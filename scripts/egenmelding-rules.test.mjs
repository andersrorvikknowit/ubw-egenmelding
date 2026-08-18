import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekWindow,
  withinWindow,
  groupIntoCases,
  excessInSixteenDayWindows,
  summarizeEmployee,
  aggregate,
} from "./egenmelding-rules.mjs";

const sick = (date, hours = 7.5, hrid = "E1", employee = "Test Person") => ({ hrid, employee, date, hours, week: null });

test("weekWindow excludes current week; end is last week's Sunday", () => {
  // Wednesday 2026-08-19. Current week Mon 2026-08-17..Sun 2026-08-23.
  // Last week Sun = 2026-08-16. Start = Monday 52 weeks before last week's Monday (2026-08-10).
  const w = weekWindow(new Date(2026, 7, 19));
  assert.equal(w.to, "2026-08-16");
  assert.equal(w.from, "2025-08-11"); // Monday of last week (2026-08-10) minus 52*7 days
});

test("Friday egenmelding makes following Monday a new case", () => {
  // Fri 2026-08-14, then Mon 2026-08-17
  const cases = groupIntoCases([sick("2026-08-14"), sick("2026-08-17")]);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].days, 1);
  assert.equal(cases[1].days, 1);
});

test("consecutive Mon-Wed is one case of 3 days", () => {
  const cases = groupIntoCases([sick("2026-08-17"), sick("2026-08-18"), sick("2026-08-19")]);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].days, 3);
});

test("case can span two week numbers when consecutive (Thu-Fri-... but Fri blocks weekend)", () => {
  // Wed 2026-08-19, Thu 2026-08-20, Fri 2026-08-21 -> one case of 3 days across days
  const cases = groupIntoCases([sick("2026-08-19"), sick("2026-08-20"), sick("2026-08-21")]);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].days, 3);
});

test("4 consecutive days -> one case flagged exceeds_3_days_per_case", () => {
  const days = [sick("2026-08-17"), sick("2026-08-18"), sick("2026-08-19"), sick("2026-08-20")];
  const s = summarizeEmployee("E1", "Test Person", days);
  assert.equal(s.sykdomstilfeller, 1);
  assert.equal(s.egenmelding_days, 4);
  assert.ok(s.flags.includes("exceeds_3_days_per_case"));
});

test("two short cases within 16 days exceeding 3 days total is flagged", () => {
  // Mon 2026-08-03 (1 day), then Mon+Tue 2026-08-10,08-11 (2 days) -> 3 days, ok
  // add another day 2026-08-12 -> 4 days within 16-day window -> excess
  const days = [sick("2026-08-03"), sick("2026-08-10"), sick("2026-08-11"), sick("2026-08-12")];
  assert.ok(excessInSixteenDayWindows(groupIntoCases(days)) > 0);
  const s = summarizeEmployee("E1", "Test Person", days);
  assert.ok(s.flags.includes("exceeds_3_days_16d_window"));
});

test("exactly 3 days spread within 16 days is NOT flagged for the window rule", () => {
  const days = [sick("2026-08-03"), sick("2026-08-10"), sick("2026-08-17")];
  // 08-03 and 08-17 are 14 days apart -> all three within a 16-day window
  assert.equal(excessInSixteenDayWindows(groupIntoCases(days)), 0);
});

test("4 separate cases -> quota_reached", () => {
  const days = [sick("2026-06-01"), sick("2026-06-15"), sick("2026-07-01"), sick("2026-07-20")];
  const s = summarizeEmployee("E1", "Test Person", days);
  assert.equal(s.sykdomstilfeller, 4);
  assert.equal(s.quota_remaining, 0);
  assert.ok(s.flags.includes("quota_reached"));
});

test("5 separate cases -> requires_sykemelding", () => {
  const days = [
    sick("2026-05-01"), sick("2026-06-01"), sick("2026-06-15"), sick("2026-07-01"), sick("2026-07-20"),
  ];
  const s = summarizeEmployee("E1", "Test Person", days);
  assert.equal(s.sykdomstilfeller, 5);
  assert.ok(s.flags.includes("requires_sykemelding"));
});

test("aggregate ignores hours=0 and out-of-window rows", () => {
  const window = { from: "2026-01-01", to: "2026-12-31" };
  const records = [
    sick("2026-06-01", 7.5),
    sick("2026-06-02", 0), // hours 0 -> ignored
    sick("2020-01-01", 7.5), // out of window -> ignored
  ];
  const summaries = aggregate(records, window);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].egenmelding_days, 1);
});

test("withinWindow boundaries inclusive", () => {
  const w = { from: "2026-01-01", to: "2026-12-31" };
  assert.ok(withinWindow("2026-01-01", w));
  assert.ok(withinWindow("2026-12-31", w));
  assert.ok(!withinWindow("2025-12-31", w));
  assert.ok(!withinWindow("2027-01-01", w));
});
