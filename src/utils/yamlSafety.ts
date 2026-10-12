/**
 * YAML Safety Scanner.
 *
 * Classifies frontmatter as safe, suspicious, or dangerous by detecting:
 * - Broken / unparseable YAML blocks
 * - Code-injection patterns (Templater, Dataview, JS, HTML embeds)
 * - Foreign-plugin field injections
 * - Type mismatches (non-scalar where scalar expected)
 * - Oversized values
 *
 * Pure read-only analysis — NEVER modifies files.
 */
import type { App, TFile, CachedMetadata } from 'obsidian';
import { t } from '../i18n';

// ─── Types ──────────────────────────────────────────────────────────────

export type SafetySeverity = 'warning' | 'danger';
export type SafetyCategory =
    | 'broken_yaml'
    | 'code_injection'
    | 'foreign_plugin'
    | 'type_mismatch'
    | 'oversized_value';

export interface SafetyIssue {
    severity: SafetySeverity;
    category: SafetyCategory;
    /** The frontmatter key that triggered the issue (absent for file-level issues). */
    field?: string;
    message: string;
    /** The matched pattern fragment, for diagnostics. */
    pattern?: string;
}

export type SafetyStatus = 'safe' | 'suspicious' | 'dangerous';

export interface FrontmatterSafetyResult {
    status: SafetyStatus;
    issues: SafetyIssue[];
}

// ─── Constants ──────────────────────────────────────────────────────────

/** Maximum character length for a single frontmatter value before flagging. */
const VALUE_SIZE_SOFT_LIMIT = 5_000;
const VALUE_SIZE_HARD_LIMIT = 20_000;

/** Maximum nesting depth for objects / arrays before flagging. */
const MAX_NESTING_DEPTH = 2;

// ─── Injection pattern regexes ──────────────────────────────────────────

