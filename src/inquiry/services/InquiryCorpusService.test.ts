/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneInclusion, InquiryClassConfig } from '../../types/settings';
import type { CorpusManifestEntry } from '../runner/types';
import {
    InquiryCorpusService,
    isSynopsisCapableClass,
    getDefaultMaterialMode,
    normalizeEvidenceMode,
    isModeActive,
    normalizeContributionMode,
    normalizeMaterialMode,
    resolveContributionMode,
    normalizeClassContribution,
    hashString,
    getCorpusGroupKey,
    getCorpusGroupBaseClass,
    getCorpusItemKey,
    parseCorpusItemKey,
    getCorpusCycleModes,
    getNextCorpusMode,
    getClassScopeConfig,
    extractClassValues,
    getCorpusGroupKeys
} from './InquiryCorpusService';

// ── Fixtures ─────────────────────────────────────────────────────────

function makeClassConfig(overrides: Partial<InquiryClassConfig> & { className: string }): InquiryClassConfig {
    return {
        enabled: true,
        bookScope: 'full',
        sagaScope: 'full',
        referenceScope: 'excluded',
        ...overrides
    };
}

function makeEntry(overrides: Partial<CorpusManifestEntry> & { path: string; class: string }): CorpusManifestEntry {
    return { mtime: Date.now(), ...overrides } as CorpusManifestEntry;
}

// ── Pure helpers ─────────────────────────────────────────────────────

describe('isSynopsisCapableClass', () => {
    it('returns true for scene and outline', () => {
        expect(isSynopsisCapableClass('scene')).toBe(true);
        expect(isSynopsisCapableClass('outline')).toBe(true);
        expect(isSynopsisCapableClass('Scene')).toBe(true);
    });

    it('returns false for non-synopsis classes', () => {
        expect(isSynopsisCapableClass('character')).toBe(false);
        expect(isSynopsisCapableClass('place')).toBe(false);
        expect(isSynopsisCapableClass('power')).toBe(false);
    });
});

describe('getDefaultMaterialMode', () => {
    it('returns summary for scene, full for others', () => {
        expect(getDefaultMaterialMode('scene')).toBe('summary');
        expect(getDefaultMaterialMode('outline')).toBe('full');
        expect(getDefaultMaterialMode('character')).toBe('full');
    });
});

describe('normalizeEvidenceMode', () => {
    it('normalizes full and summary', () => {
        expect(normalizeEvidenceMode('full')).toBe('full');
        expect(normalizeEvidenceMode('summary')).toBe('summary');
    });

    it('returns none for undefined or none', () => {
        expect(normalizeEvidenceMode(undefined)).toBe('excluded');
        expect(normalizeEvidenceMode('excluded')).toBe('excluded');
    });
});

describe('isModeActive', () => {
    it('returns true for full and summary', () => {
        expect(isModeActive('full')).toBe(true);
        expect(isModeActive('summary')).toBe(true);
    });

    it('returns false for none and undefined', () => {
        expect(isModeActive('excluded')).toBe(false);
        expect(isModeActive(undefined)).toBe(false);
    });
});

describe('normalizeContributionMode', () => {
    it('keeps summary for synopsis-capable classes', () => {
        expect(normalizeContributionMode('summary', 'scene')).toBe('summary');
        expect(normalizeContributionMode('summary', 'outline')).toBe('summary');
    });

    it('upgrades summary to full for non-synopsis classes', () => {
        expect(normalizeContributionMode('summary', 'character')).toBe('full');
        expect(normalizeContributionMode('summary', 'place')).toBe('full');
    });

    it('passes through full and none unchanged', () => {
        expect(normalizeContributionMode('full', 'character')).toBe('full');
        expect(normalizeContributionMode('excluded', 'scene')).toBe('excluded');
    });
});

