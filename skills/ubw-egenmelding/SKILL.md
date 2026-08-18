---
name: ubw-egenmelding
description: "Assist managers with counting and exporting company-wide egenmelding (self-certified sick leave) from Unit4/UBW using the connected Chrome browser session only. Use when ChatGPT needs to guide or operate UBW in Chrome, run the 'Timesheets approved per resource (T2)' report, apply Norwegian egenmelding counting rules over the last 52 completed weeks, and produce per-employee CSV exports plus a flagged list (quota reached / sykemelding required)."
---

# UBW Egenmelding Export

Use this skill to help a **manager** count and export **company-wide
egenmelding** (self-certified sick leave) from Unit4/UBW as CSV.

This skill is **read-only**: it reads report data and exports counts. It never
submits, approves, rejects, deletes, or changes anything in UBW.

## Runtime

Use the connected **Chrome ChatGPT plugin/session** for all UBW interaction.

Do not use terminal commands, bundled executables, local browser launchers,
debugging-port setup, private browser endpoints, or local file writes. If Chrome
is not connected or UBW is not available in the connected browser, ask the user
to connect/open Chrome and sign in.

Before starting, verify that the Chrome connector/plugin is available. If it is
not available, stop and tell the user this skill requires a connected Chrome
session; do not fall back to local automation.

Use ChatGPT's normal file/artifact output to provide CSV files. If UBW downloads
an Excel/CSV export and the browser plugin cannot read the downloaded file
directly, ask the user to attach that export in chat before counting.

## Data Source: Timesheets approved per resource (T2)

1. Log in to UBW. Let the user handle login, SSO, and MFA.
2. **Select the correct company** in the company dropdown (between the
   activities menu and the user menu in the top bar).
3. Open the global search (top-right, or `Alt+Q`) and search for
   **`Timesheets approved per resource (T2)`**. This is the report to use.
4. Set the report parameters:
   - **Manager** = empty. Remove anything prefilled.
   - **T.per mellom** = the first and last ISO week in the 52 completed-week
     window. The end week is the last completed week, never the current week.
   - Under **Resultat**: **Res.type** = `1`, **Timecode** = `syke`.
5. Click **Søk** to load the data.

The report's default `.xlsx` export has these columns:

```text
Cost center, Res.type, Manager, Hrid, Restyp, Resource, Resource (T),
Houremp, Timecode, Timecode (T), Inv.unit, Project, Project (T),
Work order, Work order (T), Aktivitet, Aktivitet (T), Text,
Item date, Week number, Hours
```

The skill maps each row to a sick day:
`{ hrid: Hrid, employee: Resource (T), date: Item date, week: Week number, hours: Hours }`.
Only rows with **Hours > 0** count as a sick day.

Prefer the report's export function when available because it avoids missing
rows hidden by paging or virtualization. If exporting is not available, collect
all visible grid rows, advance through every page, and verify that the row count
matches the report total before counting.

## Counting Window

- Count **52 completed weeks back through the last completed week**.
- The **current week is never included** (UBW never shows it).
- End = the most recent **Sunday** before the current ISO week (inclusive).
- Start = the **Monday** of the ISO week 51 weeks before the last completed week.
- `T.per mellom` = `YYYYWW` for the start week through `YYYYWW` for the last
  completed week.

Example: if today is Tuesday 2026-08-18, the current ISO week is 2026-W34, the
last completed week is 2026-W33, the date window is 2025-08-18 through
2026-08-16, and `T.per mellom` is `202534` to `202633`.

## Egenmelding Rules

Counting sykdomstilfeller (sickness cases) and egenmelding days:

- A **sykdomstilfelle** = consecutive calendar days of sick leave.
- Max **3 egenmelding days per sykdomstilfelle**.
- **Weekend rule:** an egenmelding on **Friday** consumes Friday, Saturday, and
  Sunday (3 calendar days). A following **Monday** is therefore a **new**
  sykdomstilfelle.
- A case may **span two week numbers** and still count as one case if the days
  are consecutive (and not more than 3 days).
- **16-day rule:** within any rolling **16 calendar-day** window an employee may
  register at most **3 egenmelding days total**. If a person returns to work and
  is sick again within 16 days, that is a new sykdomstilfelle, but the combined
  days still cannot exceed 3.
- **12-month quota:** max **4 sykdomstilfeller per 12 months** (the 52-week
  window). A 5th requires a **sykemelding** (medical certificate).

## Output

Produce two CSV files in ChatGPT:

1. **Summary** (`egenmelding-<from>-to-<to>.csv`) — all employees:
   ```text
   hrid,employee,egenmelding_days,sykdomstilfeller,quota_remaining
   ```
