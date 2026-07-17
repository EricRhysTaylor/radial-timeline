/**
 * Non-destructive YAML Audit engine.
 *
 * Compares note frontmatter against template-defined base + custom keys
 * and reports schema drift: missing fields, extra keys, and cosmetic order drift.
 * Integrates the safety scanner to flag dangerous / suspicious frontmatter.
 *
 * NEVER modifies files — read-only analysis only.
 */
import type { App, TFile, CachedMetadata } from 'obsidian';
import {
    type NoteType,
    computeCanonicalOrder,
    getBaseKeys,
    getCustomKeys,
    getExcludeKeyPredicate,
} from './yamlTemplateNormalize';
import type { RadialTimelineSettings } from '../types/settings';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from './frontmatter';
import { normalizeBeatSetNameInput, toBeatModelMatchKey } from './beatsInputNormalize';
import { STARTER_BEAT_SETS } from './beatsSystems';
import { findSavedBeatSystem } from './beatSystemState';
import {
    type FrontmatterSafetyResult,
    scanFrontmatterSafety,
} from './yamlSafety';
import { explainScope, resolveBookScopedFiles } from '../services/NoteScopeResolver';
import { readReferenceId } from './sceneIds';
import { getActiveLoadedBeatTab, getLoadedBeatTabWorkspaceSystemId } from '../storyBeats/workspaceState';
import { getSynopsisGenerationWordLimit } from './synopsisLimits';

// ─── Types ──────────────────────────────────────────────────────────────

export interface NoteAuditEntry {
    file: TFile;
    missingFields: string[];
    missingReferenceId: boolean;
    duplicateReferenceId?: string;
    /**
     * Frontmatter keys present in the note that are NOT under Radial Timeline's
     * authority — neither template-defined (canonical) nor RT-known dynamic
     * (Gossamer, scene analysis, repair metadata, legacy aliases). These keys
     * belong to other plugins or to the author. RT reports them for visibility
     * but never offers to delete them; cleanup must be done by hand or by the
     * owning plugin.
     */
    extraKeys: string[];
    orderDrift: boolean;
    semanticWarnings: string[];
    /** Short human-readable reason string (capped length). */
    reason: string;
    /** Safety scan result — present when `includeSafetyScan` is true. */
    safetyResult?: FrontmatterSafetyResult;
}

export interface YamlAuditSummary {
    totalNotes: number;
    /** Notes whose cache was unavailable (recently created / not yet indexed). */
    unreadNotes: number;
    notesWithMissing: number;
    notesMissingIds: number;
    notesDuplicateIds: number;
    notesWithExtra: number;
    /** Only counted when missingFields.length === 0 for a note. */
    notesWithDrift: number;
    notesWithWarnings: number;
    clean: number;
    /** Notes flagged as dangerous by the safety scanner. */
    notesUnsafe: number;
    /** Notes flagged as suspicious (warning-level issues, no danger). */
    notesSuspicious: number;
}

export interface YamlAuditResult {
    notes: NoteAuditEntry[];
    /** Files that had no metadata cache entry — not counted as clean. */
    unreadFiles: TFile[];
    summary: YamlAuditSummary;
    /** Per-file safety results — present when `includeSafetyScan` was true. */
    safetyResults?: Map<TFile, FrontmatterSafetyResult>;
}

