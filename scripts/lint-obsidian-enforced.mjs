#!/usr/bin/env node
// Blocking, ratcheted Obsidian lint subset.
//
// This gate intentionally enforces only the selected rules listed in
// eslint.obsidian.enforced.config.mjs. Existing findings are budgeted in
// scripts/eslint-obsidian-enforced-baseline.json; the gate fails when a rule's
// count increases, and passes when counts stay flat or improve.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ENFORCED_OBSIDIAN_RULES } from '../eslint.obsidian.enforced.config.mjs';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');
const updateBaseline = args.has('--update-baseline') || args.has('--write-baseline');
const baselinePath = path.join(root, 'scripts/eslint-obsidian-enforced-baseline.json');
const reportPath = path.join(root, '.gate-logs/eslint-obsidian-enforced.json');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function emptyCounts() {
  return Object.fromEntries(ENFORCED_OBSIDIAN_RULES.map(rule => [rule, 0]));
}

function runEslint() {
  const result = spawnSync('npx', [
    'eslint',
    'src',
    '--config',
    'eslint.obsidian.enforced.config.mjs',
    '--format',
    'json',
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (!result.stdout) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`ESLint produced no JSON output. ${stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`Failed to parse ESLint JSON output: ${error.message}. ${stderr}`);
  }
}

function summarize(files) {
  const byRule = emptyCounts();
  const topFiles = [];
  let total = 0;

  for (const file of files) {
    const messages = (file.messages || []).filter(message => ENFORCED_OBSIDIAN_RULES.includes(message.ruleId));
    if (messages.length === 0) continue;
    total += messages.length;
    topFiles.push({
      file: path.relative(root, file.filePath),
      problems: messages.length,
    });
    for (const message of messages) {
      byRule[message.ruleId] += 1;
    }
  }

  topFiles.sort((a, b) => b.problems - a.problems || a.file.localeCompare(b.file));
  return {
    total,
    byRule,
    topFiles: topFiles.slice(0, 20),
  };
}

function baselinePayload(summary) {
  return {
    rules: ENFORCED_OBSIDIAN_RULES,
    total: summary.total,
    byRule: summary.byRule,
    updatedAt: new Date().toISOString(),
    mode: 'ratchet',
    note: 'Fails when selected eslint-plugin-obsidianmd rule counts increase.',
  };
}

function printSummary(summary, baseline, deltas) {
  console.log('[obsidian-lint-enforced] Selected rule baseline check');
  console.log(`- current total: ${summary.total}`);
  if (baseline) console.log(`- baseline total: ${baseline.total ?? '(unknown)'}`);
  for (const rule of ENFORCED_OBSIDIAN_RULES) {
    const current = summary.byRule[rule] || 0;
    const base = baseline?.byRule?.[rule];
    const suffix = typeof base === 'number' ? ` (baseline ${base}, delta ${current - base})` : '';
    console.log(`  - ${rule}: ${current}${suffix}`);
  }
  if (!quiet && summary.topFiles.length > 0) {
    console.log('- top files:');
    summary.topFiles.slice(0, 8).forEach(item => console.log(`  - ${item.file}: ${item.problems}`));
  }
  if (deltas.length > 0) {
    console.log('- increases:');
    deltas.forEach(item => console.log(`  - ${item.rule}: +${item.delta} (${item.baseline} -> ${item.current})`));
  }
}

try {
  const files = runEslint();
  const summary = summarize(files);
  writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    ...summary,
  });

  if (updateBaseline) {
    writeJson(baselinePath, baselinePayload(summary));
    printSummary(summary, baselinePayload(summary), []);
    console.log(`[obsidian-lint-enforced] Wrote baseline: ${path.relative(root, baselinePath)}`);
    process.exit(0);
  }

  let baseline;
  try {
    baseline = readJson(baselinePath);
  } catch (error) {
    throw new Error(`Missing or invalid baseline at ${path.relative(root, baselinePath)}. Run npm run lint:obsidian:baseline.`);
  }

  const increases = [];
  for (const rule of ENFORCED_OBSIDIAN_RULES) {
    const current = summary.byRule[rule] || 0;
    const base = baseline.byRule?.[rule];
    if (typeof base !== 'number') {
      throw new Error(`Baseline missing selected rule: ${rule}`);
    }
    if (current > base) {
      increases.push({ rule, current, baseline: base, delta: current - base });
    }
  }

  printSummary(summary, baseline, increases);
  if (increases.length > 0) {
    console.error('[obsidian-lint-enforced] FAIL: selected Obsidian lint debt increased.');
    process.exit(1);
  }
  console.log('[obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.');
} catch (error) {
  console.error(`[obsidian-lint-enforced] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
