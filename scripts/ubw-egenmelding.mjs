#!/usr/bin/env node
// UBW Egenmelding export helper.
//
// Reuses the Chrome DevTools Protocol (CDP) machinery from the Unit4 timesheets
// skill to inspect and navigate a dedicated UBW Chrome session, then extract
// company-wide egenmelding (self-certified sick leave) data and export it to CSV.
//
// Login/SSO/MFA are handled by the user in the Chrome window opened by
// scripts/open-unit4-chrome.sh. This script never submits, approves, or changes
// anything in UBW; it is read-only and only exports data.
//
// The report navigation and DOM selectors (company dropdown, global search, the
// "Timesheets approved per resource (T2)" report parameters, and the result
// grid) are confirmed against live UBW (company 332). Use `snapshot`,
// `frame-snapshot`, and `diagnostics` if a future UBW version changes the DOM.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  weekWindow,
  periodWeekRange,
  aggregate,
  summaryCsv,
  flaggedCsv,
} from "./egenmelding-rules.mjs";

const port = process.env.UNIT4_CHROME_DEBUG_PORT || "9224";
const command = process.argv[2] || "snapshot";

// Default output folder: <repo>/output (sibling of scripts/). Overridable with
// UBW_EGENMELDING_OUTPUT_DIR. Created on demand when exporting.
const OUTPUT_DIR =
  process.env.UBW_EGENMELDING_OUTPUT_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "output");

// ---------------------------------------------------------------------------
// CDP core (shared with the timesheets skill)
// ---------------------------------------------------------------------------

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    };
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function withCdp(action) {
  const tabs = await getJson(`http://127.0.0.1:${port}/json/list`);
  const page = tabs.find((tab) => tab.type === "page");
  if (!page) {
    throw new Error(`No Chrome page target found on port ${port}. Run scripts/open-unit4-chrome.sh first.`);
  }
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  try {
    return await action(cdp);
  } finally {
    cdp.close();
  }
}

async function evaluate(expression) {
  return withCdp(async (cdp) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
    }
    return result.result.value;
  });
}

async function clickPoint(point) {
  return withCdp(async (cdp) => {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    return point;
  });
}

