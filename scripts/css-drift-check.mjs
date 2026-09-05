import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Full source CSS scope. The hard-FAIL rules (!important, global element
// selectors, unscoped Obsidian selectors, rt- backslide in rt-ui.css) apply
// everywhere; the WARN rules (raw-hex / spacing-px / shadow-rgba / rt-legacy)
// are budgeted against scripts/css-drift-baseline.json so previously-invisible
// renderer-island debt is frozen, not silently growable.
//
// Walk src/styles rather than listing files by hand: a hand-maintained list
// silently exempts whatever nobody remembered to add (src/styles/features/*
// and bug-report.css were unscanned this way). The generated bundle
// (./styles.css) is NOT scanned — it is a concatenation of these sources, so
// including it counted every warning twice and made the totals depend on
// whether the tree had been built.
const SOURCE_DIR = path.join(ROOT, "src/styles");
const collectCss = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectCss(full);
      return entry.name.endsWith(".css") ? [full] : [];
    })
    .sort();
const FILES = collectCss(SOURCE_DIR);

const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, "utf8");

// Namespace policy: which CSS files have finished migrating off rt-* and must
// stay clean. A hard-FAIL on rt-* in these files is the backslide guard that
// the count-based WARN ratchet cannot provide (the ratchet only freezes the
// global total, so an rt- removed from the renderer island could silently be
// re-introduced into a migrated chrome file). See css-namespace-allowlist.json.
const ALLOWLIST_PATH = path.join(ROOT, "scripts/css-namespace-allowlist.json");
const RT_CLEAN_FILES = (() => {
  try {
    const policy = JSON.parse(read(ALLOWLIST_PATH));
    return new Set(policy?.rtCleanFiles?.files ?? []);
  } catch {
    return new Set();
  }
})();

// Matches an rt-* class token at the START of a class name (preceded by `.`,
// whitespace, `,`, `>`, etc.) — NOT one embedded after a hyphen. This excludes
// `apr-rt-attribution` (APR branding emitted into exported SVGs, never legacy
// debt) and `--rt-*` custom-property references, while still catching real
// legacy selectors like `.rt-foo` and compounds like `.rt-a.rt-b`.
const RT_LEGACY_TOKEN = "(?<![\\w-])rt-[a-zA-Z0-9_-]+";

const args = new Set(process.argv.slice(2));
const MODE = args.has("--strict")
  ? "strict"
  : args.has("--maintenance")
    ? "maintenance"
    : args.has("--migration")
      ? "migration"
      : (process.env.CSS_DRIFT_MODE || "maintenance");
const MIGRATION_MODE = MODE === "migration";
const MAINTENANCE_MODE = MODE === "maintenance";
const LOOSE_MODE = MODE !== "strict";
const WRITE_BASELINE = args.has("--write-baseline") || args.has("--update-baseline");
const BASELINE_PATH = path.join(ROOT, "scripts/css-drift-baseline.json");
const BASELINE_KEY = MAINTENANCE_MODE ? "maintenance" : MIGRATION_MODE ? "migration" : null;

/**
 * Class selectors known to be appended to `document.body` (or any element
 * outside the `.ert-ui` subtree). Rules whose selector list mentions one of
 * these CANNOT read `--ert-gap-*` / `--ert-pad-*` — those tokens are scoped
 * to `.ert-ui`. Hard-fail any such rule that uses them. Add new portal-mounted
 * chrome here when you create it; the matching pattern is loose-prefix (also
 * matches `.ert-timeline-session-panel__recent`, etc.).
 *
 * See docs/engineering/standards/css-guidelines.md → Token scope.
 */
const BODY_PORTAL_SELECTORS = [
  ".ert-timeline-session-panel",
  // Session-log chrome only renders inside .ert-timeline-session-panel
  // (and the in-settings card expand, which IS under .ert-ui — that path is
  // safe). The compact-variant rules below are the body-portal usage; they
  // must still use --size-4-* tokens because that's the worst-case scope.
  ".ert-session-log-list--compact",
  ".ert-session-log-row--compact",
];

