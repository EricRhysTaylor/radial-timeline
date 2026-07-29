import { describe, expect, it } from 'vitest';
import {
    findActBoundaries,
    planBookMigration,
    type MigrationSceneInput,
} from './partMarkers';

function scenes(...acts: Array<unknown>): MigrationSceneInput[] {
    return acts.map((act, index) => ({ path: `Scenes/${index + 1}.md`, act }));
}

describe('findActBoundaries', () => {
    it('opens a boundary every time the act value changes, not once per act', () => {
        // This is the exporter's actual rule. "First scene of each distinct act"
        // would find two boundaries here; the export emits three.
        const boundaries = findActBoundaries(scenes(1, 1, 2, 2, 1, 1));
        expect(boundaries.map(b => b.actNumber)).toEqual([1, 2, 1]);
        expect(boundaries.map(b => b.path)).toEqual(['Scenes/1.md', 'Scenes/3.md', 'Scenes/5.md']);
    });

    it('reads numeric strings as well as numbers', () => {
        expect(findActBoundaries(scenes('1', 2, '3')).map(b => b.actNumber)).toEqual([1, 2, 3]);
    });

    it('skips scenes with no usable act rather than treating them as a change', () => {
        const boundaries = findActBoundaries(scenes(1, null, 1, 2));
        expect(boundaries.map(b => b.actNumber)).toEqual([1, 2]);
    });

    it('finds nothing in an empty book', () => {
        expect(findActBoundaries([])).toEqual([]);
    });
});

