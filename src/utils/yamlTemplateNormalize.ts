/**
 * Shared YAML template parsing utilities — single source of truth.
 *
 * All template resolution for Scene / Beat / Backdrop flows through
 * `getTemplateParts()` and `getMergedTemplate()`.  Every creation path,
 * audit, backfill, delete, and reorder operation MUST use these functions
 * so that the canonical field order is consistent everywhere.
 */
import { parseYaml } from 'obsidian';
import type { RadialTimelineSettings } from '../types/settings';
import { getBeatConfigForSystem, normalizeBeatBaseTemplateOrder, sanitizeBeatAdvancedForWrite } from './beatsTemplates';
import { mergeTemplateParts, removeTemplateFields, splitTemplateFields, templateFieldKey } from './templateMerge';
import { withOptionalManagedKeys } from './optionalManagedKeys';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { t } from '../i18n';

// ─── Types ──────────────────────────────────────────────────────────────

export type FieldEntryValue = string | string[];

export type NoteType = 'Scene' | 'Beat' | 'Backdrop';

const TOTAL_TIME_KEY = 'Total Time';

// ─── Low-level parsers ──────────────────────────────────────────────────

function sanitizeTemplatePlaceholdersForYamlParse(template: string): string {
    return (template || '')
        .split('\n')
        .filter(line => !/^\s*{{[^{}\n]+}}\s*$/.test(line))
        // A value already in quotes parses as it is; quoting it again would break it.
        .map(line => /(?::|-)\s+["']/.test(line) ? line : line.replace(/{{[^{}\n]+}}/g, match => JSON.stringify(match)))
        .join('\n');
}

function normalizeParsedTemplateScalar(value: unknown): string {
    return String(value).replace(/^['"]({{[^{}\n]+}})['"]$/, '$1');
}

/** The keys a template defines, in the order they appear. */
export function extractKeysInOrder(template: string): string[] {
    const keys: string[] = [];
    for (const line of (template || '').split('\n')) {
        const key = templateFieldKey(line);
        if (key !== null && !keys.includes(key)) keys.push(key);
    }
    return keys;
}

/**
 * Parse a YAML template into a flat key → value record. Arrays stay `string[]`;
 * everything else becomes `string`; empty values become `''`. Fields parse one
 * at a time, so a single malformed value cannot blank the others.
 */
export function safeParseYaml(template: string): Record<string, FieldEntryValue> {
    const entries: Record<string, FieldEntryValue> = {};
    for (const field of splitTemplateFields(template)) {
        let parsed: unknown;
        try {
            parsed = parseYaml(sanitizeTemplatePlaceholdersForYamlParse(field.lines));
        } catch {
            entries[field.key] = '';
            continue;
        }
        const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[field.key] : undefined;
        if (Array.isArray(value)) entries[field.key] = value.map(item => normalizeParsedTemplateScalar(item));
        else entries[field.key] = value === undefined || value === null ? '' : normalizeParsedTemplateScalar(value);
    }
    return entries;
}

/**
 * Merge two ordered key lists, preserving the relative order of each.
 * Primary keys appear first; secondary keys that aren't already present
 * are appended in their original order.
 */
export function mergeOrders(primary: string[], secondary: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    [...primary, ...secondary].forEach(key => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    });
    return result;
}

// ─── Reserved keys ──────────────────────────────────────────────────────

/** Obsidian-internal keys injected into the metadata cache — never user-editable. */
export const RESERVED_OBSIDIAN_KEYS = new Set(['position', 'cssclasses', 'tags', 'aliases']);

// ─── Template parts — single source of truth ───────────────────────────

/** Resolved template strings for a note type. */
export interface TemplateParts {
    /** Raw base template string (placeholders intact). */
    base: string;
    /** Raw advanced template string (placeholders intact, empty if none). */
    advanced: string;
    /** Fully merged template string (base + advanced, via canonical template merge helper). */
    merged: string;
}

/**
 * Resolve the base, advanced, and merged template strings for a note type.
 *
 * This is the **single source of truth** for template resolution.
 * Every creation path, audit, backfill, delete, and reorder operation
 * MUST use this (or its wrapper `getMergedTemplate`) so that the
 * canonical field order is consistent everywhere.
 */
export function getTemplateParts(
    noteType: NoteType,
    settings: RadialTimelineSettings,
    beatSystemKey?: string
): TemplateParts {
    switch (noteType) {
        case 'Scene': {
            const base = settings.sceneYamlTemplates?.base
                ?? DEFAULT_SETTINGS.sceneYamlTemplates!.base;
            const advanced = removeTemplateFields(
                settings.sceneYamlTemplates?.advanced
                ?? DEFAULT_SETTINGS.sceneYamlTemplates!.advanced,
                ['Chapter']
            );
            const merged = advanced.trim()
                ? mergeTemplateParts(base, advanced)
                : base;
            return { base, advanced, merged };
        }
        case 'Beat': {
            const configuredBase = settings.beatYamlTemplates?.base
                ?? DEFAULT_SETTINGS.beatYamlTemplates!.base;
            const base = normalizeBeatBaseTemplateOrder(configuredBase)
                .replace(/^Beat Id\s*:\s*.*$/gim, '')
                .replace(/^Description:/gm, 'Purpose:')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            const config = getBeatConfigForSystem(settings, beatSystemKey);
            const advanced = removeTemplateFields(sanitizeBeatAdvancedForWrite(config.beatYamlAdvanced), ['Chapter']);
            const merged = advanced.trim()
                ? mergeTemplateParts(base, advanced)
                : base;
            return { base, advanced, merged };
        }
        case 'Backdrop': {
            const templates = settings.backdropYamlTemplates
                ?? DEFAULT_SETTINGS.backdropYamlTemplates;
            const base = templates?.base
                ?? 'Class: Backdrop\nWhen:\nEnd:\nContext:';
            const advancedRaw = templates?.advanced ?? '';
            // Filter legacy Synopsis key from advanced writes.
            const advanced = removeTemplateFields(advancedRaw, ['Chapter', 'Synopsis']);
            const merged = advanced.trim()
                ? mergeTemplateParts(base, advanced)
                : base;
            return { base, advanced, merged };
        }
    }
}

/**
 * Return the fully merged template string for a note type.
 * Convenience wrapper around `getTemplateParts().merged`.
 */
export function getMergedTemplate(
    noteType: NoteType,
    settings: RadialTimelineSettings,
    beatSystemKey?: string
): string {
    return getTemplateParts(noteType, settings, beatSystemKey).merged;
}

/** The scene template the current settings apply: Core, plus Advanced when enabled. */
export function getSceneTemplate(
    settings: RadialTimelineSettings,
    advanced: boolean = settings.sceneAdvancedPropertiesEnabled ?? true
): string {
    const parts = getTemplateParts('Scene', settings);
    return advanced ? parts.merged : parts.base;
}

/** Which scene property sets a note receives, for the drop and promotion dialogs. */
export function scenePropertySetLabel(settings: RadialTimelineSettings): string {
    const core = t('ui.scenePropertiesSection.coreName');
    return (settings.sceneAdvancedPropertiesEnabled ?? true)
        ? `${core} + ${t('ui.scenePropertiesSection.advancedName')}`
        : core;
}

/**
 * Bring stored scene templates up to the current layout, once, when settings
 * load. Total Time became a Core property: an older vault gets it where a new
 * vault has it, carrying over any default the author set in Advanced. Every
 * other field is left exactly as stored.
 */
export function migrateSceneTemplates(stored: { base?: string; advanced?: string }): { base: string; advanced: string } {
    const base = stored.base?.trim() ? stored.base : DEFAULT_SETTINGS.sceneYamlTemplates!.base;
    const storedAdvanced = stored.advanced ?? '';
    const movedTime = splitTemplateFields(storedAdvanced).find(field => field.key.toLowerCase() === TOTAL_TIME_KEY.toLowerCase());
    const advanced = movedTime ? removeTemplateFields(storedAdvanced, [movedTime.key]) : storedAdvanced;
    const movedLines = movedTime?.lines.replace(/^[^:]*:/, `${TOTAL_TIME_KEY}:`);

    const fields = splitTemplateFields(base);
    const existing = fields.find(field => field.key.toLowerCase() === TOTAL_TIME_KEY.toLowerCase());
    if (existing) {
        const blank = !existing.lines.replace(/^[^:]*:/, '').replace(/#.*$/, '').trim();
        if (blank && movedLines) existing.lines = movedLines;
    } else {
        const wordsIndex = fields.findIndex(field => field.key === 'Words');
        const pulseIndex = fields.findIndex(field => field.key === 'Pulse Update');
        const position = wordsIndex >= 0 ? wordsIndex + 1 : pulseIndex >= 0 ? pulseIndex : fields.length;
        const lines = movedLines ?? `${TOTAL_TIME_KEY}:`;
        fields.splice(position, 0, { key: TOTAL_TIME_KEY, lines, rest: lines.slice(TOTAL_TIME_KEY.length) });
    }
    return { base: fields.map(field => field.lines).join('\n'), advanced };
}

// ─── High-level per-note-type helpers ───────────────────────────────────

/**
 * Return the base template keys for a given note type.
 */
export function getBaseKeys(noteType: NoteType, settings: RadialTimelineSettings): string[] {
    const baseKeys = extractKeysInOrder(getTemplateParts(noteType, settings).base);
    // System-managed scene update flags should always exist in schema, even if
    // a customized base template accidentally removed them.
    if (noteType === 'Scene') {
        if (!baseKeys.includes('Pulse Update')) {
            baseKeys.push('Pulse Update');
        }
        if (!baseKeys.includes('Summary Update')) {
            baseKeys.push('Summary Update');
        }
    }
    return baseKeys;
}

/**
 * Return the custom/advanced template keys for a given note type,
 * filtering out any base keys.
 */
export function getCustomKeys(
    noteType: NoteType,
    settings: RadialTimelineSettings,
    beatSystemKey?: string
): string[] {
    const parts = getTemplateParts(noteType, settings, beatSystemKey);
    const baseKeys = extractKeysInOrder(parts.base);
    const advKeys = extractKeysInOrder(parts.advanced);
    return advKeys.filter(k => !baseKeys.includes(k));
}

/**
 * Compute the canonical key order for a note type.
 *
 * Delegates to `getTemplateParts().merged` so the order mirrors the
 * exact merged template that note-creation paths produce.
 */
export function computeCanonicalOrder(
    noteType: NoteType,
    settings: RadialTimelineSettings,
    beatSystemKey?: string
): string[] {
    const mergedOrder = extractKeysInOrder(
        getTemplateParts(noteType, settings, beatSystemKey).merged
    );
    // Reference ID is system-managed and always canonical-first for note types
    // that use IDs (Scene, Beat, Backdrop).
    const result: string[] = ['ID'];
    const seen = new Set<string>(['id']);
    for (const key of mergedOrder) {
        const lower = key.toLowerCase();
        if (seen.has(lower)) continue;
        result.push(key);
        seen.add(lower);
    }
    if (noteType === 'Scene') {
        for (const sceneKey of ['Pulse Update', 'Summary Update']) {
            const lower = sceneKey.toLowerCase();
            if (!seen.has(lower)) {
                result.push(sceneKey);
                seen.add(lower);
            }
        }
    }
    // Optional-managed keys are RT-owned schema that ships in no template, so the
    // merged-template walk above cannot see them. They still need a canonical
    // position: reorder places only keys a note actually carries, so this is
    // inert for the notes that lack them and authoritative for the ones that
    // don't. See `optionalManagedKeys.ts`.
    return withOptionalManagedKeys(noteType, result);
}

/**
 * Compute default values for all custom (advanced) template keys.
 * Values are derived from the parsed advanced template.
 * `undefined` / `null` are normalized to `''` to prevent `key: null` writes.
 */
export function getCustomDefaults(
    noteType: NoteType,
    settings: RadialTimelineSettings,
    beatSystemKey?: string
): Record<string, FieldEntryValue> {
    const parts = getTemplateParts(noteType, settings, beatSystemKey);
    const customKeys = extractKeysInOrder(parts.advanced).filter(
        k => !extractKeysInOrder(parts.base).includes(k)
    );

    const parsed = safeParseYaml(parts.advanced);
    const defaults: Record<string, FieldEntryValue> = {};
    for (const key of customKeys) {
        const val = parsed[key];
        defaults[key] = val ?? '';
    }
    return defaults;
}

// ─── Exclude-key predicates ─────────────────────────────────────────────

/**
 * Returns a predicate that identifies "known dynamic" keys for a note type —
 * keys that may appear in frontmatter but are NOT part of the base or custom
 * template and should NOT be reported as "extra" by the audit.
 *
 * Example: Gossamer score fields on beats (Gossamer1, Gossamer2, GossamerStage1, …)
 */
export function getExcludeKeyPredicate(
    noteType: NoteType,
    settings?: Pick<RadialTimelineSettings, 'enableAiSceneAnalysis'>
): (key: string) => boolean {
    switch (noteType) {
        case 'Beat':
            return (key: string) => {
                // System-managed reference id; never flag as extra
                if (key.toLowerCase() === 'id') return true;
                // All Gossamer-injected fields: Gossamer1, GossamerStage1,
                // GossamerSignal1, Gossamer1 Justification, Gossamer Last Updated, etc.
                if (/^Gossamer/i.test(key)) return true;
                // Legacy base field (removed from template but may exist in older notes)
                if (key === 'When') return true;
                // Legacy narrative field — RT-managed; migrated to Purpose via the
                // dedicated "Migrate deprecated fields" action.
                if (key === 'Description') return true;
                // Obsidian-internal keys
                if (RESERVED_OBSIDIAN_KEYS.has(key)) return true;
                return false;
            };
        case 'Scene':
            return (key: string) => {
                // System-managed reference id; never flag as extra
                if (key.toLowerCase() === 'id') return true;
                const legacyNarrativeKey = 'long' + 'form';
                const aiEnabled = settings?.enableAiSceneAnalysis ?? true;
                // Scene analysis dynamic fields
                if (aiEnabled && /^(previous|current|next)SceneAnalysis$/i.test(key)) return true;
                // Legacy analysis fields
                if (/^[123]beats$/i.test(key)) return true;
                // Legacy narrative field
                if (key === legacyNarrativeKey) return true;
                // Repair metadata
                if (['WhenSource', 'WhenConfidence', 'DurationSource', 'NeedsReview'].includes(key)) return true;
                // Legacy narration field (renamed Narration): still read as the
                // scene's narration override, migrated by the POV → Narration alert.
                if (key === 'POV') return true;
                // Obsidian-internal keys
                if (RESERVED_OBSIDIAN_KEYS.has(key)) return true;
                return false;
            };
        case 'Backdrop':
            return (key: string) => {
                // System-managed reference id; never flag as extra
                if (key.toLowerCase() === 'id') return true;
                // Legacy backdrop narrative field (renamed to Context)
                if (key === 'Synopsis') return true;
                // Obsidian-internal keys
                if (RESERVED_OBSIDIAN_KEYS.has(key)) return true;
                return false;
            };
    }
}
