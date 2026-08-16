import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { computeCacheableValues, compareSubplotOrder, type SubplotCountEntry } from './Precompute';
import { createSearchState } from '../../services/searchState';

function makePlugin(settingsOverrides: Record<string, unknown> = {}) {
    return {
        settings: {
            currentMode: 'narrative',
            publishStageColors: {
                Zero: '#9900ff',
                Author: '#3366ff',
                House: '#33aa44',
                Press: '#ffaa00',
            },
            subplotColors: ['#eeeeee'],
            enableAiSceneAnalysis: false,
            actCount: 3,
            ...settingsOverrides,
        },
        searchState: createSearchState(),
        openScenePaths: new Set<string>(),
        desaturateColor: (hex: string) => hex,
        calculateCompletionEstimate: () => null,
        synopsisManager: {
            generateElement: () => document.createElementNS('http://www.w3.org/2000/svg', 'g'),
        },
    };
}

describe('computeCacheableValues', () => {
    it('uses the project most-advanced publish stage color in Gossamer mode', () => {
        const plugin = makePlugin({ currentMode: 'gossamer' });
        const scenes: TimelineItem[] = [
            {
                title: '1 Opening',
                path: 'Book/1 Opening.md',
                date: '',
                subplot: 'Main Plot',
                actNumber: 1,
                'Publish Stage': 'Author',
            },
            {
                title: '1 Catalyst',
                path: 'Beats/1 Catalyst.md',
                date: '',
                itemType: 'Beat',
                subplot: 'Main Plot',
                actNumber: 1,
                'Publish Stage': 'Zero',
            },
        ];

        const values = computeCacheableValues(plugin as never, scenes);

        expect(values.maxStageColor).toBe('#3366ff');
    });

    it('clamps an out-of-range actNumber to the last quadrant instead of wrapping to Act 1', () => {
        // Regression test for GH #31: a scene whose actNumber exceeds the
        // currently configured actCount (e.g. cached from before the user
        // lowered actCount) must land in the last valid quadrant, not
        // silently collapse into Act 1's quadrant.
        const plugin = makePlugin();
        const scenes: TimelineItem[] = [
            {
                title: '1 Stale Act Four Scene',
                path: 'Book/1 Stale.md',
                date: '',
                subplot: 'Main Plot',
                actNumber: 4,
            },
        ];

        const values = computeCacheableValues(plugin as never, scenes);

        expect(values.scenesByActAndSubplot[2]['Main Plot']).toHaveLength(1);
        expect(values.scenesByActAndSubplot[0]['Main Plot'] ?? []).toHaveLength(0);
    });

    describe('NUM_RINGS single source of truth', () => {
        // Regression test for the two-derivation NUM_RINGS bug: this function
        // used to size its ring geometry (ringGeo, via a local `NUM_RINGS`)
        // from a set built by walking every scene and excluding only
        // itemType 'Backdrop' — which counts Frontmatter/Backmatter notes'
        // fallback-to-'Main Plot' subplot. `masterSubplotOrder` is built from
        // scenesByActAndSubplot, which excludes Frontmatter/Backmatter via
        // isMatterNote(). A book with front/back matter and no scene that
        // ever falls back to 'Main Plot' made the two derivations diverge by
        // one: the geometry was sized for one ring more than
        // masterSubplotOrder actually lists, silently compressing every real
        // ring's width. Both must now come from masterSubplotOrder.length.
        it('sizes ring geometry to masterSubplotOrder.length even with front/back matter notes and no Main-Plot scene', () => {
            const plugin = makePlugin();
            const scenes: TimelineItem[] = [
                {
                    title: '0 Title Page',
                    path: 'Book/0 Title Page.md',
                    date: '',
                    itemType: 'Frontmatter',
                },
                {
                    title: '1 Heist Begins',
                    path: 'Book/1 Heist Begins.md',
                    date: '',
                    subplot: 'Heist',
                    actNumber: 1,
                },
                {
                    title: '2 Redemption Turn',
                    path: 'Book/2 Redemption Turn.md',
                    date: '',
                    subplot: 'Redemption Arc',
                    actNumber: 1,
                },
                {
                    title: '200 Acknowledgments',
                    path: 'Book/200 Acknowledgments.md',
                    date: '',
                    itemType: 'Backmatter',
                },
            ];

            const values = computeCacheableValues(plugin as never, scenes);

            expect(values.masterSubplotOrder).not.toContain('Main Plot');
            expect(values.masterSubplotOrder).toHaveLength(2);
            expect(values.ringStartRadii).toHaveLength(values.masterSubplotOrder.length);
            expect(values.ringWidths).toHaveLength(values.masterSubplotOrder.length);
        });

        it('still matches when a Main Plot scene is present (both former call sites agree here already)', () => {
            const plugin = makePlugin();
            const scenes: TimelineItem[] = [
                {
                    title: '0 Title Page',
                    path: 'Book/0 Title Page.md',
                    date: '',
                    itemType: 'Frontmatter',
                },
                {
                    title: '1 Opening',
                    path: 'Book/1 Opening.md',
                    date: '',
                    subplot: 'Main Plot',
                    actNumber: 1,
                },
                {
                    title: '2 Heist Begins',
                    path: 'Book/2 Heist Begins.md',
                    date: '',
                    subplot: 'Heist',
                    actNumber: 1,
                },
            ];

            const values = computeCacheableValues(plugin as never, scenes);

            expect(values.masterSubplotOrder).toHaveLength(2);
            expect(values.ringStartRadii).toHaveLength(values.masterSubplotOrder.length);
            expect(values.ringWidths).toHaveLength(values.masterSubplotOrder.length);
        });
    });

    it('preserves ring order for a well-formed book (comparator was already consistent on this fixture)', () => {
        // Representative multi-subplot book: Main Plot has the most scenes,
        // two subplots tie on count and must break by name ascending, and a
        // lower-count subplot sits innermost. This fixture never touched the
        // buggy `|| !a.subplot` branch (every subplot value is a real,
        // non-empty name), so the fix must reproduce this exact order.
        const plugin = makePlugin();
        const scenes: TimelineItem[] = [
            { title: '1 A', path: 'Book/1 A.md', date: '', subplot: 'Main Plot', actNumber: 1 },
            { title: '2 B', path: 'Book/2 B.md', date: '', subplot: 'Main Plot', actNumber: 1 },
            { title: '3 C', path: 'Book/3 C.md', date: '', subplot: 'Main Plot', actNumber: 1 },
            { title: '4 D', path: 'Book/4 D.md', date: '', subplot: 'Zebra', actNumber: 1 },
            { title: '5 E', path: 'Book/5 E.md', date: '', subplot: 'Zebra', actNumber: 1 },
            { title: '6 F', path: 'Book/6 F.md', date: '', subplot: 'Apple', actNumber: 1 },
            { title: '7 G', path: 'Book/7 G.md', date: '', subplot: 'Apple', actNumber: 1 },
            { title: '8 H', path: 'Book/8 H.md', date: '', subplot: 'Lonely Thread', actNumber: 1 },
        ];

        const values = computeCacheableValues(plugin as never, scenes);

        // Main Plot pinned first; Apple/Zebra tie on count(2) and break by
        // name ascending ('Apple' < 'Zebra'); Lonely Thread (count 1) last.
        expect(values.masterSubplotOrder).toEqual(['Main Plot', 'Apple', 'Zebra', 'Lonely Thread']);
    });
});

