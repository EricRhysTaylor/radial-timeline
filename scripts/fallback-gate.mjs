#!/usr/bin/env node
/**
 * Fallback Gate — enforces near-zero fallback policy across the codebase.
 *
 * Mirrors the structure of scripts/css-drift-check.mjs:
 *   - scans src/**\/*.ts (excluding tests)
 *   - counts occurrences of fallback patterns per rule
 *   - compares current totals to baseline (scripts/fallback-baseline.json)
 *   - fails when current > baseline (maintenance mode)
 *
 * Rules:
 *   silent-catch          (block) — try/catch returning empty/null/undefined
 *   or-chain-3            (block) — `a || b || c || d` (3+ OR operators)
 *   nullish-literal       (warn)  — `?? 'literal'`, `?? 0`, `?? false`
 *   or-literal            (warn)  — `|| 'literal'`, `|| 0`, `|| false`
 *   switch-default-return (block) — `default: return ...;` not preceded by assertNever/throw
 *
 * Annotation escape: any line containing `// SAFE:` is exempt from the rule
 * matching that line.
 *
 * CLI:
 *   --maintenance       (default) fail if current > baseline
 *   --update-baseline   overwrite scripts/fallback-baseline.json with current counts
 *   --report            print per-file inventory without failing
 *   --quiet             suppress per-file output, only print summary
 *
 * See docs/engineering/standards/fallback-policy.md for the policy.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const BASELINE_PATH = path.join(ROOT, "scripts/fallback-baseline.json");
const POLICY_DOC = "docs/engineering/standards/fallback-policy.md";

const args = new Set(process.argv.slice(2));
const MAINTENANCE = args.has("--maintenance") || (!args.has("--update-baseline") && !args.has("--report"));
const UPDATE_BASELINE = args.has("--update-baseline");
const REPORT_MODE = args.has("--report");
const QUIET = args.has("--quiet");

const RULES = ["silent-catch", "or-chain-3", "nullish-literal", "or-literal", "switch-default-return"];

// ---- file walker ----
function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip node_modules, dist, tests dirs
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "tests" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (entry.isFile()) {
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      out.push(full);
    }
  }
  return out;
}

// ---- helpers ----
function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}
function getLineNumber(lineStarts, idx) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= idx) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}
function getLineText(text, lineStarts, lineNum) {
  const start = lineStarts[lineNum - 1];
  if (start === undefined) return "";
  const end = lineStarts[lineNum] !== undefined ? lineStarts[lineNum] - 1 : text.length;
  return text.slice(start, end);
}
function lineHasSafeAnnotation(lineText) {
  return lineText.includes("// SAFE:");
}

// ---- rule scanners ----
// Each scanner returns array of { file, line, sample, rule }
function scanSilentCatch(file, text, lineStarts) {
  const hits = [];
  // Match: catch (...) { return ''; } | catch { return null; } | catch (e) { return; } etc.
  // Body must consist solely of an empty/null/undefined/blank return statement.
  const re = /catch\s*(?:\([^)]*\))?\s*\{\s*return\s*(?:''|""|``|null|undefined|;)\s*;?\s*\}/g;
  let m;
  while ((m = re.exec(text))) {
    const line = getLineNumber(lineStarts, m.index);
    const lineText = getLineText(text, lineStarts, line);
    if (lineHasSafeAnnotation(lineText)) continue;
    hits.push({ file, line, sample: m[0].replace(/\s+/g, " "), rule: "silent-catch" });
  }
  return hits;
}

function scanOrChain3(file, text, lineStarts) {
  const hits = [];
  // 3+ `||` operators on the same logical expression line
  // Heuristic: a single line containing `||` at least 3 times
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (lineHasSafeAnnotation(ln)) continue;
    // strip line comments and strings to avoid false positives
    const stripped = ln
      .replace(/\/\/.*$/, "")
      .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, "''");
    // count `||` occurrences (avoid `|||` which won't appear, but still)
    const count = (stripped.match(/\|\|/g) || []).length;
    if (count >= 3) {
      hits.push({ file, line: i + 1, sample: ln.trim().slice(0, 200), rule: "or-chain-3" });
    }
  }
  return hits;
}

function scanNullishLiteral(file, text, lineStarts) {
  const hits = [];
  // `?? 'literal'`, `?? "x"`, `?? \`x\``, `?? 0`, `?? 1.5`, `?? true`, `?? false`, `?? []`, `?? {}`
  const re = /\?\?\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|-?\d+(?:\.\d+)?|true|false|\[\s*\]|\{\s*\})/g;
  let m;
  while ((m = re.exec(text))) {
    const line = getLineNumber(lineStarts, m.index);
    const lineText = getLineText(text, lineStarts, line);
    if (lineHasSafeAnnotation(lineText)) continue;
    hits.push({ file, line, sample: lineText.trim().slice(0, 200), rule: "nullish-literal" });
  }
  return hits;
}

function scanOrLiteral(file, text, lineStarts) {
  const hits = [];
  // `|| 'literal'`, `|| 0`, `|| false`, `|| []`, `|| {}`, `|| ""`
  // Heuristic: same shape as nullish-literal but with `||`
  const re = /\|\|\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|-?\d+(?:\.\d+)?|true|false|\[\s*\]|\{\s*\})/g;
  let m;
  while ((m = re.exec(text))) {
    const line = getLineNumber(lineStarts, m.index);
    const lineText = getLineText(text, lineStarts, line);
    if (lineHasSafeAnnotation(lineText)) continue;
    hits.push({ file, line, sample: lineText.trim().slice(0, 200), rule: "or-literal" });
  }
  return hits;
}

function scanSwitchDefaultReturn(file, text, lineStarts) {
  const hits = [];
  // Match the entire `default: ... return <expr>;` window so we can inspect the
  // return expression itself for assertNever/throw escape valves.
  const re = /\bdefault\s*:\s*(?:\/\/[^\n]*\n)?\s*return\b([^;]*);/g;
  let m;
  while ((m = re.exec(text))) {
    const line = getLineNumber(lineStarts, m.index);
    const lineText = getLineText(text, lineStarts, line);
    if (lineHasSafeAnnotation(lineText)) continue;
    const returnExpr = m[1];
    // Escape valves: return calls assertNever() OR rethrows
    if (/\bassertNever\s*\(/.test(returnExpr)) continue;
    if (/\bthrow\b/.test(returnExpr)) continue;
    // Also check the line containing the return (covers `default: return assertNever(x);` on one line)
    const returnLineIdx = m.index + m[0].lastIndexOf("return");
    const returnLine = getLineNumber(lineStarts, returnLineIdx);
    const returnLineText = getLineText(text, lineStarts, returnLine);
    if (lineHasSafeAnnotation(returnLineText)) continue;
    if (/\bassertNever\s*\(/.test(returnLineText)) continue;
    hits.push({ file, line, sample: lineText.trim().slice(0, 200), rule: "switch-default-return" });
  }
  return hits;
}

// ---- main scan ----
const files = walk(SRC_DIR, []);
const allHits = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lineStarts = buildLineIndex(text);
  allHits.push(...scanSilentCatch(file, text, lineStarts));
  allHits.push(...scanOrChain3(file, text, lineStarts));
  allHits.push(...scanNullishLiteral(file, text, lineStarts));
  allHits.push(...scanOrLiteral(file, text, lineStarts));
  allHits.push(...scanSwitchDefaultReturn(file, text, lineStarts));
}

// ---- summary ----
const summary = { total: allHits.length, byRule: {} };
for (const r of RULES) summary.byRule[r] = 0;
for (const hit of allHits) {
  summary.byRule[hit.rule] = (summary.byRule[hit.rule] || 0) + 1;
}

function printReport() {
  if (QUIET) return;
  const byFile = new Map();
  for (const hit of allHits) {
    const arr = byFile.get(hit.file) || [];
    arr.push(hit);
    byFile.set(hit.file, arr);
  }
  const sortedFiles = [...byFile.keys()].sort();
  for (const file of sortedFiles) {
    const rel = path.relative(ROOT, file);
    const hits = byFile.get(file).sort((a, b) => a.line - b.line);
    console.log(`\n${rel} (${hits.length})`);
    for (const h of hits.slice(0, 20)) {
      console.log(`  L${h.line} [${h.rule}] ${h.sample}`);
    }
    if (hits.length > 20) console.log(`  …and ${hits.length - 20} more`);
  }
}

function printSummary() {
  console.log("\nFallback gate summary:");
  console.log(`- total: ${summary.total}`);
  for (const r of RULES) {
    console.log(`  - ${r}: ${summary.byRule[r] || 0}`);
  }
}

// ---- baseline I/O ----
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    const raw = fs.readFileSync(BASELINE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.maintenance) return parsed.maintenance;
    return null;
  } catch (err) {
    // SAFE: malformed baseline JSON is a hard fail signal — surface it loudly
    throw new Error(`Failed to parse fallback baseline at ${BASELINE_PATH}: ${err.message}`);
  }
}

function writeBaseline() {
  const payload = {
    maintenance: {
      totalWarnings: summary.total,
      warningsByRule: { ...summary.byRule },
      updatedAt: new Date().toISOString(),
      mode: "maintenance",
    },
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nWrote fallback baseline to ${BASELINE_PATH}`);
}

// ---- entry point ----
if (REPORT_MODE) {
  printReport();
  printSummary();
  process.exit(0);
}

if (UPDATE_BASELINE) {
  printSummary();
  writeBaseline();
  process.exit(0);
}

// maintenance mode
const baseline = loadBaseline();
printSummary();

if (!baseline) {
  console.error(`\nMissing fallback baseline at ${BASELINE_PATH}.`);
  console.error(`Run: node scripts/fallback-gate.mjs --update-baseline`);
  console.error(`See ${POLICY_DOC} for the policy.`);
  process.exit(1);
}

const baselineTotal = baseline.totalWarnings || 0;
const regressions = [];
if (summary.total > baselineTotal) {
  regressions.push(`total: ${summary.total} > baseline ${baselineTotal} (delta +${summary.total - baselineTotal})`);
}
for (const r of RULES) {
  const cur = summary.byRule[r] || 0;
  const base = (baseline.warningsByRule && baseline.warningsByRule[r]) || 0;
  if (cur > base) {
    regressions.push(`${r}: ${cur} > baseline ${base} (delta +${cur - base})`);
  }
}

console.log(`\nBaseline: ${BASELINE_PATH} (key: maintenance)`);
console.log(`- baseline total: ${baselineTotal}`);
console.log(`- current total:  ${summary.total}`);
console.log(`- delta: ${summary.total - baselineTotal >= 0 ? "+" : ""}${summary.total - baselineTotal}`);

if (regressions.length > 0) {
  console.error("\nFallback gate failed.");
  for (const r of regressions) console.error(`  - ${r}`);
  console.error(`\nSee ${POLICY_DOC} for the policy and how to fix.`);
  process.exit(1);
}

console.log("\nFallback gate passed.");
