# Offline Task Calendar
**A simple offline planner for things that don't happen very often**  

**Release:** 1.3.4 — recurrence shifts and resolved dates

This project was originally created by a friend of mine, for his own personal use.  
It's a small, offline calendar and task database designed with autistic people in mind, particularly for keeping track of tasks that only need to be done occasionally.  

## Why am I sharing this?
I didn't create this project.  
A friend showed me something he had built to solve a problem in his own life, and I thought it was too useful not to share.  

## Credits
Created by Jamsa.

# Original Readme

## Release note — v1.3.4

- Manual postponement now shifts the future recurrence series according to the task's existing recurrence rule and selectors.
- Skipping a postponed occurrence preserves that adjusted schedule, so old future dates do not reappear.
- Completing a postponed occurrence resets the recurrence anchor to the actual completion date and clears the temporary schedule adjustment.
- A task's adjusted recurrence anchor is saved in JSON. Existing pending or skipped manual-postponement records from v1.3.3 are also recognized when loaded.
- Complete and Skip actions are recorded against the calendar date selected when the action is made; the exact timestamp is retained separately.
- Added regression coverage for postpone → skip → next occurrence, postpone → complete → re-anchor, and result-date placement.

## Release note — v1.3.1

The Absences manager now has a visible **＋ Add absence** button, including when no absences exist yet. Open **Absences** in the main toolbar, choose **＋ Add absence**, enter a name and inclusive start/end dates, then save.

A private, offline HTML5 recurring-task calendar. It uses plain HTML, CSS and JavaScript, has no backend, makes no network requests, and stores persistent user data in one JSON file that you control.

## Run it

1. Extract the ZIP to a folder.
2. Open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari).
3. Click **New task** to create your first task.
4. Click **Save JSON** to download `offline-task-calendar.json`. The filename is stable and does not include the current date.
5. On later visits, click **Open JSON** and select that save file.

The app does not use LocalStorage, IndexedDB, cookies, a database, a server, or an external service. Changes remain in memory until you export the JSON file. The app warns before closing when there are unsaved changes.

## Color themes

The application supports **System**, **Dark** and **Light** themes. The theme button in the header cycles through these three modes. System mode follows the operating-system/browser color preference and updates if that preference changes while the app is open.

The selected theme is stored in the JSON save file under `settings.theme`. Changing the theme marks the JSON data as changed, so export the save file to preserve the choice between sessions.

## Files

- `index.html` — application interface and Content Security Policy.
- `theme-init.js` — applies the system theme before the page styles render.
- `styles.css` — responsive styling.
- `recurrence-engine.js` — date and recurrence calculations.
- `occurrence-manager.js` — completion, skip, overdue and absence scheduling.
- `app.js` — calendar rendering, forms, and JSON import/export.
- `tests/` — Node.js test suite for recurrence and scheduling logic.

All application files are plain JavaScript/HTML/CSS. There is no TypeScript, framework, compiler, package manager, or build step.

## Recurrence behavior

A task has an initial date, a frequency (`day`, `week`, `month`, or `year`), an interval, and optional selectors.

- Weekdays, month dates, ordinal weekdays and selected active months can be combined.
- Different values inside one selector are alternatives (OR); different selector types are combined as restrictions (AND).
- Selected months are the only active-period control; a separate seasonal date-window control is not used.
- Seasonal date-range rules are not supported by the current recurrence format.
- `Every 2 months` plus `Monday` means every Monday in every second eligible month, anchored to the month of the current recurrence anchor.
- A monthly rule without date/weekday selectors uses the anchor's day of month. A yearly rule without selectors uses the anchor's month and day. Days such as the 31st and February 29 are clamped to the last valid day in shorter months/years.
- A weekly rule without selected weekdays uses the anchor's weekday.

When completed, the occurrence's actual completion date becomes the task's new recurrence anchor. Skipping does not change the anchor. If the next recurrence date has already passed, that next occurrence may itself be overdue; the overdue count is calculated from that occurrence's own scheduled date.

## Occurrence behavior

Only one actionable pending occurrence is maintained per task. The calendar also calculates non-persistent previews for every later recurrence in the visible month, year or decade range. This means a weekly task appears on every matching day in a future month even though only the next occurrence currently has Complete, Postpone and Skip actions. Future previews open the task editor; previews are recalculated after postponement, completion or skipping using the task's effective recurrence anchor.

- **Complete:** records the actual completion date, moves the recurrence anchor to that date, and clears any temporary postponement adjustment.
- **Postpone:** changes the occurrence's scheduled date, preserves its original due date and reschedule history, and shifts subsequent recurrence dates using the same recurrence rule from the new schedule anchor.
- **Skip:** records the skip and leaves the current recurrence anchor unchanged. If the occurrence had been postponed, the adjusted schedule remains in effect, so the old future dates do not return.
- **Resolved-event placement:** completed and skipped entries appear on the calendar date selected when the action is recorded (the date the occurrence is being completed/skipped on or for), not automatically on the task's initial anchor date. The task's scheduled date and original due date remain available in the card details when they differ. The exact recording timestamp is also retained.
- **Overdue:** an unfinished occurrence displays on today, with the number of days since its current scheduled date. Its stored scheduled date and original due date remain available in history.

