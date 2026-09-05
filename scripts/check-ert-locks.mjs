#!/usr/bin/env node
/**
 * ERT namespace locks — one table-driven scan for the four islands that
 * must not grow new legacy `rt-*` (or misplaced `ert-inquiry-*`) tokens.
 *
 * Replaces check-social-ert-lock, check-inquiry-ert-lock,
 * check-modal-settings-ert-lock and check-timeline-chrome-ert-lock, which
 * shared the same scanner and differed only in scope and rule.
 *
 * Usage: node scripts/check-ert-locks.mjs [--quiet] [--only=<id>]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const quiet = process.argv.includes("--quiet");
const only = (process.argv.find(arg => arg.startsWith("--only=")) ?? "").slice("--only=".length);

const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/css-namespace-allowlist.json"), "utf8"));
const TIMELINE_CHROME_PREFIXES = POLICY?.legacyIslands?.timelineChromeTs?.allowedRtClassPrefixes ?? [];

const STRING_LITERAL = /`([^`]+)`|"([^"]+)"|'([^']+)'/g;
const CLS_PATTERNS = [/cls:\s*`([^`]+)`/g, /cls:\s*"([^"]+)"/g, /cls:\s*'([^']+)'/g];
const CLASSNAME_PATTERNS = [/\.className\s*=\s*`([^`]+)`/g, /\.className\s*=\s*"([^"]+)"/g, /\.className\s*=\s*'([^']+)'/g];
const CLASS_METHODS_ADD = "addClass|classList\\.add";
const CLASS_METHODS_ALL = "addClass|classList\\.add|toggleClass|removeClass|hasClass|classList\\.remove|classList\\.contains";

const tokensOf = (raw) => raw.replace(/\$\{[^}]+\}/g, " ").split(/\s+/).map(t => t.trim()).filter(Boolean);
const lineAt = (content, index) => content.slice(0, index).split("\n").length;

/** Every string that names a class at a class-assignment site. */
function classSites(content, { className = false, methods = CLASS_METHODS_ADD } = {}) {
    const sites = [];
    const patterns = className ? [...CLS_PATTERNS, ...CLASSNAME_PATTERNS] : CLS_PATTERNS;
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(content))) sites.push({ value: m[1], index: m.index });
    }
    const methodPattern = new RegExp(`\\.(?:${methods})\\(([^)]*)\\)`, "g");
    let call;
    while ((call = methodPattern.exec(content))) {
        STRING_LITERAL.lastIndex = 0;
        let str;
        while ((str = STRING_LITERAL.exec(call[1]))) sites.push({ value: str[1] ?? str[2] ?? str[3] ?? "", index: call.index });
    }
    return sites;
}

/** Every string literal in the file, class site or not. */
function allStrings(content) {
    const sites = [];
    STRING_LITERAL.lastIndex = 0;
    let m;
    while ((m = STRING_LITERAL.exec(content))) sites.push({ value: m[1] ?? m[2] ?? m[3] ?? "", index: m.index });
    return sites;
}

function listTs(relativeDir, { includeTests }) {
    const dirPath = path.join(ROOT, relativeDir);
    if (!fs.existsSync(dirPath)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const rel = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) out.push(...listTs(rel, { includeTests }));
        else if (entry.name.endsWith(".ts") && (includeTests || !entry.name.endsWith(".test.ts"))) out.push(rel);
    }
    return out;
}

const SOCIAL_ALLOWED_CLASSES = new Set(["rt-hidden", "rt-settings-tab-content"]);
const SOCIAL_ALLOWED_PREFIXES = ["rt-settings-tab", "rt-settings-tab-", "rt-settings-social-content"];
const INQUIRY_PREFIX = "ert-inquiry-";

