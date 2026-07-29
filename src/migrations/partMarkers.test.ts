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
                { path: 'Scenes/1.md', title: true, actNumber: 1, partNumber: 1 },
                { path: 'Scenes/3.md', title: true, actNumber: 2, partNumber: 2 },
                { path: 'Scenes/4.md', title: true, actNumber: 3, partNumber: 3 },
            ]);
        });

        it('writes every derived marker as untitled, per the D1 sentinel', () => {
            // `Part: true` is the untitled form. Derived markers are always
            // untitled because the Act they came from had no name to carry, and
            // the executor must not have to infer the value to write.
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 2) });
            expect(plan.status).toBe('derive');
            if (plan.status !== 'derive') return;
            expect(plan.writes.every(write => write.title === true)).toBe(true);
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

        it('carries an attribution that has no quote, in both paths', () => {
            // The export already prints this: \rtPart guards the quote and the
            // attribution separately, so an attribution alone typesets alone.
            // Dropping it would make the migration lossy.
            const storedEpigraphs = {
                layout: { quotes: [''], attributions: ['Anonymous'] },
            };

            const derived = planBookMigration({ bookId: 'b', scenes: scenes(1), storedEpigraphs });
            expect(derived.status).toBe('derive');
            if (derived.status !== 'derive') return;
            expect(derived.writes[0]).not.toHaveProperty('quote');
            expect(derived.writes[0].attribution).toBe('Anonymous');

            const authored = planBookMigration({
                bookId: 'b',
                scenes: [{ path: 'Scenes/1.md', act: 1, part: true }],
                storedEpigraphs,
            });
            expect(authored.status).toBe('author-owned');
            if (authored.status !== 'author-owned') return;
            expect(authored.epigraphProposal?.entries).toEqual([
                { actNumber: 1, attribution: 'Anonymous' },
            ]);
        });

        it('proposes an attribution-only slot that outlives the quotes array', () => {
            // quotes.length alone would miss this; the proposal walks both arrays.
            const plan = planBookMigration({
                bookId: 'b',
                scenes: [{ path: 'Scenes/1.md', act: 1, part: true }],
                storedEpigraphs: {
                    layout: { quotes: ['First.'], attributions: ['One', 'Two'] },
                },
            });

            expect(plan.status).toBe('author-owned');
            if (plan.status !== 'author-owned') return;
            expect(plan.epigraphProposal?.entries).toEqual([
                { actNumber: 1, quote: 'First.', attribution: 'One' },
                { actNumber: 2, attribution: 'Two' },
            ]);
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

        it('names only the re-entering boundary, not every boundary', () => {
            // A long book blocked by one late re-entry: the author is being sent
            // to look at scenes, so listing all five buries the one that matters.
            const plan = planBookMigration({
                bookId: 'b',
                scenes: scenes(1, 2, 3, 4, 2),
            });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.reason).toBe('re-entrant-acts');
            expect(plan.scenes).toEqual([
                { path: 'Scenes/5.md', detail: 'Re-opens Act 2, which already opened earlier.' },
            ]);
        });

        it('names only the boundaries that fall out of sequence', () => {
            // Acts 1, 3: the first boundary is fine, the second is not.
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 3) });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.scenes.map(s => s.path)).toEqual(['Scenes/2.md']);
            expect(plan.scenes[0].detail).toMatch(/Act 3 where part 2 is expected/);
        });

        it('reports every offending boundary when a book is both re-entrant and gapped', () => {
            // Acts 1, 3, 1. Naming only the repeat would send the author to fix
            // one thing and get blocked again next run on a problem that was
            // already knowable.
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 3, 1) });

            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.reason).toBe('re-entrant-acts');
            expect(plan.scenes).toEqual([
                { path: 'Scenes/2.md', detail: 'Opens Act 3 where part 2 is expected.' },
                { path: 'Scenes/3.md', detail: 'Re-opens Act 1, which already opened earlier.' },
            ]);
            // The headline names the primary reason but admits the other exists.
            expect(plan.detail).toMatch(/fall out of sequence/);
        });

        it('does not claim a sequence problem when re-entry is the only fault', () => {
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 2, 1) });
            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.detail).not.toMatch(/fall out of sequence/);
        });

        it('labels each offending boundary by its own position', () => {
            // Position is carried on the entry rather than recovered with
            // indexOf, which finds the first structurally equal element.
            const plan = planBookMigration({ bookId: 'b', scenes: scenes(1, 5, 6) });
            expect(plan.status).toBe('blocked');
            if (plan.status !== 'blocked') return;
            expect(plan.scenes.map(s => s.detail)).toEqual([
                'Opens Act 5 where part 2 is expected.',
                'Opens Act 6 where part 3 is expected.',
            ]);
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