## Absence behavior

To add an absence, click **Absences** in the top toolbar, then click **＋ Add absence** in the dialog. Enter a name and the inclusive start and end dates, then choose **Save absence**. Existing absences can be edited or deleted from the same list.

Absences are calendar ranges with a name, start date and end date. The absence policy is configured separately for every task; there is no global policy.

- **Skip (default):** affected occurrences are skipped without a backlog.
- **Postpone:** move the affected occurrence to the first day after the absence.
- **Distribute:** collect affected occurrences from tasks using this policy, sort them by original due date, and assign consecutive days after the absence. If a day is covered by another absence, distribution continues after that absence.

If postponing or distributing would place an occurrence outside that task's selected active months, it is skipped instead of being carried into a later month. An overdue task that remains unfinished when an absence begins is also affected by that absence's policy.

## Calendar views

- **Month:** working view with task actions in the selected-day panel. Task names in calendar cells and the selected-day panel open task settings.
- **Year:** twelve mini-calendars; select a date to inspect it or a month to open it. Scheduled dates are indicated by blue day numbers, completed dates by green, skipped dates by red, and absence-only dates by purple.
- **Decade:** ten yearly summaries including projected recurrence dates and recorded history.
- The Tasks manager also lets you open a task by selecting its name.

Multiple tasks may appear on the same day. There is no daily workload limit.

## Save-file format

The JSON file has `version`, `settings`, `tasks`, `absences` and `occurrences` collections. The current save-file schema is version **2**. Future dates are calculated dynamically; completed and skipped history and manual postponements are retained. A task may contain `scheduleAnchorDate` when a manual postponement has shifted its future recurrence cadence; this field is optional and is preserved in JSON exports.

**Older save files are deliberately not supported.** The importer accepts only version 2 and does not migrate or repair version 1 files. Start a new save file in this release rather than importing a file from an earlier release. The importer checks the schema and refuses unknown versions or inconsistent occurrence references.

## Run tests

The tests use Node.js only as a local test runner. Node.js is not part of the application and is not needed to use the calendar.

From this folder, run:

```bash
node --test tests/*.test.cjs
```

The suite covers recurrence intervals, combined rules, month-end and leap-year handling, active-month filters, year-view day-number indicators, completion-based anchors, overdue counters, skipping, manual postponement and shifted future recurrences, result placement on the resolved occurrence date, all three absence policies, future recurrence previews, rejection of obsolete save-file formats, CSP restrictions, oversized-file rejection, strict save validation and escaped imported task names.

## Current limitations

- Saving is an explicit JSON download. A normal local HTML page cannot silently overwrite an arbitrary local file, so export the JSON again after making changes and replace your previous save file.
- Future recurrence dates are previews based on the task's effective anchor. Only the next occurrence is actionable; later previews are recalculated when the task is postponed, completed or skipped. This avoids permanently saving speculative future occurrences.
- The application is not packaged as an installable PWA. It works offline because all assets are local and there are no network dependencies.


## Security hardening (1.3.2)

- A restrictive Content Security Policy blocks inline scripts and event-handler attributes, remote scripts, network connections, external fonts, frame content loaded by the app, objects, workers and form submissions. All application scripts and styles load from the local folder.
- The startup theme initializer is a local JavaScript file; there are no inline scripts or event-handler attributes.
- The application uses no inline style attributes. Decade-view bar heights use fixed CSS classes so the stylesheet policy can disallow inline styles.
- JSON imports are limited to 20 MB and checked against the current schema with strict field allow-lists, type checks, ID checks, date/timestamp validation, collection limits and cross-reference checks. Unknown fields, duplicate IDs, orphan occurrences and inconsistent status fields are rejected.
- Imported records are copied into new, explicitly constructed objects after validation. User-controlled text is HTML-escaped before use in the remaining HTML templates, including ID attributes.
- Exports larger than 20 MB are refused so the application does not create files it cannot import again.

Because the application is opened directly as a local file, its Content Security Policy is delivered through a meta element. Meta-delivered policies cannot enforce every directive available through an HTTP response header (for example, `frame-ancestors`), so this is defense-in-depth rather than a server-delivered policy. This is not a formal security audit. JSON exports remain unencrypted plain text. Keep the application folder and save files on a trusted device and protect them with your operating-system account.


## Release 1.3.3

- Save exports use the fixed filename `offline-task-calendar.json` without a date suffix.
- The application heading and browser tab title show today's task count. The count includes pending, projected, completed and skipped task occurrences displayed for the current local date, but excludes absence entries.


## Release 1.3.4

- Manual postponement now shifts the subsequent recurrence series while preserving the task's weekday, date, ordinal and active-month selectors.
- Skipping a postponed occurrence keeps the adjusted series; completing it instead resets the anchor to the actual completion date.
- Existing v1.3.3 pending or skipped manual-postponement records are recognized so their adjusted schedule is retained after importing the save file.
- Complete and Skip events are filed under the calendar date selected when the action is recorded; the exact recording timestamp remains available in the occurrence history.
