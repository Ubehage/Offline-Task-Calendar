const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../recurrence-engine.js');
const O = require('../occurrence-manager.js');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.className = '';
    this.dataset = {};
    this.open = false;
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  click() { if (this.listeners.click) this.listeners.click({ target: this }); }
  appendChild() {}
  remove() {}
}

test('application bootstraps and renders a month calendar without a browser framework', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  const viewButtons = ["month", "year", "decade"].map(view => {
    const button = new FakeElement("view-" + view);
    button.dataset.view = view;
    return button;
  });
  const listeners = {};
  const createdElements = [];
  const root = new FakeElement('documentElement');
  const document = {
    title: '',
    documentElement: root,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll(selector) { return selector === ".view-button" ? viewButtons : []; },
    addEventListener(name, callback) { listeners[name] = callback; },
    createElement(tagName) { const element = new FakeElement(tagName || 'created'); createdElements.push(element); return element; },
    body: new FakeElement('body')
  };
  let generatedId = 0;
  const window = {
    OTCRecurrence: R,
    OTCOccurrences: O,
    crypto: { randomUUID: () => generatedId++ === 0 ? 'test-id' : 'test-id-' + generatedId },
    setInterval() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    addEventListener() {},
    confirm: () => true,
    alert: () => {}
  };
  const context = {
    window, document, console, Intl, Date, Map, Set, Math, String, Number, Array, Object, JSON,
    Blob: class { constructor(parts) { this.size = parts.reduce((sum, part) => sum + String(part).length, 0); } },
    URL: { createObjectURL: () => 'blob:test-save', revokeObjectURL() {} },
    setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });
  const calendar = elements.get('calendarContainer');
  assert.ok(calendar.innerHTML.includes('month-grid'));
  assert.equal((calendar.innerHTML.match(/class="day-cell/g) || []).length, 42);
  assert.ok(elements.get('selectedDayContent').innerHTML.includes('No tasks or absences'));
  assert.equal(elements.get('taskCount').textContent, '0');
  assert.equal(elements.get('todayTaskCount').textContent, '0 tasks today');
  assert.equal(document.title, 'Offline Task Calendar — 0 tasks today');
  assert.equal(root.attributes['data-theme'], 'dark', 'system dark preference is applied on startup');

  const themeButton = elements.get('themeToggle');
  assert.match(themeButton.textContent, /Theme: System/);
  themeButton.click();
  assert.equal(root.attributes['data-theme'], 'dark');
  assert.match(themeButton.textContent, /Theme: Dark/);
  themeButton.click();
  assert.equal(root.attributes['data-theme'], 'light');
  assert.match(themeButton.textContent, /Theme: Light/);
  themeButton.click();
  assert.equal(root.attributes['data-theme'], 'dark', 'returning to system follows the OS preference');
  assert.match(themeButton.textContent, /Theme: System/);

  // Absences can be created from the Absences manager, including when the
  // list is empty (the previous build exposed no way to create the first one).
  elements.get('manageAbsencesButton').click();
  assert.equal(elements.get('manageDialog').open, true);
  assert.match(elements.get('manageDialogContent').innerHTML, /data-add-absence/);
  const addAbsenceButton = { dataset: {} };
  listeners.click({ target: { closest(selector) {
    return selector === '[data-add-absence]' ? addAbsenceButton : null;
  } } });
  assert.equal(elements.get('manageDialog').open, false);
  assert.equal(elements.get('absenceDialog').open, true);
  const now = new Date();
  const todayString = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  elements.get('absenceName').value = 'Test absence';
  elements.get('absenceStart').value = todayString;
  elements.get('absenceEnd').value = todayString;
  elements.get('absenceForm').listeners.submit({ preventDefault() {} });
  assert.equal(elements.get('absenceDialog').open, false);
  assert.match(elements.get('selectedDayContent').innerHTML, /Test absence/);
  assert.equal(elements.get('todayTaskCount').textContent, '0 tasks today', 'absence dates do not count as tasks');

  // The brand and document title both show the count of task occurrences today.
  elements.get('addTaskButton').click();
  elements.get('taskName').value = 'Today task';
  elements.get('taskAnchor').value = todayString;
  elements.get('taskForm').listeners.submit({ preventDefault() {} });
  assert.equal(elements.get('todayTaskCount').textContent, '1 task today');
  assert.equal(document.title, 'Offline Task Calendar — 1 task today');

  // Save filename is stable and does not include today's date.
  elements.get('saveJsonButton').click();
  assert.equal(createdElements.length, 1, 'save creates one download link');
  assert.equal(createdElements[0].download, 'offline-task-calendar.json');
  assert.doesNotMatch(createdElements[0].download, /\d{4}-\d{2}-\d{2}/);

  // Reproduce the reported case: a weekly task beginning in April 2027 must
  // appear on every weekly date in that month, not only on its first date.
  elements.get('addTaskButton').click();
  elements.get('taskName').value = 'Weekly April task';
  elements.get('taskAnchor').value = '2027-04-05';
  elements.get('ruleInterval').value = '1';
  elements.get('ruleFrequency').value = 'week';
  elements.get('taskForm').listeners.submit({ preventDefault() {} });
  assert.equal(elements.get('taskCount').textContent, '2');
  assert.equal(elements.get('todayTaskCount').textContent, '1 task today', 'future recurrence does not inflate today count');
  for (let month = 0; month < 5; month++) elements.get('nextButton').click();
  const aprilCells = calendar.innerHTML.split('<div class="day-cell').filter(cell =>
    ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26'].some(date => cell.includes('data-date="' + date + '"'))
  );
  assert.equal(aprilCells.length, 4, 'calendar contains all four Monday date cells in April 2027');
  for (const date of ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26']) {
    const cell = calendar.innerHTML.split('<div class="day-cell').find(part => part.includes('data-date="' + date + '"'));
    assert.ok(cell && cell.includes('data-open-task="task-test-id-3"'), 'weekly task is visible on ' + date);
  }

  // Calendar chips open the task editor, and the selected-day sidebar exposes
  // the same shortcut for a projected occurrence.
  const taskLink = { dataset: { openTask: 'task-test-id-3' } };
  listeners.click({ target: { closest(selector) { return selector === '[data-open-task]' ? taskLink : null; } } });
  assert.equal(elements.get('taskDialog').open, true);
  assert.equal(elements.get('taskName').value, 'Weekly April task');
  elements.get('taskDialog').close();
  listeners.click({ target: { closest(selector) {
    if (selector === '[data-date]') return { dataset: { date: '2027-04-12' } };
    return null;
  } } });
  assert.match(elements.get('selectedDayContent').innerHTML, /data-open-task="task-test-id-3"/);
  listeners.click({ target: { closest(selector) { return selector === '[data-open-task]' ? taskLink : null; } } });
  assert.equal(elements.get('taskDialog').open, true, 'task editor opens from the selected-day sidebar');

  // Year view uses the date number itself for task status, not a tiny dot.
  viewButtons.find(button => button.dataset.view === "year").click();
  assert.ok(calendar.innerHTML.includes('class="mini-day has-items has-pending" data-date="2027-04-05"'));
  for (const date of ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26']) {
    assert.ok(calendar.innerHTML.includes('data-date="' + date + '"'), 'year view marks scheduled date ' + date);
  }
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.doesNotMatch(styles, /\.mini-day\.has-items::after/);
  assert.match(styles, /\.mini-day\.has-pending\s*\{\s*color:/);
});

test('task editor uses selected months as the only active-period control and task links are available', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(html, /Active months/);
  assert.doesNotMatch(html, /Seasonal restrictions|addSeasonButton|seasonRules/);
  assert.match(app, /data-open-task/);
  assert.match(app, /O\.projectedDisplay/);
});


test('save importer accepts schema v2 only and does not migrate older save files', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  let alertMessage = "";
  const document = {
    documentElement: new FakeElement('documentElement'),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new FakeElement(id)); return elements.get(id); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return new FakeElement('created'); },
    body: new FakeElement('body')
  };
  const window = {
    OTCRecurrence: R,
    OTCOccurrences: O,
    crypto: { randomUUID: () => 'test-id' },
    setInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    confirm: () => true,
    alert: message => { alertMessage = message; }
  };
  const context = { window, document, console, Intl, Date, Map, Set, Math, String, Number, Array, Object, JSON, Blob: class {}, URL: {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });
  const input = elements.get('jsonFileInput');

  await input.listeners.change({ target: { files: [{ name: 'old-save.json', size: 150, text: async () => JSON.stringify({ version: 1, settings: { weekStartsOn: 1, theme: 'system' }, tasks: [], absences: [], occurrences: [] }) }] } });
  assert.match(alertMessage, /only accepts version 2/i);

  alertMessage = "";
  await input.listeners.change({ target: { files: [{ name: 'current-save.json', size: 100, text: async () => JSON.stringify({ version: 2, settings: { weekStartsOn: 1, theme: 'dark' }, tasks: [], absences: [], occurrences: [] }) }] } });
  assert.equal(alertMessage, "", 'a valid current-format save file loads without an alert');
  assert.equal(document.documentElement.attributes['data-theme'], 'dark', 'current save theme is restored');
});


