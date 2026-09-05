/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * InquiryCorpusService — owns corpus computation, override state, and cached payload stats.
 *
 * ⚠️ GUARDRAIL: Not a shadow view-model.
 * Owns: corpus computation, override maps, cached payload stats.
 * Does NOT own: corpusWarningActive, preview/selection state, DOM selection state,
 * CC strip rendering state, or anything tied to current rendering mode.
 *
 * Instantiated per view (not singleton) because override state is per-view.
 */

import type { InquiryScope } from '../state';
import type { InquiryClassConfig, InquirySourcesSettings, SceneInclusion } from '../../types/settings';
import type { CorpusManifestEntry } from '../runner/types';
import {
    buildCorpusSelectionKey,
    parseCorpusSelectionKey
} from './corpusSelectionKeys';
import { normalizeInquiryBookInclusion } from './bookResolution';
import { normalizeScanRootPatterns } from '../utils/scanRoots';
import { normalizeFrontmatterKeys } from '../../utils/frontmatter';
import type { InquiryResult } from '../state';

// ── Constants ─────────────────────────────────────────────────────────

const SYNOPSIS_CAPABLE_CLASSES = new Set(['scene', 'outline']);

// ── Pure helpers (exported for testing) ───────────────────────────────

export function isSynopsisCapableClass(className: string): boolean {
    return SYNOPSIS_CAPABLE_CLASSES.has(className.toLowerCase());
}

export function getDefaultMaterialMode(className: string): SceneInclusion {
    if (className === 'scene') return 'summary';
    return 'full';
}

export function normalizeEvidenceMode(mode?: SceneInclusion): SceneInclusion {
    if (mode === 'full') return 'full';
    if (mode === 'summary') return 'summary';
    return 'excluded';
}

export function isModeActive(mode?: SceneInclusion): boolean {
    return normalizeEvidenceMode(mode) !== 'excluded';
}

export function normalizeContributionMode(mode: SceneInclusion, className: string): SceneInclusion {
    if (mode === 'summary' && !isSynopsisCapableClass(className)) {
        return 'full';
    }
    return mode;
}

export function normalizeMaterialMode(value: unknown, className: string): SceneInclusion {
    let normalized: SceneInclusion = 'excluded';
    if (typeof value === 'string') {
        const raw = value.trim().toLowerCase();
        if (raw === 'digest') normalized = 'summary';
        if (raw === 'excluded' || raw === 'summary' || raw === 'full') {
            normalized = raw;
        }
    }
    if (typeof value === 'boolean') {
        normalized = value ? getDefaultMaterialMode(className) : 'excluded';
    }
    return normalizeContributionMode(normalized, className);
}

export function resolveContributionMode(config: InquiryClassConfig): SceneInclusion {
    const modes: SceneInclusion[] = [config.bookScope, config.sagaScope, config.referenceScope];
    return modes.reduce((best, mode) => {
        const rank = { excluded: 0, summary: 1, full: 2 };
        return rank[mode] > rank[best] ? mode : best;
    }, 'excluded' as SceneInclusion);
}

export function normalizeClassContribution(config: InquiryClassConfig): InquiryClassConfig {
    const isReference = !isSynopsisCapableClass(config.className);
    const contribution = normalizeContributionMode(resolveContributionMode(config), config.className);
    const bookActive = !isReference && config.bookScope !== 'excluded';
    const sagaActive = !isReference && config.sagaScope !== 'excluded';
    const referenceActive = isReference && config.referenceScope !== 'excluded';
    return {
        ...config,
        bookScope: isReference ? 'excluded' : (bookActive ? contribution : 'excluded'),
        sagaScope: isReference ? 'excluded' : (sagaActive ? contribution : 'excluded'),
        referenceScope: isReference ? (referenceActive ? contribution : 'excluded') : 'excluded'
    };
}

export function hashString(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return `h${Math.abs(hash)}`;
}

export function getCorpusGroupKey(className: string, scope?: InquiryScope): string {
    if (className === 'outline' && scope === 'saga') return 'outline-saga';
    return className;
}

export function getCorpusGroupBaseClass(className: string): string {
    return className === 'outline-saga' ? 'outline' : className;
}