async function waitFor(check, { timeoutMs = 8000, intervalMs = 250, label = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Inspection commands (use these to explore live UBW)
// ---------------------------------------------------------------------------

function snapshot() {
  return evaluate(`(() => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    text: (document.body && document.body.innerText || "").slice(0, 16000)
  }))()`);
}

function frameSnapshot() {
  return evaluate(`(() => {
    const frame = document.querySelector("iframe");
    const doc = frame && frame.contentDocument;
    return {
      frameUrl: frame && frame.src,
      readyState: doc && doc.readyState,
      title: doc && doc.title,
      text: (doc && doc.body && doc.body.innerText || "").slice(0, 16000),
      fields: doc ? [...doc.querySelectorAll("input,textarea,select,button,a,[role=button],table")]
        .map((element, index) => ({
          index,
          tag: element.tagName,
          type: element.type || "",
          id: element.id || "",
          name: element.name || "",
          text: (element.innerText || element.getAttribute("aria-label") || element.title || element.placeholder || "").trim().slice(0, 140),
          className: element.className || ""
        }))
        .slice(0, 400) : []
    };
  })()`);
}

function diagnostics() {
  return evaluate(`(() => ({
    url: location.href,
    title: document.title,
    frames: [...document.querySelectorAll("iframe")].map((f) => f.src),
    menuFolders: [...document.querySelectorAll(".u4-menu-folder-header")].map((h) => h.textContent.trim()),
    menuItems: [...document.querySelectorAll(".u4-menu-item-text")].map((t) => t.textContent.trim()).slice(0, 200)
  }))()`);
}

// ---------------------------------------------------------------------------
// Report navigation (Timesheets approved per resource (T2))
// ---------------------------------------------------------------------------
//
// Workflow (confirmed against live UBW, company 332):
//   1. Select the company in the top-bar dropdown (u4_clienttoolitem).
//   2. Focus the global search (Alt+q, u4_textfield-*-inputEl), type the report
//      name, and open "Timesheets approved per resource (T2)".
//   3. Selection criteria: clear Manager, set "T.per mellom" from/to weeks,
//      then run the main Søk.
//   4. Grid filter row: Res.type = 1, Timecode = syke, applied server-side via
//      browserSearchClick(...browsergridheader...findBRT). This reduces the
//      result set to the sick-leave (egenmelding) rows.
//
// The report form lives in doubly-nested iframes, so all report DOM work runs
// inside the page via a recursive frame finder embedded in the evaluated code.

// Shared JS (string) injected into evaluated expressions: a recursive frame
// walker that returns the first document matching a predicate, plus helpers.
const FRAME_HELPERS = `
  const clickAll = (el) => ["mousedown","mouseup","click"].forEach((t) =>
    el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  const findDoc = (predicate) => {
    let found = null;
    const walk = (doc, depth) => {
      if (found) return;
      try { if (predicate(doc)) { found = doc; return; } } catch (e) {}
      if (depth > 6) return;
      doc.querySelectorAll("iframe,frame").forEach((f) => {
        let cd = null; try { cd = f.contentDocument; } catch (e) {}
        if (cd) walk(cd, depth + 1);
      });
    };
    walk(document, 0);
    return found;
  };
  const reportDoc = () => findDoc((d) => d.getElementById &&
    (d.getElementById("b_g1s3_browsergridheader_findBRT") ||
     d.querySelector("[id*=browsergridheader_findBRT]") ||
     d.querySelector("[id*=_filterRow_pd]")));
`;

// Select the company in the top-bar client dropdown. Matches by company number
// prefix (e.g. "332") or a substring of the company name.
function selectCompany(query) {
  if (!query) return Promise.resolve({ ok: false, reason: "Missing --name for company." });
  return evaluate(`(() => {
    ${FRAME_HELPERS}
    const wanted = ${JSON.stringify(String(query).trim())};
    const toggle = document.querySelector("[id^=u4_clienttoolitem]");
    if (!toggle) return { ok: false, reason: "Company selector (u4_clienttoolitem) not found." };
    const current = (toggle.getAttribute("aria-label") || toggle.innerText || "").trim();
    if (current.startsWith(wanted + " ") || current === wanted) {
      return { ok: true, alreadySelected: true, company: current };
    }
    clickAll(toggle);
    return new Promise((resolve) => {
      const attempt = (tries) => {
        const items = [...document.querySelectorAll("[id^=u4_clientmenuitem],.u4-clientmenu-item")];
        const match = items.find((el) => {
          const t = (el.innerText || el.textContent || "").trim();
          return t.startsWith(wanted) || t.toLowerCase().includes(wanted.toLowerCase());
        });
        if (match) {
          clickAll(match);
          resolve({ ok: true, picked: (match.innerText || "").replace(/\\s+/g, " ").trim() });
        } else if (tries > 0) {
          setTimeout(() => attempt(tries - 1), 200);
        } else {
          resolve({ ok: false, reason: "Company '" + wanted + "' not found in dropdown.", available: items.map((i) => (i.innerText || "").replace(/\\s+/g, " ").trim()).slice(0, 20) });
        }
      };
      attempt(15);
    });
  })()`);
}

// Open the T2 report via the global search box.
function openReport() {
  const REPORT = "Timesheets approved per resource (T2)";
  return evaluate(`(() => {
    ${FRAME_HELPERS}
    const REPORT = ${JSON.stringify(REPORT)};
    const search = document.querySelector("[id^=u4_textfield][id$=-inputEl], input[placeholder*='Alt+q' i], input[aria-label*='Alt+q' i]");
    if (!search) return { ok: false, reason: "Global search input not found." };
    search.focus();
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const text = "Timesheets approved per resource";
    for (const ch of text) {
      search.value += ch;
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ch }));
      search.dispatchEvent(new Event("input", { bubbles: true }));
      search.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: ch }));
    }
    return new Promise((resolve) => {
      const attempt = (tries) => {
        const spans = [...document.querySelectorAll(".u4-menu-item-text, [class*=menu-item-text]")];
        const hit = spans.find((s) => (s.innerText || "").trim() === REPORT)
          || spans.find((s) => /Timesheets approved per resource \\(T2\\)/i.test((s.innerText || "").trim()));
        if (hit) {
          const item = hit.closest(".u4-menu-folder-item-outer,.u4-menu-folder-item,a,[role=button]") || hit;
          clickAll(item);
          resolve({ ok: true, opened: (hit.innerText || "").trim() });
        } else if (tries > 0) {
          setTimeout(() => attempt(tries - 1), 250);
        } else {
          resolve({ ok: false, reason: "Report '" + REPORT + "' not found in search results." });
        }
      };
      attempt(20);
    });
  })()`);
}

// Wait until the report form (nested iframe) is loaded and its inputs exist.
function waitForReportForm() {
  return waitFor(
    () =>
      evaluate(`(() => {
        ${FRAME_HELPERS}
        const doc = findDoc((d) => d.getElementById && d.getElementById("b_s2_s11_l2s11_ctl00_period<>_i"));
        return !!doc;
      })()`),
    { timeoutMs: 20000, intervalMs: 500, label: "T2 report form" }
  );
}

// Set the selection criteria (clear Manager, set the T.per week range) and run
// the main Søk. fromWeek/toWeek are YYYYWW strings.
function setReportParams(fromWeek, toWeek) {
  return evaluate(`(() => {
    ${FRAME_HELPERS}
    const doc = findDoc((d) => d.getElementById && d.getElementById("b_s2_s11_l2s11_ctl00_period<>_i"));
    if (!doc) return { ok: false, reason: "Report selection-criteria form not found." };
    const set = (id, v) => {
      const el = doc.getElementById(id);
      if (!el) return false;
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      el.blur();
      return true;
    };
    const applied = {
      manager: set("b_s2_s11_l2s11_ctl00_r3resource_id=_i", ""),
      fromWeek: set("b_s2_s11_l2s11_ctl00_period<>_i", ${JSON.stringify(String(fromWeek ?? ""))}),
      toWeek: set("b_s2_s11_l2s11_ctl00_period<>_to_i", ${JSON.stringify(String(toWeek ?? ""))}),
    };
    // Run the main report search.
    const win = doc.defaultView;
    const searchBtn = doc.getElementById("b_g1s3_browsergridheader_findBRT")
      || doc.querySelector("[id*=browsergridheader_findBRT]");
    let ran = false;
    try {
      if (win.browserSearchClick && searchBtn) {
        win.browserSearchClick(new win.Event("click"), searchBtn.name || searchBtn.id.replace(/_/g, "$"), true);
        ran = true;
      } else if (searchBtn) { searchBtn.click(); ran = true; }
    } catch (e) {
      if (searchBtn) { searchBtn.click(); ran = true; }
    }
    return { ok: applied.fromWeek && applied.toWeek, applied, ran };
  })()`);
}

// Apply the grid-row filter Res.type=1 and Timecode=syke, submitted server-side
// via browserSearchClick on the grid header find button.
function applyGridFilter() {
  return evaluate(`(() => {
    ${FRAME_HELPERS}
    const doc = reportDoc();
    if (!doc) return { ok: false, reason: "Report grid not found." };
    const setVal = (id, v) => { const el = doc.getElementById(id); if (el) { el.value = v; return true; } return false; };
    const resType = setVal("b_g1s3__filterRow_r1resource_id", "1");
    const timecode = setVal("b_g1s3__filterRow_pd", "syke");
    const win = doc.defaultView;
    const btn = doc.getElementById("b_g1s3_browsergridheader_findBRT")
      || doc.querySelector("[id*=browsergridheader_findBRT]");
    if (!btn) return { ok: false, reason: "Grid search button not found.", resType, timecode };
    try {
      win.browserSearchClick(new win.Event("click"), btn.name || "b$g1s3$browsergridheader$findBRT", true);
    } catch (e) { btn.click(); }
    return { ok: resType && timecode, resType, timecode };
  })()`);
}

// ---------------------------------------------------------------------------
// Extraction: read sick-day rows from the T2 result grid.
// ---------------------------------------------------------------------------
//
// After applyGridFilter the grid holds only egenmelding rows. Data rows have
// ids like "b_g1s3_row0". We map each row to
//   { hrid: Hrid, employee: Resource (T), date: Item date (ISO), week, hours }.
// Item date is DD.MM.YYYY in UBW and is converted to ISO. Only hours > 0 count
// as a sick day (enforced later by the rule engine).
function extractEgenmelding() {
  return evaluate(`(() => {
    ${FRAME_HELPERS}
    const doc = reportDoc();
    if (!doc) return { ok: false, reason: "T2 result grid not found. Run open-report + set-report-params first." };

    const toIso = (s) => {
      const m = (s || "").match(/(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
      return m ? m[3] + "-" + m[2] + "-" + m[1] : (s || "");
    };
    const rows = [...doc.querySelectorAll("tr[id^=b_g1s3_row]")];
    const records = [];
    for (const tr of rows) {
      const cells = [...tr.querySelectorAll("td")].map((td) => td.innerText.trim());
      if (!cells.length) continue;
      const dateCell = cells.find((c) => /^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(c));
      const weekCell = cells.find((c) => /^\\d{6}$/.test(c));
      const nameCell = cells.find((c) => /,/.test(c) && /[A-Za-zæøåÆØÅ]/.test(c));
      const hoursCells = cells.filter((c) => /^\\d+,\\d{2}$/.test(c));
      const hours = hoursCells.length ? parseFloat(hoursCells[hoursCells.length - 1].replace(",", ".")) : 0;
      const nameIdx = cells.indexOf(nameCell);
      const hrid = nameIdx > 0 ? cells[nameIdx - 1] : "";
      if (!nameCell || !dateCell) continue;
      records.push({ hrid, employee: nameCell, date: toIso(dateCell), week: weekCell || "", hours: Number.isFinite(hours) ? hours : 0 });
    }

    // Row-count sanity check against the grid footer ("Antall rader N").
    const footer = (doc.body.innerText.match(/Antall rader\\s*([\\d ]+)/i) || [])[1];
    const totalRows = footer ? parseInt(footer.replace(/\\s/g, ""), 10) : null;
    return { ok: true, count: records.length, totalRows, records };
  })()`);
}

// ---------------------------------------------------------------------------
// CSV export (last 52 weeks, aggregated per employee, two files)
// ---------------------------------------------------------------------------

function parseOptions(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i++;
      }
    } else {
      options._.push(token);
    }
  }
  return options;
}