interface InjectionPattern {
    regex: RegExp;
    label: string;
    severity: SafetySeverity;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
    // Templater
    { regex: /<%[\s\S]*?%>/, get label() { return t('ui.yamlSafety.templaterSyntax'); }, severity: 'danger' },
    // Dataview inline
    { regex: /`=\s*[^`]/, get label() { return t('ui.yamlSafety.dataviewInlineQuery'); }, severity: 'warning' },
    { regex: /\bdv\.\w+/, get label() { return t('ui.yamlSafety.dataviewJsApiCall'); }, severity: 'warning' },
    // JavaScript execution
    { regex: /\beval\s*\(/, get label() { return t('ui.yamlSafety.dynamicEval'); }, severity: 'danger' },
    { regex: /\bFunction\s*\(/, get label() { return t('ui.yamlSafety.dynamicFunctionConstructor'); }, severity: 'danger' },
    { regex: /\bnew\s+Function\b/, get label() { return t('ui.yamlSafety.dynamicFunctionConstructorNew'); }, severity: 'danger' },
    // Script / HTML embeds
    { regex: /<script[\s>]/i, get label() { return t('ui.yamlSafety.scriptTag'); }, severity: 'danger' },
    { regex: /<iframe[\s>]/i, get label() { return t('ui.yamlSafety.iframeTag'); }, severity: 'danger' },
    { regex: /<object[\s>]/i, get label() { return t('ui.yamlSafety.objectTag'); }, severity: 'danger' },
    { regex: /<embed[\s>]/i, get label() { return t('ui.yamlSafety.embedTag'); }, severity: 'danger' },
    // URI handlers
    { regex: /javascript\s*:/i, get label() { return t('ui.yamlSafety.javascriptUri'); }, severity: 'danger' },
    { regex: /obsidian:\/\//, get label() { return t('ui.yamlSafety.obsidianUri'); }, severity: 'warning' },
    // Event handlers in HTML attributes
    { regex: /\bon\w+\s*=\s*["']/i, get label() { return t('ui.yamlSafety.htmlEventHandler'); }, severity: 'danger' },
];

// ─── Foreign plugin key patterns ────────────────────────────────────────

const FOREIGN_PLUGIN_PREFIXES = [
    'dataview',
    'templater',
    'kanban',
    'excalidraw',
    'tasks',
    'buttons',
    'metabind',
    'quickadd',
];

function isForeignPluginKey(key: string): string | null {
    const lower = key.toLowerCase().replace(/[\s_-]/g, '');
    for (const prefix of FOREIGN_PLUGIN_PREFIXES) {
        if (lower.startsWith(prefix) && lower.length > prefix.length) {
            return prefix;
        }
    }
    return null;
}

// ─── Depth measurement ──────────────────────────────────────────────────

function measureDepth(value: unknown, current = 0): number {
    if (current > MAX_NESTING_DEPTH + 1) return current;
    if (Array.isArray(value)) {
        let max = current;
        for (const item of value) {
            max = Math.max(max, measureDepth(item, current + 1));
        }
        return max;
    }
    if (value !== null && typeof value === 'object') {
        let max = current;
        for (const v of Object.values(value)) {
            max = Math.max(max, measureDepth(v, current + 1));
        }
        return max;
    }
    return current;
}

// ─── Value scanning ─────────────────────────────────────────────────────

function stringifyForScan(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        // JSON.stringify only throws for circular objects and BigInt values.
        return typeof value === 'bigint' ? String(value) : '[unserializable]';
    }
}

// ─── Broken-YAML detection ─────────────────────────────────────────────

/** Regex to detect a YAML frontmatter fence at the start of a file. */
const FM_FENCE_RE = /^---[ \t]*\r?\n/;

/**
 * Check whether a file appears to have a frontmatter block that Obsidian
 * failed to parse (cache has no frontmatter, but the raw text has `---`).
 *
 * This requires reading the raw file and is intentionally separated from
 * the fast cache-based checks so callers can opt in.
 */
export async function detectBrokenYaml(
    app: App,
    file: TFile,
    cache: CachedMetadata | null
): Promise<SafetyIssue | null> {
    if (cache?.frontmatter) return null;

    let content: string;
    try {
        content = await app.vault.read(file);
    } catch {
        return {
            severity: 'danger',
            category: 'broken_yaml',
            message: t('ui.yamlSafety.fileUnreadable'),
        };
    }

    if (!FM_FENCE_RE.test(content)) return null;

    const closingFence = content.indexOf('\n---', 4);
    if (closingFence === -1) {
        return {
            severity: 'danger',
            category: 'broken_yaml',
            message: t('ui.yamlSafety.unterminatedFence'),
        };
    }

    return {
        severity: 'danger',
        category: 'broken_yaml',
        message: t('ui.yamlSafety.unparseableYaml'),
    };
}

// ─── Main scanner ───────────────────────────────────────────────────────

export interface SafetyScanOptions {
    app: App;
    file: TFile;
    cache: CachedMetadata | null;
    /** Known template + dynamic keys — anything outside this set may be foreign. */
    knownKeys?: Set<string>;
    /**
     * When true, reads the raw file to detect broken YAML fences.
     * Slightly slower but catches malformed files that have no cache entry.
     * Default: true.
     */
    checkBrokenYaml?: boolean;
}

/**
 * Scan a single file's frontmatter for safety issues.
 *
 * Fast path: if the file has a valid cache with frontmatter, the scan
 * operates entirely on the cached object (no disk I/O). The slow path
 * (broken-YAML detection) only triggers when the cache is missing
 * frontmatter and `checkBrokenYaml` is true.
 */
export async function scanFrontmatterSafety(
    options: SafetyScanOptions
): Promise<FrontmatterSafetyResult> {
    const { app, file, cache, knownKeys, checkBrokenYaml = true } = options;
    const issues: SafetyIssue[] = [];

    // ── Broken YAML check (slow path) ───────────────────────────────
    if (checkBrokenYaml && (!cache || !cache.frontmatter)) {
        const brokenIssue = await detectBrokenYaml(app, file, cache);
        if (brokenIssue) {
            issues.push(brokenIssue);
            return { status: 'dangerous', issues };
        }
        // No frontmatter at all — nothing more to scan
        return { status: 'safe', issues: [] };
    }

    if (!cache?.frontmatter) {
        return { status: 'safe', issues: [] };
    }

    const fm = cache.frontmatter as Record<string, unknown>;

    for (const [key, value] of Object.entries(fm)) {
        if (key === 'position') continue;

        // ── Foreign plugin keys ─────────────────────────────────────
        if (knownKeys && !knownKeys.has(key)) {
            const plugin = isForeignPluginKey(key);
            if (plugin) {
                issues.push({
                    severity: 'warning',
                    category: 'foreign_plugin',
                    field: key,
                    message: t('ui.yamlSafety.foreignPluginKey', { key, plugin }),
                    pattern: plugin,
                });
            }
        }

        // ── Type mismatch: deeply nested values ─────────────────────
        const depth = measureDepth(value);
        if (depth > MAX_NESTING_DEPTH) {
            issues.push({
                severity: 'warning',
                category: 'type_mismatch',
                field: key,
                message: t('ui.yamlSafety.nestedTooDeep', { key, depth }),
            });
        }

        // ── Oversized values ────────────────────────────────────────
        const strValue = stringifyForScan(value);
        if (strValue.length > VALUE_SIZE_HARD_LIMIT) {
            issues.push({
                severity: 'danger',
                category: 'oversized_value',
                field: key,
                message: t('ui.yamlSafety.valueExceedsLimit', { key, length: strValue.length.toLocaleString(), limit: VALUE_SIZE_HARD_LIMIT.toLocaleString() }),
            });
        } else if (strValue.length > VALUE_SIZE_SOFT_LIMIT) {
            issues.push({
                severity: 'warning',
                category: 'oversized_value',
                field: key,
                message: t('ui.yamlSafety.valueUnusuallyLarge', { key, length: strValue.length.toLocaleString() }),
            });
        }

        // ── Code injection patterns ─────────────────────────────────
        for (const pat of INJECTION_PATTERNS) {
            if (pat.regex.test(strValue)) {
                issues.push({
                    severity: pat.severity,
                    category: 'code_injection',
                    field: key,
                    message: t('ui.yamlSafety.patternDetected', { pattern: pat.label, key }),
                    pattern: pat.label,
                });
            }
        }
    }

    // ── Determine overall status ────────────────────────────────────
    const status = deriveStatus(issues);
    return { status, issues };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function deriveStatus(issues: SafetyIssue[]): SafetyStatus {
    if (issues.length === 0) return 'safe';
    if (issues.some(i => i.severity === 'danger')) return 'dangerous';
    return 'suspicious';
}

/**
 * Build a human-readable summary of safety issues for a single file.
 */
export function formatSafetyIssues(result: FrontmatterSafetyResult): string {
    if (result.issues.length === 0) return t('ui.yamlSafety.noIssues');
    return result.issues
        .map(i => `[${i.severity === 'danger' ? t('ui.yamlSafety.severityDanger') : t('ui.yamlSafety.severityWarning')}] ${i.message}`)
        .join('\n');
}
