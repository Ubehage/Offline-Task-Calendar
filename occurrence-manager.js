/* Offline Task Calendar — occurrence and absence scheduling
 * Plain JavaScript module loaded as a classic browser script.
 */
(function (root, factory) {
  const recurrence = root.OTCRecurrence || (typeof module !== "undefined" && module.exports ? require("./recurrence-engine.js") : null);
  const api = factory(recurrence);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OTCOccurrences = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (R) {
  "use strict";
  if (!R) throw new Error("Load recurrence-engine.js before occurrence-manager.js.");

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return "occ-" + crypto.randomUUID();
    return "occ-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isTaskDateAllowed(task, date) {
    const month = R.parseDate(date).month;
    const selectedMonths = Array.isArray(task.rule.months) ? task.rule.months : [];
    return !selectedMonths.length || selectedMonths.includes(month);
  }
  function pendingForTask(state, taskId) {
    return state.occurrences.find(item => item.taskId === taskId && item.status === "pending") || null;
  }
  function addOccurrence(state, task, originalDate, scheduledDate, extra) {
    const item = Object.assign({
      id: uid(), taskId: task.id, originalDate, scheduledDate,
      status: "pending", rescheduleHistory: [], createdAt: new Date().toISOString()
    }, extra || {});
    state.occurrences.push(item);
    return item;
  }
  function addSkipped(state, task, originalDate, scheduledDate, reason, skippedDate) {
    const item = addOccurrence(state, task, originalDate, scheduledDate, { status: "skipped" });
    item.skippedDate = skippedDate || scheduledDate;
    item.skipReason = reason;
    item.resolvedAt = new Date().toISOString();
    return item;
  }
  function mergeAbsences(absences) {
    const sorted = (absences || []).slice().sort((a, b) => cmp(a.startDate, b.startDate));
    const merged = [];
    for (const absence of sorted) {
      const last = merged[merged.length - 1];
      if (!last || cmp(absence.startDate, R.addDays(last.endDate, 1)) > 0) {
        merged.push({ startDate: absence.startDate, endDate: absence.endDate, ids: [absence.id] });
      } else {
        if (cmp(absence.endDate, last.endDate) > 0) last.endDate = absence.endDate;
        last.ids.push(absence.id);
      }
    }
    return merged;
  }
  function absenceGroupContaining(state, date) {
    return mergeAbsences(state.absences).find(group => cmp(date, group.startDate) >= 0 && cmp(date, group.endDate) <= 0) || null;
  }
  function absenceGroupAffecting(state, date, today) {
    const groups = mergeAbsences(state.absences);
    const containing = groups.find(group => cmp(date, group.startDate) >= 0 && cmp(date, group.endDate) <= 0);
    if (containing) return containing;
    // An unfinished overdue occurrence is also affected by an absence that has
    // already started, even when its original due date was before the absence.
    return groups.find(group => cmp(date, group.startDate) < 0 && cmp(group.startDate, today) <= 0) || null;
  }
  function firstDayAfterAbsences(state, date) {
    let target = R.addDays(date, 1);
    for (let guard = 0; guard < 100; guard++) {
      const group = absenceGroupContaining(state, target);
      if (!group) return target;
      target = R.addDays(group.endDate, 1);
    }
    throw new Error("Unable to resolve overlapping absence dates.");
  }
  function recurrenceAnchor(task) {
    return task.scheduleAnchorDate || task.anchorDate;
  }

  function recoverScheduleAnchor(state, task, pending) {
    // Recover a cadence shift from v1.3.3 records, which stored the manual
    // reschedule on the occurrence but did not persist it on the task. A null
    // value is an explicit reset (for example, after editing the recurrence).
    if (task.scheduleAnchorDate !== undefined) return;

    const completed = state.occurrences
      .filter(item => item.taskId === task.id && item.status === "completed")
      .sort((a, b) => cmp(a.resolvedAt || "", b.resolvedAt || ""));
    const latestCompletionAt = completed.length ? (completed[completed.length - 1].resolvedAt || "") : "";

    if (pending && Array.isArray(pending.rescheduleHistory)) {
      const latestManual = pending.rescheduleHistory
        .filter(entry => entry.reason === "manual")
        .sort((a, b) => cmp(a.at, b.at));
      if (latestManual.length && latestManual[latestManual.length - 1].at > latestCompletionAt) {
        task.scheduleAnchorDate = pending.scheduledDate;
        return;
      }
    }

    const skipped = state.occurrences
      .filter(item => item.taskId === task.id && item.status === "skipped" && Array.isArray(item.rescheduleHistory) &&
        item.rescheduleHistory.some(entry => entry.reason === "manual"))
      .sort((a, b) => cmp(a.resolvedAt || "", b.resolvedAt || ""));
    if (skipped.length) {
      const latest = skipped[skipped.length - 1];
      if ((latest.resolvedAt || "") > latestCompletionAt) task.scheduleAnchorDate = latest.scheduledDate;
    }
  }

  function nextBaseDate(state, task, afterDate) {
    const anchor = recurrenceAnchor(task);
    // The initial anchor is inclusive for a new task. A schedule anchor exists
    // only after a manual postponement, so it is exclusive: the postponed
    // occurrence itself must not be generated again after it is skipped.
    let after = afterDate || (task.scheduleAnchorDate ? task.scheduleAnchorDate : task.hasCompleted ? task.anchorDate : R.addDays(task.anchorDate, -1));
    for (let guard = 0; guard < 1500; guard++) {
      const searchYears = task.rule.frequency === "year" ? task.rule.interval + 1 : task.rule.frequency === "month" ? Math.ceil(task.rule.interval / 12) + 2 : 20;
      const next = R.nextOccurrence({ anchor, after, rule: task.rule, maxYears: searchYears });
      if (!next) return null;
      const skipped = state.occurrences.some(item => item.taskId === task.id && item.status === "skipped" && item.originalDate === next);
      if (skipped) { after = next; continue; }
      return next;
    }
    return null;
  }

  /**
   * Ensure each task has at most one pending occurrence. This method mutates state
   * only to materialize due occurrences and absence/season decisions.
   *
   * `today` is injectable for deterministic tests; callers normally omit it.
   */
  function reconcile(state, today) {
    today = today || localToday();
    R.parseDate(today, "Today");
    let pass = 0;
    let repeat = true;
    while (repeat && pass++ < 1500) {
      repeat = false;
      const distribution = new Map();

      for (const task of state.tasks) {
        let pending = pendingForTask(state, task.id);
        // Recover cadence shifts from the immediately preceding app release,
        // including an occurrence that was already skipped after postponement.
        recoverScheduleAnchor(state, task, pending);
        const coveredGroup = pending ? absenceGroupAffecting(state, pending.scheduledDate, today) : null;
        if (pending && (!coveredGroup || pending.absenceGroupEnd === coveredGroup.endDate)) continue;

        if (!pending) {
          let searchAfter = null;
          for (let guard = 0; guard < 1500; guard++) {
            const candidate = nextBaseDate(state, task, searchAfter);
            if (!candidate) break;
            const group = absenceGroupAffecting(state, candidate, today);
            if (!group) {
              addOccurrence(state, task, candidate, candidate);
              break;
            }
            if (task.absencePolicy === "skip") {
              addSkipped(state, task, candidate, candidate, "absence", candidate);
              searchAfter = candidate;
              repeat = true;
              continue;
            }
            if (task.absencePolicy === "postpone") {
              const target = firstDayAfterAbsences(state, group.endDate);
              if (!isTaskDateAllowed(task, target)) {
                addSkipped(state, task, candidate, target, "season", target);
                searchAfter = candidate;
                repeat = true;
                continue;
              }
              addOccurrence(state, task, candidate, target, { absenceGroupEnd: group.endDate });
              break;
            }
            if (task.absencePolicy === "distribute") {
              if (!distribution.has(group.endDate)) distribution.set(group.endDate, []);
              distribution.get(group.endDate).push({ task, originalDate: candidate, existing: null });
              break;
            }
          }
        } else if (coveredGroup) {
          if (task.absencePolicy === "skip") {
            pending.status = "skipped";
            pending.skippedDate = pending.originalDate;
            pending.skipReason = "absence";
            pending.resolvedAt = new Date().toISOString();
            repeat = true;
          } else if (task.absencePolicy === "postpone") {
            const target = firstDayAfterAbsences(state, coveredGroup.endDate);
            pending.rescheduleHistory = pending.rescheduleHistory || [];
            pending.rescheduleHistory.push({ from: pending.scheduledDate, to: target, at: new Date().toISOString(), reason: "absence" });
            if (!isTaskDateAllowed(task, target)) {
              pending.status = "skipped";
              pending.scheduledDate = target;
              pending.skippedDate = target;
              pending.skipReason = "season";
              pending.resolvedAt = new Date().toISOString();
              repeat = true;
            } else {
              pending.scheduledDate = target;
              pending.absenceGroupEnd = coveredGroup.endDate;
            }
          } else if (task.absencePolicy === "distribute") {
            if (!distribution.has(coveredGroup.endDate)) distribution.set(coveredGroup.endDate, []);
            distribution.get(coveredGroup.endDate).push({ task, originalDate: pending.originalDate, existing: pending });
          }
        }
      }

      for (const [groupEnd, items] of distribution.entries()) {
        items.sort((a, b) => cmp(a.originalDate, b.originalDate) || a.task.name.localeCompare(b.task.name));
        let cursor = R.addDays(groupEnd, 1);
        for (const item of items) {
          const otherAbsence = absenceGroupContaining(state, cursor);
          if (otherAbsence) cursor = R.addDays(otherAbsence.endDate, 1);
          const target = cursor;
          cursor = R.addDays(cursor, 1);
          if (!isTaskDateAllowed(item.task, target)) {
            if (item.existing) {
              item.existing.status = "skipped";
              item.existing.scheduledDate = target;
              item.existing.skippedDate = target;
              item.existing.skipReason = "season";
              item.existing.resolvedAt = new Date().toISOString();
            } else {
              addSkipped(state, item.task, item.originalDate, target, "season", target);
            }
            repeat = true;
            continue;
          }
          if (item.existing) {
            item.existing.rescheduleHistory = item.existing.rescheduleHistory || [];
            item.existing.rescheduleHistory.push({ from: item.existing.scheduledDate, to: target, at: new Date().toISOString(), reason: "absence" });
            item.existing.scheduledDate = target;
            item.existing.absenceGroupEnd = groupEnd;
          } else {
            addOccurrence(state, item.task, item.originalDate, target, { absenceGroupEnd: groupEnd });
          }
        }
      }
    }
    return state;
  }

  function localToday() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function pendingDisplay(state, today) {
    today = today || localToday();
    return state.occurrences.filter(item => item.status === "pending").map(item => {
      const task = state.tasks.find(candidate => candidate.id === item.taskId);
      if (!task) return null;
      const autoMoved = item.scheduledDate < today;
      const overdueDays = item.originalDate < today ? R.daysBetween(item.originalDate, today) : 0;
      return { occurrence: item, task, displayDate: autoMoved ? today : item.scheduledDate, overdueDays, autoMoved };
    }).filter(Boolean);
  }

  /**
   * Return non-persistent future recurrence previews for the currently visible
   * calendar range. The task still has only one actionable pending occurrence;
   * later dates are projections and become actionable as earlier occurrences
   * are completed or skipped.
   */
  function projectedDisplay(state, from, to, today) {
    today = today || localToday();
    R.parseDate(today, "Today");
    R.parseDate(from, "From");
    R.parseDate(to, "To");
    if (cmp(to, from) < 0) throw new TypeError("To date must not be before from date.");

    const projected = [];
    const distribution = new Map();
    const pendingTargets = new Map();

    // Existing occurrences already distributed by reconcile reserve the first
    // day(s) after their absence. New previews continue after those assignments.
    state.occurrences.forEach(item => {
      if (item.status === "pending" && item.absenceGroupEnd) {
        const task = state.tasks.find(value => value.id === item.taskId);
        if (!task || task.absencePolicy !== "distribute") return;
        const key = item.absenceGroupEnd;
        const current = pendingTargets.get(key);
        if (!current || cmp(item.scheduledDate, current) > 0) pendingTargets.set(key, item.scheduledDate);
      }
    });

    for (const task of state.tasks) {
      const pending = pendingForTask(state, task.id);
      if (!pending) continue;
      const manuallyAdjusted = Boolean(task.scheduleAnchorDate);
      // Ordinary overdue items still block forecasts. A manually postponed item
      // has a new recurrence phase, so its later occurrences remain visible even
      // when the original due date is already in the past. Absence postponements
      // continue to forecast from the unmodified recurrence anchor.
      if (cmp(pending.originalDate, today) < 0 && !manuallyAdjusted && !pending.absenceGroupEnd) continue;
      if (pending.scheduledDate !== pending.originalDate && !pending.absenceGroupEnd && !manuallyAdjusted) continue;

      const searchFrom = R.addDays(manuallyAdjusted ? pending.scheduledDate : pending.originalDate, 1);
      if (cmp(searchFrom, to) > 0) continue;
      const candidates = R.generateOccurrences({
        anchor: recurrenceAnchor(task),
        rule: task.rule,
        from: searchFrom,
        to,
        limit: 10000
      });

      for (const originalDate of candidates) {
        // Never display a forecast for an occurrence that has already been
        // recorded (for example, an imported historical skip).
        const recorded = state.occurrences.some(item => item.taskId === task.id && item.originalDate === originalDate);
        if (recorded) continue;
        const group = absenceGroupContaining(state, originalDate);
        if (!group) {
          if (cmp(originalDate, from) >= 0) projected.push(makeProjection(task, originalDate, originalDate));
          continue;
        }
        if (task.absencePolicy === "skip") continue;
        if (task.absencePolicy === "postpone") {
          const target = firstDayAfterAbsences(state, group.endDate);
          if (!isTaskDateAllowed(task, target) || cmp(target, from) < 0 || cmp(target, to) > 0) continue;
          projected.push(makeProjection(task, originalDate, target));
          continue;
        }
        if (!distribution.has(group.endDate)) distribution.set(group.endDate, []);
        distribution.get(group.endDate).push({ task, originalDate, groupEnd: group.endDate });
      }
    }

    for (const [groupEnd, items] of distribution.entries()) {
      items.sort((a, b) => cmp(a.originalDate, b.originalDate) || a.task.name.localeCompare(b.task.name) || a.task.id.localeCompare(b.task.id));
      let cursor = pendingTargets.has(groupEnd) ? R.addDays(pendingTargets.get(groupEnd), 1) : R.addDays(groupEnd, 1);
      for (const item of items) {
        const otherAbsence = absenceGroupContaining(state, cursor);
        if (otherAbsence) cursor = R.addDays(otherAbsence.endDate, 1);
        const target = cursor;
        cursor = R.addDays(cursor, 1);
        if (!isTaskDateAllowed(item.task, target) || cmp(target, from) < 0 || cmp(target, to) > 0) continue;
        projected.push(makeProjection(item.task, item.originalDate, target));
      }
    }

    return projected.sort((a, b) => cmp(a.displayDate, b.displayDate) || a.task.name.localeCompare(b.task.name));
  }

  function makeProjection(task, originalDate, displayDate) {
    return {
      type: "projected",
      projected: true,
      task,
      occurrence: {
        id: null,
        taskId: task.id,
        originalDate,
        scheduledDate: displayDate,
        status: "projected"
      },
      displayDate,
      overdueDays: 0,
      autoMoved: false
    };
  }

  function complete(state, occurrenceId, completedDate) {
    completedDate = completedDate || localToday();
    R.parseDate(completedDate, "Completion date");
    const item = state.occurrences.find(value => value.id === occurrenceId && value.status === "pending");
    if (!item) throw new Error("Pending occurrence not found.");
    const task = state.tasks.find(value => value.id === item.taskId);
    if (!task) throw new Error("Task not found.");
    item.status = "completed";
    item.completedDate = completedDate;
    item.resolvedAt = new Date().toISOString();
    task.anchorDate = completedDate;
    task.hasCompleted = true;
    // Completion becomes the definitive new anchor and clears any temporary
    // schedule shift introduced by postponement.
    delete task.scheduleAnchorDate;
    return item;
  }

  function skip(state, occurrenceId, skippedDate, reason) {
    skippedDate = skippedDate || localToday();
    R.parseDate(skippedDate, "Skipped date");
    const item = state.occurrences.find(value => value.id === occurrenceId && value.status === "pending");
    if (!item) throw new Error("Pending occurrence not found.");
    item.status = "skipped";
    item.skippedDate = skippedDate;
    item.skipReason = reason || "manual";
    item.resolvedAt = new Date().toISOString();
    return item;
  }

  function postpone(state, occurrenceId, targetDate, changedAt) {
    R.parseDate(targetDate, "New date");
    const item = state.occurrences.find(value => value.id === occurrenceId && value.status === "pending");
    if (!item) throw new Error("Pending occurrence not found.");
    const task = state.tasks.find(value => value.id === item.taskId);
    if (!task) throw new Error("Task not found.");
    if (!isTaskDateAllowed(task, targetDate)) {
      item.status = "skipped";
      item.scheduledDate = targetDate;
      item.skippedDate = targetDate;
      item.skipReason = "season";
      item.resolvedAt = new Date().toISOString();
      return { item, skipped: true };
    }
    item.rescheduleHistory = item.rescheduleHistory || [];
    item.rescheduleHistory.push({ from: item.scheduledDate, to: targetDate, at: changedAt || new Date().toISOString(), reason: "manual" });
    item.scheduledDate = targetDate;
    // Shift the future recurrence series as well. Keeping this on the task means
    // a subsequent Skip advances the adjusted series instead of restoring dates
    // from the old anchor. Complete clears it and re-anchors from actual completion.
    task.scheduleAnchorDate = targetDate;
    delete item.absenceGroupEnd;
    return { item, skipped: false };
  }

  return { complete, mergeAbsences, pendingDisplay, pendingForTask, postpone, projectedDisplay, reconcile, skip };
});
