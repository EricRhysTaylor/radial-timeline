import { describe, expect, it } from 'vitest';
import {
    asBackdropFrontmatter,
    asBeatFrontmatter,
    BACKDROP_CONTEXT_KEYS,
    BEAT_PURPOSE_KEYS,
    extractSummary,
    getActiveFrontmatterMappings,
    getSupportedFrontmatterRemapTargets,
    normalizeBeatFrontmatterKeys,
    normalizeFrontmatterKeys,
    readBackdropContext,
    readBeatPurpose,
} from './frontmatter';

describe('normalizeBeatFrontmatterKeys', () => {
    it('maps legacy beat description directly to canonical Purpose', () => {
        const normalized = normalizeBeatFrontmatterKeys({
            Class: 'Beat',
            Description: 'Legacy purpose'
        });

        expect(normalized.Purpose).toBe('Legacy purpose');
        expect('Description' in normalized).toBe(false);
    });
});

describe('scene core frontmatter remaps', () => {
    it('derives supported remap targets from the canonical scene base schema', () => {
        const targets = getSupportedFrontmatterRemapTargets();

        expect(targets).toContain('Class');
        expect(targets).toContain('When');
        expect(targets).toContain('Summary');
        expect(targets).not.toContain('Iteration');
        expect(targets).not.toContain('Place');
    });

    it('ignores unsupported advanced-field remaps while preserving supported scene-core remaps', () => {
        const normalized = normalizeFrontmatterKeys(
            {
                StoryType: 'Scene',
                StoryWhen: '2026-01-01',
                DraftPass: '2'
            },
            {
                StoryType: 'Class',
                StoryWhen: 'When',
                DraftPass: 'Iteration'
            }
        );

        expect(normalized.Class).toBe('Scene');
        expect(normalized.When).toBe('2026-01-01');
        expect(normalized.DraftPass).toBe('2');
        expect('Iteration' in normalized).toBe(false);
    });

    it('returns only supported mappings when the remap feature is enabled', () => {
        const mappings = getActiveFrontmatterMappings({
            enableCustomMetadataMapping: true,
            frontmatterMappings: {
                StoryType: 'Class',
                DraftPass: 'Iteration'
            }
        });

        expect(mappings).toEqual({ StoryType: 'Class' });
    });
});

describe('extractSummary', () => {
    it('trims a string Summary', () => {
        expect(extractSummary({ Summary: '  hello world  ' })).toBe('hello world');
    });

    it('joins array elements with newlines, String-coercing non-strings, then trims', () => {
        expect(extractSummary({ Summary: ['line one', 'line two'] })).toBe('line one\nline two');
        expect(extractSummary({ Summary: ['a', 2, true] })).toBe('a\n2\ntrue');
        expect(extractSummary({ Summary: ['  pad  ', 'x'] })).toBe('pad  \nx');
    });

    it('returns empty string for an empty array', () => {
        expect(extractSummary({ Summary: [] })).toBe('');
    });

    it('returns empty string for null, undefined, or a missing key', () => {
        expect(extractSummary({ Summary: null })).toBe('');
        expect(extractSummary({ Summary: undefined })).toBe('');
        expect(extractSummary({})).toBe('');
    });

    it('String-coerces and trims any other type', () => {
        expect(extractSummary({ Summary: 42 })).toBe('42');
        expect(extractSummary({ Summary: 0 })).toBe('0');
        expect(extractSummary({ Summary: false })).toBe('false');
        expect(extractSummary({ Summary: { a: 1 } })).toBe('{"a":1}');
    });
});

describe('canonical key registry', () => {
    it('lists Purpose as the canonical Beat key, with Description and description as legacy', () => {
        expect(BEAT_PURPOSE_KEYS[0]).toBe('Purpose');
        expect([...BEAT_PURPOSE_KEYS]).toEqual(['Purpose', 'Description', 'description']);
    });

    it('lists Context as the canonical Backdrop key, with Synopsis as legacy', () => {
        expect(BACKDROP_CONTEXT_KEYS[0]).toBe('Context');
        expect([...BACKDROP_CONTEXT_KEYS]).toEqual(['Context', 'Synopsis']);
    });

    it('keeps Beats and Backdrops on separate registries so legacy keys never cross note types', () => {
        // Synopsis is the *Backdrop* legacy key; if it leaks into the Beat registry
        // we are back to the GossamerCommands.fm.Synopsis regression of 2026-04-21.
        expect((BEAT_PURPOSE_KEYS as readonly string[])).not.toContain('Synopsis');
        expect((BEAT_PURPOSE_KEYS as readonly string[])).not.toContain('Context');
        expect((BACKDROP_CONTEXT_KEYS as readonly string[])).not.toContain('Purpose');
        expect((BACKDROP_CONTEXT_KEYS as readonly string[])).not.toContain('Description');
    });
});

