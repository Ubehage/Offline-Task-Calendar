/* Offline Task Calendar — application controller
 * Vanilla JavaScript only. No network access and no browser storage for user data.
 * Persistent user data is imported/exported as one JSON file.
 */
(function () {
  "use strict";

  const R = window.OTCRecurrence;
  const O = window.OTCOccurrences;
  if (!R || !O) throw new Error("The scheduling modules did not load.");

  const $ = id => document.getElementById(id);
  const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let state = emptyState();
  let dirty = false;
  let loadedFileName = "";
  let view = "month";
  let viewDate = todayLocal();
  let selectedDate = todayLocal();
  let toastTimer = null;
  let lastObservedDate = todayLocal();
  let pendingByDate = new Map();
  let historyByDate = new Map();

  function emptyState() {
    return { version: 2, settings: { weekStartsOn: 1, theme: "system" }, tasks: [], absences: [], occurrences: [] };
  }

  function themeSetting() {
    const value = state && state.settings ? state.settings.theme : "system";
    return ["system", "light", "dark"].includes(value) ? value : "system";
  }

  function applyTheme() {
    const setting = themeSetting();
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
    const resolved = setting === "system" ? (media && media.matches ? "dark" : "light") : setting;
    const root = document.documentElement;
    if (root) {
      root.setAttribute("data-theme", resolved);
    }

    const button = $("themeToggle");
    if (button) {
      const stateLabel = setting === "system" ? "System" : (setting === "dark" ? "Dark" : "Light");
      const icon = resolved === "dark" ? "☾" : "☀";
      button.textContent = icon + " Theme: " + stateLabel;
      button.title = "Current theme: " + stateLabel + (setting === "system" ? " (" + resolved + ")" : "") + ". Activate to cycle System, Dark and Light.";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", resolved === "dark" ? "true" : "false");
    }
  }

  function cycleTheme() {
    const current = themeSetting();
    const next = current === "system" ? "dark" : current === "dark" ? "light" : "system";
    state.settings.theme = next;
    applyTheme();
    markChanged("Theme set to " + next);
  }

  function todayLocal() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  }

  function randomId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return prefix + "-" + window.crypto.randomUUID();
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function formatDate(dateString, options) {
    const p = R.parseDate(dateString);
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
    return new Intl.DateTimeFormat(undefined, options || { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function monthTitle(dateString) {
    const p = R.parseDate(dateString);
    return MONTH_LABELS[p.month - 1] + " " + p.year;
  }

  function dateParts(dateString) { return R.parseDate(dateString); }
  function compareDates(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function setDirty(value) {
    dirty = Boolean(value);
    const status = $("saveStatus");
    if (dirty) {
      status.textContent = "Unsaved changes";
      status.className = "save-status unsaved";
    } else if (loadedFileName) {
      status.textContent = "Saved · " + loadedFileName;
      status.className = "save-status saved";
    } else {
      status.textContent = state.tasks.length || state.absences.length ? "Not saved to a file" : "No save file loaded";
      status.className = "save-status";
    }
  }

  function markChanged(message) {
    setDirty(true);
    if (message) showToast(message);
    renderAll();
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function getTask(taskId) { return state.tasks.find(task => task.id === taskId) || null; }
  function getOccurrence(occurrenceId) { return state.occurrences.find(item => item.id === occurrenceId) || null; }
  function pendingForTask(taskId) { return O.pendingForTask(state, taskId); }

  function reconcileSchedules() {
    const before = JSON.stringify(state.occurrences);
    O.reconcile(state, todayLocal());
    if (JSON.stringify(state.occurrences) !== before) dirty = true;
  }

  function visibleCalendarRange() {
    const p = dateParts(viewDate);
    if (view === "month") {
      const first = String(p.year).padStart(4, "0") + "-" + String(p.month).padStart(2, "0") + "-01";
      const offset = (R.weekday(first) + 6) % 7;
      const start = R.addDays(first, -offset);
      return { from: start, to: R.addDays(start, 41) };
    }
    if (view === "year") {
      return { from: String(p.year).padStart(4, "0") + "-01-01", to: String(p.year).padStart(4, "0") + "-12-31" };
    }
    const firstYear = Math.floor(p.year / 10) * 10;
    return {
      from: String(firstYear).padStart(4, "0") + "-01-01",
      to: String(firstYear + 9).padStart(4, "0") + "-12-31"
    };
  }

  function addPendingEvent(entry, type) {
    if (!pendingByDate.has(entry.displayDate)) pendingByDate.set(entry.displayDate, []);
    pendingByDate.get(entry.displayDate).push({
      type,
      task: entry.task,
      occurrence: entry.occurrence,
      overdueDays: entry.overdueDays || 0,
      autoMoved: Boolean(entry.autoMoved),
      projected: Boolean(entry.projected)
    });
  }

  function rebuildEventIndexes() {
    pendingByDate = new Map();
    historyByDate = new Map();
    const today = todayLocal();
    for (const entry of O.pendingDisplay(state, today)) addPendingEvent(entry, "pending");
    const range = visibleCalendarRange();
    for (const entry of O.projectedDisplay(state, range.from, range.to, today)) addPendingEvent(entry, "projected");
    for (const item of state.occurrences) {
      let date = null, type = null;
      // Resolved actions belong to the calendar day the user selected when
      // recording them. This is the occurrence's action/for date, not the task's
      // initial anchor date. resolvedAt still records the exact actual timestamp.
      if (item.status === "completed") { date = item.completedDate; type = "completed"; }
      else if (item.status === "skipped") { date = item.skippedDate; type = "skipped"; }
      if (!date) continue;
      const task = getTask(item.taskId);
      if (!task) continue;
      if (!historyByDate.has(date)) historyByDate.set(date, []);
      historyByDate.get(date).push({ type, task, occurrence: item });
    }
  }

  function eventsForDate(dateString) {
    const events = [];
    if (pendingByDate.has(dateString)) events.push(...pendingByDate.get(dateString));
    if (historyByDate.has(dateString)) events.push(...historyByDate.get(dateString));
    for (const absence of state.absences) {
      if (compareDates(dateString, absence.startDate) >= 0 && compareDates(dateString, absence.endDate) <= 0) {
        events.push({ type: "absence", absence });
      }
    }
    return events;
  }

  function eventsInMonth(year, month) {
    const count = R.daysInMonth(year, month);
    const result = new Map();
    for (let day = 1; day <= count; day++) {
      const date = String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      const events = eventsForDate(date);
      if (events.length) result.set(date, events);
    }
    return result;
  }

  function renderMonth() {
    const p = dateParts(viewDate);
    const first = String(p.year).padStart(4, "0") + "-" + String(p.month).padStart(2, "0") + "-01";
    const offset = (R.weekday(first) + 6) % 7;
    const gridStart = R.addDays(first, -offset);
    const today = todayLocal();
    let html = '<div class="month-grid">';
    DAY_LABELS.forEach(label => { html += '<div class="weekday-heading">' + label + '</div>'; });
    for (let i = 0; i < 42; i++) {
      const date = R.addDays(gridStart, i);
      const dp = dateParts(date);
      const isOutside = dp.month !== p.month;
      const events = eventsForDate(date);
      const classes = ["day-cell", isOutside ? "outside-month" : "", date === today ? "today" : "", date === selectedDate ? "selected" : ""].filter(Boolean).join(" ");
      html += '<div class="' + classes + '" data-date="' + date + '" role="button" tabindex="0" aria-label="' + esc(formatDate(date)) + '">';
      html += '<span class="day-number">' + dp.day + '</span><div class="day-items">';
      events.slice(0, 3).forEach(event => {
        if (event.type === "absence") {
          html += '<span class="calendar-task absence">' + esc(event.absence.name) + '</span>';
        } else {
          const klass = event.type === "pending" ? (event.overdueDays ? "overdue" : "") : event.type;
          const prefix = event.type === "completed" ? "✓ " : event.type === "skipped" ? "– " : "";
          const hint = event.type === "projected" ? "Upcoming recurrence · Open task settings" : "Open task settings";
          html += '<button class="calendar-task ' + klass + '" type="button" data-open-task="' + esc(event.task.id) + '" title="' + esc(hint) + '">' + prefix + esc(event.task.name) + (event.overdueDays ? " · " + event.overdueDays + "d late" : "") + '</button>';
        }
      });
      if (events.length > 3) html += '<span class="more-items">+' + (events.length - 3) + ' more</span>';
      html += '</div></div>';
    }
    html += '</div>';
    $("calendarContainer").innerHTML = html;
  }

  function renderYear() {
    const year = dateParts(viewDate).year;
    const today = todayLocal();
    let html = '<div class="year-grid">';
    for (let month = 1; month <= 12; month++) {
      const first = String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-01";
      const offset = (R.weekday(first) + 6) % 7;
      const days = R.daysInMonth(year, month);
      html += '<div class="mini-month" data-month="' + month + '"><h3>' + MONTH_LABELS[month - 1] + '</h3><div class="mini-weekdays">';
      DAY_LABELS.forEach(label => { html += '<span>' + label.slice(0, 1) + '</span>'; });
      html += '</div><div class="mini-days">';
      for (let blank = 0; blank < offset; blank++) html += '<span class="mini-day outside"></span>';
      for (let day = 1; day <= days; day++) {
        const date = String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
        const events = eventsForDate(date);
        const hasPending = events.some(event => event.type === "pending" || event.type === "projected");
        const hasCompleted = events.some(event => event.type === "completed");
        const hasSkipped = events.some(event => event.type === "skipped");
        const hasItems = hasPending || hasCompleted || hasSkipped;
        const hasAbsence = events.some(event => event.type === "absence");
        const cls = ["mini-day", hasItems ? "has-items" : "", hasPending ? "has-pending" : "", hasCompleted ? "has-completed" : "", hasSkipped ? "has-skipped" : "", hasAbsence ? "has-absence" : "", date === today ? "is-today" : ""].filter(Boolean).join(" ");
        html += '<span class="' + cls + '" data-date="' + date + '" title="' + esc(formatDate(date)) + '">' + day + '</span>';
      }
      html += '</div></div>';
    }
    html += '</div>';
    $("calendarContainer").innerHTML = html;
  }

  function renderDecade() {
    const selectedYear = dateParts(viewDate).year;
    const firstYear = Math.floor(selectedYear / 10) * 10;
    const todayYear = dateParts(todayLocal()).year;
    let html = '<div class="decade-grid">';
    for (let year = firstYear; year < firstYear + 10; year++) {
      let activeCount = 0, completedCount = 0;
      const fills = [];
      for (let month = 1; month <= 12; month++) {
        const events = eventsInMonth(year, month);
        let count = 0, done = 0;
        for (const list of events.values()) {
          for (const event of list) {
            if (event.type === "pending" || event.type === "projected") count++;
            if (event.type === "completed") done++;
          }
        }
        activeCount += count;
        completedCount += done;
        fills.push({ count, done });
      }
      html += '<button class="decade-year" type="button" data-year="' + year + '"><h3>' + year + (year === todayYear ? ' <span class="optional">· current year</span>' : '') + '</h3><div class="year-month-bars">';
      fills.forEach(item => {
        const fill = Math.min(100, item.count * 18 + item.done * 10);
        const fillClass = 'fill-' + (Math.round(fill / 10) * 10);
        html += '<span class="' + fillClass + ' ' + (item.done && !item.count ? 'has-completed' : '') + '" title="' + (item.count + item.done) + ' task events"></span>';
      });
      html += '</div><div class="year-month-labels">' + SHORT_MONTHS.map(m => '<span>' + m[0] + '</span>').join("") + '</div><p class="decade-caption">' + activeCount + ' scheduled · ' + completedCount + ' completed</p></button>';
    }
    html += '</div>';
    $("calendarContainer").innerHTML = html;
  }

  function renderCalendar() {
    $("viewTitle").textContent = view === "month" ? monthTitle(viewDate) : view === "year" ? String(dateParts(viewDate).year) : (Math.floor(dateParts(viewDate).year / 10) * 10) + "–" + (Math.floor(dateParts(viewDate).year / 10) * 10 + 9);
    document.querySelectorAll(".view-button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
    if (!state.tasks.length && !state.absences.length && view === "month") {
      renderMonth();
      return;
    }
    if (view === "month") renderMonth();
    else if (view === "year") renderYear();
    else renderDecade();
  }

  function eventCard(event) {
    const occurrence = event.occurrence;
    const type = event.type;
    let badge = "", meta = "";
    if (type === "pending") {
      badge = event.overdueDays ? '<span class="status-badge status-overdue">' + event.overdueDays + ' day' + (event.overdueDays === 1 ? '' : 's') + ' overdue</span>' : '<span class="status-badge status-pending">Scheduled</span>';
      if (event.autoMoved) meta = 'Automatically moved to today · Originally due ' + formatDate(occurrence.originalDate);
      else if (occurrence.scheduledDate !== occurrence.originalDate) meta = 'Postponed to ' + formatDate(occurrence.scheduledDate) + ' · Originally due ' + formatDate(occurrence.originalDate);
      else meta = 'Scheduled ' + formatDate(occurrence.scheduledDate);
    } else if (type === "projected") {
      badge = '<span class="status-badge status-projected">Upcoming</span>';
      meta = 'Upcoming recurrence · ' + formatDate(occurrence.originalDate);
    } else if (type === "completed") {
      badge = '<span class="status-badge status-completed">Completed</span>';
      meta = 'Completed ' + formatDate(occurrence.completedDate) +
        (occurrence.scheduledDate !== occurrence.completedDate ? ' · For ' + formatDate(occurrence.scheduledDate) : '') +
        (occurrence.originalDate !== occurrence.scheduledDate ? ' · Originally due ' + formatDate(occurrence.originalDate) : '');
    } else {
      badge = '<span class="status-badge status-skipped">Skipped</span>';
      const skipDescription = occurrence.skipReason === "absence" ? 'Skipped during absence' : occurrence.skipReason === "season" ? 'Skipped outside selected months' : 'Skipped manually';
      meta = skipDescription + ' · Recorded ' + formatDate(occurrence.skippedDate) +
        (occurrence.scheduledDate !== occurrence.skippedDate ? ' · For ' + formatDate(occurrence.scheduledDate) : '') +
        (occurrence.originalDate !== occurrence.scheduledDate ? ' · Originally due ' + formatDate(occurrence.originalDate) : '');
    }
    let actions = "";
    if (type === "pending") {
      actions = '<div class="occurrence-actions"><button class="small-action complete" data-action="complete" data-occurrence="' + esc(occurrence.id) + '">Complete</button><button class="small-action" data-action="postpone" data-occurrence="' + esc(occurrence.id) + '">Postpone</button><button class="small-action skip" data-action="skip" data-occurrence="' + esc(occurrence.id) + '">Skip</button></div>';
    }
    return '<article class="occurrence-card"><div class="occurrence-top"><h3 class="occurrence-name"><button class="task-name-link" type="button" data-open-task="' + esc(event.task.id) + '" title="Edit task settings">' + esc(event.task.name) + '</button></h3>' + badge + '</div><p class="occurrence-meta">' + esc(meta) + '</p>' + actions + '</article>';
  }

  function renderSelectedDay() {
    $("selectedDateTitle").textContent = formatDate(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const events = eventsForDate(selectedDate);
    const absences = events.filter(event => event.type === "absence");
    const pending = events.filter(event => event.type === "pending");
    const projected = events.filter(event => event.type === "projected");
    const completed = events.filter(event => event.type === "completed");
    const skipped = events.filter(event => event.type === "skipped");
    let html = "";
    absences.forEach(event => { html += '<div class="absence-banner">◌ ' + esc(event.absence.name) + ' · ' + formatDate(event.absence.startDate) + ' – ' + formatDate(event.absence.endDate) + '</div>'; });
    if (pending.length) {
      html += '<p class="day-section-label">To do (' + pending.length + ')</p>';
      pending.forEach(event => { html += eventCard(event); });
    }
    if (projected.length) {
      html += '<p class="day-section-label">Upcoming (' + projected.length + ')</p>';
      projected.forEach(event => { html += eventCard(event); });
    }
    if (completed.length) {
      html += '<p class="day-section-label">Completed (' + completed.length + ')</p>';
      completed.forEach(event => { html += eventCard(event); });
    }
    if (skipped.length) {
      html += '<p class="day-section-label">Skipped (' + skipped.length + ')</p>';
      skipped.forEach(event => { html += eventCard(event); });
    }
    if (!html) {
      html = '<div class="day-empty"><span class="empty-icon">◷</span>No tasks or absences on this date.<br>Use “New task” to add a recurring task.</div>';
    }
    $("selectedDayContent").innerHTML = html;
  }

  function updateTodayTaskCount() {
    const today = todayLocal();
    // Count task occurrences displayed for today, but do not count absence banners.
    const count = eventsForDate(today).filter(event => event.type !== "absence").length;
    const label = count + (count === 1 ? " task today" : " tasks today");
    const counter = $("todayTaskCount");
    if (counter) counter.textContent = label;
    document.title = "Offline Task Calendar — " + label;
  }

  function renderAll() {
    reconcileSchedules();
    rebuildEventIndexes();
    $("taskCount").textContent = String(state.tasks.length);
    updateTodayTaskCount();
    renderCalendar();
    renderSelectedDay();
    setDirty(dirty);
  }

  function openDialog(id) {
    const dialog = $(id);
    if (dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
  }
  function closeDialog(id) {
    const dialog = $(id);
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function clearTaskRuleEditor() {
    $("ordinalRules").innerHTML = "";
    document.querySelectorAll("#weekdayPicker input").forEach(input => { input.checked = false; });
    document.querySelectorAll("#monthPicker input").forEach(input => { input.checked = false; });
    $("monthDaysInput").value = "";
  }

  function addOrdinalRow(value) {
    if (document.querySelectorAll("#ordinalRules .dynamic-rule-row").length >= 42) {
      showToast("A task can have at most 42 ordinal weekday rules.");
      return;
    }
    const row = document.createElement("div");
    row.className = "dynamic-rule-row";
    const ordinal = document.createElement("select");
    ordinal.className = "text-input";
    ordinal.dataset.ordinal = "";
    [[1, "First"], [2, "Second"], [3, "Third"], [4, "Fourth"], [5, "Fifth"], [-1, "Last"]].forEach(([number, label]) => {
      const option = document.createElement("option"); option.value = String(number); option.textContent = label; ordinal.appendChild(option);
    });
    const day = document.createElement("select");
    day.className = "text-input";
    day.dataset.weekday = "";
    [1, 2, 3, 4, 5, 6, 0].forEach(number => {
      const option = document.createElement("option"); option.value = String(number); option.textContent = WEEKDAY_LABELS[number]; day.appendChild(option);
    });
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "remove-rule"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remove rule");
    remove.addEventListener("click", () => row.remove());
    if (value) { ordinal.value = String(value.ordinal); day.value = String(value.weekday); }
    row.append(ordinal, day, remove);
    $("ordinalRules").appendChild(row);
  }

  function openTaskDialog(task, initialDate) {
    clearTaskRuleEditor();
    $("taskFormError").textContent = "";
    $("taskId").value = task ? task.id : "";
    $("taskDialogTitle").textContent = task ? "Edit task" : "New task";
    $("taskName").value = task ? task.name : "";
    $("taskAnchor").value = task ? task.anchorDate : (initialDate || selectedDate || todayLocal());
    $("taskAbsencePolicy").value = task ? task.absencePolicy : "skip";
    $("ruleInterval").value = task ? task.rule.interval : 1;
    $("ruleFrequency").value = task ? task.rule.frequency : "week";
    if (task) {
      (task.rule.weekdays || []).forEach(day => { const input = document.querySelector('#weekdayPicker input[value="' + day + '"]'); if (input) input.checked = true; });
      $("monthDaysInput").value = (task.rule.monthDays || []).join(", ");
      (task.rule.months || []).forEach(month => { const input = document.querySelector('#monthPicker input[value="' + month + '"]'); if (input) input.checked = true; });
      (task.rule.weekdayPositions || []).forEach(addOrdinalRow);
    }
    openDialog("taskDialog");
    setTimeout(() => $("taskName").focus(), 30);
  }

  function parseTaskRuleFromForm() {
    const frequency = $("ruleFrequency").value;
    const interval = Number($("ruleInterval").value);
    const weekdays = Array.from(document.querySelectorAll("#weekdayPicker input:checked")).map(input => Number(input.value));
    const months = Array.from(document.querySelectorAll("#monthPicker input:checked")).map(input => Number(input.value));
    const monthText = $("monthDaysInput").value.trim();
    const monthDays = monthText ? monthText.split(",").map(value => {
      const clean = value.trim().toLowerCase();
      if (clean === "last") return "last";
      if (!/^\d{1,2}$/.test(clean)) throw new Error('Specific dates must be numbers from 1–31 or the word “last”.');
      const number = Number(clean);
      if (number < 1 || number > 31) throw new Error("Specific dates must be between 1 and 31.");
      return number;
    }) : [];
    const weekdayPositions = Array.from(document.querySelectorAll("#ordinalRules .dynamic-rule-row")).map(row => ({
      ordinal: Number(row.querySelector("[data-ordinal]").value),
      weekday: Number(row.querySelector("[data-weekday]").value)
    }));
    const rule = { frequency, interval, weekdays, monthDays, months, weekdayPositions };
    R.validateRule(rule);
    return rule;
  }

  function saveTaskFromForm(event) {
    event.preventDefault();
    const error = $("taskFormError"); error.textContent = "";
    try {
      const id = $("taskId").value;
      const name = $("taskName").value.trim();
      const anchorDate = $("taskAnchor").value;
      if (!name) throw new Error("Please enter a task name.");
      R.parseDate(anchorDate, "First date");
      const rule = parseTaskRuleFromForm();
      const absencePolicy = $("taskAbsencePolicy").value;
      if (!["skip", "postpone", "distribute"].includes(absencePolicy)) throw new Error("Choose a valid absence policy.");
      const existing = id ? getTask(id) : null;
      if (existing) {
        const ruleChanged = JSON.stringify(existing.rule) !== JSON.stringify(rule) || existing.anchorDate !== anchorDate;
        existing.name = name;
        existing.anchorDate = anchorDate;
        existing.rule = rule;
        existing.absencePolicy = absencePolicy;
        if (ruleChanged) {
          state.occurrences = state.occurrences.filter(item => !(item.taskId === id && item.status === "pending"));
          // null means an explicit reset. It prevents old skipped-postponement
          // history from restoring a schedule shift after the user edits rules.
          existing.scheduleAnchorDate = null;
        }
      } else {
        if (state.tasks.length >= MAX_TASKS) throw new Error("The application limit of 5,000 tasks has been reached.");
        state.tasks.push({ id: randomId("task"), name, anchorDate, hasCompleted: false, rule, absencePolicy, createdAt: new Date().toISOString() });
      }
      closeDialog("taskDialog");
      markChanged(existing ? "Task updated" : "Task created");
    } catch (err) {
      error.textContent = err.message || "Could not save this task.";
    }
  }

  function openAbsenceDialog(absence) {
    $("absenceFormError").textContent = "";
    $("absenceId").value = absence ? absence.id : "";
    $("absenceDialogTitle").textContent = absence ? "Edit absence" : "Add absence";
    $("absenceName").value = absence ? absence.name : "";
    $("absenceStart").value = absence ? absence.startDate : selectedDate;
    $("absenceEnd").value = absence ? absence.endDate : selectedDate;
    openDialog("absenceDialog");
  }

  function saveAbsenceFromForm(event) {
    event.preventDefault();
    const error = $("absenceFormError"); error.textContent = "";
    try {
      const id = $("absenceId").value;
      const name = $("absenceName").value.trim();
      const startDate = $("absenceStart").value;
      const endDate = $("absenceEnd").value;
      if (!name) throw new Error("Please enter a name for this absence.");
      R.parseDate(startDate, "Start date"); R.parseDate(endDate, "End date");
      if (compareDates(endDate, startDate) < 0) throw new Error("The end date must be on or after the start date.");
      const existing = state.absences.find(item => item.id === id);
      if (existing) Object.assign(existing, { name, startDate, endDate });
      else {
        if (state.absences.length >= MAX_ABSENCES) throw new Error("The application limit of 10,000 absences has been reached.");
        state.absences.push({ id: randomId("absence"), name, startDate, endDate });
      }
      closeDialog("absenceDialog");
      markChanged(existing ? "Absence updated" : "Absence added");
    } catch (err) { error.textContent = err.message || "Could not save this absence."; }
  }

  function renderManageDialog(kind) {
    const isTask = kind === "tasks";
    $("manageDialogTitle").textContent = isTask ? "Tasks" : "Absences";
    const items = isTask ? state.tasks : state.absences;
    // Absences are managed in their own list; keep the creation action visible
    // even when the list is empty so the first absence can be added.
    const addAbsenceAction = isTask ? "" : '<div class="manage-toolbar"><button class="button button-primary" type="button" data-add-absence>＋ Add absence</button></div>';
    if (!items.length) {
      $("manageDialogContent").innerHTML = addAbsenceAction + '<div class="empty-list">No ' + kind + ' yet.' + (isTask ? '' : '<br>Use “Add absence” to block out vacation or other time away.') + '</div>';
    } else {
      let html = addAbsenceAction + '<div class="manage-list">';
      items.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach(item => {
        let description = "";
        if (isTask) {
          const rule = item.rule;
          const unit = { day: "day", week: "week", month: "month", year: "year" }[rule.frequency];
          description = 'Every ' + rule.interval + ' ' + unit + (rule.interval > 1 ? 's' : '') + ' · ' + ({ skip: "Skip", postpone: "Postpone", distribute: "Distribute" }[item.absencePolicy] || "Skip") + ' during absences';
        } else description = formatDate(item.startDate) + ' – ' + formatDate(item.endDate);
        html += '<div class="manage-item"><div><h3>' + (isTask ? '<button class="task-name-link" type="button" data-open-task="' + esc(item.id) + '">' + esc(item.name) + '</button>' : esc(item.name)) + '</h3><p>' + esc(description) + '</p></div><div class="manage-item-actions"><button class="small-action" data-manage-edit="' + esc(item.id) + '" data-kind="' + esc(kind) + '">Edit</button><button class="small-action skip" data-manage-delete="' + esc(item.id) + '" data-kind="' + esc(kind) + '">Delete</button></div></div>';
      });
      html += '</div>';
      $("manageDialogContent").innerHTML = html;
    }
    openDialog("manageDialog");
  }

  function openPostponeDialog(occurrence) {
    const task = getTask(occurrence.taskId);
    if (!task) return;
    const currentDisplay = compareDates(occurrence.scheduledDate, todayLocal()) < 0 ? todayLocal() : occurrence.scheduledDate;
    $("postponeOccurrenceId").value = occurrence.id;
    $("postponeTaskName").textContent = task.name;
    $("postponeDate").min = R.addDays(currentDisplay, 1);
    $("postponeDate").value = R.addDays(currentDisplay, 1);
    $("postponeFormError").textContent = "";
    openDialog("postponeDialog");
  }

  function submitPostpone(event) {
    event.preventDefault();
    const error = $("postponeFormError"); error.textContent = "";
    const occurrence = getOccurrence($("postponeOccurrenceId").value);
    if (!occurrence || occurrence.status !== "pending") return;
    try {
      const task = getTask(occurrence.taskId);
      const target = $("postponeDate").value;
      R.parseDate(target, "New date");
      const min = $("postponeDate").min;
      if (compareDates(target, min) < 0) throw new Error("Choose a date later than the current scheduled date.");
      const result = O.postpone(state, occurrence.id, target);
      closeDialog("postponeDialog");
      markChanged(result.skipped ? "Outside selected active months — occurrence skipped" : "Task postponed");
    } catch (err) { error.textContent = err.message || "Could not postpone this occurrence."; }
  }

  function completeOccurrence(id) {
    try {
      O.complete(state, id, selectedDate || todayLocal());
      markChanged("Task completed · next date recalculated");
    } catch (err) {
      showToast(err.message || "Could not complete this task");
    }
  }

  function skipOccurrence(id) {
    const occurrence = getOccurrence(id);
    if (!occurrence || occurrence.status !== "pending") return;
    if (!window.confirm("Skip “" + (getTask(occurrence.taskId) || { name: "this task" }).name + "”?")) return;
    try {
      O.skip(state, id, selectedDate || todayLocal(), "manual");
      markChanged("Occurrence skipped");
    } catch (err) {
      showToast(err.message || "Could not skip this occurrence");
    }
  }

  function deleteManagedItem(id, kind) {
    if (kind === "tasks") {
      const task = getTask(id);
      if (!task || !window.confirm('Delete task “' + task.name + '” and its occurrence history?')) return;
      state.tasks = state.tasks.filter(item => item.id !== id);
      state.occurrences = state.occurrences.filter(item => item.taskId !== id);
      showToast("Task and its history deleted");
    } else {
      const absence = state.absences.find(item => item.id === id);
      if (!absence || !window.confirm('Delete absence “' + absence.name + '”? Existing rescheduling decisions will remain.')) return;
      state.absences = state.absences.filter(item => item.id !== id);
      showToast("Absence deleted");
    }
    renderManageDialog(kind);
    markChanged();
  }

  function saveJson() {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    if (blob.size > MAX_IMPORT_BYTES) {
      window.alert("This save file would exceed the 20 MB limit. Remove some old task history before exporting.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName = "offline-task-calendar.json";
    link.href = url; link.download = fileName;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    loadedFileName = fileName;
    setDirty(false);
    showToast("JSON file exported");
  }

  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  const MAX_TASKS = 5000;
  const MAX_ABSENCES = 10000;
  const MAX_OCCURRENCES = 100000;
  const MAX_HISTORY_PER_OCCURRENCE = 5000;

  function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error(label + " must be a plain JSON object.");
    }
  }

  function requireExactKeys(value, required, optional, label) {
    requireObject(value, label);
    const allowed = new Set(required.concat(optional || []));
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(label + " is missing " + key + ".");
    }
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new Error(label + " contains an unsupported field: " + key + ".");
    }
  }

  function requireString(value, label, maxLength, allowEmpty) {
    if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(label + " is invalid or too long.");
    }
  }

  function requireId(value, label) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
      throw new Error(label + " has an invalid ID.");
    }
  }

  function requireTimestamp(value, label) {
    if (typeof value !== "string" || value.length > 32 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
      throw new Error(label + " must be a valid UTC timestamp.");
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new Error(label + " must be a valid UTC timestamp.");
    }
  }

  function requireDate(value, label) {
    try { R.parseDate(value, label); }
    catch (error) { throw new Error(error.message || (label + " is invalid.")); }
  }

  function validateImportedState(data) {
    requireExactKeys(data, ["version", "settings", "tasks", "absences", "occurrences"], [], "Save file");
    if (data.version !== 2) throw new Error("Unsupported save-file version. This app only accepts version 2 files; older save files are not compatible.");

    requireExactKeys(data.settings, ["weekStartsOn", "theme"], [], "Settings");
    if (!(["system", "light", "dark"].includes(data.settings.theme))) throw new Error("The save file contains an invalid theme setting.");
    if (data.settings.weekStartsOn !== 1) throw new Error("The save file contains an unsupported week-start setting.");

    if (!Array.isArray(data.tasks) || data.tasks.length > MAX_TASKS) throw new Error("The save file has an invalid task collection or too many tasks.");
    if (!Array.isArray(data.absences) || data.absences.length > MAX_ABSENCES) throw new Error("The save file has an invalid absence collection or too many absences.");
    if (!Array.isArray(data.occurrences) || data.occurrences.length > MAX_OCCURRENCES) throw new Error("The save file has an invalid occurrence collection or too many occurrences.");

    const cleanTasks = [];
    const taskIds = new Set();
    for (const task of data.tasks) {
      requireExactKeys(task,
        ["id", "name", "anchorDate", "hasCompleted", "rule", "absencePolicy", "createdAt"], ["scheduleAnchorDate"], "Task");
      requireId(task.id, "Task");
      if (taskIds.has(task.id)) throw new Error("A task has a duplicate ID.");
      taskIds.add(task.id);
      requireString(task.name, "Task name", 100, false);
      requireDate(task.anchorDate, "Task anchor");
      if (Object.prototype.hasOwnProperty.call(task, "scheduleAnchorDate") && task.scheduleAnchorDate !== null) requireDate(task.scheduleAnchorDate, "Adjusted schedule anchor");
      if (typeof task.hasCompleted !== "boolean") throw new Error("A task has an invalid completion-state field.");
      if (!["skip", "postpone", "distribute"].includes(task.absencePolicy)) throw new Error("A task has an invalid absence policy.");
      requireTimestamp(task.createdAt, "Task creation date");

      requireExactKeys(task.rule,
        ["frequency", "interval", "weekdays", "monthDays", "months", "weekdayPositions"], [], "Task recurrence rule");
      R.validateRule(task.rule);
      if (task.rule.weekdays.length > 7 || task.rule.monthDays.length > 31 || task.rule.months.length > 12 || task.rule.weekdayPositions.length > 42) {
        throw new Error("A task recurrence rule contains too many selector values.");
      }
      const positions = task.rule.weekdayPositions.map(item => {
        requireExactKeys(item, ["ordinal", "weekday"], [], "Ordinal weekday rule");
        return { ordinal: item.ordinal, weekday: item.weekday };
      });
      const cleanTask = {
        id: task.id,
        name: task.name,
        anchorDate: task.anchorDate,
        hasCompleted: task.hasCompleted,
        rule: {
          frequency: task.rule.frequency,
          interval: task.rule.interval,
          weekdays: task.rule.weekdays.slice(),
          monthDays: task.rule.monthDays.slice(),
          months: task.rule.months.slice(),
          weekdayPositions: positions
        },
        absencePolicy: task.absencePolicy,
        createdAt: task.createdAt
      };
      if (Object.prototype.hasOwnProperty.call(task, "scheduleAnchorDate")) cleanTask.scheduleAnchorDate = task.scheduleAnchorDate;
      cleanTasks.push(cleanTask);
    }

    const cleanAbsences = [];
    const absenceIds = new Set();
    for (const absence of data.absences) {
      requireExactKeys(absence, ["id", "name", "startDate", "endDate"], [], "Absence");
      requireId(absence.id, "Absence");
      if (absenceIds.has(absence.id)) throw new Error("An absence has a duplicate ID.");
      absenceIds.add(absence.id);
      requireString(absence.name, "Absence name", 80, false);
      requireDate(absence.startDate, "Absence start");
      requireDate(absence.endDate, "Absence end");
      if (compareDates(absence.endDate, absence.startDate) < 0) throw new Error("An absence ends before it starts.");
      cleanAbsences.push({ id: absence.id, name: absence.name, startDate: absence.startDate, endDate: absence.endDate });
    }

    const cleanOccurrences = [];
    const occurrenceIds = new Set();
    const pendingTasks = new Set();
    const optionalOccurrenceKeys = ["absenceGroupEnd", "completedDate", "skippedDate", "skipReason", "resolvedAt"];
    for (const occurrence of data.occurrences) {
      requireExactKeys(occurrence,
        ["id", "taskId", "originalDate", "scheduledDate", "status", "rescheduleHistory", "createdAt"],
        optionalOccurrenceKeys, "Occurrence");
      requireId(occurrence.id, "Occurrence");
      if (occurrenceIds.has(occurrence.id)) throw new Error("An occurrence has a duplicate ID.");
      occurrenceIds.add(occurrence.id);
      requireId(occurrence.taskId, "Occurrence task reference");
      if (!taskIds.has(occurrence.taskId)) throw new Error("An occurrence refers to a task that does not exist.");
      requireDate(occurrence.originalDate, "Occurrence original date");
      requireDate(occurrence.scheduledDate, "Occurrence scheduled date");
      if (compareDates(occurrence.scheduledDate, occurrence.originalDate) < 0) throw new Error("An occurrence cannot be scheduled before its original date.");
      requireTimestamp(occurrence.createdAt, "Occurrence creation date");
      if (!Array.isArray(occurrence.rescheduleHistory) || occurrence.rescheduleHistory.length > MAX_HISTORY_PER_OCCURRENCE) {
        throw new Error("An occurrence has invalid or excessive rescheduling history.");
      }
      const cleanHistory = occurrence.rescheduleHistory.map(entry => {
        requireExactKeys(entry, ["from", "to", "at", "reason"], [], "Rescheduling history entry");
        requireDate(entry.from, "Previous scheduled date");
        requireDate(entry.to, "New scheduled date");
        requireTimestamp(entry.at, "Rescheduling timestamp");
        if (!["manual", "absence"].includes(entry.reason)) throw new Error("A rescheduling history entry has an invalid reason.");
        return { from: entry.from, to: entry.to, at: entry.at, reason: entry.reason };
      });
      if (!["pending", "completed", "skipped"].includes(occurrence.status)) throw new Error("An occurrence has an invalid status.");

      const clean = {
        id: occurrence.id,
        taskId: occurrence.taskId,
        originalDate: occurrence.originalDate,
        scheduledDate: occurrence.scheduledDate,
        status: occurrence.status,
        rescheduleHistory: cleanHistory,
        createdAt: occurrence.createdAt
      };
      if (Object.prototype.hasOwnProperty.call(occurrence, "absenceGroupEnd")) {
        requireDate(occurrence.absenceGroupEnd, "Absence end marker");
        clean.absenceGroupEnd = occurrence.absenceGroupEnd;
      }

      if (occurrence.status === "pending") {
        if (pendingTasks.has(occurrence.taskId)) throw new Error("A task has more than one pending occurrence.");
        pendingTasks.add(occurrence.taskId);
        if (["completedDate", "skippedDate", "skipReason", "resolvedAt"].some(key => Object.prototype.hasOwnProperty.call(occurrence, key))) {
          throw new Error("A pending occurrence contains fields for a resolved occurrence.");
        }
      } else {
        requireTimestamp(occurrence.resolvedAt, "Occurrence resolution date");
        clean.resolvedAt = occurrence.resolvedAt;
        if (occurrence.status === "completed") {
          requireDate(occurrence.completedDate, "Completion date");
          if (["skippedDate", "skipReason"].some(key => Object.prototype.hasOwnProperty.call(occurrence, key))) throw new Error("A completed occurrence contains skip fields.");
          clean.completedDate = occurrence.completedDate;
        } else {
          requireDate(occurrence.skippedDate, "Skipped date");
          if (!["manual", "absence", "season"].includes(occurrence.skipReason)) throw new Error("A skipped occurrence has an invalid reason.");
          if (Object.prototype.hasOwnProperty.call(occurrence, "completedDate")) throw new Error("A skipped occurrence contains a completion date.");
          clean.skippedDate = occurrence.skippedDate;
          clean.skipReason = occurrence.skipReason;
        }
      }
      cleanOccurrences.push(clean);
    }

    return {
      version: 2,
      settings: { weekStartsOn: 1, theme: data.settings.theme },
      tasks: cleanTasks,
      absences: cleanAbsences,
      occurrences: cleanOccurrences
    };
  }

  async function importJson(file) {
    if (!file) return;
    try {
      if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("The selected file is empty or its size cannot be verified.");
      if (file.size > MAX_IMPORT_BYTES) throw new Error("The JSON file is too large. The maximum supported size is 20 MB.");
      if (typeof file.text !== "function") throw new Error("This browser cannot read the selected file. Try a recent browser version.");
      if (dirty && !window.confirm("Discard unsaved changes and open another JSON file?")) return;
      const text = await file.text();
      if (typeof text !== "string" || text.length === 0 || text.length > MAX_IMPORT_BYTES) throw new Error("The JSON file is empty or exceeds the supported size limit.");
      const parsed = JSON.parse(text);
      state = validateImportedState(parsed);
      applyTheme();
      loadedFileName = file.name;
      const beforeReconcile = JSON.stringify(state);
      reconcileSchedules();
      dirty = JSON.stringify(state) !== beforeReconcile;
      setDirty(dirty);
      renderAll();
      showToast("Loaded " + file.name);
    } catch (err) {
      window.alert("Could not open JSON file:\n\n" + (err.message || "Invalid file."));
    } finally {
      $("jsonFileInput").value = "";
    }
  }

  function selectDate(dateString, newView) {
    selectedDate = dateString;
    if (newView) view = newView;
    const p = dateParts(dateString);
    if (view === "month") viewDate = dateString.slice(0, 7) + "-01";
    else viewDate = String(p.year).padStart(4, "0") + "-01-01";
    renderAll();
  }

  function navigate(direction) {
    const p = dateParts(viewDate);
    if (view === "month") {
      const d = new Date(Date.UTC(p.year, p.month - 1 + direction, 1, 12));
      viewDate = String(d.getUTCFullYear()).padStart(4, "0") + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-01";
      selectedDate = viewDate;
    } else if (view === "year") {
      const year = p.year + direction;
      viewDate = String(year).padStart(4, "0") + "-01-01";
      selectedDate = viewDate;
    } else {
      const year = Math.floor(p.year / 10) * 10 + direction * 10;
      viewDate = String(year).padStart(4, "0") + "-01-01";
      selectedDate = viewDate;
    }
    renderAll();
  }

  function bindEvents() {
    $("themeToggle").addEventListener("click", cycleTheme);
    $("openJsonButton").addEventListener("click", () => $("jsonFileInput").click());
    $("saveJsonButton").addEventListener("click", saveJson);
    $("jsonFileInput").addEventListener("change", event => importJson(event.target.files[0]));
    $("previousButton").addEventListener("click", () => navigate(-1));
    $("nextButton").addEventListener("click", () => navigate(1));
    $("todayButton").addEventListener("click", () => { view = "month"; viewDate = todayLocal().slice(0, 7) + "-01"; selectedDate = todayLocal(); renderAll(); });
    document.querySelectorAll(".view-button").forEach(button => button.addEventListener("click", () => {
      view = button.dataset.view;
      const p = dateParts(selectedDate);
      viewDate = view === "month" ? selectedDate.slice(0, 7) + "-01" : String(p.year).padStart(4, "0") + "-01-01";
      renderAll();
    }));
    $("addTaskButton").addEventListener("click", () => openTaskDialog(null, selectedDate));
    $("addTaskForDayButton").addEventListener("click", () => openTaskDialog(null, selectedDate));
    $("manageTasksButton").addEventListener("click", () => renderManageDialog("tasks"));
    $("manageAbsencesButton").addEventListener("click", () => renderManageDialog("absences"));
    $("taskForm").addEventListener("submit", saveTaskFromForm);
    $("absenceForm").addEventListener("submit", saveAbsenceFromForm);
    $("postponeForm").addEventListener("submit", submitPostpone);
    $("addOrdinalButton").addEventListener("click", () => addOrdinalRow());

    document.addEventListener("click", event => {
      const addAbsence = event.target.closest("[data-add-absence]");
      if (addAbsence) {
        closeDialog("manageDialog");
        openAbsenceDialog(null);
        return;
      }
      const openTask = event.target.closest("[data-open-task]");
      if (openTask) {
        const task = getTask(openTask.dataset.openTask);
        if (task) {
          if ($("manageDialog").open) closeDialog("manageDialog");
          openTaskDialog(task);
        }
        return;
      }
      const close = event.target.closest("[data-close]");
      if (close) closeDialog(close.dataset.close);
      const dateCell = event.target.closest("[data-date]");
      if (dateCell && dateCell.dataset.date) {
        const date = dateCell.dataset.date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) selectDate(date, view);
      }
      const monthCard = event.target.closest(".mini-month");
      if (monthCard && view === "year" && !event.target.closest("[data-date]")) {
        const year = dateParts(viewDate).year;
        const month = Number(monthCard.dataset.month);
        selectDate(String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-01", "month");
      }
      const yearCard = event.target.closest("[data-year]");
      if (yearCard && view === "decade") {
        const year = Number(yearCard.dataset.year);
        view = "year"; viewDate = String(year).padStart(4, "0") + "-01-01"; selectedDate = viewDate; renderAll();
      }
      const action = event.target.closest("[data-action]");
      if (action) {
        const id = action.dataset.occurrence;
        if (action.dataset.action === "complete") completeOccurrence(id);
        else if (action.dataset.action === "postpone") { const occ = getOccurrence(id); if (occ) openPostponeDialog(occ); }
        else if (action.dataset.action === "skip") skipOccurrence(id);
      }
      const edit = event.target.closest("[data-manage-edit]");
      if (edit) {
        const id = edit.dataset.manageEdit;
        if (edit.dataset.kind === "tasks") { const task = getTask(id); closeDialog("manageDialog"); if (task) openTaskDialog(task); }
        else { const absence = state.absences.find(item => item.id === id); closeDialog("manageDialog"); if (absence) openAbsenceDialog(absence); }
      }
      const remove = event.target.closest("[data-manage-delete]");
      if (remove) deleteManagedItem(remove.dataset.manageDelete, remove.dataset.kind);
    });

    document.addEventListener("keydown", event => {
      const cell = event.target.closest(".day-cell");
      if (cell && !event.target.closest("[data-open-task]") && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectDate(cell.dataset.date, view); }
    });

    window.addEventListener("beforeunload", event => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });

    // Re-evaluate overdue counts and absences when the local calendar date changes.
    window.setInterval(() => {
      const currentDate = todayLocal();
      if (currentDate !== lastObservedDate) {
        lastObservedDate = currentDate;
        renderAll();
      }
    }, 60000);

    // The mobile header remains intentionally small; the dots button opens task tools.
    $("menuButton").addEventListener("click", () => {
      const choice = window.prompt("Type “tasks” or “absences” to manage them, or leave blank to cancel:");
      if (choice && choice.toLowerCase().startsWith("t")) renderManageDialog("tasks");
      else if (choice && choice.toLowerCase().startsWith("a")) renderManageDialog("absences");
    });
  }

  function initialize() {
    applyTheme();
    if (typeof window.matchMedia === "function") {
      const preference = window.matchMedia("(prefers-color-scheme: dark)");
      const onPreferenceChange = () => { if (themeSetting() === "system") applyTheme(); };
      if (typeof preference.addEventListener === "function") preference.addEventListener("change", onPreferenceChange);
      else if (typeof preference.addListener === "function") preference.addListener(onPreferenceChange);
    }
    bindEvents();
    // Starting with an empty in-memory workspace. No LocalStorage or IndexedDB is used.
    reconcileSchedules();
    renderAll();
    setDirty(false);
  }

  initialize();
})();
