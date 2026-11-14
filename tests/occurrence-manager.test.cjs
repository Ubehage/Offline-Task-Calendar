const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../occurrence-manager.js');

function makeTask(id, anchorDate, options = {}) {
  return {
    id,
    name: options.name || id,
    anchorDate,
    hasCompleted: false,
    absencePolicy: options.absencePolicy || 'skip',
    rule: options.rule || { frequency: 'week', interval: 1 },
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}
function makeState(tasks, absences = []) {
  return { version: 2, settings: { weekStartsOn: 1 }, tasks, absences, occurrences: [] };
}

test('completion date becomes the new recurrence anchor', () => {
  const state = makeState([makeTask('mow', '2026-05-01')]);
  O.reconcile(state, '2026-05-01');
  const current = O.pendingForTask(state, 'mow');
  assert.equal(current.originalDate, '2026-05-01');
  O.complete(state, current.id, '2026-05-04');
  assert.equal(state.tasks[0].anchorDate, '2026-05-04');
  assert.equal(state.tasks[0].hasCompleted, true);
  O.reconcile(state, '2026-05-04');
  assert.equal(O.pendingForTask(state, 'mow').originalDate, '2026-05-11');
});

test('skipping does not reset the recurrence anchor', () => {
  const state = makeState([makeTask('clean', '2026-05-04')]);
  O.reconcile(state, '2026-05-04');
  const first = O.pendingForTask(state, 'clean');
  O.skip(state, first.id, '2026-05-05');
  assert.equal(state.tasks[0].anchorDate, '2026-05-04');
  O.reconcile(state, '2026-05-05');
  assert.equal(O.pendingForTask(state, 'clean').originalDate, '2026-05-11');
});

test('overdue pending occurrence is displayed today with an increasing day count', () => {
  const state = makeState([makeTask('bins', '2026-05-01')]);
  O.reconcile(state, '2026-05-01');
  const display = O.pendingDisplay(state, '2026-05-04')[0];
  assert.equal(display.displayDate, '2026-05-04');
  assert.equal(display.overdueDays, 3);
  O.complete(state, display.occurrence.id, '2026-05-04');
  assert.equal(O.pendingDisplay(state, '2026-05-04').length, 0);
});

test('skip absence policy skips every affected occurrence without backlog', () => {
  const state = makeState(
    [makeTask('water', '2026-07-06', { absencePolicy: 'skip' })],
    [{ id: 'vac', name: 'Vacation', startDate: '2026-07-06', endDate: '2026-07-24' }]
  );
  O.reconcile(state, '2026-07-06');
  const skipped = state.occurrences.filter(item => item.status === 'skipped');
  assert.deepEqual(skipped.map(item => item.originalDate), ['2026-07-06', '2026-07-13', '2026-07-20']);
  assert.equal(O.pendingForTask(state, 'water').originalDate, '2026-07-27');
});

test('postpone absence policy moves an occurrence to the first day after absence', () => {
  const state = makeState(
    [makeTask('clean', '2026-07-06', { absencePolicy: 'postpone' })],
    [{ id: 'vac', name: 'Vacation', startDate: '2026-07-06', endDate: '2026-07-24' }]
  );
  O.reconcile(state, '2026-07-06');
  const pending = O.pendingForTask(state, 'clean');
  assert.equal(pending.originalDate, '2026-07-06');
  assert.equal(pending.scheduledDate, '2026-07-25');
});

test('distribution policy allocates consecutive days in original due-date order', () => {
  const state = makeState(
    [
      makeTask('later', '2026-07-13', { absencePolicy: 'distribute', name: 'Later due' }),
      makeTask('earlier', '2026-07-06', { absencePolicy: 'distribute', name: 'Earlier due' })
    ],
    [{ id: 'vac', name: 'Vacation', startDate: '2026-07-06', endDate: '2026-07-24' }]
  );
  O.reconcile(state, '2026-07-06');
  assert.equal(O.pendingForTask(state, 'earlier').scheduledDate, '2026-07-25');
  assert.equal(O.pendingForTask(state, 'later').scheduledDate, '2026-07-26');
});

test('postponement outside selected months is skipped, not moved into a later month', () => {
  const state = makeState(
    [makeTask('mow', '2026-10-30', {
      absencePolicy: 'postpone',
      rule: { frequency: 'week', interval: 1, months: [4, 5, 6, 7, 8, 9, 10] }
    })],
    [{ id: 'vac', name: 'Vacation', startDate: '2026-10-30', endDate: '2026-11-05' }]
  );
  O.reconcile(state, '2026-10-30');
  const skipped = state.occurrences.find(item => item.status === 'skipped');
  assert.equal(skipped.skipReason, 'season');
  assert.equal(skipped.originalDate, '2026-10-30');
  assert.equal(skipped.scheduledDate, '2026-11-06');
  assert.equal(O.pendingForTask(state, 'mow').originalDate, '2027-04-02');
});

test('manual postponement outside selected months converts the occurrence to skipped', () => {
  const state = makeState([makeTask('mow', '2026-10-26', {
    rule: { frequency: 'week', interval: 1, months: [4, 5, 6, 7, 8, 9, 10] }
  })]);
  O.reconcile(state, '2026-10-26');
  const pending = O.pendingForTask(state, 'mow');
  const result = O.postpone(state, pending.id, '2026-11-02');
  assert.equal(result.skipped, true);
  assert.equal(pending.status, 'skipped');
  assert.equal(pending.skipReason, 'season');
});

test('an unfinished overdue occurrence is also handled when an absence starts after its due date', () => {
  const state = makeState(
    [makeTask('bins', '2026-07-06', { absencePolicy: 'postpone' })],
    [{ id: 'vac', name: 'Vacation', startDate: '2026-07-10', endDate: '2026-07-24' }]
  );
  O.reconcile(state, '2026-07-06');
  const dueBeforeVacation = O.pendingForTask(state, 'bins');
  assert.equal(dueBeforeVacation.originalDate, '2026-07-06');
  O.reconcile(state, '2026-07-15');
  assert.equal(dueBeforeVacation.scheduledDate, '2026-07-25');
});


test('overdue count continues increasing after a manual postponement until resolution', () => {
  const state = makeState([makeTask('clean', '2026-05-01')]);
  O.reconcile(state, '2026-05-01');
  const pending = O.pendingForTask(state, 'clean');
  O.postpone(state, pending.id, '2026-05-10');
  const display = O.pendingDisplay(state, '2026-05-06')[0];
  assert.equal(display.displayDate, '2026-05-10');
  assert.equal(display.autoMoved, false);
  assert.equal(display.overdueDays, 5);
  O.complete(state, pending.id, '2026-05-10');
  assert.equal(O.pendingDisplay(state, '2026-05-10').length, 0);
});

test('future weekly occurrences are projected for the whole visible month without persisting them', () => {
  const state = makeState([makeTask('weekly-april', '2027-04-05')]);
  O.reconcile(state, '2026-11-13');
  const before = state.occurrences.length;
  const projected = O.projectedDisplay(state, '2027-04-01', '2027-04-30', '2026-11-13');
  assert.deepEqual(projected.map(item => item.displayDate), ['2027-04-12', '2027-04-19', '2027-04-26']);
  assert.equal(projected.every(item => item.type === 'projected'), true);
  assert.equal(state.occurrences.length, before, 'calendar previews must not create JSON occurrence records');
});

test('projected weekly occurrences respect selected active months', () => {
  const state = makeState([makeTask('seasonal-months', '2027-04-05', {
    rule: { frequency: 'week', interval: 1, months: [4, 5] }
  })]);
  O.reconcile(state, '2026-11-13');
  const projected = O.projectedDisplay(state, '2027-04-01', '2027-06-30', '2026-11-13');
  assert.deepEqual(projected.map(item => item.displayDate), [
    '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-03', '2027-05-10', '2027-05-17', '2027-05-24', '2027-05-31'
  ]);
});

test('future absence projections honor each task policy', () => {
  const absence = [{ id: 'vac', name: 'Vacation', startDate: '2027-04-12', endDate: '2027-04-20' }];
  const skipState = makeState([makeTask('skip-preview', '2027-04-05', { absencePolicy: 'skip' })], absence);
  O.reconcile(skipState, '2026-11-13');
  const skippedForecast = O.projectedDisplay(skipState, '2027-04-01', '2027-04-30', '2026-11-13');
  assert.deepEqual(skippedForecast.map(item => item.displayDate), ['2027-04-26']);

  const postponeState = makeState([makeTask('postpone-preview', '2027-04-05', { absencePolicy: 'postpone' })], absence);
  O.reconcile(postponeState, '2026-11-13');
  const postponedForecast = O.projectedDisplay(postponeState, '2027-04-01', '2027-04-30', '2026-11-13');
  assert.deepEqual(postponedForecast.map(item => item.displayDate), ['2027-04-21', '2027-04-21', '2027-04-26']);

  const distributeState = makeState([makeTask('distribute-preview', '2027-04-05', { absencePolicy: 'distribute' })], absence);
  O.reconcile(distributeState, '2026-11-13');
  const distributedForecast = O.projectedDisplay(distributeState, '2027-04-01', '2027-04-30', '2026-11-13');
  assert.deepEqual(distributedForecast.map(item => item.displayDate), ['2027-04-21', '2027-04-22', '2027-04-26']);
});

test('future projections stop while the current occurrence is overdue but continue after manual postponement', () => {
  const overdue = makeState([makeTask('late', '2027-04-05')]);
  O.reconcile(overdue, '2027-04-06');
  assert.deepEqual(O.projectedDisplay(overdue, '2027-04-01', '2027-04-30', '2027-04-06'), []);

  const postponed = makeState([makeTask('moved', '2027-04-05')]);
  O.reconcile(postponed, '2027-04-01');
  O.postpone(postponed, O.pendingForTask(postponed, 'moved').id, '2027-04-20');
  assert.deepEqual(
    O.projectedDisplay(postponed, '2027-04-01', '2027-04-30', '2027-04-01').map(item => item.displayDate),
    ['2027-04-27'],
    'manual postponement shifts the future cadence instead of hiding it'
  );
});

test('manual postponement shifts future weekly occurrences and skipping keeps the shifted schedule', () => {
  const state = makeState([makeTask('moved-weekly', '2027-04-05', {
    rule: { frequency: 'week', interval: 1, weekdays: [1] }
  })]);
  O.reconcile(state, '2027-04-01');
  const first = O.pendingForTask(state, 'moved-weekly');
  const result = O.postpone(state, first.id, '2027-04-14');
  assert.equal(result.skipped, false);
  assert.equal(state.tasks[0].scheduleAnchorDate, '2027-04-14');

  const beforeSkip = O.projectedDisplay(state, '2027-04-01', '2027-04-30', '2027-04-01');
  assert.deepEqual(beforeSkip.map(item => item.displayDate), ['2027-04-19', '2027-04-26']);

  O.skip(state, first.id, '2027-04-14', 'manual');
  O.reconcile(state, '2027-04-14');
  assert.equal(O.pendingForTask(state, 'moved-weekly').originalDate, '2027-04-19');
  const afterSkip = O.projectedDisplay(state, '2027-04-01', '2027-04-30', '2027-04-14');
  assert.deepEqual(afterSkip.map(item => item.displayDate), ['2027-04-26']);
  assert.equal(state.tasks[0].scheduleAnchorDate, '2027-04-14', 'skip preserves the adjusted recurrence phase');
});


test('a skipped manually postponed occurrence preserves its adjusted cadence after reload', () => {
  const state = makeState([makeTask('legacy-shifted', '2027-04-05')]);
  state.occurrences.push({
    id: 'legacy-occurrence', taskId: 'legacy-shifted',
    originalDate: '2027-04-05', scheduledDate: '2027-04-14', status: 'skipped',
    rescheduleHistory: [{ from: '2027-04-05', to: '2027-04-14', at: '2027-04-05T12:00:00.000Z', reason: 'manual' }],
    createdAt: '2027-04-01T00:00:00.000Z', skippedDate: '2027-04-14', skipReason: 'manual',
    resolvedAt: '2027-04-14T12:00:00.000Z'
  });
  O.reconcile(state, '2027-04-14');
  assert.equal(state.tasks[0].scheduleAnchorDate, '2027-04-14');
  assert.equal(O.pendingForTask(state, 'legacy-shifted').originalDate, '2027-04-21');
});

test('a later completion supersedes an older manual postponement schedule shift', () => {
  const task = makeTask('completed-after-skip', '2027-04-05');
  task.hasCompleted = true;
  task.anchorDate = '2027-04-20';
  const state = makeState([task]);
  state.occurrences.push({
    id: 'old-skipped', taskId: 'completed-after-skip', originalDate: '2027-04-05', scheduledDate: '2027-04-14',
    status: 'skipped', rescheduleHistory: [{ from: '2027-04-05', to: '2027-04-14', at: '2027-04-05T12:00:00.000Z', reason: 'manual' }],
    createdAt: '2027-04-01T00:00:00.000Z', skippedDate: '2027-04-14', skipReason: 'manual', resolvedAt: '2027-04-14T12:00:00.000Z'
  });
  state.occurrences.push({
    id: 'later-completed', taskId: 'completed-after-skip', originalDate: '2027-04-20', scheduledDate: '2027-04-20',
    status: 'completed', rescheduleHistory: [], createdAt: '2027-04-20T00:00:00.000Z', completedDate: '2027-04-20',
    resolvedAt: '2027-04-20T12:00:00.000Z'
  });
  O.reconcile(state, '2027-04-20');
  assert.equal(state.tasks[0].scheduleAnchorDate, undefined);
  assert.equal(O.pendingForTask(state, 'completed-after-skip').originalDate, '2027-04-27');
});

test('completing a postponed occurrence resets the schedule anchor to actual completion date', () => {
  const state = makeState([makeTask('complete-shifted', '2027-04-05')]);
  O.reconcile(state, '2027-04-01');
  const pending = O.pendingForTask(state, 'complete-shifted');
  O.postpone(state, pending.id, '2027-04-14');
  O.complete(state, pending.id, '2027-04-16');
  assert.equal(state.tasks[0].anchorDate, '2027-04-16');
  assert.equal(Object.hasOwn(state.tasks[0], 'scheduleAnchorDate'), false);
  O.reconcile(state, '2027-04-16');
  assert.equal(O.pendingForTask(state, 'complete-shifted').originalDate, '2027-04-23');
});

test('a manually postponed overdue occurrence still forecasts its shifted future cadence', () => {
  const state = makeState([makeTask('late-shifted', '2027-04-05')]);
  O.reconcile(state, '2027-04-06');
  const pending = O.pendingForTask(state, 'late-shifted');
  O.postpone(state, pending.id, '2027-04-20');
  const projected = O.projectedDisplay(state, '2027-04-01', '2027-04-30', '2027-04-06');
  assert.deepEqual(projected.map(item => item.displayDate), ['2027-04-27']);
});