async function exportCsv(options) {
  const window = weekWindow();
  let records;

  if (options.input) {
    // Offline mode: JSON array of { hrid, employee, date, week, hours } records.
    records = JSON.parse(fs.readFileSync(options.input, "utf8"));
  } else {
    const extracted = await extractEgenmelding();
    if (!extracted.ok || extracted.todo) {
      return {
        ok: false,
        todo: true,
        reason: "extract-egenmelding could not read the T2 grid. Confirm live UBW, or pass --input <records.json>.",
        extracted,
      };
    }
    records = extracted.records || [];
  }

  if (!Array.isArray(records)) {
    return { ok: false, reason: "Records source did not yield an array." };
  }

  const summaries = aggregate(records, window);

  // Resolve output paths. Bare filenames (no directory separator) go into the
  // default OUTPUT_DIR; paths with a separator are used as-is. The folder is
  // created if missing.
  const resolveOut = (value, fallbackName) => {
    if (!value) return path.join(OUTPUT_DIR, fallbackName);
    return value.includes(path.sep) || path.isAbsolute(value)
      ? value
      : path.join(OUTPUT_DIR, value);
  };

  const defaultName = `egenmelding-${window.from}-to-${window.to}.csv`;
  const outSummary = resolveOut(options.out, defaultName);
  const outFlagged = options["out-flagged"]
    ? resolveOut(options["out-flagged"], "")
    : outSummary.replace(/\.csv$/i, "") + "-flagged.csv";

  fs.mkdirSync(path.dirname(outSummary), { recursive: true });
  fs.mkdirSync(path.dirname(outFlagged), { recursive: true });

  fs.writeFileSync(outSummary, summaryCsv(summaries), "utf8");
  fs.writeFileSync(outFlagged, flaggedCsv(summaries), "utf8");

  const flaggedCount = summaries.filter((s) => s.flags.length > 0).length;
  return {
    ok: true,
    window,
    employees: summaries.length,
    flagged: flaggedCount,
    out: outSummary,
    outFlagged,
  };
}