describe('compareSubplotOrder', () => {
    it('pins Main Plot first regardless of count', () => {
        const entries: SubplotCountEntry[] = [
            { subplot: 'Main Plot', count: 0 },
            { subplot: 'Anything', count: 999 },
        ];
        expect([...entries].sort(compareSubplotOrder).map(e => e.subplot)).toEqual(['Main Plot', 'Anything']);
    });

    it('orders by scene count descending when neither is Main Plot', () => {
        const entries: SubplotCountEntry[] = [
            { subplot: 'Low', count: 1 },
            { subplot: 'High', count: 5 },
            { subplot: 'Mid', count: 3 },
        ];
        expect([...entries].sort(compareSubplotOrder).map(e => e.subplot)).toEqual(['High', 'Mid', 'Low']);
    });

    it('breaks ties by name ascending', () => {
        const entries: SubplotCountEntry[] = [
            { subplot: 'Zebra', count: 2 },
            { subplot: 'Apple', count: 2 },
            { subplot: 'Mango', count: 2 },
        ];
        expect([...entries].sort(compareSubplotOrder).map(e => e.subplot)).toEqual(['Apple', 'Mango', 'Zebra']);
    });

    it('is reflexive: comparing an entry to itself is always 0, including the Main Plot entry', () => {
        const entries: SubplotCountEntry[] = [
            { subplot: 'Main Plot', count: 4 },
            { subplot: 'Heist', count: 4 },
            { subplot: '', count: 0 },
        ];
        for (const e of entries) {
            expect(compareSubplotOrder(e, e)).toBe(0);
        }
    });

    it('stays transitive when two entries share a name but disagree on count (found by the property test below)', () => {
        // Regression pin for a real transitivity break surfaced while fixing
        // this comparator: an earlier draft force-tied any pair sharing a
        // subplot name, regardless of count. That is sound for production
        // data (Map-built, so equal name implies equal count) but broke
        // transitivity for a same-name/different-count pair interposed by a
        // third, differently-named entry with a count in between:
        // cmp(Heist:2, Backdrop:1) < 0, cmp(Backdrop:1, Backdrop:3) = 0 (tie,
        // under the old force-tie rule), yet cmp(Heist:2, Backdrop:3) > 0 —
        // a<b, b=c, but a>c. Comparing by count first (falling to name only
        // once counts also match) resolves it: same-name entries with
        // different counts are no longer an automatic tie.
        const heist2 = { subplot: 'Heist', count: 2 };
        const backdrop1 = { subplot: 'Backdrop', count: 1 };
        const backdrop3 = { subplot: 'Backdrop', count: 3 };
        expect(compareSubplotOrder(heist2, backdrop1)).toBeLessThan(0);
        expect(compareSubplotOrder(backdrop1, backdrop3)).toBeGreaterThan(0);
        expect(compareSubplotOrder(heist2, backdrop3)).toBeGreaterThan(0);
    });

    // Deterministic PRNG (mulberry32) so generated cases are reproducible
    // across runs and CI machines — no external fuzzing dependency needed.
    function mulberry32(seed: number): () => number {
        let state = seed | 0;
        return () => {
            state = (state + 0x6d2b79f5) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Includes 'Main Plot' (the pinned name), an empty string (the old dead
    // branch's trigger), duplicate names on purpose (subplotCounts is
    // Map-derived and never has these in production, but a general-purpose
    // exported comparator must still hold its contract for them), and a
    // same-count / name-collation-adjacent pair.
    const NAME_POOL = ['Main Plot', 'Heist', 'Redemption Arc', 'Apple', 'apple', 'Zzz', 'Backdrop', ''];

    function randomEntry(rand: () => number): SubplotCountEntry {
        return {
            subplot: NAME_POOL[Math.floor(rand() * NAME_POOL.length)],
            count: Math.floor(rand() * 6),
        };
    }

    // Object.is(-0, 0) is false, and Math.sign(-0) === -0, so a plain
    // Math.sign round-trip can spuriously fail `toBe` on a legitimate tie;
    // this normalizes both zeros to +0 before comparing signs.
    function sign(n: number): number {
        return n === 0 ? 0 : n > 0 ? 1 : -1;
    }

    it('is antisymmetric and transitive over randomly generated entry sets (property test)', () => {
        const rand = mulberry32(0xc0ffee);
        for (let trial = 0; trial < 200; trial++) {
            const size = 2 + Math.floor(rand() * 5);
            const entries: SubplotCountEntry[] = Array.from({ length: size }, () => randomEntry(rand));

            // Antisymmetry (and reflexivity as the a===b case): sign(cmp(a,b))
            // must be the exact negation of sign(cmp(b,a)) for every pair,
            // including a compared to itself. Summing avoids -0/+0 mismatches
            // from negating a zero sign directly.
            for (const a of entries) {
                for (const b of entries) {
                    expect(sign(compareSubplotOrder(a, b)) + sign(compareSubplotOrder(b, a))).toBe(0);
                }
            }

            // Transitivity of the "sorts before or ties with" relation.
            for (const a of entries) {
                for (const b of entries) {
                    if (compareSubplotOrder(a, b) > 0) continue;
                    for (const c of entries) {
                        if (compareSubplotOrder(b, c) > 0) continue;
                        expect(compareSubplotOrder(a, c)).toBeLessThanOrEqual(0);
                    }
                }
            }
        }
    });
});
