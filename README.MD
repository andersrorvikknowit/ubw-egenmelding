# UBW Egenmelding Export Skill

The UBW Egenmelding skill helps a **manager** count and export **company-wide
egenmelding** (self-certified sick leave) from Unit4/UBW. It reuses the login and
browser-automation approach from the Unit4 Timesheets skill, adapted for a
read-only workflow that runs a UBW report, applies the Norwegian egenmelding
counting rules over the last 52 weeks, and exports **CSV**.

## What the Skill Can Do

- Open a dedicated UBW Chrome session and let the user handle login, SSO, and MFA.
- Select the company, then run **Timesheets approved per resource (T2)** with
  Manager empty, the 52-week period, Res.type = 1, Timecode = syke.
- Read sick-day rows and apply the egenmelding rules:
  - consecutive-day sickness cases, max 3 days per case
  - Friday egenmelding consumes the weekend (Mon is a new case)
  - max 3 egenmelding days within any rolling 16 calendar days
  - max 4 sickness cases per 12 months (5th requires a sykemelding)
- Export two CSVs: a per-employee summary and a flagged-only list.

## Counting Window

52 weeks back through the last completed week. The current week is never
included (UBW never shows it). End = most recent Sunday (inclusive), start =
Monday of the ISO week 52 weeks earlier.

## Output

Both CSVs are written to the **`output/`** folder by default (git-ignored, as
they contain confidential personnel data). Override with
`UBW_EGENMELDING_OUTPUT_DIR`, or pass `--out`/`--out-flagged` (bare filenames go
into `output/`; full paths are used as-is).

Summary (`egenmelding-<from>-to-<to>.csv`):

```text
hrid,employee,egenmelding_days,sykdomstilfeller,quota_remaining
```

Flagged only (`...-flagged.csv`):

```text
hrid,employee,egenmelding_days,sykdomstilfeller,flag
```

Flags: `quota_reached`, `requires_sykemelding`, `exceeds_3_days_per_case`,
`exceeds_3_days_16d_window`.

## Scripts

- `scripts/open-unit4-chrome.sh` — launch the dedicated UBW Chrome session
  (remote debugging on port `9224`).
- `scripts/ubw-egenmelding.mjs` — inspect, navigate the T2 report, extract, and
  export. `run --company <n>` does the whole flow end-to-end. Run with `--help`
  for all commands.
- `scripts/egenmelding-rules.mjs` — pure egenmelding rule engine (window,
  case grouping, 16-day rule, quota, CSV).
- `scripts/egenmelding-rules.test.mjs` — tests: `node --test scripts/egenmelding-rules.test.mjs`.
- `scripts/cdp-eval.mjs` — raw CDP JavaScript evaluation for ad hoc inspection.

## Safety Boundaries

- Read-only. The skill never submits, approves, rejects, deletes, or changes
  anything in UBW.
- It does not invent employee names, dates, timecodes, or counts.
- Login, SSO, and MFA remain under the user's control.
- Egenmelding data is confidential personnel data and is written only to the
  requested CSVs.

## Status

The full workflow is implemented and verified end-to-end against live UBW
(company 332): `run --company <n>` selects the company, opens the T2 report,
sets the 52-week period, applies the Res.type=1 / Timecode=syke grid filter,
extracts the sick-day rows, and writes both CSVs. The rule engine and CSV export
are covered by tests and also work offline via `export-csv --input <records.json>`.