export interface SemanticWarningGroup {
    label: string;
    entries: NoteAuditEntry[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Cap a reason string to a maximum length, appending "…" when truncated. */
function capReason(text: string, maxLen = 80): string {
    return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '…';
}

const BEAT_PURPOSE_SOFT_MAX_WORDS = 75;
const BACKDROP_SCENE_TITLE_MAX_MATCHES = 3;
const SYNOPSIS_LENGTH_WARNING = 'Synopsis length above target';
const PURPOSE_LENGTH_WARNING = 'Purpose length above target';

function getStringField(fm: Record<string, unknown>, key: string): string | undefined {
    const value = fm[key];
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function countWords(value: string): number {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized ? normalized.split(' ').length : 0;
}

function stripSceneNumberPrefix(title: string): string {
    return title.replace(/^\d+(?:\.\d+)?\s+/, '').trim();
}

function hasCanonicalPulseUpdateKey(frontmatter: Record<string, unknown>): boolean {
    return Object.keys(frontmatter).some((key) => (
        key.toLowerCase().replace(/[\s_-]/g, '') === 'pulseupdate'
    ));
}

function hasCanonicalSummaryUpdateKey(frontmatter: Record<string, unknown>): boolean {
    return Object.keys(frontmatter).some((key) => (
        key.toLowerCase().replace(/[\s_-]/g, '') === 'summaryupdate'
    ));
}

function collectSceneTitleIndex(app: App, settings: RadialTimelineSettings): string[] {
    const mappings = getActiveFrontmatterMappings(settings);
    const titles = new Set<string>();

    const scopedScenes = resolveBookScopedFiles({ app, settings, noteType: 'Scene' }).files;
    for (const file of scopedScenes) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) continue;
        const fm = mappings ? normalizeFrontmatterKeys(cache.frontmatter, mappings) : cache.frontmatter;
        if (fm.Class !== 'Scene') continue;

        const candidates = [file.basename, stripSceneNumberPrefix(file.basename)];
        if (typeof fm.Title === 'string' && fm.Title.trim().length > 0) {
            candidates.push(fm.Title.trim());
        }

        for (const raw of candidates) {
            const normalized = raw.trim().toLowerCase();
            if (normalized.length >= 8) titles.add(normalized);
        }
    }

    return [...titles];
}

export function getSemanticWarningType(warning: string): string {
    const [head] = warning.split(':', 1);
    return (head || warning).replace(/\.$/, '').trim();
}

export function groupSemanticWarningEntries(entries: NoteAuditEntry[]): SemanticWarningGroup[] {
    const groups = new Map<string, NoteAuditEntry[]>();
    for (const entry of entries) {
        const labelsForEntry = new Set<string>();
        for (const warning of entry.semanticWarnings) {
            const label = getSemanticWarningType(warning);
            if (labelsForEntry.has(label)) continue;
            labelsForEntry.add(label);
            const group = groups.get(label) ?? [];
            group.push(entry);
            groups.set(label, group);
        }
    }
    return [...groups.entries()].map(([label, groupedEntries]) => ({
        label,
        entries: groupedEntries,
    }));
}

export function formatSemanticWarningChipText(group: SemanticWarningGroup): string {
    const count = group.entries.length;
    return `${count} warning${count !== 1 ? 's' : ''}: ${group.label}.`;
}

export function formatSemanticWarningReason(warnings: string[]): string {
    if (warnings.length === 0) return 'Warnings';
    const parts = warnings.map((warning) => {
        const type = getSemanticWarningType(warning);
        const wordMatch = warning.match(/:\s*(\d+)\s+words?/i);
        if (type === SYNOPSIS_LENGTH_WARNING && wordMatch) {
            return `Synopsis Warnings: ${wordMatch[1]} words`;
        }
        if (type === PURPOSE_LENGTH_WARNING && wordMatch) {
            return `Purpose Warnings: ${wordMatch[1]} words`;
        }
        return type;
    });
    return [...new Set(parts)].join('; ');
}

function buildSemanticWarnings(
    noteType: NoteType,
    fm: Record<string, unknown>,
    sceneTitleIndex: string[],
    settings: RadialTimelineSettings
): string[] {
    const warnings: string[] = [];

    if (noteType === 'Scene') {
        const synopsis = getStringField(fm, 'Synopsis');
        if (synopsis) {
            const wordCount = countWords(synopsis);
            const targetWords = getSynopsisGenerationWordLimit(settings);
            if (wordCount > targetWords) {
                warnings.push(`${SYNOPSIS_LENGTH_WARNING}: ${wordCount} words (target ${targetWords} words).`);
            }
        }
        return warnings;
    }

    if (noteType === 'Beat') {
        const purpose = getStringField(fm, 'Purpose') ?? getStringField(fm, 'Description');
        if (getStringField(fm, 'Description') && !getStringField(fm, 'Purpose')) {
            warnings.push('Legacy Description key: migrate to Purpose.');
        }
        if (purpose) {
            const purposeWords = countWords(purpose);
            if (purposeWords > BEAT_PURPOSE_SOFT_MAX_WORDS) {
                warnings.push(`${PURPOSE_LENGTH_WARNING}: ${purposeWords} words (target ${BEAT_PURPOSE_SOFT_MAX_WORDS} words).`);
            }
        }
        return warnings;
    }

    if (noteType === 'Backdrop') {
        const context = getStringField(fm, 'Context') ?? getStringField(fm, 'Synopsis');
        if (getStringField(fm, 'Synopsis') && !getStringField(fm, 'Context')) {
            warnings.push('Legacy Synopsis key: migrate to Context.');
        }
        if (context && sceneTitleIndex.length > 0) {
            const lower = context.toLowerCase();
            const matched: string[] = [];
            for (const sceneTitle of sceneTitleIndex) {
                if (lower.includes(sceneTitle)) {
                    matched.push(sceneTitle);
                    if (matched.length >= BACKDROP_SCENE_TITLE_MAX_MATCHES) break;
                }
            }
            if (matched.length > 0) {
                warnings.push(`Backdrop Context references scene titles: ${matched.join(', ')}.`);
            }
        }
        return warnings;
    }

    return warnings;
}

/**
 * Determine whether the order of `presentKeys` (as they appear in the note)
 * matches the subsequence they would occupy in `canonicalOrder`.
 *
 * Keys not in `canonicalOrder` are ignored (they are "extra" keys).
 * Only called when `missingFields` is empty.
 */
function hasOrderDrift(presentKeys: string[], canonicalOrder: string[]): boolean {
    // Build the subsequence of canonicalOrder that intersects with presentKeys
    const canonicalSet = new Set(presentKeys);
    const expected = canonicalOrder.filter(k => canonicalSet.has(k));

    // Compare actual vs expected
    const actual = presentKeys.filter(k => canonicalOrder.includes(k));
    if (actual.length !== expected.length) return true;
    for (let i = 0; i < actual.length; i++) {
        if (actual[i] !== expected[i]) return true;
    }
    return false;
}

// ─── Main audit function ────────────────────────────────────────────────

export interface YamlAuditOptions {
    app: App;
    settings: RadialTimelineSettings;
    noteType: NoteType;
    files: TFile[];
    /** Beat system key override (only relevant when noteType === 'Beat'). */
    beatSystemKey?: string;
    /**
     * When true, runs the safety scanner on each file and attaches results
     * to `NoteAuditEntry.safetyResult`. Makes the audit async and slightly
     * slower (broken-YAML detection reads raw files for cache-less notes).
     * Default: false (preserves original fast synchronous behaviour).
     */
    includeSafetyScan?: boolean;
}

/**
 * Run a non-destructive audit against all supplied files.
 *
 * Uses `metadataCache.getFileCache()` for speed. If a file has no cache
 * entry (stale or not yet indexed), it is counted as "unread" — never
 * mislabelled as clean.
 *
 * When `includeSafetyScan` is true the function becomes async and
 * attaches a `FrontmatterSafetyResult` to every audit entry. The
 * safety results map is also returned at the top level so the UI
 * can pass it to delete / reorder operations without re-scanning.
 */
export async function runYamlAudit(options: YamlAuditOptions): Promise<YamlAuditResult> {
    const { app, settings, noteType, files, beatSystemKey, includeSafetyScan = false } = options;

    const baseKeys = getBaseKeys(noteType, settings);
    const customKeys = getCustomKeys(noteType, settings, beatSystemKey);
    let canonicalOrder = computeCanonicalOrder(noteType, settings, beatSystemKey);
    const allTemplateKeys = new Set([...baseKeys, ...customKeys]);
    const excludeKey = getExcludeKeyPredicate(noteType, settings);
    const aiEnabled = settings.enableAiSceneAnalysis ?? true;
    const sceneAiSchemaKeys = new Set([
        'Pulse Update',
        'Summary Update',
        'previousSceneAnalysis',
        'currentSceneAnalysis',
        'nextSceneAnalysis',
    ]);
    // AI off: the AI schema keys are TOLERATED, not required and not extra.
    // Dropping them from allTemplateKeys stops the audit demanding them, but a
    // scene that already carries them (template-seeded, or from a past AI run)
    // must stay clean — flagging them "extra" would route every such scene into
    // the repair flow and invite deleting the author's existing analysis.
    if (noteType === 'Scene' && !aiEnabled) {
        for (const key of sceneAiSchemaKeys) {
            allTemplateKeys.delete(key);
        }
        canonicalOrder = canonicalOrder.filter((key) => !sceneAiSchemaKeys.has(key));
    }
    const isToleratedAiKey = (key: string): boolean =>
        noteType === 'Scene' && !aiEnabled && sceneAiSchemaKeys.has(key);

    const mappings = getActiveFrontmatterMappings(settings);
    const sceneTitleIndex = noteType === 'Backdrop' ? collectSceneTitleIndex(app, settings) : [];

    // Build the known-key set for the safety scanner (template + dynamic keys).
    // AI keys stay known even when AI is off — they are RT-owned schema.
    const knownKeysForSafety = new Set<string>([...allTemplateKeys]);
    if (noteType === 'Scene') {
        for (const key of sceneAiSchemaKeys) knownKeysForSafety.add(key);
    }
    // Add common Obsidian-internal keys
    for (const k of ['position', 'cssclasses', 'tags', 'aliases']) knownKeysForSafety.add(k);

    type AuditedNoteRecord = {
        file: TFile;
        missingFields: string[];
        missingReferenceId: boolean;
        referenceId?: string;
        extraKeys: string[];
        orderDrift: boolean;
        semanticWarnings: string[];
        safetyResult?: FrontmatterSafetyResult;
    };

    const auditedNotes: AuditedNoteRecord[] = [];
    const notes: NoteAuditEntry[] = [];
    const unreadFiles: TFile[] = [];
    const safetyResultsMap = includeSafetyScan
        ? new Map<TFile, FrontmatterSafetyResult>()
        : undefined;

    for (const file of files) {
        const cache: CachedMetadata | null = app.metadataCache.getFileCache(file);

        // ── Safety scan (when enabled) ──────────────────────────────
        let safetyResult: FrontmatterSafetyResult | undefined;
        if (includeSafetyScan) {
            safetyResult = await scanFrontmatterSafety({
                app,
                file,
                cache,
                knownKeys: knownKeysForSafety,
                checkBrokenYaml: true,
            });
            safetyResultsMap!.set(file, safetyResult);
        }

        // Stale-cache guard: if no cache entry at all, skip as unread
        if (!cache || !cache.frontmatter) {
            unreadFiles.push(file);
            continue;
        }

        const rawFm = cache.frontmatter;
        const fm = mappings ? normalizeFrontmatterKeys(rawFm, mappings) : rawFm;

        // Get the keys actually present in the note's frontmatter
        const noteKeys = Object.keys(fm).filter(k => k !== 'position'); // Obsidian injects 'position'

        // Missing: template keys not present in note
        const missingFields = [...allTemplateKeys].filter(k => !noteKeys.includes(k));
        // For Scene notes, legacy aliases like "Beats Update" are deprecated and
        // should not satisfy the canonical "Pulse Update" schema key.
        if (noteType === 'Scene' && aiEnabled && !hasCanonicalPulseUpdateKey(rawFm) && !missingFields.includes('Pulse Update')) {
            missingFields.push('Pulse Update');
        }
        if (noteType === 'Scene' && aiEnabled && !hasCanonicalSummaryUpdateKey(rawFm) && !missingFields.includes('Summary Update')) {
            missingFields.push('Summary Update');
        }
        // Check both raw and normalized frontmatter so user-defined key mappings
        // cannot accidentally hide an existing system reference id.
        const referenceId = readReferenceId(rawFm) ?? readReferenceId(fm);
        const missingReferenceId = !referenceId;

        // Extra: note keys not in any template and not excluded. Tolerated AI
        // keys (AI off) are never extra — see the tolerance note above.
        const extraKeys = noteKeys.filter(k =>
            !allTemplateKeys.has(k) && !excludeKey(k) && !isToleratedAiKey(k)
        );

        // Order drift: only evaluated when no fields are missing
        const orderDrift = missingFields.length === 0
            ? hasOrderDrift(noteKeys, canonicalOrder)
            : false;
        const semanticWarnings = buildSemanticWarnings(noteType, fm, sceneTitleIndex, settings);

        auditedNotes.push({
            file,
            missingFields,
            missingReferenceId,
            referenceId,
            extraKeys,
            orderDrift,
            semanticWarnings,
            safetyResult,
        });
    }

    const idIndex = new Map<string, AuditedNoteRecord[]>();
    for (const record of auditedNotes) {
        if (!record.referenceId) continue;
        const entries = idIndex.get(record.referenceId) ?? [];
        entries.push(record);
        idIndex.set(record.referenceId, entries);
    }
    const duplicateIds = new Set<string>();
    for (const [id, entries] of idIndex.entries()) {
        if (entries.length > 1) duplicateIds.add(id);
    }

    for (const record of auditedNotes) {
        const duplicateReferenceId = record.referenceId && duplicateIds.has(record.referenceId)
            ? record.referenceId
            : undefined;

        // Build concise reason string
        const reasons: string[] = [];
        if (record.missingFields.length > 0) {
            reasons.push(`missing: ${record.missingFields.join(', ')}`);
        }
        if (record.missingReferenceId) {
            reasons.push('missing reference id');
        }
        if (duplicateReferenceId) {
            reasons.push(`duplicate reference id: ${duplicateReferenceId}`);
        }
        if (record.extraKeys.length > 0) {
            reasons.push(`extra: ${record.extraKeys.join(', ')}`);
        }
        if (record.orderDrift) {
            reasons.push('field order differs from template');
        }
        if (record.semanticWarnings.length > 0) {
            reasons.push(`warnings: ${record.semanticWarnings.join(' | ')}`);
        }
        if (record.safetyResult && record.safetyResult.status !== 'safe') {
            const label = record.safetyResult.status === 'dangerous' ? 'UNSAFE' : 'review';
            reasons.push(`safety: ${label} (${record.safetyResult.issues.length} issue${record.safetyResult.issues.length !== 1 ? 's' : ''})`);
        }

        const hasSchemaIssues = record.missingFields.length > 0
            || record.missingReferenceId
            || !!duplicateReferenceId
            || record.extraKeys.length > 0
            || record.orderDrift
            || record.semanticWarnings.length > 0;
        const hasSafetyIssues = record.safetyResult && record.safetyResult.status !== 'safe';

        if (!hasSchemaIssues && !hasSafetyIssues) {
            continue;
        }

        notes.push({
            file: record.file,
            missingFields: record.missingFields,
            missingReferenceId: record.missingReferenceId,
            duplicateReferenceId,
            extraKeys: record.extraKeys,
            orderDrift: record.orderDrift,
            semanticWarnings: record.semanticWarnings,
            reason: capReason(reasons.join(' | ')),
            safetyResult: record.safetyResult,
        });
    }

    const notesWithMissing = notes.filter(n => n.missingFields.length > 0).length;
    const notesMissingIds = notes.filter(n => n.missingReferenceId).length;
    const notesDuplicateIds = notes.filter(n => !!n.duplicateReferenceId).length;
    const notesWithExtra = notes.filter(n => n.extraKeys.length > 0).length;
    const notesWithDrift = notes.filter(n => n.orderDrift).length;
    const notesWithWarnings = notes.filter(n => n.semanticWarnings.length > 0).length;
    const notesUnsafe = notes.filter(n => n.safetyResult?.status === 'dangerous').length;
    const notesSuspicious = notes.filter(n => n.safetyResult?.status === 'suspicious').length;

    return {
        notes,
        unreadFiles,
        summary: {
            totalNotes: files.length,
            unreadNotes: unreadFiles.length,
            notesWithMissing,
            notesMissingIds,
            notesDuplicateIds,
            notesWithExtra,
            notesWithDrift,
            notesWithWarnings,
            clean: files.length - notes.length - unreadFiles.length,
            notesUnsafe,
            notesSuspicious,
        },
        safetyResults: safetyResultsMap,
    };
}

// ─── File collection helpers ────────────────────────────────────────────

/**
 * Collect vault files matching a note type, scoped to the active book folder.
 * Uses metadataCache for fast classification (no file I/O).
 */
export function collectFilesForAudit(
    app: App,
    noteType: NoteType,
    settings: RadialTimelineSettings,
    beatSystemKey?: string
): TFile[] {
    return collectFilesForAuditWithScope(app, noteType, settings, beatSystemKey).files;
}

export interface AuditScopeResult {
    files: TFile[];
    sourcePath: string;
    bookTitle: string;
    scopeSummary: string;
    reason?: string;
}

export function collectFilesForAuditWithScope(
    app: App,
    noteType: NoteType,
    settings: RadialTimelineSettings,
    beatSystemKey?: string
): AuditScopeResult {
    const scoped = resolveBookScopedFiles({ app, settings, noteType });
    const files = scoped.files;
    const mappings = getActiveFrontmatterMappings(settings);

    // Resolve Beat Model name for custom systems.
    // beatSystemKey may be in internal format 'custom:<id>' but frontmatter stores
    // the human-readable system name (e.g. 'Custom beats').
    let beatModelFilter: string | undefined;
    if (beatSystemKey && noteType === 'Beat') {
        if (beatSystemKey.startsWith('custom:')) {
            const customId = beatSystemKey.slice('custom:'.length);
            // Resolve name from saved sets, starter sets, or the active loaded workspace tab.
            const saved = findSavedBeatSystem(settings, customId);
            const starter = STARTER_BEAT_SETS.find(s => s.id === customId);
            const activeTab = getActiveLoadedBeatTab(settings);
            const activeName = activeTab && getLoadedBeatTabWorkspaceSystemId(activeTab) === customId
                ? activeTab.name
                : undefined;
            beatModelFilter = normalizeBeatSetNameInput(
                saved?.name ?? starter?.name ?? activeName ?? '',
                'Custom'
            );
        } else {
            beatModelFilter = normalizeBeatSetNameInput(beatSystemKey, '');
        }
    }

    const filteredFiles = files.filter(file => {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) return false;
        const fm = mappings
            ? normalizeFrontmatterKeys(cache.frontmatter, mappings)
            : cache.frontmatter;

        switch (noteType) {
            case 'Scene':
                return fm.Class === 'Scene';
            case 'Beat':
                if (fm.Class !== 'Beat' && fm.Class !== 'Plot') return false;
                if (beatModelFilter) {
                    const model = fm['Beat Model'];
                    return toBeatModelMatchKey(String(model ?? '')) === toBeatModelMatchKey(beatModelFilter);
                }
                return true;
            case 'Backdrop':
                return fm.Class === 'Backdrop';
            default:
                return false;
        }
    });