// Matches a top-level CSS rule whose selector list contains any of the
// body-portal selectors. Captures: [1]=selector, [2]=rule body.
// Greedy `[^{}]*` on selector and `[^}]*` on body — does not support nested
// `{}` inside the body (none of our rules use it for these surfaces today).
const BODY_PORTAL_RULE_REGEX = new RegExp(
  `((?:[^{}@/]*?(?:${BODY_PORTAL_SELECTORS
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})[^{}@]*?))\\{([^}]*)\\}`,
  "g",
);

const FAIL = [];
const WARN = [];

function addFail(file, msg, sample, rule, line) {
  FAIL.push({ file, msg, sample, rule, line });
}
function addWarn(file, msg, sample, rule, line) {
  WARN.push({ file, msg, sample, rule, line });
}

function findAll(re, text) {
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push(m);
  return hits;
}

function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function getLineNumber(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high + 1;
}

const SKIN_SELECTOR_RE = /\.ert-skin--[a-zA-Z0-9_-]+/;
const SKIN_FORBIDDEN_PROPS = new Set([
  "font-size",
  "font-weight",
  "line-height",
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
]);
const SKIN_FORBIDDEN_PREFIXES = [
  "margin",
  "padding",
  "gap",
  "grid",
  "flex",
];
const SKIN_ALLOWED_PROPS = new Set([
  "background",
  "background-color",
  "background-image",
  "border",
  "box-shadow",
  "color",
  "filter",
  "fill",
  "opacity",
  "outline-color",
  "stroke",
]);

function isSkinForbiddenProp(prop) {
  if (SKIN_FORBIDDEN_PROPS.has(prop)) return true;
  return SKIN_FORBIDDEN_PREFIXES.some((prefix) => prop === prefix || prop.startsWith(prefix + "-"));
}

function isSkinAllowedProp(prop) {
  if (prop.startsWith("--")) return true;
  if (SKIN_ALLOWED_PROPS.has(prop)) return true;
  if (prop.endsWith("-color")) return true;
  return false;
}

