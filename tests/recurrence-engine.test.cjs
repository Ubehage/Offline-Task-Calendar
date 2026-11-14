const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../recurrence-engine.js');

test('daily interval is anchored to the initial date', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-01-01', from: '2026-01-01', to: '2026-01-10',
    rule: { frequency: 'day', interval: 3 }
  }), ['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10']);
});

test('weekly interval selects weekdays in every eligible week', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-01-05', from: '2026-01-01', to: '2026-01-25',
    rule: { frequency: 'week', interval: 2, weekdays: [1, 4] }
  }), ['2026-01-05', '2026-01-08', '2026-01-19', '2026-01-22']);
});

test('every second month on Mondays means every Monday in every second month', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-04-06', from: '2026-04-01', to: '2026-07-31',
    rule: { frequency: 'month', interval: 2, weekdays: [1] }
  }), ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27', '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
});

test('monthly day 31 clamps to the final day in shorter months', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-01-31', from: '2026-01-01', to: '2026-04-30',
    rule: { frequency: 'month', interval: 1 }
  }), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('yearly February 29 clamps in non-leap years and returns to February 29 in leap years', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2024-02-29', from: '2024-01-01', to: '2032-12-31',
    rule: { frequency: 'year', interval: 1 }
  }), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
});

test('ordinal weekday rules and month filter combine', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-01-01', from: '2026-01-01', to: '2026-12-31',
    rule: { frequency: 'month', interval: 1, months: [3, 4], weekdayPositions: [{ weekday: 1, ordinal: 2 }] }
  }), ['2026-03-09', '2026-04-13']);
});

test('specific date and weekday selectors are combined as restrictions', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-01-01', from: '2026-01-01', to: '2026-03-31',
    rule: { frequency: 'day', interval: 1, weekdays: [1], monthDays: [5, 19] }
  }), ['2026-01-05', '2026-01-19']);
});

test('selected months can cross the year boundary', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-11-01', from: '2026-11-01', to: '2027-02-28',
    rule: { frequency: 'month', interval: 1, months: [11, 12, 1, 2] }
  }), ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
});

test('nextOccurrence is strictly after its after-date', () => {
  assert.equal(R.nextOccurrence({
    anchor: '2026-05-01', after: '2026-05-01', maxYears: 2,
    rule: { frequency: 'week', interval: 1 }
  }), '2026-05-08');
});

test('date arithmetic does not shift around leap day', () => {
  assert.equal(R.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(R.addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(R.daysBetween('2026-05-01', '2026-05-04'), 3);
});

test('invalid date and invalid recurrence selector are rejected', () => {
  assert.throws(() => R.parseDate('2026-02-30'));
  assert.throws(() => R.validateRule({ frequency: 'month', interval: 0 }));
  assert.throws(() => R.validateRule({ frequency: 'month', interval: 1, weekdays: [8] }));
});

test('weekly recurrence can use an ordinal weekday without inheriting the anchor weekday', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-01-08', from: '2026-01-01', to: '2026-03-31',
    rule: { frequency: 'week', interval: 1, weekdayPositions: [{ weekday: 1, ordinal: 2 }] }
  }), ['2026-01-12', '2026-02-09', '2026-03-09']);
});

test('yearly recurrence can combine selected months with a specific day', () => {
  assert.deepEqual(R.generateOccurrences({
    anchor: '2026-01-15', from: '2026-01-01', to: '2027-12-31',
    rule: { frequency: 'year', interval: 1, months: [1, 7], monthDays: [15] }
  }), ['2026-01-15', '2026-07-15', '2027-01-15', '2027-07-15']);
});

test('legacy seasonal date-range rules are rejected instead of migrated', () => {
  assert.throws(() => R.validateRule({ frequency: 'week', interval: 1, seasons: [{ start: '04-01', end: '10-31' }] }), /selected months/i);
});
