// Egenmelding rule engine (pure, testable).
//
// Turns a flat list of sick-day records into per-employee egenmelding counts,
// applying the Norwegian self-certified sick-leave rules:
//
//  - Window: last completed week going 52 weeks back. The current week is never
//    included (UBW never shows it). End = most recent Sunday (inclusive),
//    start = Monday of the ISO week 52 weeks earlier.
//  - A sykdomstilfelle (sickness case) = consecutive calendar days.
//  - A Friday egenmelding consumes Fri+Sat+Sun (3 calendar days), so a following
//    Monday starts a NEW case.
//  - Max 3 egenmelding days per case.
//  - Within any rolling 16 calendar-day window, max 3 egenmelding days total.
//  - Max 4 sykdomstilfeller per 12 months (52 weeks). A 5th requires sykemelding.
//  - A case may span two week numbers and still count as one case if days are
//    consecutive.
//
// Input record shape (one row per sick day):
//   { hrid, employee, date: "YYYY-MM-DD", week, hours }
// Only rows with hours > 0 are treated as sick days.

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function calendarDaysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / DAY_MS);
}

// Monday=0 ... Sunday=6
function weekdayIndex(d) {
  return (d.getDay() + 6) % 7;
}

function mondayOf(d) {
  const base = toDate(d);
  const back = weekdayIndex(base);
  return new Date(base.getTime() - back * DAY_MS);
}

function sundayOf(d) {
  const monday = mondayOf(d);
  return new Date(monday.getTime() + 6 * DAY_MS);
}

// Window: current week excluded. End = last week's Sunday (inclusive).
// Start = Monday of the week 52 weeks before that last week.
export function weekWindow(now = new Date()) {
  const thisMonday = mondayOf(now);
  const endSunday = new Date(thisMonday.getTime() - 1 * DAY_MS); // Sunday before current week
  const lastMonday = mondayOf(endSunday);
  const startMonday = new Date(lastMonday.getTime() - 52 * 7 * DAY_MS);
  return { from: isoDate(startMonday), to: isoDate(endSunday) };
}

// ISO week number for a date.
function isoYearWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((t - firstThursday) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
  return { year: t.getUTCFullYear(), week };
}

// The UBW "T.per mellom" week range (YYYYWW strings) matching weekWindow():
// from = ISO week of the window start (52 weeks back), to = ISO week of the
// last completed week (window end / most recent Sunday).
export function periodWeekRange(now = new Date()) {
  const w = weekWindow(now);
  const fmt = (isoStr) => {
    const d = toDate(isoStr);
    const yw = isoYearWeek(d);
    return `${yw.year}${String(yw.week).padStart(2, "0")}`;
  };
  return { fromWeek: fmt(w.from), toWeek: fmt(w.to) };
}

export function withinWindow(dateStr, window) {
  const d = toDate(dateStr);
  if (!d) return false;
  return d >= toDate(window.from) && d <= toDate(window.to);
}

// Reach of a single egenmelding day in calendar days. A Friday (index 4)
// consumes Fri+Sat+Sun; Saturday consumes Sat+Sun; otherwise just the day.
function reachDays(d) {
  const wd = weekdayIndex(d);
  if (wd === 4) return 3; // Friday -> Fri, Sat, Sun
  if (wd === 5) return 2; // Saturday -> Sat, Sun
  return 1;
}

