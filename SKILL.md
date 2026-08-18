---
name: ubw-egenmelding
description: "Assist managers with counting and exporting company-wide egenmelding (self-certified sick leave) from Unit4/UBW. Use when Codex needs to help a manager run the 'Timesheets approved per resource (T2)' report, apply the Norwegian egenmelding counting rules over the last 52 weeks, and export per-employee counts plus a flagged list (quota reached / sykemelding required) as CSV."
---

# UBW Egenmelding Export

Use this skill to help a **manager** count and export **company-wide egenmelding**
(self-certified sick leave) from Unit4/UBW as **CSV**.

This skill is **read-only**: it reads report data and exports counts. It never
submits, approves, rejects, deletes, or changes anything in UBW.

## Data Source: Timesheets approved per resource (T2)

1. Log in to UBW. Let the user handle login, SSO, and MFA.
2. **Select the correct company** in the company dropdown (between the
   activities menu and the user menu in the top bar).
3. Open the global search (top-right, or `Alt+Q`) and search for
   **`Timesheets approved per resource (T2)`**. This is the report to use.
4. Set the report parameters:
   - **Manager** = empty. Remove anything prefilled.
   - **T.per mellom** = the week number **52 weeks back from last week**, through
     the present.
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

## Counting Window

- Count **52 weeks back through the last completed week**.
- The **current week is never included** (UBW never shows it).
- End = the most recent **Sunday** (inclusive). Start = the **Monday** of the ISO
  week 52 weeks before the last completed week.

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

More rules may be added later; the CSV and rule engine are designed to extend.

## Output: two CSV files

Both files are written to the **`output/`** folder in the repo by default (bare
filenames passed to `--out` also land there; full/relative paths are used as-is;
override the folder with `UBW_EGENMELDING_OUTPUT_DIR`). The `output/` folder is
git-ignored because it contains confidential personnel data.

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

## Safety Rules

- Read-only. Never submit, approve, reject, delete, or change anything in UBW.
- Do not invent employee names, dates, timecodes, or counts.
- Do not guess credentials. Let the user handle login, MFA, and SSO.
- Treat egenmelding data as confidential personnel data. Write only the requested
  CSVs; do not copy it into unrelated files, logs, or messages.
- Preserve Norwegian labels and names when the page is in Norwegian.

## Browser Guidance

The Knowit production UBW URL is fixed:
`https://ubw.unit4cloud.com/se_kno_prod_web/`. Do not ask for the URL.

If no controllable UBW session exists, open a dedicated Chrome instance first:

```bash
scripts/open-unit4-chrome.sh
```

This opens a dedicated Chrome profile with remote debugging on port `9224`,
keeping cookies/SSO state out of the repo. If login/SSO/MFA is required, stop and
let the user complete it in the Chrome window.

### Skill Commands

Use `scripts/ubw-egenmelding.mjs` against the dedicated Chrome instance:

```bash
scripts/ubw-egenmelding.mjs run --company 332                 # full end-to-end export
scripts/ubw-egenmelding.mjs run --company 332 --out out.csv   # custom output path

# Individual steps (for debugging / partial runs):
scripts/ubw-egenmelding.mjs select-company --name 332         # select company
scripts/ubw-egenmelding.mjs open-report                       # open T2 report
scripts/ubw-egenmelding.mjs set-report-params                 # clear Manager, set weeks, Søk
scripts/ubw-egenmelding.mjs apply-grid-filter                 # Res.type=1, Timecode=syke
scripts/ubw-egenmelding.mjs extract-egenmelding               # read sick-day rows
scripts/ubw-egenmelding.mjs export-csv --out egenmelding.csv  # write both CSVs

# Inspection / offline:
scripts/ubw-egenmelding.mjs diagnostics                       # menu path + frames
scripts/ubw-egenmelding.mjs frame-snapshot                    # inspect report fields/grid
scripts/ubw-egenmelding.mjs period-weeks                      # T.per mellom YYYYWW range
scripts/ubw-egenmelding.mjs window                            # 52-week date window
```

`export-csv` also accepts `--input <records.json>` (a JSON array of
`{ hrid, employee, date, week, hours }`) to aggregate offline without a browser.

### Live UBW implementation notes (confirmed, company 332)

- **Company dropdown:** top-bar control `[id^=u4_clienttoolitem]`; options are
  `[id^=u4_clientmenuitem]`. `select-company` matches by number prefix (e.g.
  `332`) or name substring.
- **Global search:** `[id^=u4_textfield][id$=-inputEl]` (placeholder "Søk
  (Alt+q)"). Typing the report name surfaces a `.u4-menu-item-text` result to click.
- **Report form** lives in **doubly-nested iframes** (`Container.aspx` →
  `ContentContainer.aspx`), so the script uses a recursive frame finder.
- **Selection criteria** ids: Manager `b_s2_s11_l2s11_ctl00_r3resource_id=_i`
  (cleared), T.per mellom `..._period<>_i` / `..._period<>_to_i` (YYYYWW).
- **Grid filter row:** Res.type `b_g1s3__filterRow_r1resource_id` = `1`,
  Timecode `b_g1s3__filterRow_pd` = `syke`, applied **server-side** via
  `browserSearchClick(event, 'b$g1s3$browsergridheader$findBRT', true)`. This is
  what reduces the full result set to the egenmelding rows.
- **Grid rows:** `tr[id^=b_g1s3_row]`; **Item date** is `DD.MM.YYYY` and is
  converted to ISO. Only rows with **Hours > 0** count as sick days.
- Filtering server-side keeps the sick-leave rows on a single grid page; if a
  company has more sick-leave rows than the page size, pagination handling would
  be needed.


## Rule Engine and Tests

The counting logic lives in `scripts/egenmelding-rules.mjs` and is covered by
`scripts/egenmelding-rules.test.mjs`:

```bash
node --test scripts/egenmelding-rules.test.mjs
```

## Final Review

Before treating the export as final, present a compact review:

- window (from / to)
- number of employees included
- number flagged, and why (quota / sykemelding / day caps)
- output CSV paths
- any rows that could not be parsed and need attention
