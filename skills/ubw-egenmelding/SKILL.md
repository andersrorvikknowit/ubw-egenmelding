---
name: ubw-egenmelding
description: "Assist managers with counting and exporting company-wide egenmelding (self-certified sick leave) from Unit4/UBW using the connected Chrome browser session. Use when ChatGPT or Codex needs to guide or operate UBW in Chrome, run the 'Timesheets approved per resource (T2)' report, apply Norwegian egenmelding counting rules over the last 12 months through the last completed month, and produce per-employee CSV exports plus a flagged list (quota reached / sykemelding required)."
---

# UBW Egenmelding Export

**Version:** 1.1.0 — counting window is the **last 12 months through the last
completed month**; the downloaded UBW export is located automatically in the
user's Downloads folder when local file reading is available.

State the skill version and the resolved counting window in your **first reply**,
for example: `UBW Egenmelding Export v1.1.0 — window 2025-08-01 to 2026-07-31`.
This lets the user tell which revision of the counting rules produced the numbers.

Use this skill to help a **manager** count and export **company-wide
egenmelding** (self-certified sick leave) from Unit4/UBW as CSV.

This skill is **read-only**: it reads report data and exports counts. It never
submits, approves, rejects, deletes, or changes anything in UBW.

## Runtime

Use the connected **Chrome ChatGPT/Codex plugin session** for all UBW interaction.

Do not use bundled executables, local browser launchers, debugging-port setup,
private browser endpoints, or local file **writes**. If Chrome is not connected or
UBW is not available in the connected browser, ask the user to connect/open Chrome
and sign in.

