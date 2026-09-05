import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type TokenKind = "stale-comment" | "drift-term";
type HitCategory = TokenKind | "synopsis_identifier" | "synopsis_copy" | "synopsis_yaml";

interface TokenDefinition {
  token: string;
  tokenKind: TokenKind;
  regex: RegExp;
}

interface HitContextLine {
  line: number;
  text: string;
}

interface Hit {
  filePath: string;
  line: number;
  token: string;
  tokenKind: TokenKind;
  category: HitCategory;
  weight: number;
  lineText: string;
  context: {
    before?: HitContextLine;
    current: HitContextLine;
    after?: HitContextLine;
  };
}

interface CategorySummary {
  hitCount: number;
  weightedScore: number;
}

const staleCommentMarkers = [
  "TODO",
  "FIXME",
  "HACK",
  "WORKAROUND",
  "TEMP",
  "DEPRECATED",
  "NOTE",
  "IMPORTANT",
] as const;

const driftTerms = [
  "Synopsis",
  "legacy key",
  "plaintext key",
  "api key in settings",
  "mergeTemplates",
  "getMergedBeatYaml",
  "advanced template cleanup",
  "refreshTimelineIfNeeded",
  "ChangeType.SETTINGS",
  "Ripple Rename",
  "prefix normalization",
] as const;

const tokenDefinitions: TokenDefinition[] = [
  ...staleCommentMarkers.map((token) => ({
    token,
    tokenKind: "stale-comment" as const,
    regex: new RegExp(`\\b${escapeRegExp(token)}\\b`, "i"),
  })),
  ...driftTerms.map((token) => ({
    token,
    tokenKind: "drift-term" as const,
    regex: token === "Synopsis"
      ? /Synopsis/
      : new RegExp(escapeRegExp(token), "i"),
  })),
];

const synopsisIdentifierPatterns: RegExp[] = [
  /\bimport\b.*Synopsis/,
  /\bexport\b.*Synopsis/,
  /\bclass\s+Synopsis/,
  /\binterface\s+Synopsis/,
  /\btype\s+Synopsis/,
  /\bfunction\s+Synopsis/,
  /\bconst\s+Synopsis/,
  /\bfrom\s+['"][^'"]*Synopsis[^'"]*['"]/,
];

const synopsisYamlPatterns: RegExp[] = [
  /^\s*Synopsis:/,
  /\\nSynopsis:/,
];

const synopsisCopyPatterns: RegExp[] = [
  /['"`]([^'"`]*Synopsis[^'"`]*)['"`]/,
  /\/\/.*Synopsis/,
  /\/\*.*Synopsis.*\*\//,
];

const categoryWeights = new Map<HitCategory, number>([
  ["synopsis_identifier", 0],
  ["synopsis_copy", 5],
  ["synopsis_yaml", 4],
]);

const tokenWeights = new Map<string, number>([
  ["mergeTemplates", 5],
  ["HACK", 3],
  ["FIXME", 3],
  ["WORKAROUND", 3],
  ["TODO", 1],
]);

const scanRoots = ["src", "scripts"];
const ignoredDirectoryNames = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  "release",
  "release-ts",
  "build",
  "dist",
  ".cursor",
  ".agent",
  ".claude",
]);

const scanExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".sh",
]);

