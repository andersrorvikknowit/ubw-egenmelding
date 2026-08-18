# UBW Egenmelding Export Skill

This is an instruction-only ChatGPT Skill for exporting company-wide
egenmelding (self-certified sick leave) counts from Unit4/UBW.

The skill is designed for ChatGPT Desktop/Web with a connected Chrome browser
session. It intentionally contains no terminal scripts, local executables,
browser launcher, debugging-port setup, or local file-writing workflow.

Runtime requirement: ChatGPT must have the Chrome connector/plugin installed and
connected. The skill should stop and ask for that connection if Chrome is not
available; it should not fall back to local automation.

## What the Skill Does

- Uses the connected Chrome session to open UBW and let the user handle login,
  SSO, and MFA.
- Runs **Timesheets approved per resource (T2)** with Manager empty, a 52
  completed-week period ending with the last completed ISO week, Res.type = `1`,
  and Timecode = `syke`.
- Applies Norwegian egenmelding counting rules.
- Produces two CSV outputs through ChatGPT: a per-employee summary and a
  flagged-only list.

## Install Shape

Install this repository as a plugin, or upload the skill folder directly.

Plugin install shape:

```text
ubw-egenmelding/
  .codex-plugin/plugin.json
  skills/ubw-egenmelding/SKILL.md
  skills/ubw-egenmelding/agents/openai.yaml
```

Direct skill upload shape:

```text
skills/ubw-egenmelding/
  SKILL.md
  agents/openai.yaml
```