export function getCorpusItemKey(className: string, filePath: string, scope?: InquiryScope, sceneId?: string): string {
    return buildCorpusSelectionKey({
        className,
        filePath,
        scope,
        sceneId
    });
}

export function parseCorpusItemKey(entryKey: string): { className: string; scope?: InquiryScope; path: string; sceneId?: string } {
    const parsed = parseCorpusSelectionKey(entryKey);
    return {
        className: parsed.className,
        scope: parsed.scope,
        path: parsed.path ?? '',
        sceneId: parsed.sceneId
    };
}

export function getCorpusCycleModes(_className: string): SceneInclusion[] {
    return ['excluded', 'summary', 'full'];
}

export function getNextCorpusMode(current: SceneInclusion, modes: SceneInclusion[]): SceneInclusion {
    const index = modes.indexOf(current);
    if (index === -1) return modes[0] ?? 'excluded';
    return modes[(index + 1) % modes.length] ?? 'excluded';
}

export function getClassScopeConfig(raw?: string[]): { allowAll: boolean; allowed: Set<string> } {
    const list = (raw || []).map(entry => entry.trim().toLowerCase()).filter(Boolean);
    const allowAll = list.includes('/');
    const allowed = new Set(list.filter(entry => entry !== '/'));
    return { allowAll, allowed };
}

export function extractClassValues(frontmatter: Record<string, unknown>): string[] {
    const rawClass = frontmatter['Class'];
    const values = Array.isArray(rawClass) ? rawClass : rawClass ? [rawClass] : [];
    return values
        .map(value => (typeof value === 'string' ? value : String(value)).trim())
        .filter(Boolean)
        .map(value => value.toLowerCase());
}

export function getFrontmatterScope(
    frontmatter: Record<string, unknown>,
    frontmatterMappings?: Record<string, string>
): InquiryScope | undefined {
    const normalizedFrontmatter = normalizeFrontmatterKeys(frontmatter, frontmatterMappings);
    const keys = Object.keys(normalizedFrontmatter);
    const scopeKey = keys.find(key => key.toLowerCase() === 'scope');
    if (!scopeKey) return undefined;
    const value = normalizedFrontmatter[scopeKey];
    if (typeof value !== 'string') return undefined;
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === 'book' || normalizedValue === 'saga') {
        return normalizedValue;
    }
    return undefined;
}

export function normalizeInquirySources(raw?: InquirySourcesSettings): InquirySourcesSettings {
    if (!raw) {
        return { scanRoots: [], bookInclusion: {}, classes: [], classCounts: {}, resolvedScanRoots: [] };
    }
    return {
        preset: raw.preset,
        scanRoots: raw.scanRoots && raw.scanRoots.length ? normalizeScanRootPatterns(raw.scanRoots) : [],
        bookInclusion: normalizeInquiryBookInclusion(raw.bookInclusion),
        classScope: raw.classScope ? raw.classScope.map(value => value.trim().toLowerCase()).filter(Boolean) : [],
        classes: (raw.classes || []).filter(config => !config.className.startsWith('/')).map(config => normalizeClassContribution({
            className: config.className.toLowerCase(),
            enabled: !!config.enabled,
            bookScope: normalizeMaterialMode(config.bookScope, config.className.toLowerCase()),
            sagaScope: normalizeMaterialMode(config.sagaScope, config.className.toLowerCase()),
            referenceScope: normalizeMaterialMode(
                (config).referenceScope
                ?? (!isSynopsisCapableClass(config.className.toLowerCase()) ? true : false),
                config.className.toLowerCase()
            )
        })),
        classCounts: raw.classCounts || {},
        resolvedScanRoots: raw.resolvedScanRoots ? normalizeScanRootPatterns(raw.resolvedScanRoots) : [],
        lastScanAt: raw.lastScanAt
    };
}

export function getCorpusGroupKeys(
    sources: InquirySourcesSettings,
    fallbackEntries?: Array<{ className: string }>
): string[] {
    const classScope = getClassScopeConfig(sources.classScope);
    const keys: string[] = [];
    const addKey = (key: string) => {
        if (!keys.includes(key)) keys.push(key);
    };
    (sources.classes || []).forEach(config => {
        if (!config.enabled) return;
        if (!classScope.allowAll && !classScope.allowed.has(config.className)) return;
        if (config.className === 'outline') {
            addKey('outline');
            addKey('outline-saga');
            return;
        }
        addKey(config.className);
    });
    (fallbackEntries || []).forEach(entry => {
        addKey(entry.className);
    });
    return keys;
}