const excludedRelativePaths = new Set(["scripts/audit/run-scan.ts"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function collectFiles(rootPath: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(rootPath)) {
    return files;
  }

  const stack: string[] = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      const filePathRelative = relativePath(fullPath);
      if (
        scanExtensions.has(extension) &&
        !excludedRelativePaths.has(filePathRelative)
      ) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function classifySynopsisHit(filePath: string, rawLine: string): HitCategory {
  if (filePath.includes("Synopsis")) {
    return "synopsis_identifier";
  }

  if (synopsisIdentifierPatterns.some((pattern) => pattern.test(rawLine))) {
    return "synopsis_identifier";
  }

  if (synopsisYamlPatterns.some((pattern) => pattern.test(rawLine))) {
    return "synopsis_yaml";
  }

  if (synopsisCopyPatterns.some((pattern) => pattern.test(rawLine))) {
    return "synopsis_copy";
  }

  return "synopsis_identifier";
}

function resolveCategory(
  definition: TokenDefinition,
  filePath: string,
  rawLine: string,
): HitCategory {
  if (definition.token === "Synopsis") {
    return classifySynopsisHit(filePath, rawLine);
  }

  return definition.tokenKind;
}

function resolveWeight(token: string, category: HitCategory): number {
  const categoryWeight = categoryWeights.get(category);
  if (categoryWeight !== undefined) {
    return categoryWeight;
  }

  const tokenWeight = tokenWeights.get(token);
  if (tokenWeight !== undefined) {
    return tokenWeight;
  }

  return 1;
}

function scanFile(filePath: string): Hit[] {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const hits: Hit[] = [];
  const filePathRelative = relativePath(filePath);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];

    for (const definition of tokenDefinitions) {
      if (!definition.regex.test(rawLine)) {
        continue;
      }

      const category = resolveCategory(definition, filePathRelative, rawLine);
      const weight = resolveWeight(definition.token, category);

      const beforeRaw = index > 0 ? lines[index - 1] : undefined;
      const afterRaw = index < lines.length - 1 ? lines[index + 1] : undefined;

      hits.push({
        filePath: filePathRelative,
        line: index + 1,
        token: definition.token,
        tokenKind: definition.tokenKind,
        category,
        weight,
        lineText: normalizeWhitespace(rawLine),
        context: {
          before:
            beforeRaw === undefined
              ? undefined
              : { line: index, text: normalizeWhitespace(beforeRaw) },
          current: { line: index + 1, text: normalizeWhitespace(rawLine) },
          after:
            afterRaw === undefined
              ? undefined
              : { line: index + 2, text: normalizeWhitespace(afterRaw) },
        },
      });
    }
  }

  return hits;
}

function toMarkdownTableRow(columns: string[]): string {
  const escaped = columns.map((column) => column.replace(/\|/g, "\\|"));
  return `| ${escaped.join(" | ")} |`;
}

function inlineCode(value: string): string {
  return "`" + value + "`";
}

function formatSignedDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function loadPreviousWeightedTotal(jsonOutputPath: string): number | null {
  if (!fs.existsSync(jsonOutputPath)) {
    return null;
  }

  try {
    const previous = JSON.parse(fs.readFileSync(jsonOutputPath, "utf8")) as {
      summary?: {
        weightedTotal?: number;
      };
    };

    const weightedTotal = previous.summary?.weightedTotal;
    if (typeof weightedTotal === "number" && Number.isFinite(weightedTotal)) {
      return weightedTotal;
    }
  } catch {
    return null;
  }

  return null;
}

