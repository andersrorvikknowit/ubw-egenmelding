# UBW Egenmelding Export Skill

**Version 1.1.0** — see [CHANGELOG.md](CHANGELOG.md).

This is an instruction-only ChatGPT/Codex Skill for exporting company-wide
egenmelding (self-certified sick leave) counts from Unit4/UBW.

The skill is designed for the ChatGPT/Codex desktop app or web with a connected
Chrome browser session. It intentionally contains no terminal scripts, local
executables, browser launcher, debugging-port setup, or local file-writing
workflow.

Runtime requirement: the assistant must have the Chrome connector/plugin installed
and connected. The skill should stop and ask for that connection if Chrome is not
available; it should not fall back to local browser automation.

## What the Skill Does

- Uses the connected Chrome session to open UBW and let the user handle login,
  SSO, and MFA.
- Runs **Timesheets approved per resource (T2)** with Manager empty, Res.type = `1`,
  Timecode = `syke`, and `T.per mellom` set to the ISO weeks covering the counting
  window.
- Counts over the **last 12 months through the last completed month**. Since
  `T.per mellom` takes ISO weeks, the report is loaded for a week-aligned superset
  and rows are then filtered by `Item date` to the exact month boundaries.
- Applies Norwegian egenmelding counting rules.
- Produces two CSV outputs: a per-employee summary and a flagged-only list.

## Finding the Downloaded Export

UBW's export lands in the user's Downloads folder. When the runtime has local file
access — for example the Codex desktop app on Windows — the skill locates that file
itself rather than asking for a manual attachment. It checks
`%USERPROFILE%\Downloads`, OneDrive-redirected Downloads via the Known Folder
registry value, and literally Norwegian-named folders as a fallback.

On Norwegian Windows the Downloads folder is only *displayed* as "Nedlastinger";
the real path stays `Downloads`. The same applies to macOS.

File access is **read-only** — the skill never writes, moves, or deletes anything.
Before counting, it echoes the chosen file's path, modified time, and header row for
confirmation, so a stale export from an earlier month cannot be counted silently.
Attaching the file in chat still works and remains the fallback for runtimes without
local file access, such as ChatGPT on the web.

## Install Shape

Install this repository as a plugin, or upload the skill folder directly.

Plugin install shape:

```text
ubw-egenmelding/
  .codex-plugin/plugin.json
  CHANGELOG.md
  skills/ubw-egenmelding/SKILL.md
  skills/ubw-egenmelding/agents/openai.yaml
```

The plugin version lives in `.codex-plugin/plugin.json` and is repeated in the
display names so it is visible in the app, in `SKILL.md`, and in the skill's first
reply in chat. When bumping the version, update all four.

Direct skill upload shape:

```text
skills/ubw-egenmelding/
  SKILL.md
  agents/openai.yaml
```