    return {
        files: filteredFiles,
        sourcePath: scoped.sourcePath,
        bookTitle: scoped.bookTitle,
        scopeSummary: explainScope(filteredFiles, { noteType, bookTitle: scoped.bookTitle }),
        reason: scoped.reason
    };
}

// ─── Report formatting ──────────────────────────────────────────────────

/**
 * Format audit results as a plain-text report for clipboard / support.
 */
export function formatAuditReport(result: YamlAuditResult, noteType: NoteType): string {
    const lines: string[] = [];
    const s = result.summary;

    lines.push(`${noteType} Properties Report`);
    lines.push(`${'─'.repeat(48)}`);
    lines.push(`Total notes:     ${s.totalNotes}`);
    lines.push(`Clean:           ${s.clean}`);
    lines.push(`Missing fields:  ${s.notesWithMissing} note(s)`);
    lines.push(`Missing IDs:     ${s.notesMissingIds} note(s)`);
    lines.push(`Duplicate IDs:   ${s.notesDuplicateIds} note(s)`);
    lines.push(`Extra keys:      ${s.notesWithExtra} note(s)`);
    lines.push(`Order drift:     ${s.notesWithDrift} note(s)`);
    lines.push(`Warnings:        ${s.notesWithWarnings} note(s)`);
    if (s.notesUnsafe > 0) {
        lines.push(`Unsafe:          ${s.notesUnsafe} note(s)`);
    }
    if (s.notesSuspicious > 0) {
        lines.push(`Suspicious:      ${s.notesSuspicious} note(s)`);
    }
    if (s.unreadNotes > 0) {
        lines.push(`Unread (stale):  ${s.unreadNotes} note(s)`);
    }
    lines.push('');

    if (result.notes.length > 0) {
        lines.push('Details:');
        for (const entry of result.notes) {
            lines.push(`  ${entry.file.basename}  —  ${entry.reason}`);
            if (entry.semanticWarnings.length > 0) {
                lines.push(`    warnings: ${entry.semanticWarnings.join(' | ')}`);
            }
            if (entry.safetyResult && entry.safetyResult.status !== 'safe') {
                for (const issue of entry.safetyResult.issues) {
                    lines.push(`    [${issue.severity.toUpperCase()}] ${issue.message}`);
                }
            }
        }
    }

    if (result.unreadFiles.length > 0) {
        lines.push('');
        lines.push('Unread (no cache):');
        for (const f of result.unreadFiles) {
            lines.push(`  ${f.basename}`);
        }
    }

    return lines.join('\n');
}