function buildMarkdownReport(input: {
  generatedAt: string;
  hits: Hit[];
  totalsByToken: Map<string, number>;
  totalsByFile: Map<string, number>;
  totalsByFileWeighted: Map<string, number>;
  byCategory: Map<HitCategory, CategorySummary>;
  weightedTotal: number;
  previousWeightedTotal: number | null;
}): string {
  const {
    generatedAt,
    hits,
    totalsByToken,
    totalsByFile,
    totalsByFileWeighted,
    byCategory,
    weightedTotal,
    previousWeightedTotal,
  } = input;

  const orderedTokenDefinitions = [...tokenDefinitions].sort((left, right) => {
    const leftCount = totalsByToken.get(left.token) ?? 0;
    const rightCount = totalsByToken.get(right.token) ?? 0;
    return rightCount - leftCount || left.token.localeCompare(right.token);
  });

  const totalHits = hits.length;
  const filesWithHits = totalsByFile.size;

  const hotspotRows = [...totalsByFile.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20);

  const weightedHotspotRows = [...totalsByFileWeighted.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10);

  const synopsisCategories: HitCategory[] = [
    "synopsis_identifier",
    "synopsis_copy",
    "synopsis_yaml",
  ];

  const sections: string[] = [];

  sections.push("# Sanitation Audit");
  sections.push("");
  sections.push(`Generated: ${generatedAt}`);
  sections.push("");
  sections.push("## Executive summary");
  sections.push("");
  sections.push(
    [
      "This audit pass is report-only and does not change runtime behavior.",
      `The scan found ${totalHits} matched lines across ${filesWithHits} files.`,
      `Weighted score is ${weightedTotal}, prioritizing actionable drift over identifier noise.`,
    ].join(" "),
  );
  sections.push("");

  sections.push("## Totals by token (raw counts)");
  sections.push("");
  sections.push(toMarkdownTableRow(["Token", "Token kind", "Total hits"]));
  sections.push(toMarkdownTableRow(["---", "---", "---"]));
  for (const definition of orderedTokenDefinitions) {
    sections.push(
      toMarkdownTableRow([
        inlineCode(definition.token),
        definition.tokenKind,
        String(totalsByToken.get(definition.token) ?? 0),
      ]),
    );
  }

  sections.push("");
  sections.push("## Synopsis breakdown");
  sections.push("");
  sections.push(toMarkdownTableRow(["Category", "Hits", "Weighted score"]));
  sections.push(toMarkdownTableRow(["---", "---", "---"]));
  for (const category of synopsisCategories) {
    const summary = byCategory.get(category) ?? { hitCount: 0, weightedScore: 0 };
    sections.push(
      toMarkdownTableRow([
        inlineCode(category),
        String(summary.hitCount),
        String(summary.weightedScore),
      ]),
    );
  }

  sections.push("");
  sections.push("## Weighted delta vs prior run");
  sections.push("");
  if (previousWeightedTotal === null) {
    sections.push("No prior weighted baseline found in the previous `sanitation-audit.json`.");
  } else {
    const delta = weightedTotal - previousWeightedTotal;
    sections.push(`- Previous weighted total: ${previousWeightedTotal}`);
    sections.push(`- Current weighted total: ${weightedTotal}`);
    sections.push(`- Delta: ${formatSignedDelta(delta)}`);
  }

  sections.push("");
  sections.push("## Top 10 files by weighted score");
  sections.push("");
  sections.push(toMarkdownTableRow(["File", "Weighted score", "Raw hits"]));
  sections.push(toMarkdownTableRow(["---", "---", "---"]));
  for (const [filePath, weightedScore] of weightedHotspotRows) {
    sections.push(
      toMarkdownTableRow([
        inlineCode(filePath),
        String(weightedScore),
        String(totalsByFile.get(filePath) ?? 0),
      ]),
    );
  }

  sections.push("");
  sections.push("## Top hotspots by raw hits");
  sections.push("");
  sections.push(toMarkdownTableRow(["File", "Hits"]));
  sections.push(toMarkdownTableRow(["---", "---"]));
  for (const [filePath, count] of hotspotRows) {
    sections.push(toMarkdownTableRow([inlineCode(filePath), String(count)]));
  }

  sections.push("");
  sections.push("## Supporting reports");
  sections.push("");
  sections.push("- TypeScript unused symbol report: `docs/audits/tsc-unused.txt`");
  sections.push("- ESLint audit output: `docs/audits/eslint.txt`");
  sections.push("");

  sections.push("## Findings by token (top 20 per token)");
  sections.push("");
  for (const definition of orderedTokenDefinitions) {
    const tokenHits = hits
      .filter((hit) => hit.token === definition.token)
      .sort(
        (left, right) =>
          left.filePath.localeCompare(right.filePath) || left.line - right.line,
      )
      .slice(0, 20);

    sections.push(
      "### " +
        inlineCode(definition.token) +
        " (" +
        String(totalsByToken.get(definition.token) ?? 0) +
        ")",
    );
    sections.push("");
    sections.push(
      toMarkdownTableRow(["File", "Line", "Category", "Weight", "Matched line"]),
    );
    sections.push(toMarkdownTableRow(["---", "---", "---", "---", "---"]));
    if (tokenHits.length === 0) {
      sections.push(toMarkdownTableRow(["(none)", "-", "-", "-", "-"]));
      sections.push("");
      continue;
    }

    for (const hit of tokenHits) {
      sections.push(
        toMarkdownTableRow([
          inlineCode(hit.filePath),
          String(hit.line),
          inlineCode(hit.category),
          String(hit.weight),
          inlineCode(hit.lineText || "(blank)"),
        ]),
      );
    }
    sections.push("");
  }

  sections.push("## Next PR checklist (no edits in this PR)");
  sections.push("");
  sections.push("- [ ] Convert unlabeled TODO/FIXME to `TODO(#issue)` or delete if obsolete.");
  sections.push("- [ ] Rewrite comments that reference removed systems to point to canonical helpers.");
  sections.push("- [ ] Remove dead wrappers after a dev-guard period.");
  sections.push("- [ ] Remove unused exports and legacy adapters.");
  sections.push("");

  return sections.join("\n");
}