// ── Override summary type ─────────────────────────────────────────────

export interface CorpusOverrideSummary {
    active: boolean;
    classCount: number;
    itemCount: number;
    total: number;
}

// ── InquiryCorpusService class ────────────────────────────────────────

export class InquiryCorpusService {
    private corpusClassOverrides = new Map<string, SceneInclusion>();
    private corpusItemOverrides = new Map<string, SceneInclusion>();

    // ── Override accessors ────────────────────────────────────────────

    hasOverrides(): boolean {
        return this.corpusClassOverrides.size > 0 || this.corpusItemOverrides.size > 0;
    }

    getOverrideSummary(): CorpusOverrideSummary {
        const classCount = this.corpusClassOverrides.size;
        const itemCount = this.corpusItemOverrides.size;
        return {
            active: classCount > 0 || itemCount > 0,
            classCount,
            itemCount,
            total: classCount + itemCount
        };
    }

    applyOverrideSummary(result: InquiryResult): InquiryResult {
        const summary = this.getOverrideSummary();
        result.corpusOverridesActive = summary.active;
        result.corpusOverrideSummary = {
            classCount: summary.classCount,
            itemCount: summary.itemCount,
            total: summary.total
        };
        return result;
    }

    // ── Override mutations ────────────────────────────────────────────

    /** Clear all overrides. UI state (corpusWarningActive) stays in InquiryView. */
    resetOverrides(): void {
        this.corpusClassOverrides.clear();
        this.corpusItemOverrides.clear();
    }

    getClassOverride(groupKey: string): SceneInclusion | undefined {
        return this.corpusClassOverrides.get(groupKey);
    }

    setClassOverride(groupKey: string, mode: SceneInclusion): void {
        this.corpusClassOverrides.set(groupKey, mode);
    }

    deleteClassOverride(groupKey: string): void {
        this.corpusClassOverrides.delete(groupKey);
    }

    getItemOverride(
        className: string,
        filePath: string,
        scope?: InquiryScope,
        sceneId?: string
    ): SceneInclusion | undefined {
        const key = getCorpusItemKey(className, filePath, scope, sceneId);
        return this.corpusItemOverrides.get(key);
    }

    setItemOverride(
        className: string,
        filePath: string,
        mode: SceneInclusion,
        scope?: InquiryScope,
        sceneId?: string
    ): void {
        const key = getCorpusItemKey(className, filePath, scope, sceneId);
        this.corpusItemOverrides.set(key, mode);
    }

    deleteItemOverride(
        className: string,
        filePath: string,
        scope?: InquiryScope,
        sceneId?: string
    ): void {
        const key = getCorpusItemKey(className, filePath, scope, sceneId);
        this.corpusItemOverrides.delete(key);
    }

    clearItemOverridesForGroup(groupKey: string): void {
        Array.from(this.corpusItemOverrides.keys()).forEach(key => {
            const parsed = parseCorpusItemKey(key);
            if (getCorpusGroupKey(parsed.className, parsed.scope) === groupKey) {
                this.corpusItemOverrides.delete(key);
            }
        });
    }

    // ── Key-based accessors (for pre-built entryKey strings) ──────────

    getItemOverrideByKey(key: string): SceneInclusion | undefined {
        return this.corpusItemOverrides.get(key);
    }

    setItemOverrideByKey(key: string, mode: SceneInclusion): void {
        this.corpusItemOverrides.set(key, mode);
    }

    deleteItemOverrideByKey(key: string): void {
        this.corpusItemOverrides.delete(key);
    }

    /** Total number of item overrides. */
    get itemOverrideCount(): number {
        return this.corpusItemOverrides.size;
    }

    /** Total number of class overrides. */
    get classOverrideCount(): number {
        return this.corpusClassOverrides.size;
    }

    // ── Effective mode queries ────────────────────────────────────────