test('security policy blocks inline code and outbound connections', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /\sstyle=/i, 'HTML has no inline style attributes');
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scriptTags.length > 0);
  assert.ok(scriptTags.every(match => /\bsrc=/.test(match[1]) && !match[2].trim()), 'all scripts are external local files');
  assert.doesNotMatch(html, /\son(?:click|load|error|change|submit)\s*=/i, 'there are no inline event handlers');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /style\s*=\s*['"]|\.style\.cssText\s*=/i, 'dynamic markup does not emit inline styles');
  const themeInit = fs.readFileSync(path.join(__dirname, '..', 'theme-init.js'), 'utf8');
  assert.match(themeInit, /matchMedia/);
});

test('import rejects oversized files before reading them', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  let alertMessage = '';
  let readCalled = false;
  const document = {
    documentElement: new FakeElement('documentElement'),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new FakeElement(id)); return elements.get(id); },
    querySelectorAll() { return []; }, addEventListener() {},
    createElement() { return new FakeElement('created'); }, body: new FakeElement('body')
  };
  const window = {
    OTCRecurrence: R, OTCOccurrences: O,
    crypto: { randomUUID: () => 'test-id' }, setInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
    confirm: () => true, alert: message => { alertMessage = message; }
  };
  const context = { window, document, console, Intl, Date, Map, Set, Math, String, Number, Array, Object, JSON, Blob: class {}, URL: {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });
  await elements.get('jsonFileInput').listeners.change({ target: { files: [{
    name: 'too-large.json', size: 20 * 1024 * 1024 + 1,
    text: async () => { readCalled = true; return '{}'; }
  }] } });
  assert.match(alertMessage, /too large/i);
  assert.equal(readCalled, false, 'oversized content is rejected before reading');
});