describe('normalizeMaterialMode', () => {
    it('normalizes string values', () => {
        expect(normalizeMaterialMode('full', 'scene')).toBe('full');
        expect(normalizeMaterialMode('summary', 'scene')).toBe('summary');
        expect(normalizeMaterialMode('excluded', 'scene')).toBe('excluded');
    });

    it('normalizes digest to summary', () => {
        expect(normalizeMaterialMode('digest', 'scene')).toBe('summary');
    });

    it('normalizes boolean values', () => {
        expect(normalizeMaterialMode(true, 'scene')).toBe('summary');
        expect(normalizeMaterialMode(true, 'character')).toBe('full');
        expect(normalizeMaterialMode(false, 'scene')).toBe('excluded');
    });

    it('returns none for unknown values', () => {
        expect(normalizeMaterialMode(42, 'scene')).toBe('excluded');
        expect(normalizeMaterialMode(null, 'scene')).toBe('excluded');
    });
});

describe('resolveContributionMode', () => {
    it('returns the highest-ranked mode', () => {
        expect(resolveContributionMode(makeClassConfig({ className: 'scene', bookScope: 'full', sagaScope: 'excluded', referenceScope: 'excluded' }))).toBe('full');
        expect(resolveContributionMode(makeClassConfig({ className: 'scene', bookScope: 'summary', sagaScope: 'excluded', referenceScope: 'excluded' }))).toBe('summary');
        expect(resolveContributionMode(makeClassConfig({ className: 'scene', bookScope: 'excluded', sagaScope: 'excluded', referenceScope: 'excluded' }))).toBe('excluded');
    });
});

describe('normalizeClassContribution', () => {
    it('normalizes reference class to use referenceScope only', () => {
        const result = normalizeClassContribution(makeClassConfig({
            className: 'character',
            bookScope: 'full',
            sagaScope: 'full',
            referenceScope: 'full'
        }));
        expect(result.bookScope).toBe('excluded');
        expect(result.sagaScope).toBe('excluded');
        expect(result.referenceScope).toBe('full');
    });

    it('normalizes synopsis-capable class to use book/saga scopes', () => {
        const result = normalizeClassContribution(makeClassConfig({
            className: 'scene',
            bookScope: 'full',
            sagaScope: 'summary',
            referenceScope: 'excluded'
        }));
        expect(result.bookScope).toBe('full');
        expect(result.sagaScope).toBe('full');
        expect(result.referenceScope).toBe('excluded');
    });
});

describe('hashString', () => {
    it('returns deterministic hash', () => {
        const h1 = hashString('hello');
        const h2 = hashString('hello');
        expect(h1).toBe(h2);
    });

    it('returns different hashes for different strings', () => {
        expect(hashString('hello')).not.toBe(hashString('world'));
    });

    it('starts with h prefix', () => {
        expect(hashString('test')).toMatch(/^h\d+$/);
    });
});

describe('getCorpusGroupKey', () => {
    it('returns outline-saga for outline with saga scope', () => {
        expect(getCorpusGroupKey('outline', 'saga')).toBe('outline-saga');
    });

    it('returns class name for other cases', () => {
        expect(getCorpusGroupKey('scene')).toBe('scene');
        expect(getCorpusGroupKey('outline', 'book')).toBe('outline');
        expect(getCorpusGroupKey('character')).toBe('character');
    });
});

describe('getCorpusGroupBaseClass', () => {
    it('maps outline-saga back to outline', () => {
        expect(getCorpusGroupBaseClass('outline-saga')).toBe('outline');
    });

    it('passes through other class names', () => {
        expect(getCorpusGroupBaseClass('scene')).toBe('scene');
        expect(getCorpusGroupBaseClass('character')).toBe('character');
    });
});

describe('parseCorpusItemKey', () => {
    it('round-trips scene key with sceneId (path not preserved)', () => {
        // Scene keys with sceneId use sceneId-based format; path is not stored.
        const key = getCorpusItemKey('scene', '/path/to/file.md', 'book', 'scn_123');
        const parsed = parseCorpusItemKey(key);
        expect(parsed.className).toBe('scene');
        expect(parsed.sceneId).toBe('scn_123');
        // path is empty because scene+sceneId keys don't encode the path
        expect(parsed.path).toBe('');
    });

    it('round-trips non-scene key with path', () => {
        const key = getCorpusItemKey('character', '/notes/hero.md', 'book');
        const parsed = parseCorpusItemKey(key);
        expect(parsed.className).toBe('character');
        expect(parsed.path).toBe('/notes/hero.md');
        expect(parsed.sceneId).toBeUndefined();
    });
});