    /**
     * Compute the base mode for a corpus group from config, ignoring overrides.
     * @param scope Current inquiry scope (from view state, not stored here).
     * @param fallbackEntries CC entries for classes not in config (e.g. from ccEntries).
     */
    getGroupBaseMode(
        groupKey: string,
        configMap: Map<string, InquiryClassConfig>,
        scope: InquiryScope,
        fallbackEntries?: Array<{ className: string; mode: SceneInclusion }>
    ): SceneInclusion {
        const baseClass = getCorpusGroupBaseClass(groupKey);
        const config = configMap.get(baseClass);
        if (!config) {
            const fallback = (fallbackEntries || []).find(entry => entry.className === groupKey);
            if (fallback) {
                return normalizeContributionMode(fallback.mode ?? 'excluded', baseClass);
            }
            return 'excluded';
        }
        if (!config.enabled) return 'excluded';
        if (baseClass === 'outline') {
            const scopeMode = groupKey === 'outline-saga' ? config.sagaScope : config.bookScope;
            return normalizeContributionMode(scopeMode, baseClass);
        }
        if (!isSynopsisCapableClass(baseClass)) {
            return normalizeContributionMode(config.referenceScope, baseClass);
        }
        const scopeMode = scope === 'saga' ? config.sagaScope : config.bookScope;
        return normalizeContributionMode(scopeMode, baseClass);
    }

    /** Effective mode for a corpus group (base + class override). */
    getGroupEffectiveMode(
        groupKey: string,
        configMap: Map<string, InquiryClassConfig>,
        scope: InquiryScope,
        fallbackEntries?: Array<{ className: string; mode: SceneInclusion }>
    ): SceneInclusion {
        const baseClass = getCorpusGroupBaseClass(groupKey);
        const baseMode = this.getGroupBaseMode(groupKey, configMap, scope, fallbackEntries);
        const override = this.corpusClassOverrides.get(groupKey);
        const effective = override ?? baseMode;
        return normalizeContributionMode(effective, baseClass);
    }

    /** Effective mode for a specific corpus item (base + class override + item override). */
    getItemEffectiveMode(
        entry: CorpusManifestEntry,
        configMap: Map<string, InquiryClassConfig>,
        scope: InquiryScope,
        fallbackEntries?: Array<{ className: string; mode: SceneInclusion }>
    ): SceneInclusion {
        const groupKey = getCorpusGroupKey(entry.class, entry.scope);
        const baseClass = getCorpusGroupBaseClass(groupKey);
        const baseMode = this.getGroupBaseMode(groupKey, configMap, scope, fallbackEntries);
        const classOverride = this.corpusClassOverrides.get(groupKey);
        const itemOverride = this.getItemOverride(entry.class, entry.path, entry.scope, entry.sceneId);
        const effective = itemOverride ?? classOverride ?? baseMode;
        return normalizeContributionMode(effective, baseClass);
    }

    /** Global mode across all groups (excluded / summary / full / mixed). */
    getGlobalMode(
        groupKeys: string[],
        configMap: Map<string, InquiryClassConfig>,
        scope: InquiryScope,
        fallbackEntries?: Array<{ className: string; mode: SceneInclusion }>
    ): SceneInclusion | 'mixed' {
        if (!groupKeys.length) return 'excluded';
        const groupModes = groupKeys.map(key => this.getGroupEffectiveMode(key, configMap, scope, fallbackEntries));
        const allExcluded = groupModes.every(mode => mode === 'excluded');
        if (allExcluded) return 'excluded';
        const allFull = groupModes.every(mode => mode === 'full');
        if (allFull) return 'full';

        const synopsisKeys = groupKeys.filter(key => isSynopsisCapableClass(getCorpusGroupBaseClass(key)));
        const nonSynopsisKeys = groupKeys.filter(key => !isSynopsisCapableClass(getCorpusGroupBaseClass(key)));
        const synopsisAllSummary = synopsisKeys.length > 0
            && synopsisKeys.every(key => this.getGroupEffectiveMode(key, configMap, scope, fallbackEntries) === 'summary');
        const nonSynopsisAllFull = nonSynopsisKeys.length === 0
            || nonSynopsisKeys.every(key => this.getGroupEffectiveMode(key, configMap, scope, fallbackEntries) === 'full');
        if (synopsisAllSummary && nonSynopsisAllFull) return 'summary';
        return 'mixed';
    }
}