const LOCKS = [
    {
        id: "social",
        label: "Social ERT lock",
        pass: "no rt-* classes in Social render files",
        fail: "Social ERT lock failed. rt-* classes detected:",
        files: () => ["src/settings/sections/AuthorProgressSection.ts", "src/settings/sections/CampaignManagerSection.ts"],
        sites: (content) => classSites(content),
        violates: (token) => token.startsWith("rt-")
            && !SOCIAL_ALLOWED_CLASSES.has(token)
            && !SOCIAL_ALLOWED_PREFIXES.some(prefix => token.startsWith(prefix))
    },
    {
        id: "modal-settings",
        label: "Modal/settings ERT lock",
        pass: "no rt-* classes in modal/settings render files",
        fail: "Modal/settings ERT lock failed. rt-* classes detected:",
        files: () => ["src/modals", "src/settings", "src/sceneAnalysis"].flatMap(dir => listTs(dir, { includeTests: false })),
        sites: (content) => classSites(content, { methods: CLASS_METHODS_ALL }),
        violates: (token) => token.startsWith("rt-")
    },
    {
        id: "timeline-chrome",
        label: "Timeline chrome ERT lock",
        pass: "no unexpected rt-* class creation in TimeLineView.ts",
        fail: "Timeline chrome ERT lock failed. Unexpected rt-* class creation detected:",
        hint: "Use ert-timeline-* for new Timeline view chrome. Only allowlisted legacy rt-* chrome may remain.",
        files: () => ["src/view/TimeLineView.ts"],
        sites: (content) => classSites(content, { className: true }),
        violates: (token) => token.startsWith("rt-") && !TIMELINE_CHROME_PREFIXES.some(prefix => token.startsWith(prefix))
    },
    {
        id: "inquiry",
        label: "Inquiry ERT lock",
        pass: "no ert-inquiry-* tokens in settings/modals TS or rt-ui.css",
        fail: "Inquiry ERT lock failed. ert-inquiry-* tokens detected:",
        files: () => ["src/settings", "src/modals"].flatMap(dir => listTs(dir, { includeTests: true })),
        sites: (content) => allStrings(content),
        violates: (token) => {
            if (!token.includes(INQUIRY_PREFIX)) return false;
            if (token.includes(`--${INQUIRY_PREFIX}`)) {
                return token.includes(`.${INQUIRY_PREFIX}`) || token.startsWith(INQUIRY_PREFIX);
            }
            return !token.startsWith(`data-${INQUIRY_PREFIX}`);
        },
        // The shared stylesheet must not carry Inquiry selectors either.
        extra: () => {
            const cssFile = "src/styles/rt-ui.css";
            const cssPath = path.join(ROOT, cssFile);
            if (!fs.existsSync(cssPath)) return [];
            const content = fs.readFileSync(cssPath, "utf8");
            const hits = [];
            const rule = /([^{}]+)\{[^{}]*\}/g;
            let m;
            while ((m = rule.exec(content))) {
                const classes = (m[1] ?? "").match(/\.ert-inquiry-[a-z0-9-]+/gi) ?? [];
                for (const cls of classes) hits.push({ file: cssFile, line: lineAt(content, m.index), token: cls });
            }
            return hits;
        }
    }
];

let failed = false;
for (const lock of LOCKS) {
    if (only && lock.id !== only) continue;
    const violations = [];
    for (const rel of lock.files()) {
        const filePath = path.join(ROOT, rel);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, "utf8");
        for (const site of lock.sites(content)) {
            for (const token of tokensOf(site.value)) {
                if (lock.violates(token)) violations.push({ file: rel, line: lineAt(content, site.index), token });
            }
        }
    }
    if (lock.extra) violations.push(...lock.extra());
    if (violations.length > 0) {
        failed = true;
        console.error(`❌ ${lock.fail}`);
        for (const { file, line, token } of violations) console.error(`  ${file}:${line} -> ${token}`);
        if (lock.hint) console.error(lock.hint);
    } else if (!quiet) {
        console.log(`✅ ${lock.label} passed (${lock.pass}).`);
    }
}
if (failed) process.exit(1);