describe('getCorpusCycleModes', () => {
    it('returns none, summary, full', () => {
        expect(getCorpusCycleModes('scene')).toEqual(['excluded', 'summary', 'full']);
        expect(getCorpusCycleModes('character')).toEqual(['excluded', 'summary', 'full']);
    });
});

describe('getNextCorpusMode', () => {
    const modes: SceneInclusion[] = ['excluded', 'summary', 'full'];

    it('cycles through modes', () => {
        expect(getNextCorpusMode('excluded', modes)).toBe('summary');
        expect(getNextCorpusMode('summary', modes)).toBe('full');
        expect(getNextCorpusMode('full', modes)).toBe('excluded');
    });

    it('returns first mode for unknown current', () => {
        expect(getNextCorpusMode('unknown' as SceneInclusion, modes)).toBe('excluded');
    });
});

describe('getClassScopeConfig', () => {
    it('returns allowAll when / is present', () => {
        const result = getClassScopeConfig(['/']);
        expect(result.allowAll).toBe(true);
    });

    it('returns specific allowed classes', () => {
        const result = getClassScopeConfig(['scene', 'character']);
        expect(result.allowAll).toBe(false);
        expect(result.allowed.has('scene')).toBe(true);
        expect(result.allowed.has('character')).toBe(true);
    });

    it('handles undefined input', () => {
        const result = getClassScopeConfig(undefined);
        expect(result.allowAll).toBe(false);
        expect(result.allowed.size).toBe(0);
    });
});

describe('extractClassValues', () => {
    it('extracts string class values', () => {
        expect(extractClassValues({ Class: 'Scene' })).toEqual(['scene']);
    });

    it('extracts array class values', () => {
        expect(extractClassValues({ Class: ['Scene', 'Outline'] })).toEqual(['scene', 'outline']);
    });

    it('returns empty for missing Class', () => {
        expect(extractClassValues({})).toEqual([]);
    });
});

describe('getCorpusGroupKeys', () => {
    it('returns keys from sources classes', () => {
        const sources = {
            scanRoots: [],
            bookInclusion: {},
            classes: [makeClassConfig({ className: 'scene' })],
            classCounts: {},
            resolvedScanRoots: [],
            classScope: ['/']
        };
        const keys = getCorpusGroupKeys(sources);
        expect(keys).toContain('scene');
    });

    it('expands outline to both outline and outline-saga', () => {
        const sources = {
            scanRoots: [],
            bookInclusion: {},
            classes: [makeClassConfig({ className: 'outline' })],
            classCounts: {},
            resolvedScanRoots: [],
            classScope: ['/']
        };
        const keys = getCorpusGroupKeys(sources);
        expect(keys).toContain('outline');
        expect(keys).toContain('outline-saga');
    });

    it('includes fallback entries', () => {
        const sources = {
            scanRoots: [],
            bookInclusion: {},
            classes: [],
            classCounts: {},
            resolvedScanRoots: [],
            classScope: ['/']
        };
        const keys = getCorpusGroupKeys(sources, [{ className: 'custom' }]);
        expect(keys).toContain('custom');
    });
});

// ── InquiryCorpusService — Override management ───────────────────────

