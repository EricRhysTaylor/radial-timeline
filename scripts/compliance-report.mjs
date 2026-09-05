#!/usr/bin/env node
// Dumps the full compliance error list to docs/engineering/audits/compliance-debt.md
// Grouped by rule id, then by file. Runs compliance-check.mjs as a subprocess and parses
// its output — keeps this script thin and source-of-truth aligned with the main checker.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "docs/engineering/audits/compliance-debt.md");

const result = spawnSync("node", ["scripts/compliance-check.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
const lines = combined.split("\n");

// Parse the "Errors:" section
let inErrors = false;
const issues = [];
let current = null;
for (const line of lines) {
  if (/^❌ Errors:/.test(line)) { inErrors = true; continue; }
  if (!inErrors) continue;
  if (/^📖 /.test(line)) break;
  const header = line.match(/^- (\S+?):(\d+):(\d+) — (.+)$/);
  if (header) {
    if (current) issues.push(current);
    current = { file: header[1], line: Number(header[2]), col: Number(header[3]), message: header[4], snippet: "", suggestion: "" };
    continue;
  }
  if (!current) continue;
  const suggestion = line.match(/^\s*↳ Suggestion:\s*(.*)$/);
  if (suggestion) { current.suggestion = suggestion[1]; continue; }
  const trimmed = line.replace(/^\s{2}/, "");
  if (trimmed && !current.snippet) current.snippet = trimmed;
}
if (current) issues.push(current);

// Classify into rule buckets by message keyword
function ruleFor(msg) {
  const m = msg.toLowerCase();
  if (m.includes("registerdomevent")) return "raw-addEventListener";
  if (m.includes("avoid console")) return "console-log";
  if (m.includes("node core") && m.includes("import")) return "node-core-import";
  if (m.includes("node core") && m.includes("require")) return "node-core-require";
  if (m.includes("vault api")) return "adapter";
  if (m.includes("requesturl")) return "fetch-vs-requestUrl";
  if (m.includes("abortable")) return "fetch-abort";
  if (m.includes("eval")) return "eval";
  if (m.includes("new function")) return "new-function";
  if (m.includes("disconnect")) return "observer-disconnect";
  if (m.includes("normalizepath")) return "normalizePath";
  if (m.includes("tags/aliases/cssclasses")) return "deprecated-frontmatter";
  if (m.includes("window.")) return "window-global";
  if (m.includes("const or let instead of var")) return "var-declaration";
  if (m.includes("cancelanimationframe")) return "raf-cleanup";
  return "other";
}

const buckets = new Map();
for (const it of issues) {
  const rule = ruleFor(it.message);
  if (!buckets.has(rule)) buckets.set(rule, []);
  buckets.get(rule).push(it);
}

const total = issues.length;
const ruleOrder = [...buckets.keys()].sort((a, b) => buckets.get(b).length - buckets.get(a).length);

let md = "";
md += "# Compliance Debt\n\n";
md += `Generated: ${new Date().toISOString()}\n\n`;
md += `Snapshot of every compliance **error** at the time of baseline reset. Work through these to ratchet the compliance baseline down. After fixing a batch, run \`node scripts/compliance-check.mjs --update-baseline\` to lock in the new lower ceiling.\n\n`;
md += "Regenerate this report anytime with: `node scripts/compliance-report.mjs`.\n\n";
md += "## Totals\n\n";
md += `- **Total errors:** ${total}\n`;
for (const rule of ruleOrder) md += `- \`${rule}\`: ${buckets.get(rule).length}\n`;
md += "\n## How to work a rule\n\n";
md += "1. Open the section for the rule.\n";
md += "2. Fix one file at a time.\n";
md += "3. Re-run `node scripts/compliance-check.mjs` and confirm the count dropped.\n";
md += "4. When a batch is done: `node scripts/compliance-check.mjs --update-baseline`.\n\n";
md += "### Fix hints\n\n";
md += "- `raw-addEventListener` — in `Component`/`View` subclasses, replace `el.addEventListener(...)` with `this.registerDomEvent(el, ...)`. Modal classes are exempt (no `registerDomEvent`). Check the class the call lives in before converting.\n";
md += "- `console-log` — remove or guard behind a debug flag. Shipped plugins should not log to console.\n";
md += "- `node-core-import` / `node-core-require` — replace `fs`/`path` with Obsidian Vault API where possible. If the code is build-only (never reached at runtime), move it to `scripts/`.\n";
md += "- `adapter` — prefer `Vault.read/write/...` over `Vault.adapter.*`.\n";
md += "- `fetch-vs-requestUrl` — network calls use `requestUrl` from obsidian, not `fetch`.\n";
md += "- `fetch-abort` — if `fetch` is unavoidable, pass `{ signal: controller.signal }` and register abort.\n";
md += "- `eval` / `new-function` — usually false positives when the string appears inside a regex literal detecting these very patterns. Silence with `// SAFE: describes why` comment on the same line.\n";
md += "- `deprecated-frontmatter` — rename `tag` → `tags`, `alias` → `aliases`, `cssclass` → `cssclasses`.\n";
md += "- `normalizePath` — wrap user-provided paths with `normalizePath()` before storing.\n";
md += "- `observer-disconnect` — `new MutationObserver(...)` must be disconnected on unload via `this.register(() => obs.disconnect())`.\n";
md += "- `raf-cleanup` — `requestAnimationFrame` must register matching `cancelAnimationFrame` cleanup.\n";

for (const rule of ruleOrder) {
  const items = buckets.get(rule);
  md += `\n## \`${rule}\` (${items.length})\n\n`;
  const byFile = new Map();
  for (const it of items) {
    if (!byFile.has(it.file)) byFile.set(it.file, []);
    byFile.get(it.file).push(it);
  }
  const sortedFiles = [...byFile.keys()].sort((a, b) => byFile.get(b).length - byFile.get(a).length);
  for (const f of sortedFiles) {
    const hits = byFile.get(f);
    md += `\n### ${f} (${hits.length})\n\n`;
    md += "```\n";
    for (const h of hits) {
      const snippet = h.snippet ? ` — ${h.snippet}` : "";
      md += `${f}:${h.line}:${h.col}${snippet}\n`;
    }
    md += "```\n";
  }
}

fs.writeFileSync(OUTPUT, md);
console.log(`Wrote ${total} compliance errors to ${path.relative(ROOT, OUTPUT)}`);