2. **Flagged** (`...-flagged.csv`) — only employees needing attention:
   ```text
   hrid,employee,egenmelding_days,sykdomstilfeller,flag
   ```
   `flag` values: `quota_reached`, `requires_sykemelding`,
   `exceeds_3_days_per_case`, `exceeds_3_days_16d_window` (multiple joined by `;`).

Do not include confidential row-level personnel data in the chat transcript
unless the user explicitly asks for it. Summarize counts and attach/provide the
CSV outputs.

## Safety Rules

- Read-only. Never submit, approve, reject, delete, or change anything in UBW.
- Do not invent employee names, dates, timecodes, or counts.
- Do not guess credentials. Let the user handle login, MFA, and SSO.
- Treat egenmelding data as confidential personnel data. Use it only to produce
  the requested CSVs and compact review.
- Preserve Norwegian labels and names when the page is in Norwegian.

## Chrome Workflow

The Knowit production UBW URL is fixed:
`https://ubw.unit4cloud.com/se_kno_prod_web/`. Do not ask for the URL.

Operate the UI through Chrome:

- **Company dropdown:** top-bar control `[id^=u4_clienttoolitem]`; options are
  `[id^=u4_clientmenuitem]`. Match by company number prefix (for example `332`)
  or name substring.
- **Global search:** `[id^=u4_textfield][id$=-inputEl]` (placeholder "Søk
  (Alt+q)"). Typing the report name surfaces a `.u4-menu-item-text` result to click.
- **Report form** lives in **doubly-nested iframes** (`Container.aspx` →
  `ContentContainer.aspx`).
- **Selection criteria** ids: Manager `b_s2_s11_l2s11_ctl00_r3resource_id=_i`
  (cleared), T.per mellom `..._period<>_i` / `..._period<>_to_i` (YYYYWW).
- **Grid filter row:** Res.type `b_g1s3__filterRow_r1resource_id` = `1`,
  Timecode `b_g1s3__filterRow_pd` = `syke`, applied **server-side** via
  `browserSearchClick(event, 'b$g1s3$browsergridheader$findBRT', true)`. This is
  what reduces the full result set to the egenmelding rows.
- **Grid rows:** `tr[id^=b_g1s3_row]`; **Item date** is `DD.MM.YYYY` and is
  converted to ISO. Only rows with **Hours > 0** count as sick days.
- Filtering server-side keeps the sick-leave rows on a single grid page; if a
  company has more sick-leave rows than the page size, collect every page or use
  the report export.

## Counting Procedure

1. Normalize each qualifying report row to:
   `{ hrid, employee, date, week, hours }`.
2. Exclude rows with missing dates, employees, or `Hours <= 0`; report any
   unparseable rows separately.
3. Deduplicate by employee/date before grouping so multiple positive-hour rows
   on the same date count as one egenmelding day.
4. For each employee, sort sick days by date and group consecutive calendar days
   into sickness cases.
5. Apply weekend reach before grouping:
   - A Friday row consumes Friday, Saturday, and Sunday. Ignore Saturday/Sunday
     rows that fall inside that reach. A following Monday starts a new case.
   - A Saturday row consumes Saturday and Sunday. Ignore a Sunday row that falls
     inside that reach.
   - Other weekdays consume only that day.
6. Count `egenmelding_days` as the deduplicated qualifying sick-day rows, and
   `sykdomstilfeller` as the grouped cases.
7. Set `quota_remaining = max(0, 4 - sykdomstilfeller)`.
8. Add flags:
   - `quota_reached` when `sykdomstilfeller = 4`.
   - `requires_sykemelding` when `sykdomstilfeller >= 5`.
   - `exceeds_3_days_per_case` when any case has more than 3 egenmelding days.
   - `exceeds_3_days_16d_window` when any rolling 16-calendar-day window has more
     than 3 egenmelding days.

Use these examples as checks while counting:

- `2026-08-14` (Friday) plus `2026-08-17` (Monday) = 2 sickness cases, 2
  egenmelding days.
- `2026-08-17`, `2026-08-18`, `2026-08-19` = 1 sickness case, 3 egenmelding
  days, no day-cap flag.
- `2026-08-17`, `2026-08-18`, `2026-08-19`, `2026-08-20` = 1 sickness case, 4
  egenmelding days, `exceeds_3_days_per_case`.
- Four separate sickness cases in the window = `quota_reached`; five or more =
  `requires_sykemelding`.
- Any set of four or more egenmelding days where the first and last are less
  than 16 calendar days apart = `exceeds_3_days_16d_window`.

## Final Review

Before treating the export as final, present a compact review:

- window (from / to)
- number of employees included
- number flagged, and why (quota / sykemelding / day caps)
- output CSV paths
- any rows that could not be parsed and need attention