describe('InquiryCorpusService', () => {
    let service: InquiryCorpusService;

    beforeEach(() => {
        service = new InquiryCorpusService();
    });

    describe('override management', () => {
        it('starts with no overrides', () => {
            expect(service.hasOverrides()).toBe(false);
            expect(service.classOverrideCount).toBe(0);
            expect(service.itemOverrideCount).toBe(0);
        });

        it('tracks class overrides', () => {
            service.setClassOverride('scene', 'full');
            expect(service.hasOverrides()).toBe(true);
            expect(service.getClassOverride('scene')).toBe('full');
            expect(service.classOverrideCount).toBe(1);
        });

        it('deletes class overrides', () => {
            service.setClassOverride('scene', 'full');
            service.deleteClassOverride('scene');
            expect(service.getClassOverride('scene')).toBeUndefined();
            expect(service.classOverrideCount).toBe(0);
        });

        it('tracks item overrides', () => {
            service.setItemOverride('scene', '/file.md', 'summary');
            expect(service.hasOverrides()).toBe(true);
            expect(service.getItemOverride('scene', '/file.md')).toBe('summary');
            expect(service.itemOverrideCount).toBe(1);
        });

        it('deletes item overrides', () => {
            service.setItemOverride('scene', '/file.md', 'summary');
            service.deleteItemOverride('scene', '/file.md');
            expect(service.getItemOverride('scene', '/file.md')).toBeUndefined();
        });

        it('resets all overrides', () => {
            service.setClassOverride('scene', 'full');
            service.setItemOverride('scene', '/file.md', 'summary');
            service.resetOverrides();
            expect(service.hasOverrides()).toBe(false);
            expect(service.classOverrideCount).toBe(0);
            expect(service.itemOverrideCount).toBe(0);
        });

        it('clears item overrides for group', () => {
            service.setItemOverride('scene', '/a.md', 'full');
            service.setItemOverride('scene', '/b.md', 'summary');
            service.setItemOverride('character', '/c.md', 'full');
            service.clearItemOverridesForGroup('scene');
            expect(service.getItemOverride('scene', '/a.md')).toBeUndefined();
            expect(service.getItemOverride('scene', '/b.md')).toBeUndefined();
            expect(service.getItemOverride('character', '/c.md')).toBe('full');
        });

        it('key-based accessors work', () => {
            const key = getCorpusItemKey('scene', '/file.md');
            service.setItemOverrideByKey(key, 'full');
            expect(service.getItemOverrideByKey(key)).toBe('full');
            service.deleteItemOverrideByKey(key);
            expect(service.getItemOverrideByKey(key)).toBeUndefined();
        });
    });

    describe('getOverrideSummary', () => {
        it('returns zero counts when empty', () => {
            const summary = service.getOverrideSummary();
            expect(summary.active).toBe(false);
            expect(summary.classCount).toBe(0);
            expect(summary.itemCount).toBe(0);
            expect(summary.total).toBe(0);
        });

        it('returns correct counts', () => {
            service.setClassOverride('scene', 'full');
            service.setItemOverride('scene', '/a.md', 'summary');
            service.setItemOverride('scene', '/b.md', 'full');
            const summary = service.getOverrideSummary();
            expect(summary.active).toBe(true);
            expect(summary.classCount).toBe(1);
            expect(summary.itemCount).toBe(2);
            expect(summary.total).toBe(3);
        });
    });

    // ── Effective mode queries ────────────────────────────────────────

    describe('getGroupBaseMode', () => {
        it('returns none when no config and no fallback', () => {
            const configMap = new Map<string, InquiryClassConfig>();
            expect(service.getGroupBaseMode('scene', configMap, 'book')).toBe('excluded');
        });

        it('returns none for disabled config', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', enabled: false })]]);
            expect(service.getGroupBaseMode('scene', configMap, 'book')).toBe('excluded');
        });

        it('returns bookScope for book scope on scene', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', bookScope: 'summary', sagaScope: 'full' })]]);
            expect(service.getGroupBaseMode('scene', configMap, 'book')).toBe('summary');
        });

        it('returns sagaScope for saga scope on scene', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', bookScope: 'summary', sagaScope: 'full' })]]);
            expect(service.getGroupBaseMode('scene', configMap, 'saga')).toBe('full');
        });

        it('returns referenceScope for non-synopsis class', () => {
            const configMap = new Map([['character', makeClassConfig({ className: 'character', referenceScope: 'full' })]]);
            expect(service.getGroupBaseMode('character', configMap, 'book')).toBe('full');
        });

        it('returns bookScope for outline with book scope', () => {
            const configMap = new Map([['outline', makeClassConfig({ className: 'outline', bookScope: 'summary', sagaScope: 'full' })]]);
            expect(service.getGroupBaseMode('outline', configMap, 'book')).toBe('summary');
        });

        it('returns sagaScope for outline-saga', () => {
            const configMap = new Map([['outline', makeClassConfig({ className: 'outline', bookScope: 'summary', sagaScope: 'full' })]]);
            expect(service.getGroupBaseMode('outline-saga', configMap, 'book')).toBe('full');
        });

        it('uses fallback entries when no config', () => {
            const configMap = new Map<string, InquiryClassConfig>();
            const fallback = [{ className: 'scene', mode: 'summary' as SceneInclusion }];
            expect(service.getGroupBaseMode('scene', configMap, 'book', fallback)).toBe('summary');
        });
    });

    describe('getGroupEffectiveMode', () => {
        it('returns base mode when no override', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', bookScope: 'summary' })]]);
            expect(service.getGroupEffectiveMode('scene', configMap, 'book')).toBe('summary');
        });

        it('returns override when set', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', bookScope: 'summary' })]]);
            service.setClassOverride('scene', 'full');
            expect(service.getGroupEffectiveMode('scene', configMap, 'book')).toBe('full');
        });

        it('normalizes contribution mode for non-synopsis class', () => {
            const configMap = new Map([['character', makeClassConfig({ className: 'character', referenceScope: 'full' })]]);
            service.setClassOverride('character', 'summary');
            // summary gets upgraded to full for non-synopsis classes
            expect(service.getGroupEffectiveMode('character', configMap, 'book')).toBe('full');
        });
    });

    describe('getItemEffectiveMode', () => {
        it('returns base mode when no overrides', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', bookScope: 'summary' })]]);
            const entry = makeEntry({ path: '/file.md', class: 'scene' });
            expect(service.getItemEffectiveMode(entry, configMap, 'book')).toBe('summary');
        });

        it('prefers item override over class override', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', bookScope: 'summary' })]]);
            const entry = makeEntry({ path: '/file.md', class: 'scene' });
            service.setClassOverride('scene', 'excluded');
            service.setItemOverride('scene', '/file.md', 'full');
            expect(service.getItemEffectiveMode(entry, configMap, 'book')).toBe('full');
        });

        it('falls back to class override when no item override', () => {
            const configMap = new Map([['scene', makeClassConfig({ className: 'scene', bookScope: 'summary' })]]);
            const entry = makeEntry({ path: '/file.md', class: 'scene' });
            service.setClassOverride('scene', 'full');
            expect(service.getItemEffectiveMode(entry, configMap, 'book')).toBe('full');
        });
    });

    describe('getGlobalMode', () => {
        it('returns none for empty group keys', () => {
            const configMap = new Map<string, InquiryClassConfig>();
            expect(service.getGlobalMode([], configMap, 'book')).toBe('excluded');
        });

        it('returns none when all groups are none', () => {
            const configMap = new Map([
                ['scene', makeClassConfig({ className: 'scene', enabled: false })],
                ['character', makeClassConfig({ className: 'character', enabled: false })]
            ]);
            expect(service.getGlobalMode(['scene', 'character'], configMap, 'book')).toBe('excluded');
        });

        it('returns full when all groups are full', () => {
            const configMap = new Map([
                ['scene', makeClassConfig({ className: 'scene', bookScope: 'full' })],
                ['character', makeClassConfig({ className: 'character', referenceScope: 'full' })]
            ]);
            expect(service.getGlobalMode(['scene', 'character'], configMap, 'book')).toBe('full');
        });

        it('returns summary when synopsis groups are summary and non-synopsis are full', () => {
            const configMap = new Map([
                ['scene', makeClassConfig({ className: 'scene', bookScope: 'summary' })],
                ['character', makeClassConfig({ className: 'character', referenceScope: 'full' })]
            ]);
            expect(service.getGlobalMode(['scene', 'character'], configMap, 'book')).toBe('summary');
        });

        it('returns mixed for inconsistent modes', () => {
            const configMap = new Map([
                ['scene', makeClassConfig({ className: 'scene', bookScope: 'full' })],
                ['character', makeClassConfig({ className: 'character', enabled: false })]
            ]);
            expect(service.getGlobalMode(['scene', 'character'], configMap, 'book')).toBe('mixed');
        });
    });
});