function main(): void {
  const absoluteScanRoots = scanRoots.map((scanRoot) =>
    path.resolve(process.cwd(), scanRoot),
  );

  const files = absoluteScanRoots.flatMap((scanRootPath) =>
    collectFiles(scanRootPath),
  );

  const hits = files.flatMap((filePath) => scanFile(filePath));

  const totalsByToken = new Map<string, number>();
  const totalsByTokenKind = new Map<TokenKind, number>();
  const totalsByFile = new Map<string, number>();
  const totalsByFileWeighted = new Map<string, number>();
  const byCategory = new Map<HitCategory, CategorySummary>();

  for (const hit of hits) {
    totalsByToken.set(hit.token, (totalsByToken.get(hit.token) ?? 0) + 1);
    totalsByTokenKind.set(
      hit.tokenKind,
      (totalsByTokenKind.get(hit.tokenKind) ?? 0) + 1,
    );
    totalsByFile.set(hit.filePath, (totalsByFile.get(hit.filePath) ?? 0) + 1);
    totalsByFileWeighted.set(
      hit.filePath,
      (totalsByFileWeighted.get(hit.filePath) ?? 0) + hit.weight,
    );

    const existingCategory = byCategory.get(hit.category) ?? {
      hitCount: 0,
      weightedScore: 0,
    };
    byCategory.set(hit.category, {
      hitCount: existingCategory.hitCount + 1,
      weightedScore: existingCategory.weightedScore + hit.weight,
    });
  }

  const weightedTotal = [...byCategory.values()].reduce(
    (sum, category) => sum + category.weightedScore,
    0,
  );

  const reportDirectory = path.resolve(process.cwd(), "docs", "audits");
  fs.mkdirSync(reportDirectory, { recursive: true });

  const jsonOutputPath = path.join(reportDirectory, "sanitation-audit.json");
  const markdownOutputPath = path.join(reportDirectory, "sanitation-audit.md");

  const previousWeightedTotal = loadPreviousWeightedTotal(jsonOutputPath);
  const generatedAt = new Date().toISOString();

  const jsonPayload = {
    generatedAt,
    scannedDirectories: scanRoots,
    filesScanned: files.map((filePath) => relativePath(filePath)).sort(),
    tokenDefinitions: tokenDefinitions.map((definition) => ({
      token: definition.token,
      tokenKind: definition.tokenKind,
    })),
    weights: {
      byToken: Object.fromEntries(
        [...tokenWeights.entries()].sort((left, right) =>
          left[0].localeCompare(right[0]),
        ),
      ),
      byCategory: Object.fromEntries(
        [...categoryWeights.entries()].sort((left, right) =>
          left[0].localeCompare(right[0]),
        ),
      ),
      defaultWeight: 1,
    },
    summary: {
      totalHits: hits.length,
      totalFilesScanned: files.length,
      filesWithHits: totalsByFile.size,
      weightedTotal,
      weightedDeltaFromPrevious:
        previousWeightedTotal === null
          ? null
          : weightedTotal - previousWeightedTotal,
      totalsByToken: Object.fromEntries(
        [...totalsByToken.entries()].sort((left, right) =>
          left[0].localeCompare(right[0]),
        ),
      ),
      totalsByTokenKind: Object.fromEntries(
        [...totalsByTokenKind.entries()].sort((left, right) =>
          left[0].localeCompare(right[0]),
        ),
      ),
      byCategory: Object.fromEntries(
        [...byCategory.entries()]
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([category, summary]) => [category, summary]),
      ),
      hotspots: [...totalsByFile.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 50)
        .map(([filePath, hitCount]) => ({ filePath, hitCount })),
      weightedHotspots: [...totalsByFileWeighted.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 50)
        .map(([filePath, weightedScore]) => ({
          filePath,
          weightedScore,
          hitCount: totalsByFile.get(filePath) ?? 0,
        })),
    },
    hits,
  };

  fs.writeFileSync(jsonOutputPath, `${JSON.stringify(jsonPayload, null, 2)}\n`);
  fs.writeFileSync(
    markdownOutputPath,
    `${buildMarkdownReport({
      generatedAt,
      hits,
      totalsByToken,
      totalsByFile,
      totalsByFileWeighted,
      byCategory,
      weightedTotal,
      previousWeightedTotal,
    })}\n`,
  );

  process.stdout.write(
    `Sanitation scan complete: ${hits.length} hits in ${totalsByFile.size} files (weighted ${weightedTotal}).\n`,
  );
  process.stdout.write(`- ${relativePath(markdownOutputPath)}\n`);
  process.stdout.write(`- ${relativePath(jsonOutputPath)}\n`);
}

main();
