/* Offline Task Calendar — recurrence engine
 * Plain JavaScript, no dependencies, no network, and safe to load as a classic script.
 * All scheduling values are date-only strings (YYYY-MM-DD), evaluated in UTC.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OTCRecurrence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 86400000;
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function assert(condition, message) {
    if (!condition) throw new TypeError(message);
  }

  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function daysInMonth(year, month) {
    assert(Number.isInteger(month) && month >= 1 && month <= 12, "Month must be between 1 and 12.");
    return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  function parseDate(value, label) {
    label = label || "Date";
    assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value), label + " must use YYYY-MM-DD format.");
    const parts = value.split("-").map(Number);
    const year = parts[0], month = parts[1], day = parts[2];
    assert(year >= 1 && year <= 9999, label + " year is out of range.");
    assert(month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month), label + " is not a valid calendar date.");
    const d = new Date(0);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCFullYear(year, month - 1, day);
    return { year, month, day, epoch: d.getTime() };
  }

  function formatDate(epoch) {
    const d = new Date(epoch);
    return String(d.getUTCFullYear()).padStart(4, "0") + "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(d.getUTCDate()).padStart(2, "0");
  }

  function addDays(dateString, amount) {
    assert(Number.isInteger(amount), "Day offset must be an integer.");
    return formatDate(parseDate(dateString).epoch + amount * DAY_MS);
  }

  function daysBetween(from, to) {
    return (parseDate(to).epoch - parseDate(from).epoch) / DAY_MS;
  }

  function weekday(dateString) {
    return new Date(parseDate(dateString).epoch).getUTCDay();
  }

  function weekdayName(dateString) {
    return WEEKDAY_NAMES[weekday(dateString)];
  }

  function clampDay(year, month, intendedDay) {
    return Math.min(intendedDay, daysInMonth(year, month));
  }

  function startOfWeek(epoch) {
    const day = new Date(epoch).getUTCDay();
    return epoch - ((day + 6) % 7) * DAY_MS; // Monday-based week.
  }

  function monthDiff(a, b) {
    return (b.year - a.year) * 12 + b.month - a.month;
  }

  function validateRule(rule) {
    assert(rule && typeof rule === "object", "A recurrence rule is required.");
    assert(["day", "week", "month", "year"].includes(rule.frequency), "Frequency must be day, week, month, or year.");
    assert(Number.isInteger(rule.interval) && rule.interval >= 1 && rule.interval <= 999, "Interval must be between 1 and 999.");
    assert(!Object.prototype.hasOwnProperty.call(rule, "seasons"), "Seasonal date ranges are not supported. Use selected months instead.");
    const validateArray = (name, predicate, message) => {
      if (rule[name] === undefined) return;
      assert(Array.isArray(rule[name]), name + " must be an array.");
      rule[name].forEach(value => assert(predicate(value), message));
    };
    validateArray("weekdays", n => Number.isInteger(n) && n >= 0 && n <= 6, "Weekdays must use 0=Sunday through 6=Saturday.");
    validateArray("monthDays", n => n === "last" || (Number.isInteger(n) && n >= 1 && n <= 31), "Month days must be 1–31 or 'last'.");
    validateArray("months", n => Number.isInteger(n) && n >= 1 && n <= 12, "Months must be 1–12.");
    validateArray("weekdayPositions", item => item && Number.isInteger(item.weekday) && item.weekday >= 0 && item.weekday <= 6 && [-1, 1, 2, 3, 4, 5].includes(item.ordinal), "Invalid ordinal weekday rule.");
    ["weekdays", "monthDays", "months"].forEach(name => {
      if (Array.isArray(rule[name])) assert(new Set(rule[name].map(String)).size === rule[name].length, name + " cannot contain duplicates.");
    });
  }

  function cadenceMatches(date, anchor, rule) {
    if (date.epoch < anchor.epoch) return false;
    if (rule.frequency === "day") {
      return ((date.epoch - anchor.epoch) / DAY_MS) % rule.interval === 0;
    }
    if (rule.frequency === "week") {
      const weeks = (startOfWeek(date.epoch) - startOfWeek(anchor.epoch)) / (7 * DAY_MS);
      return weeks >= 0 && weeks % rule.interval === 0;
    }
    if (rule.frequency === "month") {
      const months = monthDiff(anchor, date);
      return months >= 0 && months % rule.interval === 0;
    }
    const years = date.year - anchor.year;
    return years >= 0 && years % rule.interval === 0;
  }

  function isLastWeekdayOfMonth(date) {
    return date.day + 7 > daysInMonth(date.year, date.month);
  }

  function ordinalOfWeekday(date) {
    return Math.floor((date.day - 1) / 7) + 1;
  }

  function matchesDateSelectors(date, anchor, rule) {
    const dayOfWeek = new Date(date.epoch).getUTCDay();
    const weekdays = Array.isArray(rule.weekdays) ? rule.weekdays : [];
    const monthDays = Array.isArray(rule.monthDays) ? rule.monthDays : [];
    const months = Array.isArray(rule.months) ? rule.months : [];
    const positions = Array.isArray(rule.weekdayPositions) ? rule.weekdayPositions : [];

    // Yearly recurrence defaults to the anchor month unless explicit months are selected.
    if (rule.frequency === "year" && months.length === 0 && date.month !== anchor.month) return false;
    if (months.length && !months.includes(date.month)) return false;

    // A plain monthly rule defaults to the anchor's day. Weekday/ordinal selectors
    // override that default, making (for example) every Monday in each active month.
    if (rule.frequency === "month" && !weekdays.length && !monthDays.length && !positions.length) {
      if (date.day !== clampDay(date.year, date.month, anchor.day)) return false;
    }

    // A plain yearly rule defaults to the anchor's month and day.
    if (rule.frequency === "year" && !weekdays.length && !monthDays.length && !positions.length) {
      if (date.day !== clampDay(date.year, date.month, anchor.day)) return false;
    }

    // A plain weekly rule defaults to the anchor weekday. Explicit date or
    // ordinal selectors replace that default rather than being ANDed with it.
    if (rule.frequency === "week" && !weekdays.length && !monthDays.length && !positions.length && dayOfWeek !== new Date(anchor.epoch).getUTCDay()) return false;

    if (weekdays.length && !weekdays.includes(dayOfWeek)) return false;
    if (monthDays.length) {
      const last = daysInMonth(date.year, date.month);
      const matches = monthDays.some(value => value === "last" ? date.day === last : date.day === clampDay(date.year, date.month, value));
      if (!matches) return false;
    }
    if (positions.length) {
      const matches = positions.some(item => item.weekday === dayOfWeek && (item.ordinal === -1 ? isLastWeekdayOfMonth(date) : ordinalOfWeekday(date) === item.ordinal));
      if (!matches) return false;
    }
    return true;
  }

  function matches(dateString, anchorString, rule) {
    validateRule(rule);
    const date = parseDate(dateString);
    const anchor = parseDate(anchorString, "Anchor");
    return cadenceMatches(date, anchor, rule) && matchesDateSelectors(date, anchor, rule);
  }

  function generateOccurrences(options) {
    const anchorString = options.anchor;
    const rule = options.rule;
    const fromString = options.from;
    const toString = options.to;
    const limit = options.limit === undefined ? 10000 : options.limit;
    validateRule(rule);
    const anchor = parseDate(anchorString, "Anchor");
    const from = parseDate(fromString, "From");
    const to = parseDate(toString, "To");
    assert(to.epoch >= from.epoch, "To date must not be before from date.");
    assert(Number.isInteger(limit) && limit > 0, "Limit must be a positive integer.");
    const start = Math.max(from.epoch, anchor.epoch);
    const results = [];
    for (let epoch = start; epoch <= to.epoch; epoch += DAY_MS) {
      const date = { epoch, year: new Date(epoch).getUTCFullYear(), month: new Date(epoch).getUTCMonth() + 1, day: new Date(epoch).getUTCDate() };
      if (cadenceMatches(date, anchor, rule) && matchesDateSelectors(date, anchor, rule)) {
        results.push(formatDate(epoch));
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  function nextOccurrence(options) {
    const after = parseDate(options.after, "After");
    const anchor = parseDate(options.anchor, "Anchor");
    const start = Math.max(after.epoch + DAY_MS, anchor.epoch);
    const toDate = new Date(start);
    toDate.setUTCFullYear(toDate.getUTCFullYear() + (options.maxYears || 20));
    const to = formatDate(toDate.getTime());
    const found = generateOccurrences({ anchor: options.anchor, rule: options.rule, from: formatDate(start), to, limit: 1 });
    return found.length ? found[0] : null;
  }

  return {
    addDays,
    daysBetween,
    daysInMonth,
    formatDate,
    generateOccurrences,
    isLeapYear,
    matches,
    nextOccurrence,
    parseDate,
    weekday,
    weekdayName,
    validateRule
  };
});