// Full end-to-end run: select company, open the report, set parameters, apply
// the sick-leave grid filter, extract, and export both CSVs.
async function run(options) {
  const steps = [];
  const record = (name, result) => {
    steps.push({ step: name, result });
    return result;
  };

  if (options.company) {
    const r = record("select-company", await selectCompany(options.company));
    if (r.ok === false) return { ok: false, failedAt: "select-company", steps };
    await sleep(2000);
  }

  const opened = record("open-report", await openReport());
  if (opened.ok === false) return { ok: false, failedAt: "open-report", steps };

  record("wait-report-form", await waitForReportForm().then(() => ({ ok: true })).catch((e) => ({ ok: false, reason: String(e) })));

  const { fromWeek, toWeek } = periodWeekRange();
  const params = record("set-report-params", await setReportParams(fromWeek, toWeek));
  if (params.ok === false) return { ok: false, failedAt: "set-report-params", steps };
  await sleep(6000);

  const filtered = record("apply-grid-filter", await applyGridFilter());
  if (filtered.ok === false) return { ok: false, failedAt: "apply-grid-filter", steps };
  await sleep(6000);

  const exported = record("export-csv", await exportCsv(options));
  return { ok: exported.ok !== false, fromWeek, toWeek, export: exported, steps };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

const commands = {
  snapshot: () => snapshot(),
  "frame-snapshot": () => frameSnapshot(),
  diagnostics: () => diagnostics(),
  "select-company": () => selectCompany(parseOptions(process.argv.slice(3)).name),
  "open-report": () => openReport(),
  "set-report-params": () => {
    const range = periodWeekRange();
    const opts = parseOptions(process.argv.slice(3));
    return setReportParams(opts["from-week"] || range.fromWeek, opts["to-week"] || range.toWeek);
  },
  "apply-grid-filter": () => applyGridFilter(),
  "extract-egenmelding": () => extractEgenmelding(),
  "export-csv": () => exportCsv(parseOptions(process.argv.slice(3))),
  run: () => {
    const opts = parseOptions(process.argv.slice(3));
    return run({ company: opts.company || opts.name, out: opts.out, "out-flagged": opts["out-flagged"], input: opts.input });
  },
  window: () => weekWindow(),
  "period-weeks": () => periodWeekRange(),
};

if (command === "--help" || command === "-h" || command === "help") {
  console.log(`Usage: ubw-egenmelding.mjs <command> [options]

Inspection:
  snapshot              Print top-level page text/state.
  frame-snapshot        Inspect the UBW iframe: text + fields (find selectors).
  diagnostics           List menu folders/items and frames.

Report navigation:
  select-company --name "<company>"   Select the company in the top-bar dropdown
                                      (match by number prefix or name substring).
  open-report                         Open "Timesheets approved per resource (T2)".
  set-report-params                   Clear Manager, set T.per mellom to the 52-week
    [--from-week YYYYWW --to-week YYYYWW]  range (defaults computed), then run Søk.
  apply-grid-filter                   Set Res.type=1, Timecode=syke and apply the
                                      server-side grid filter (sick-leave rows only).

Data:
  extract-egenmelding   Read sick-day rows from the filtered T2 grid.
  export-csv            Aggregate the last 52 weeks per employee. Writes two CSVs
                        (summary + flagged-only) into the output/ folder by default.
                        Options: --out <file>  --out-flagged <file>  --input <records.json>
                        Bare filenames go into output/; paths are used as-is.
  run --company "<c>"   End-to-end: select company, open report, set params, filter,
                        extract, and export. Options: --out, --out-flagged.
  window                Print the computed 52-week window (current week excluded).
  period-weeks          Print the T.per mellom YYYYWW from/to weeks.

Environment:
  UNIT4_CHROME_DEBUG_PORT      Chrome remote debugging port (default 9224).
  UBW_EGENMELDING_OUTPUT_DIR   Output folder for CSVs (default <repo>/output).
`);
  process.exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available commands: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}

const result = await commands[command]();
console.log(JSON.stringify(result, null, 2));