test('import strictly rejects unsafe IDs and unknown fields', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  let alertMessage = '';
  const document = {
    documentElement: new FakeElement('documentElement'),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new FakeElement(id)); return elements.get(id); },
    querySelectorAll() { return []; }, addEventListener() {},
    createElement() { return new FakeElement('created'); }, body: new FakeElement('body')
  };
  const window = {
    OTCRecurrence: R, OTCOccurrences: O,
    crypto: { randomUUID: () => 'test-id' }, setInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
    confirm: () => true, alert: message => { alertMessage = message; }
  };
  const context = { window, document, console, Intl, Date, Map, Set, Math, String, Number, Array, Object, JSON, Blob: class {}, URL: {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });
  const input = elements.get('jsonFileInput');
  const maliciousId = { version: 2, settings: { weekStartsOn: 1, theme: 'system' }, tasks: [{
    id: 'task-<svg onload=alert(1)>', name: 'Bad ID', anchorDate: '2027-04-05', hasCompleted: false,
    rule: { frequency: 'week', interval: 1, weekdays: [], monthDays: [], months: [], weekdayPositions: [] },
    absencePolicy: 'skip', createdAt: '2027-01-01T00:00:00.000Z'
  }], absences: [], occurrences: [] };
  const maliciousField = { version: 2, settings: { weekStartsOn: 1, theme: 'system', unexpected: true }, tasks: [], absences: [], occurrences: [] };
  for (const [name, payload] of [['malicious-id.json', maliciousId], ['unknown-field.json', maliciousField]]) {
    alertMessage = '';
    const text = JSON.stringify(payload);
    await input.listeners.change({ target: { files: [{ name, size: text.length, text: async () => text }] } });
    assert.match(alertMessage, /invalid ID|unsupported field/i);
  }
});


