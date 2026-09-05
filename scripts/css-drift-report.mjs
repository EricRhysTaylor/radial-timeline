#!/usr/bin/env node
// Dumps the full CSS drift offender list to docs/engineering/audits/css-drift-debt.md
// Uses the same detection logic as scripts/css-drift-check.mjs but emits every hit,
// grouped by rule and file, so the debt can be burned down after a baseline reset.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "docs/engineering/audits/css-drift-debt.md");

const FILES = [
  "src/styles/rt-ui.css",
  "src/styles/settings.css",
  "src/styles/modal.css",
  "src/styles/timeline-audit.css",
  "src/styles/timeline-repair.css",
  "src/styles/book-designer.css",
  "src/styles/legacy/apr-legacy.css",
  "src/styles/legacy/rt-ui-legacy.css",
].map((p) => path.join(ROOT, p));

const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, "utf8");
const rel = (p) => path.relative(ROOT, p);

function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineNo(lineStarts, index) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= index) lo = mid + 1; else hi = mid - 1;
  }
  return hi + 1;
}

const buckets = {
  "spacing-px": [],
  "raw-hex": [],
  "shadow-rgba": [],
  "rt-legacy": [],
};

for (const file of FILES.filter(exists)) {
  const css = read(file);
  const lineStarts = buildLineIndex(css);
  const relFile = rel(file);

  // spacing-px
  const spacingRe = /\b(padding|margin|gap)\s*:\s*[^;]*\b\d+px\b/g;
  let m;
  while ((m = spacingRe.exec(css))) {
    if (/\b0px\b/.test(m[0])) continue;
    buckets["spacing-px"].push({ file: relFile, line: lineNo(lineStarts, m.index), sample: m[0].trim() });
  }

  // raw-hex (skip css-var declaration lines)
  const lines = css.split("\n");
  lines.forEach((line, i) => {
    if (!/#[0-9a-fA-F]{3,8}\b/.test(line)) return;
    if (/--[a-zA-Z0-9-_]+\s*:/.test(line)) return;
    buckets["raw-hex"].push({ file: relFile, line: i + 1, sample: line.trim() });
  });

  // shadow-rgba
  const shadowRe = /\bbox-shadow\s*:\s*[^;]*\brgba?\(/g;
  while ((m = shadowRe.exec(css))) {
    buckets["shadow-rgba"].push({ file: relFile, line: lineNo(lineStarts, m.index), sample: m[0].trim() });
  }

  // rt-legacy (only outside rt-ui.css)
  if (!file.endsWith("rt-ui.css")) {
    const rtRe = /(^|\n)\s*[^@{]*\brt-[a-zA-Z0-9_-]+[^,{]*\{/g;
    while ((m = rtRe.exec(css))) {
      buckets["rt-legacy"].push({ file: relFile, line: lineNo(lineStarts, m.index), sample: m[0].trim() });
    }
  }
}

const total = Object.values(buckets).reduce((a, b) => a + b.length, 0);
const timestamp = new Date().toISOString();

let md = "";
md += "# CSS Drift Debt\n\n";
md += `Generated: ${timestamp}\n\n`;
md += "Snapshot of every WARN-level drift hit at the time of baseline reset. Work through these to ratchet the baseline down. After fixing a batch, run `npm run css-drift -- --maintenance --update-baseline` to lock in the new lower ceiling.\n\n";
md += "> **Note on counts:** this report scans only the _source_ CSS files under `src/styles/`. The drift check also scans the bundled `styles.css` output (auto-generated from sources), so its totals are roughly 2× these. Fixing a hit here will remove both copies after the next `npm run build`.\n\n";
md += "Regenerate this report anytime with: `node scripts/css-drift-report.mjs`.\n\n";
md += "## Totals\n\n";
md += `- **Total WARN hits:** ${total}\n`;
for (const rule of Object.keys(buckets)) {
  md += `- \`${rule}\`: ${buckets[rule].length}\n`;
}
md += "\n## How to work a rule\n\n";
md += "1. Open the section below for the rule.\n";
md += "2. Fix one file's hits at a time (files are grouped together in line order).\n";
md += "3. Rebuild and re-run `npm run css-drift -- --maintenance` to confirm the count dropped.\n";
md += "4. When a batch is done, run `npm run css-drift -- --maintenance --update-baseline`.\n\n";
md += "### Fix hints per rule\n\n";
md += "- `spacing-px` — replace literal `padding/margin/gap: Npx` with `var(--ert-pad-*)` / `var(--ert-gap-*)` tokens. See `src/styles/variables.css` for the token table.\n";
md += "- `raw-hex` — replace hex colors with theme vars (`var(--text-*)`, `var(--background-*)`) or ERT tokens. Hex is OK inside `--var:` declarations in `variables.css`.\n";
md += "- `shadow-rgba` — replace raw `rgba(...)` in `box-shadow` with `color-mix(in srgb, var(--...) N%, transparent)` or an ERT shadow token.\n";
md += "- `rt-legacy` — rename `.rt-*` selector to `.ert-*` (and update TS class usage) or relocate to `src/styles/legacy/rt-ui-legacy.css`. Note: `legacy/rt-ui-legacy.css` is itself scanned, so renaming beats relocating long-term.\n";

for (const rule of Object.keys(buckets)) {
  const items = buckets[rule];
  md += `\n## \`${rule}\` (${items.length})\n\n`;
  if (!items.length) {
    md += "_No hits. 🎉_\n";
    continue;
  }
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
      md += `${f}:${h.line}: ${h.sample}\n`;
    }
    md += "```\n";
  }
}

fs.writeFileSync(OUTPUT, md);
console.log(`Wrote ${total} offenders to ${rel(OUTPUT)}`);