describe('readBeatPurpose', () => {
    it('returns Purpose when present (canonical key wins)', () => {
        expect(readBeatPurpose(asBeatFrontmatter({ Purpose: 'canonical text' }))).toBe('canonical text');
    });

    it('prefers Purpose over legacy Description when both are present', () => {
        expect(readBeatPurpose(asBeatFrontmatter({
            Purpose: 'canonical text',
            Description: 'legacy text'
        }))).toBe('canonical text');
    });

    it('falls back to legacy Description in un-migrated vaults', () => {
        expect(readBeatPurpose(asBeatFrontmatter({ Description: 'legacy text' }))).toBe('legacy text');
    });

    it('falls back to lowercase description as the last resort', () => {
        expect(readBeatPurpose(asBeatFrontmatter({ description: 'lowercase text' }))).toBe('lowercase text');
    });

    it('trims surrounding whitespace', () => {
        expect(readBeatPurpose(asBeatFrontmatter({ Purpose: '  padded  ' }))).toBe('padded');
    });

    it('skips empty strings and continues to the next legacy key', () => {
        expect(readBeatPurpose(asBeatFrontmatter({
            Purpose: '   ',
            Description: 'real text'
        }))).toBe('real text');
    });

    it('returns undefined when no key holds a non-empty string (no fabricated default)', () => {
        expect(readBeatPurpose(asBeatFrontmatter({}))).toBeUndefined();
        expect(readBeatPurpose(asBeatFrontmatter(null))).toBeUndefined();
        expect(readBeatPurpose(asBeatFrontmatter(undefined))).toBeUndefined();
    });

    it('ignores non-string values rather than coercing them', () => {
        expect(readBeatPurpose(asBeatFrontmatter({ Purpose: 42, Description: 'string fallback' } as never))).toBe('string fallback');
    });

    it('never reads Synopsis on a beat (Beats use Purpose; Synopsis is a Backdrop key)', () => {
        expect(readBeatPurpose(asBeatFrontmatter({ Synopsis: 'wrong field' } as never))).toBeUndefined();
    });
});

describe('readBackdropContext', () => {
    it('returns Context when present (canonical key wins)', () => {
        expect(readBackdropContext(asBackdropFrontmatter({ Context: 'world layer' }))).toBe('world layer');
    });

    it('falls back to legacy Synopsis in un-migrated vaults', () => {
        expect(readBackdropContext(asBackdropFrontmatter({ Synopsis: 'legacy backdrop text' }))).toBe('legacy backdrop text');
    });

    it('prefers Context over Synopsis when both are present', () => {
        expect(readBackdropContext(asBackdropFrontmatter({
            Context: 'canonical',
            Synopsis: 'legacy'
        }))).toBe('canonical');
    });

    it('returns undefined when neither key holds content', () => {
        expect(readBackdropContext(asBackdropFrontmatter({}))).toBeUndefined();
    });
});

describe('frontmatter narrowing functions', () => {
    it('asBeatFrontmatter returns null for nullish or non-object input', () => {
        expect(asBeatFrontmatter(null)).toBeNull();
        expect(asBeatFrontmatter(undefined)).toBeNull();
        expect(asBeatFrontmatter('string')).toBeNull();
        expect(asBeatFrontmatter(42)).toBeNull();
    });

    it('asBeatFrontmatter passes through actual objects (cast is documentation, not validation)', () => {
        const fm = { Purpose: 'x', Range: '0-100' };
        expect(asBeatFrontmatter(fm)).toBe(fm);
    });

    it('asBackdropFrontmatter has matching nullish handling', () => {
        expect(asBackdropFrontmatter(null)).toBeNull();
        expect(asBackdropFrontmatter({ Context: 'x' })).toEqual({ Context: 'x' });
    });
});