test('valid imported task names are rendered as text, not executable markup', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  let alertMessage = '';
  const listeners = {};
  const document = {
    documentElement: new FakeElement('documentElement'),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new FakeElement(id)); return elements.get(id); },
    querySelectorAll() { return []; }, addEventListener(name, callback) { listeners[name] = callback; },
    createElement() { return new FakeElement('created'); }, body: new FakeElement('body')
  };
  const window = {
    OTCRecurrence: R, OTCOccurrences: O,
    crypto: { randomUUID: () => 'test-id' }, setInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
    confirm: () => true, alert: message => { alertMessage = message; }
  };
  const context = { window, document, console, Intl, Date, Map, Set, Math, String, Number, Array, Object, JSON, Blob: class {}, URL: {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });

  const payload = {
    version: 2,
    settings: { weekStartsOn: 1, theme: 'system' },
    tasks: [{
      id: 'task-safe-123', name: '<img src=x onerror=alert(1)>', anchorDate: '2027-04-05', hasCompleted: false,
      rule: { frequency: 'week', interval: 1, weekdays: [], monthDays: [], months: [], weekdayPositions: [] },
      absencePolicy: 'skip', createdAt: '2027-01-01T00:00:00.000Z'
    }],
    absences: [], occurrences: []
  };
  const text = JSON.stringify(payload);
  await elements.get('jsonFileInput').listeners.change({ target: { files: [{ name: 'safe-data.json', size: text.length, text: async () => text }] } });
  assert.equal(alertMessage, '', 'a valid current-format task imports successfully');
  elements.get('manageTasksButton').click();
  const rendered = elements.get('manageDialogContent').innerHTML;
  assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(rendered, /<img src=x onerror=alert\(1\)>/);
});

test('strict importer accepts the app-generated pending, completed, skipped and absence-rescheduled records', async () => {
  const state = {
    version: 2,
    settings: { weekStartsOn: 1, theme: 'dark' },
    tasks: ['task-done', 'task-skipped', 'task-manual', 'task-absence'].map(id => ({
      id,
      name: id,
      anchorDate: '2027-04-05',
      hasCompleted: false,
      rule: { frequency: 'week', interval: 1, weekdays: [], monthDays: [], months: [], weekdayPositions: [] },
      absencePolicy: id === 'task-absence' ? 'postpone' : 'skip',
      createdAt: '2027-01-01T00:00:00.000Z'
    })),
    absences: [{ id: 'absence-sample', name: 'Trip', startDate: '2027-04-06', endDate: '2027-04-08' }],
    occurrences: []
  };
  O.reconcile(state, '2027-04-05');
  O.complete(state, O.pendingForTask(state, 'task-done').id, '2027-04-06');
  O.skip(state, O.pendingForTask(state, 'task-skipped').id, '2027-04-06', 'manual');
  O.postpone(state, O.pendingForTask(state, 'task-manual').id, '2027-04-10', '2027-04-06T12:00:00.000Z');
  O.reconcile(state, '2027-04-06');
  const absencePending = O.pendingForTask(state, 'task-absence');
  assert.equal(absencePending.scheduledDate, '2027-04-09');
  assert.equal(absencePending.rescheduleHistory[0].reason, 'absence');

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  let alertMessage = '';
  const document = {
    documentElement: new FakeElement('documentElement'),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new FakeElement(id)); return elements.get(id); },
    querySelectorAll() { return []; }, addEventListener() {},
    createElement() { return new FakeElement('created'); }, body: new FakeElement('body')
  };
  const window = {
    OTCRecurrence: R, OTCOccurrences: O,
    crypto: { randomUUID: () => 'test-id' }, setInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
    confirm: () => true, alert: message => { alertMessage = message; }
  };
  const context = { window, document, console, Intl, Date, Map, Set, Math, String, Number, Array, Object, JSON, Blob: class {}, URL: {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });
  const text = JSON.stringify(state);
  await elements.get('jsonFileInput').listeners.change({ target: { files: [{ name: 'app-generated.json', size: text.length, text: async () => text }] } });
  assert.equal(alertMessage, '', 'all normal app-generated record forms import correctly');
});