// Group an employee's sick days into consecutive cases, applying the weekend
// reach rule. Returns cases: { start, end, dates: [ISO], days }.
export function groupIntoCases(sickDays) {
  const dates = [...new Set(sickDays.map((s) => isoDate(toDate(s.date))))]
    .map(toDate)
    .sort((a, b) => a - b);

  const cases = [];
  let current = null;
  let lastDay = null; // last registered sick day in the current case

  for (const d of dates) {
    if (current && lastDay) {
      const gap = calendarDaysBetween(lastDay, d);
      const reach = reachDays(lastDay); // how many calendar days lastDay covers
      if (gap < reach) {
        // d falls inside the previous day's reach (e.g. a Saturday after a
        // Friday). Not a separate registered day; ignore it.
        continue;
      }
      if (gap === 1) {
        // immediately following calendar day -> extends the current case
        current.dates.push(isoDate(d));
        current.end = isoDate(d);
        current.days += 1;
        lastDay = d;
        continue;
      }
      // Any larger gap (including Friday -> Monday, where the weekend reach
      // pushes the next eligible new-case day to Monday) starts a new case.
    }
    current = { start: isoDate(d), end: isoDate(d), dates: [isoDate(d)], days: 1 };
    cases.push(current);
    lastDay = d;
  }

  return cases;
}

// Rolling 16 calendar-day window: at most 3 egenmelding days total. Returns the
// number of egenmelding days that exceed the cap in any window.
export function excessInSixteenDayWindows(cases) {
  const dayList = cases
    .flatMap((c) => c.dates)
    .map(toDate)
    .sort((a, b) => a - b);

  let excess = 0;
  for (let i = 0; i < dayList.length; i++) {
    let count = 0;
    for (let j = i; j < dayList.length; j++) {
      if (calendarDaysBetween(dayList[i], dayList[j]) < 16) count++;
      else break;
    }
    if (count > 3) {
      excess = Math.max(excess, count - 3);
    }
  }
  return excess;
}

const MAX_DAYS_PER_CASE = 3;
const MAX_CASES_PER_YEAR = 4;

// Aggregate a single employee's cases into a summary with flags.
export function summarizeEmployee(hrid, employee, sickDays) {
  const cases = groupIntoCases(sickDays);
  const totalDays = cases.reduce((sum, c) => sum + c.days, 0);
  const sykdomstilfeller = cases.length;
  const quotaRemaining = Math.max(0, MAX_CASES_PER_YEAR - sykdomstilfeller);

  const flags = [];
  if (cases.some((c) => c.days > MAX_DAYS_PER_CASE)) flags.push("exceeds_3_days_per_case");
  if (excessInSixteenDayWindows(cases) > 0) flags.push("exceeds_3_days_16d_window");
  if (sykdomstilfeller > MAX_CASES_PER_YEAR) flags.push("requires_sykemelding");
  else if (sykdomstilfeller === MAX_CASES_PER_YEAR) flags.push("quota_reached");

  return {
    hrid,
    employee,
    egenmelding_days: totalDays,
    sykdomstilfeller,
    quota_remaining: quotaRemaining,
    cases,
    flags,
  };
}

// records: [{ hrid, employee, date, week, hours }]
export function aggregate(records, window = weekWindow()) {
  const byEmployee = new Map();
  for (const r of records) {
    if (!(Number(r.hours) > 0)) continue; // only hours > 0 count as a sick day
    if (!withinWindow(r.date, window)) continue;
    const key = r.hrid || r.employee || "(unknown)";
    if (!byEmployee.has(key)) {
      byEmployee.set(key, { hrid: r.hrid || "", employee: r.employee || "", days: [] });
    }
    const bucket = byEmployee.get(key);
    if (!bucket.employee && r.employee) bucket.employee = r.employee;
    bucket.days.push(r);
  }

  const summaries = [];
  for (const [, bucket] of byEmployee) {
    summaries.push(summarizeEmployee(bucket.hrid, bucket.employee, bucket.days));
  }
  summaries.sort((a, b) => (a.employee || "").localeCompare(b.employee || ""));
  return summaries;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

export function summaryCsv(summaries) {
  const headers = ["hrid", "employee", "egenmelding_days", "sykdomstilfeller", "quota_remaining"];
  return toCsv(headers, summaries);
}

export function flaggedCsv(summaries) {
  const headers = ["hrid", "employee", "egenmelding_days", "sykdomstilfeller", "flag"];
  const rows = summaries
    .filter((s) => s.flags.length > 0)
    .map((s) => ({ ...s, flag: s.flags.join(";") }));
  return toCsv(headers, rows);
}
