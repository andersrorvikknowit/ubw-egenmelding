# Changelog

All notable changes to the UBW Egenmelding Export plugin are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-08-31

### Changed

- **Counting window is now the last 12 months through the last completed month**,
  replacing the previous rolling 52-completed-week window. A month counts as
  completed only once the calendar has moved past it, so the current partial month
  is never included.
  - Because `T.per mellom` only accepts ISO weeks, the report is loaded for the ISO
    weeks covering the window (a superset) and rows are then filtered by `Item date`
    to the exact month boundaries.
  - The 4-sykdomstilfeller quota is now measured over this calendar-month window.
    Counts may differ from 1.0.0 for the same employee near the window edges.
- Output CSV filenames use the window's ISO dates, e.g.
  `egenmelding-2025-08-01-to-2026-07-31.csv`.
- The final review now reports the skill version, both the date window and the
  `T.per mellom` weeks used, the source file that was counted, and the number of
  rows dropped for falling outside the window.

### Added

- **Automatic discovery of the downloaded UBW export.** When the runtime has local
  file access (for example the Codex desktop app), the skill locates the export in
  the user's Downloads folder instead of asking for a manual attachment. Resolution
  covers `%USERPROFILE%\Downloads`, OneDrive-redirected Downloads via the Known
  Folder registry value, and literally Norwegian-named folders
  (`Nedlastinger`/`Nedlastninger`/`Nedlastingar`) as a fallback. Note that on
  Norwegian Windows the folder is only *displayed* as "Nedlastinger" — the real path
  remains `Downloads`.
- The chosen file's path, modified time, and header row are echoed for confirmation
  before counting, to guard against silently counting a stale export.
- Version is surfaced in the plugin display name, the skill's first reply, and the
  final review.

### Notes

- File access is **read-only**. Local writes, browser launchers, and
  debugging-port setup remain prohibited, and the skill remains read-only against
  UBW itself.
- Attaching the export in chat still works and remains the fallback for runtimes
  without local file access, such as ChatGPT on the web.

## [1.0.0]

### Added

- Initial Chrome-only plugin release: run *Timesheets approved per resource (T2)*,
  apply Norwegian egenmelding counting rules over the last 52 completed weeks, and
  produce a per-employee summary CSV plus a flagged-only CSV.