**Reading the downloaded export locally is allowed.** When the runtime has local
file access (for example the Codex desktop app), you may list and read files in
the user's Downloads folder to find the UBW export, as described in
[Locating the UBW Export File](#locating-the-ubw-export-file). This is read-only:
never write, move, rename, or delete anything on the user's disk.

Before starting, verify that the Chrome connector/plugin is available. If it is
not available, stop and tell the user this skill requires a connected Chrome
session; do not fall back to local browser automation.

Use the assistant's normal file/artifact output to provide the CSV results.

## Locating the UBW Export File

UBW's report export downloads to the user's Downloads folder. Find it yourself
instead of asking the user to attach it every time.

### Resolving the Downloads folder

Try these in order and use the first one that exists:

1. **`%USERPROFILE%\Downloads`** — on Windows this is the real on-disk folder name
   **even when File Explorer displays it as "Nedlastinger"**. Windows localizes
   only the *display* name (via `desktop.ini`); the path itself stays English. Do
   not go looking for a Norwegian-named folder first.
2. **Redirected or OneDrive-backed Downloads**, read from the Known Folder registry
   value:

   ```text
   reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" /v "{374DE290-123F-4565-9164-39C4925E467B}"
   ```

3. **`%OneDrive%\Downloads`** or **`%USERPROFILE%\OneDrive\Downloads`**.
4. **Literally named Norwegian folders**, for machines where such a folder really
   was created on disk: `Nedlastinger`, `Nedlastninger`, `Nedlastingar`.
5. **`$HOME/Downloads`** on macOS/Linux. macOS localizes the display name the same
   way Windows does, so the path is still `Downloads`.

A sandboxed Codex may ask for approval to read outside the workspace. Ask the user
for a reusable approval for the Downloads folder rather than one approval per
command.

### Choosing the file

- Consider only `*.xlsx` and `*.csv`.
- Pick the **newest by modified time**, and prefer a file modified since the export
  was triggered in this session (roughly the last 2 hours). A stale export from an
  earlier month is the realistic failure mode — an old file that parses cleanly
  will produce confidently wrong counts.
- Before counting, **echo the absolute path, the modified time, and the header row**,
  and check that the header matches the T2 column list below. Ask the user to
  confirm. Never count an unverified file.
- If several plausible candidates exist, list them with timestamps and let the user
  choose.

### Fallbacks

- If no file is found, or the runtime has no local file access (for example ChatGPT
  on the web), ask the user to attach the export in chat before counting.
- `.xlsx` is a zip archive, not text. If the runtime cannot read `.xlsx`, ask the
  user to re-export as CSV from UBW or to attach the file. Do not guess at the
  contents of a file you could not parse.

## Data Source: Timesheets approved per resource (T2)

1. Log in to UBW. Let the user handle login, SSO, and MFA.
2. **Select the correct company** in the company dropdown (between the
   activities menu and the user menu in the top bar).
3. Open the global search (top-right, or `Alt+Q`) and search for
   **`Timesheets approved per resource (T2)`**. This is the report to use.
4. Set the report parameters:
   - **Manager** = empty. Remove anything prefilled.
   - **T.per mellom** = the ISO weeks covering the 12-month window, derived as
     described in [Counting Window](#counting-window). This is a *superset* of the
     window; rows outside it are filtered out afterwards by `Item date`.
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

Count the **last 12 months through the last completed month**.

- A month is **completed** only once the calendar has moved past it. On
  2026-08-31, the last completed month is **2026-07**, not 2026-08.
- The **current, partial month is never included**.
- **End date** = the last day of the last completed month.
- **Start date** = the first day of the month **11 months before** the end month,
  giving a 12-month window inclusive of the last completed month.

UBW's `T.per mellom` parameter only accepts ISO weeks (`YYYYWW`), and ISO weeks do
not align to month boundaries. So fetch a week-aligned **superset** and then filter
precisely by date:

- `T.per mellom` = the ISO week containing the **start date** through the ISO week
  containing the **end date**.
- After loading the report, **discard every row whose `Item date` falls outside the
  start and end dates**. Do this before any grouping or counting.

Example:

```text
Today 2026-08-31  →  last completed month = 2026-07
Window (dates):      2025-08-01 .. 2026-07-31
ISO week of 2025-08-01 = 2025-W31      ISO week of 2026-07-31 = 2026-W31
T.per mellom:          202531 .. 202631   (superset — filter by Item date after)
```

**ISO week-numbering year caveat.** The `YYYY` in `YYYYWW` is the ISO
week-*numbering* year, not the calendar year of the date. `2024-12-31` falls in
`2025-W01`, so its `YYYYWW` is `202501`, not `202401`. A window ending
`2025-12-31` therefore ends at `202601`. Compute the week-numbering year and the
week number together; never take the year from the date string.

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
- **12-month quota:** max **4 sykdomstilfeller per 12 months** (the 12-month
  window defined above). A 5th requires a **sykemelding** (medical certificate).

## Output

Produce two CSV files in ChatGPT:

`<from>` and `<to>` are the window's ISO **dates**, not week numbers — for example
`egenmelding-2025-08-01-to-2026-07-31.csv`.

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
2. **Discard rows whose `Item date` falls outside the counting window.** The
   `T.per mellom` weeks are a superset of the 12-month window, so this step is what
   makes the window exact. Report how many rows were dropped this way.
3. Exclude rows with missing dates, employees, or `Hours <= 0`; report any
   unparseable rows separately.
4. Deduplicate by employee/date before grouping so multiple positive-hour rows
   on the same date count as one egenmelding day.
5. For each employee, sort sick days by date and group consecutive calendar days
   into sickness cases.
6. Apply weekend reach before grouping:
   - A Friday row consumes Friday, Saturday, and Sunday. Ignore Saturday/Sunday
     rows that fall inside that reach. A following Monday starts a new case.
   - A Saturday row consumes Saturday and Sunday. Ignore a Sunday row that falls
     inside that reach.
   - Other weekdays consume only that day.
7. Count `egenmelding_days` as the deduplicated qualifying sick-day rows, and
   `sykdomstilfeller` as the grouped cases.
8. Set `quota_remaining = max(0, 4 - sykdomstilfeller)`.
9. Add flags:
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
- Four separate sickness cases in the 12-month window = `quota_reached`; five or more =
  `requires_sykemelding`.
- Any set of four or more egenmelding days where the first and last are less
  than 16 calendar days apart = `exceeds_3_days_16d_window`.

## Final Review

Before treating the export as final, present a compact review:

- skill version (`1.1.0`)
- window: the date range (from / to) **and** the `T.per mellom` weeks actually used,
  so the reader can see the superset was filtered down
- source file: the path and modified time of the export that was counted, or "attached
  in chat"
- number of employees included
- number flagged, and why (quota / sykemelding / day caps)
- output CSV paths
- rows dropped for falling outside the window, and any rows that could not be parsed
  and need attention