describe('planBookMigration', () => {
    describe('derivable books', () => {
        it('writes one marker per boundary, numbered sequentially', () => {
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 1, 2, 3, 3) });

            expect(plan.status).toBe('derive');
            if (plan.status !== 'derive') return;
            expect(plan.writes).toEqual([
                { path: 'Scenes/1.md', actNumber: 1, partNumber: 1 },
                { path: 'Scenes/3.md', actNumber: 2, partNumber: 2 },
                { path: 'Scenes/4.md', actNumber: 3, partNumber: 3 },
            ]);
        });

        it('carries stored epigraphs onto the marker for their act', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: scenes(1, 2),
                storedEpigraphs: {
                    'bundled-fiction-modern-classic': {
                        quotes: ['The absurd does not liberate.', 'Who draws back?'],
                        attributions: ['Albert Camus', 'Arthur Rimbaud'],
                    },
                },
            });

            expect(plan.status).toBe('derive');
            if (plan.status !== 'derive') return;
            expect(plan.writes[0].quote).toBe('The absurd does not liberate.');
            expect(plan.writes[0].attribution).toBe('Albert Camus');
            expect(plan.writes[1].quote).toBe('Who draws back?');
        });

        it('omits epigraph fields when the stored slot is blank', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: scenes(1, 2),
                storedEpigraphs: {
                    layout: { quotes: ['Only the first.', '  '], attributions: [] },
                },
            });

            expect(plan.status).toBe('derive');
            if (plan.status !== 'derive') return;
            expect(plan.writes[0].quote).toBe('Only the first.');
            expect(plan.writes[1]).not.toHaveProperty('quote');
            expect(plan.writes[1]).not.toHaveProperty('attribution');
        });

        it('treats identical epigraph copies across layouts as one source', () => {
            // Switching layouts duplicates the text forward; that is not a conflict.
            const stored = { quotes: ['Same.'], attributions: ['Same author'] };
            const plan = planBookMigration({
                bookId: 'b',
                scenes: scenes(1),
                storedEpigraphs: { layoutA: stored, layoutB: { ...stored } },
            });

            expect(plan.status).toBe('derive');
        });
    });

    describe('author-owned markers win outright', () => {
        it('skips act derivation entirely when a scene already carries a Part marker', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [
                    { path: 'Scenes/1.md', act: 1, part: 'The Gathering' },
                    { path: 'Scenes/2.md', act: 2 },
                ],
            });

            expect(plan.status).toBe('author-owned');
            if (plan.status !== 'author-owned') return;
            expect(plan.markerPaths).toEqual(['Scenes/1.md']);
        });

        it('recognises an untitled marker as author structure', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [{ path: 'Scenes/1.md', act: 1, part: true }],
            });
            expect(plan.status).toBe('author-owned');
        });

        it('ignores an empty Part value, which is not a marker', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [
                    { path: 'Scenes/1.md', act: 1, part: '' },
                    { path: 'Scenes/2.md', act: 2 },
                ],
            });
            expect(plan.status).toBe('derive');
        });

        it('lets an author-marked book migrate even when its acts are re-entrant', () => {
            // The whole point of D2's repair path: the author fixes the structure
            // by placing markers, NOT by editing Act values. Blocking here would
            // make the repair path a loop.
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [
                    { path: 'Scenes/1.md', act: 1, part: true },
                    { path: 'Scenes/2.md', act: 2 },
                    { path: 'Scenes/3.md', act: 1, part: 'Back Again' },
                ],
            });
            expect(plan.status).toBe('author-owned');
        });

        it('surfaces stored epigraphs as a proposal rather than placing them', () => {
            // Stored epigraphs are indexed by act; author-placed markers have no
            // reliable correspondence to acts, so this needs acceptance.
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [{ path: 'Scenes/1.md', act: 1, part: 'One' }],
                storedEpigraphs: { layout: { quotes: ['A quote.'], attributions: ['Someone'] } },
            });

            expect(plan.status).toBe('author-owned');
            if (plan.status !== 'author-owned') return;
            expect(plan.epigraphProposal).toEqual({
                layoutId: 'layout',
                entries: [{ actNumber: 1, quote: 'A quote.', attribution: 'Someone' }],
            });
        });
    });

    describe('provenance — presence is not authorship', () => {
        it('does not treat the migration’s own partial output as author structure', () => {
            // A crashed run left a marker on Scenes/1.md. Without the journal
            // telling us we wrote it, this book would classify as author-owned,
            // derivation would be skipped, and a half-migrated book would freeze
            // into a structure that looks deliberate.
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [
                    { path: 'Scenes/1.md', act: 1, part: true },
                    { path: 'Scenes/2.md', act: 2 },
                ],
                migrationWrittenPaths: new Set(['Scenes/1.md']),
            });

            expect(plan.status).toBe('derive');
            if (plan.status !== 'derive') return;
            expect(plan.writes.map(w => w.path)).toEqual(['Scenes/1.md', 'Scenes/2.md']);
        });

        it('still honours an author marker the migration did not write', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [
                    { path: 'Scenes/1.md', act: 1, part: true },
                    { path: 'Scenes/2.md', act: 2, part: 'Author placed this' },
                ],
                migrationWrittenPaths: new Set(['Scenes/1.md']),
            });

            expect(plan.status).toBe('author-owned');
            if (plan.status !== 'author-owned') return;
            expect(plan.markerPaths).toEqual(['Scenes/2.md']);
        });
    });

    describe('blocked books', () => {
        it('blocks re-entrant acts, because a part numeral would repeat', () => {
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 2, 1) });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.reason).toBe('re-entrant-acts');
            expect(plan.detail).toMatch(/Part markers explicitly/);
        });

        it('blocks a gap in the act sequence, which would renumber the parts', () => {
            // Pre-migration this prints Part I then Part III; sequential numbering
            // would print I then II. Silently renumbering a book is not acceptable.
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 3) });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.reason).toBe('non-sequential-acts');
        });

        it('blocks a book whose acts start above 1', () => {
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(2, 3) });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.reason).toBe('non-sequential-acts');
        });

        it('blocks and names the scenes when an act value is unusable', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [
                    { path: 'Scenes/1.md', act: 1 },
                    { path: 'Scenes/2.md', act: 'not a number' },
                    { path: 'Scenes/3.md', act: 0 },
                ],
            });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.reason).toBe('act-missing');
            expect(plan.scenes.map(s => s.path)).toEqual(['Scenes/2.md', 'Scenes/3.md']);
        });

        it('blocks when two layouts disagree about the epigraph text', () => {
            const plan = planBookMigration({
                bookId: 'b',
                scenes: scenes(1, 2),
                storedEpigraphs: {
                    layoutA: { quotes: ['One version.'], attributions: [] },
                    layoutB: { quotes: ['A different version.'], attributions: [] },
                },
            });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.reason).toBe('epigraph-conflict');
            expect(plan.detail).toMatch(/will not pick for you/);
        });
    });

    describe('nothing to do', () => {
        it('reports a book with no scenes', () => {
            const plan = planBookMigration({ bookId: 'b', scenes: [] });
            expect(plan).toEqual({ bookId: 'b', status: 'noop', reason: 'no-scenes' });
        });

        it('reports a single-act book, which has no part structure to preserve', () => {
            // One boundary at act 1 is still a boundary — the export emits Part I.
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 1, 1) });
            expect(plan.status).toBe('derive');
            if (plan.status !== 'derive') return;
            expect(plan.writes).toHaveLength(1);
        });
    });
});
