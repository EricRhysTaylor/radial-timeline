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
 *   or-chain-3            (block) — `a || b || c || d` value chain (3+ OR operators)
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
import ts from "typescript";

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

// or-chain-3 targets value-precedence chains (`a || b || c || 'Untitled'`).
// A chain whose result is only tested for truthiness is a predicate, not a
// fallback, so it is exempt when it feeds a condition (if/while/do/for test,
// ternary test, `!`, `Boolean(...)`) or when any operand is a comparison or a
// negation, which a precedence list never contains. Chains are found with the
// TypeScript parser and counted once each, so a value chain split across
// lines is still caught. `// SAFE:` on the chain's first or last line exempts it.
const K = ts.SyntaxKind;
const PREDICATE_OPERATORS = new Set([
  K.EqualsEqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.EqualsEqualsToken, K.ExclamationEqualsToken,
  K.LessThanToken, K.GreaterThanToken, K.LessThanEqualsToken, K.GreaterThanEqualsToken,
  K.InstanceOfKeyword, K.InKeyword,
]);

function isOrExpression(node) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === K.BarBarToken;
}
function isLogicalExpression(node) {
  return ts.isBinaryExpression(node)
    && (node.operatorToken.kind === K.BarBarToken || node.operatorToken.kind === K.AmpersandAmpersandToken);
}
function skipParentheses(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
function orOperands(node, out) {
  const inner = skipParentheses(node);
  if (isOrExpression(inner)) {
    orOperands(inner.left, out);
    orOperands(inner.right, out);
  } else {
    out.push(inner);
  }
  return out;
}
function isPredicateOperand(node) {
  if (ts.isPrefixUnaryExpression(node)) return node.operator === K.ExclamationToken;
  return ts.isBinaryExpression(node) && PREDICATE_OPERATORS.has(node.operatorToken.kind);
}
function feedsTruthinessTest(chain) {
  // Truthiness flows through parentheses and enclosing && / || expressions.
  let child = chain;
  let parent = chain.parent;
  while (ts.isParenthesizedExpression(parent) || isLogicalExpression(parent)) {
    child = parent;
    parent = parent.parent;
  }
  if (ts.isPrefixUnaryExpression(parent)) return parent.operator === K.ExclamationToken;
  if (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) return parent.expression === child;
  if (ts.isForStatement(parent)) return parent.condition === child;
  if (ts.isConditionalExpression(parent)) return parent.condition === child;
  if (ts.isCallExpression(parent)) return ts.isIdentifier(parent.expression) && parent.expression.text === "Boolean";
  return false;
}

function scanOrChain3(file, text) {
  const hits = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const visit = (node) => {
    let parent = node.parent;
    while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
    const isChainRoot = isOrExpression(node) && !(parent && isOrExpression(parent));
    if (isChainRoot) {
      const operands = orOperands(node, []);
      if (operands.length >= 4 && !feedsTruthinessTest(node) && !operands.some(isPredicateOperand)) {
        const firstLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
        const lastLine = source.getLineAndCharacterOfPosition(node.getEnd()).line;
        if (!lineHasSafeAnnotation(lines[firstLine]) && !lineHasSafeAnnotation(lines[lastLine])) {
          hits.push({ file, line: firstLine + 1, sample: node.getText(source).replace(/\s+/g, " ").slice(0, 200), rule: "or-chain-3" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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
  allHits.push(...scanOrChain3(file, text));
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