function loadBaselineStore() {
  if (!exists(BASELINE_PATH)) return null;
  try {
    const data = JSON.parse(read(BASELINE_PATH));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function resolveBaseline(store) {
  if (!store) return { baseline: null, source: "missing" };
  if (BASELINE_KEY && store[BASELINE_KEY]) {
    return { baseline: store[BASELINE_KEY], source: "key" };
  }
  const hasLegacy = store.totalWarnings || store.warningsByRule;
  if (hasLegacy) {
    const matchesMode =
      store.mode === MODE ||
      (store.migrationMode === true && MIGRATION_MODE) ||
      (store.migrationMode === false && MAINTENANCE_MODE);
    if (matchesMode || !store.mode) {
      return { baseline: store, source: "legacy" };
    }
  }
  return { baseline: null, source: "missing" };
}

function describeBaseline(pathLabel, key, source) {
  const parts = [pathLabel];
  if (key) parts.push(`key: ${key}`);
  if (source && source !== "key") parts.push(source);
  return parts.join(" · ");
}

/**
 * Heuristics:
 * - We allow raw colors ONLY in token blocks (lines containing --ert- or --rt- CSS vars)
 * - We require .ert-ui scoping for Obsidian classes usage (setting-item, modal, etc.)
 */
for (const file of FILES.filter(exists)) {
  const css = read(file);
  const lineStarts = buildLineIndex(css);

  // 0) Skin overreach (fail) — .ert-skin--* selectors must remain visual-only
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of findAll(ruleRe, css)) {
    const selectorText = m[1].trim();
    if (!SKIN_SELECTOR_RE.test(selectorText)) continue;
    const selectors = selectorText.split(",").map((s) => s.trim()).filter(Boolean);
    const skinSelectors = selectors.filter((s) => SKIN_SELECTOR_RE.test(s));
    if (!skinSelectors.length) continue;
    const selectorLabel = skinSelectors.join(", ");
    const decls = m[2].split(";");
    for (const decl of decls) {
      const idx = decl.indexOf(":");
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).trim();
      if (!prop) continue;
      if (isSkinForbiddenProp(prop)) {
        addFail(
          file,
          `Skin selector sets forbidden property "${prop}".`,
          `${selectorLabel} { ${prop}: ${value}; }`,
          "skin-overreach",
          getLineNumber(lineStarts, m.index)
        );
      } else if (!isSkinAllowedProp(prop)) {
        addFail(
          file,
          `Skin selector sets non-allowed property "${prop}".`,
          `${selectorLabel} { ${prop}: ${value}; }`,
          "skin-overreach",
          getLineNumber(lineStarts, m.index)
        );
      }
    }
  }

  // 1) !important (fail)
  for (const m of findAll(/!important\b/g, css)) {
    addFail(
      file,
      "Found !important (ban).",
      "!important",
      "important",
      getLineNumber(lineStarts, m.index)
    );
  }

  // 2) Global selectors in UI css (fail) — coarse but effective
  const globalSelectorRe = /(^|\n)\s*(\*|html|body|button|input|select|textarea)\s*\{/g;
  for (const m of findAll(globalSelectorRe, css)) {
    addFail(
      file,
      "Global element selector (likely bleed). Scope under .ert-ui.",
      m[2] + " {",
      "global-element",
      getLineNumber(lineStarts, m.index)
    );
  }

  // 3) Raw hex colors outside token lines (fail in strict, warn in migration/maintenance)
  //    (skip lines that define css variables)
  const lines = css.split("\n");
  lines.forEach((line, idx) => {
    const hasHex = /#[0-9a-fA-F]{3,8}\b/.test(line);
    if (!hasHex) return;
    const isVarLine = /--[a-zA-Z0-9-_]+\s*:/.test(line);
    if (!isVarLine) {
      const rule = "raw-hex";
      if (LOOSE_MODE) {
        addWarn(file, `Raw hex color outside token/var line at L${idx + 1}.`, line.trim(), rule, idx + 1);
      } else {
        addFail(file, `Raw hex color outside token/var line at L${idx + 1}.`, line.trim(), rule, idx + 1);
      }
    }
  });

  // 4) Obsidian class selectors not scoped under .ert-ui (fail)
  //    catches ".setting-item { ... }" etc.
  const obsidianClasses = ["setting-item", "modal", "cm-", "workspace", "markdown", "nav-file"];
  for (const cls of obsidianClasses) {
    const re = new RegExp(`(^|\\n)\\s*\\.${cls}[^,{]*\\{`, "g");
    for (const m of findAll(re, css)) {
      addFail(
        file,
        `Unscoped Obsidian selector ".${cls}…" — must be under ".ert-ui …"`,
        m[0].trim(),
        "unscoped-obsidian",
        getLineNumber(lineStarts, m.index)
      );
    }
  }

  // 5) Legacy prefix usage inside rt-ui.css (fail)
  if (file.endsWith("rt-ui.css")) {
    const legacyMatch = css.match(/\.(rt-|rt-apr-)/);
    if (legacyMatch) {
      addFail(
        file,
        "Legacy .rt-* selectors detected in rt-ui.css (backslide).",
        legacyMatch[0],
        "rt-in-rt-ui",
        getLineNumber(lineStarts, legacyMatch.index || 0)
      );
    }
  }

  // 5a) Hover-path filters (fail) — a `filter` on a :hover / .rt-selected rule
  //     forces a per-frame raster pass while the pointer moves over the
  //     timeline, which makes scene hover sluggish. Use stroke / opacity /
  //     background cues instead. (owner rule, 2026-09-04)
  const hoverRuleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of findAll(hoverRuleRe, css)) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const body = m[2].replace(/\/\*[\s\S]*?\*\//g, "");
    if (selector.startsWith("@") || !/:hover|\.rt-selected/.test(selector)) continue;
    // Timeline chrome only: the rule is about the scene-hover path, not modals.
    if (!/radial-timeline-container|\.rt-|\.ert-timeline-/.test(selector)) continue;
    const filterDecl = body.match(/(?:^|[;\s])(?:backdrop-)?filter\s*:(?!\s*none\b)[^;]+/);
    const filterTransition = body.match(/transition[^;]*\bfilter\b/);
    const hit = filterDecl ?? filterTransition;
    if (!hit) continue;
    addFail(
      file,
      "filter on a hover/selected rule (hover-path raster cost). Use stroke, opacity, or background instead.",
      `${selector.split("\n").pop().trim()} { ${hit[0].trim()} }`,
      "hover-filter",
      getLineNumber(lineStarts, m.index + m[0].indexOf(hit[0]))
    );
  }

  // 5b) Backslide guard (fail) — rt-* selectors in files that have finished
  //     migrating off rt-* are a hard FAIL. apr-rt-* branding is exempt via
  //     RT_LEGACY_TOKEN. See scripts/css-namespace-allowlist.json → rtCleanFiles.
  const relPath = path.relative(ROOT, file);
  if (RT_CLEAN_FILES.has(relPath)) {
    const cleanRe = new RegExp(`(^|\\n)\\s*[^@{]*${RT_LEGACY_TOKEN}[^,{]*\\{`, "g");
    for (const m of findAll(cleanRe, css)) {
      addFail(
        file,
        "Legacy rt-* selector in a migrated (rt-clean) file — backslide. Use ert-* or remove.",
        m[0].trim(),
        "rt-clean-backslide",
        getLineNumber(lineStarts, m.index)
      );
    }
  }

  // 6) Legacy rt-* selectors outside rt-ui.css (warn in migration/maintenance)
  if (!file.endsWith("rt-ui.css")) {
    const rtSelectorRe = new RegExp(`(^|\\n)\\s*[^@{]*${RT_LEGACY_TOKEN}[^,{]*\\{`, "g");
    for (const m of findAll(rtSelectorRe, css)) {
      addWarn(
        file,
        "Legacy .rt-* selector (legacy warning).",
        m[0].trim(),
        "rt-legacy",
        getLineNumber(lineStarts, m.index)
      );
    }
  }

  // 7) Token bypass for spacing (warn)
  for (const m of findAll(/\b(padding|margin|gap)\s*:\s*[^;]*\b\d+px\b/g, css)) {
    // ignore zero px
    if (/\b0px\b/.test(m[0])) continue;
    addWarn(
      file,
      "Spacing uses literal px (prefer var(--ert-*) tokens).",
      m[0].trim(),
      "spacing-px",
      getLineNumber(lineStarts, m.index)
    );
  }

  // 8) Token bypass for shadows (warn)
  for (const m of findAll(/\bbox-shadow\s*:\s*[^;]*\brgba?\(/g, css)) {
    addWarn(
      file,
      "Box-shadow uses raw rgba() (prefer theme vars/tokens).",
      m[0].trim(),
      "shadow-rgba",
      getLineNumber(lineStarts, m.index)
    );
  }

  // 9) Token-scope fail (hard fail) — `--ert-gap-*` and `--ert-pad-*` are
  // scoped to `.ert-ui`. Rules whose selector lists a known body-portal
  // class CANNOT reach those tokens; the `var()` reference is undefined
  // there and the property silently falls back to `0`. See
  // docs/engineering/standards/css-guidelines.md → Token scope.
  for (const m of findAll(BODY_PORTAL_RULE_REGEX, css)) {
    const ruleBody = m[2];
    const ertVarMatch = ruleBody.match(/var\(--ert-(gap|pad)-[a-z0-9-]+/);
    if (!ertVarMatch) continue;
    const selector = m[1].trim();
    addFail(
      file,
      `Body-portal rule uses '${ertVarMatch[0]})' — --ert-gap-*/--ert-pad-* are scoped to .ert-ui and unreachable here; use --size-4-* tokens instead.`,
      `${selector} { … ${ertVarMatch[0]}…) … }`,
      "ert-token-scope",
      getLineNumber(lineStarts, m.index)
    );
  }
}

function print(items, label) {
  if (!items.length) return;
  console.log(`\n${label} (${items.length})`);
  for (const it of items.slice(0, 50)) {
    const line = it.line ? `:${it.line}` : "";
    console.log(`- ${it.file}${line}: ${it.msg}`);
    if (it.sample) console.log(`  ${it.sample}`);
  }
  if (items.length > 50) console.log(`…and ${items.length - 50} more`);
}

function printFailTop(items, limit = 20) {
  if (!items.length) return;
  const sorted = [...items].sort((a, b) => {
    if (a.file === b.file) return (a.line || 0) - (b.line || 0);
    return a.file.localeCompare(b.file);
  });
  console.log(`\nTop FAIL offenders (${Math.min(limit, sorted.length)})`);
  for (const it of sorted.slice(0, limit)) {
    const line = it.line ? `:${it.line}` : "";
    console.log(`- ${it.file}${line}: ${it.msg}`);
    if (it.sample) console.log(`  ${it.sample}`);
  }
}

print(WARN, "CSS drift warnings");
print(FAIL, "CSS drift failures");
printFailTop(FAIL, 20);

const warnSummary = WARN.reduce(
  (acc, it) => {
    const rule = it.rule || "unknown";
    acc.total += 1;
    acc.byRule[rule] = (acc.byRule[rule] || 0) + 1;
    return acc;
  },
  { total: 0, byRule: {} }
);

const baselineStore = loadBaselineStore();
const baselineInfo = BASELINE_KEY ? resolveBaseline(baselineStore) : { baseline: null, source: "unused" };
console.log(`\nBaseline: ${describeBaseline(BASELINE_PATH, BASELINE_KEY, baselineInfo.source)}`);

if (WRITE_BASELINE) {
  if (!BASELINE_KEY) {
    console.error("\nBaseline writes are only supported in maintenance or migration modes.");
    process.exit(1);
  }
  const payload = {
    totalWarnings: warnSummary.total,
    warningsByRule: warnSummary.byRule,
    updatedAt: new Date().toISOString(),
    mode: MODE,
  };
  const store = baselineStore && typeof baselineStore === "object" ? baselineStore : {};
  const output = store.maintenance || store.migration ? { ...store } : {};
  if (!output.maintenance && !output.migration && (store.totalWarnings || store.warningsByRule)) {
    const legacyKey =
      store.mode === "migration" || store.migrationMode === true
        ? "migration"
        : "maintenance";
    output[legacyKey] = store;
  }
  output[BASELINE_KEY] = payload;
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(output, null, 2));
  console.log(`\n🧭 Wrote CSS drift baseline to ${BASELINE_PATH} (key: ${BASELINE_KEY})`);
}

if (LOOSE_MODE && !WRITE_BASELINE) {
  const baseline = baselineInfo.baseline;
  if (baseline) {
    const baselineTotal = baseline.totalWarnings ?? 0;
    const currentTotal = warnSummary.total;
    const delta = currentTotal - baselineTotal;
    const keys = ["raw-hex", "spacing-px", "shadow-rgba", "rt-legacy"];
    const summaryLabel = MAINTENANCE_MODE ? "Maintenance WARN summary:" : "Migration WARN summary:";
    console.log(`\n${summaryLabel}`);
    console.log(`- current WARN total: ${currentTotal}`);
    console.log(`- baseline WARN total: ${baselineTotal}`);
    console.log(`- delta: ${delta >= 0 ? "+" : ""}${delta}`);
    console.log("- breakdown deltas:");
    for (const key of keys) {
      const currentCount = warnSummary.byRule[key] ?? 0;
      const baselineCount = baseline.warningsByRule?.[key] ?? 0;
      const ruleDelta = currentCount - baselineCount;
      console.log(`  - ${key}: ${currentCount} (baseline ${baselineCount}, delta ${ruleDelta >= 0 ? "+" : ""}${ruleDelta})`);
    }
  }

  if (!baseline) {
    addFail(
      BASELINE_PATH,
      `Missing drift baseline for ${BASELINE_KEY || "strict"} mode. Run with --write-baseline to capture the current WARN budget.`,
      "baseline missing",
      "warn-budget"
    );
  } else if (warnSummary.total > (baseline.totalWarnings ?? 0)) {
    addFail(
      BASELINE_PATH,
      `WARN budget exceeded: ${warnSummary.total} > ${baseline.totalWarnings}.`,
      "warn budget",
      "warn-budget"
    );
  } else if (MAINTENANCE_MODE) {
    const regressions = ["raw-hex", "spacing-px", "shadow-rgba", "rt-legacy"]
      .map((key) => {
        const currentCount = warnSummary.byRule[key] ?? 0;
        const baselineCount = baseline.warningsByRule?.[key] ?? 0;
        return { key, currentCount, baselineCount, delta: currentCount - baselineCount };
      })
      .filter((entry) => entry.delta > 0);
    if (regressions.length > 0) {
      regressions.forEach(({ key, currentCount, baselineCount, delta }) => {
        addFail(
          BASELINE_PATH,
          `Maintenance regression for ${key}: ${currentCount} > ${baselineCount}.`,
          `${key} +${delta}`,
          "warn-budget"
        );
      });
    }
  }
}

if (FAIL.length) {
  console.error("\n❌ CSS drift gate failed.");
  process.exit(1);
} else {
  console.log("\n✅ CSS drift gate passed.");
}
