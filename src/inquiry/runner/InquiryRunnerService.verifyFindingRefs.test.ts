import { describe, expect, it, vi } from 'vitest';

vi.mock('../../ai/runtime/aiClient', () => ({
    getAIClient: vi.fn(() => ({}))
}));

import { InquiryRunnerService } from './InquiryRunnerService';
import { buildSceneRefIndex } from '../../ai/references/sceneRefNormalizer';

type Verifier = (
    rawFindings: Array<Record<string, unknown>>,
    sceneRefIndex: ReturnType<typeof buildSceneRefIndex> | Record<string, unknown>,
    options?: Record<string, unknown>
) => {
    verified: Array<{ refId: string; headline: string; recommendedAction?: string; rawRef?: Record<string, string>; subject?: string; span?: string; supportingRefs?: Array<{ refId: string }> }>;
    unverified: Array<{ rawRefId?: string; rawRefLabel?: string; rawRefPath?: string; headline: string; warning: string }>;
    warnings: Array<{ stage: string; message: string }>;
    repairs: Array<{ rawRef: string; canonicalRef: string }>;
};

function getVerifier(): Verifier {
    const service = new InquiryRunnerService(
        { settings: {} } as never,
        { getAbstractFileByPath: () => null } as never,
        {} as never
    ) as unknown as { verifyFindingRefs: Verifier };
    return service.verifyFindingRefs.bind(service);
}

function singleSceneIndex() {
    return buildSceneRefIndex([{
        sceneId: 'scn_a1b2c3d4',
        path: 'Book 1 Shail + Trisan/3 Party.md',
        label: '3 Party.md',
        sceneNumber: 3,
        title: '3 Party',
        aliases: []
    }]);
}

function twoScenesDifferentBooksIndex() {
    return buildSceneRefIndex([
        {
            sceneId: 'scn_aaaaaaaa',
            path: 'Book 1/1 Intro.md',
            label: '1 Intro.md',
            sceneNumber: 1,
            title: '1 Intro',
            aliases: []
        },
        {
            sceneId: 'scn_bbbbbbbb',
            path: 'Book 2/1 Intro.md',
            label: '1 Intro.md',
            sceneNumber: 1,
            title: '1 Intro',
            aliases: []
        }
    ]);
}

function twoBookIndex() {
    const b1 = { bookId: 'book_aaaaaaaa', path: 'Books/Book 1', label: 'B1', title: 'B1', aliases: ['Book 1'] };
    const b2 = { bookId: 'book_bbbbbbbb', path: 'Books/Book 2', label: 'B2', title: 'B2', aliases: ['Book 2'] };
    return {
        byBookId: new Map([[b1.bookId, b1], [b2.bookId, b2]]),
        byPath: new Map([[b1.path.toLowerCase(), b1], [b2.path.toLowerCase(), b2]]),
        byLabel: new Map([[b1.label.toLowerCase(), b1], [b2.label.toLowerCase(), b2]]),
        byNormalizedKey: new Map([
            ['bookaaaaaaaa', [b1]],
            ['bookbbbbbbbb', [b2]],
            ['booksbook1', [b1]],
            ['booksbook2', [b2]],
            ['b1', [b1]],
            ['b2', [b2]],
            ['book1', [b1]],
            ['book2', [b2]]
        ])
    };
}

describe('verifyFindingRefs', () => {
    it('passes clean findings straight through with no warnings', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_a1b2c3d4',
                ref_label: '3 Party.md',
                ref_path: 'Book 1 Shail + Trisan/3 Party.md',
                kind: 'continuity',
                headline: 'Clean finding',
                bullets: ['a'],
                recommended_action: 'Clarify the setup before the payoff.',
                role: 'target'
            }],
            singleSceneIndex()
        );

        expect(out.verified.length).toBe(1);
        expect(out.verified[0].refId).toBe('scn_a1b2c3d4');
        expect(out.verified[0].recommendedAction).toBe('Clarify the setup before the payoff.');
        expect(out.verified[0].rawRef).toBeUndefined();
        expect(out.unverified.length).toBe(0);
        expect(out.warnings.length).toBe(0);
    });

    it('drops contentless placeholder findings before citation validation', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_deadbeef',
                ref_label: '20 Collins Proposes.md',
                ref_path: 'Pride & Prejudice/20 Collins Proposes.md',
                kind: 'loose_end',
                headline: '',
                bullets: [],
                recommended_action: '',
                evidence_quote: '',
                role: ''
            }],
            singleSceneIndex()
        );

        expect(out.verified.length).toBe(0);
        expect(out.unverified.length).toBe(0);
        expect(out.warnings.length).toBe(0);
    });

    it('quarantines a fabricated ref when nothing matches the corpus', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_deadbeef',
                ref_label: 'Nowhere.md',
                ref_path: 'Made Up/Nowhere.md',
                kind: 'continuity',
                headline: 'Fabricated',
                bullets: [],
                role: 'target'
            }],
            singleSceneIndex()
        );

        expect(out.verified.length).toBe(0);
        expect(out.unverified.length).toBe(1);
        expect(out.unverified[0].rawRefId).toBe('scn_deadbeef');
        expect(out.unverified[0].rawRefLabel).toBe('Nowhere.md');
        expect(out.unverified[0].headline).toBe('Fabricated');
        expect(out.warnings.length).toBeGreaterThan(0);
        expect(out.warnings[0].stage).toBe('unresolved_ref');
        expect(out.warnings[0].message).toContain('scn_deadbeef');
        expect(out.warnings[0].message).toContain('could not be matched');
    });

    it('rescues a fabricated ref_id via label as a DIAGNOSTIC, not an author-facing warning', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_deadbeef',
                ref_label: '3 Party.md',
                ref_path: 'Book 1 Shail + Trisan/3 Party.md',
                kind: 'continuity',
                headline: 'Rescued',
                bullets: [],
                role: 'context'
            }],
            singleSceneIndex()
        );

        // Finding stays usable and bound to the canonical id.
        expect(out.verified.length).toBe(1);
        expect(out.verified[0].refId).toBe('scn_a1b2c3d4');
        expect(out.verified[0].rawRef).toEqual({
            refId: 'scn_deadbeef',
            refLabel: '3 Party.md',
            refPath: 'Book 1 Shail + Trisan/3 Party.md'
        });
        // A deterministic repair must NOT raise a hard "do not trust" warning...
        expect(out.warnings.length).toBe(0);
        // ...but it IS retained as an internal audit diagnostic.
        expect(out.repairs).toEqual([{ rawRef: 'scn_deadbeef', canonicalRef: 'scn_a1b2c3d4' }]);
    });

    it('repairs a numbered placeholder ref (scn_16) via label without an author warning (Opus 4.8 signature)', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_3',                       // S-number placeholder, not a canonical hash
                ref_label: '3 Party.md',
                ref_path: 'Book 1 Shail + Trisan/3 Party.md',
                kind: 'unclear',
                headline: 'Numbered placeholder ref',
                bullets: ['x'],
                role: 'context'
            }],
            singleSceneIndex()
        );

        expect(out.verified.length).toBe(1);
        expect(out.verified[0].refId).toBe('scn_a1b2c3d4');
        expect(out.warnings.length).toBe(0);
        expect(out.repairs).toEqual([{ rawRef: 'scn_3', canonicalRef: 'scn_a1b2c3d4' }]);
    });

    it('quarantines when fallback keys are ambiguous (multiple scenes share a number)', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_deadbeef',
                ref_label: 'Scene 1',
                ref_path: '',
                kind: 'continuity',
                headline: 'Ambiguous',
                bullets: [],
                role: 'target'
            }],
            twoScenesDifferentBooksIndex()
        );

        expect(out.verified.length).toBe(0);
        expect(out.unverified.length).toBe(1);
        expect(out.unverified[0].rawRefId).toBe('scn_deadbeef');
        expect(out.warnings[0].stage).toBe('unresolved_ref');
    });

    it('flags ref_label_mismatch when ref_id resolves to A but ref_label/path points to B', () => {
        const verify = getVerifier();
        const index = buildSceneRefIndex([
            {
                sceneId: 'scn_aaaaaaaa',
                path: 'Book/3 Party.md',
                label: '3 Party.md',
                sceneNumber: 3,
                title: '3 Party',
                aliases: []
            },
            {
                sceneId: 'scn_bbbbbbbb',
                path: 'Book/4 Aftermath.md',
                label: '4 Aftermath.md',
                sceneNumber: 4,
                title: '4 Aftermath',
                aliases: []
            }
        ]);

        const out = verify(
            [{
                ref_id: 'scn_aaaaaaaa',
                ref_label: '4 Aftermath.md',
                ref_path: 'Book/4 Aftermath.md',
                kind: 'continuity',
                headline: 'Mismatched citation',
                bullets: [],
                role: 'target'
            }],
            index
        );

        expect(out.verified.length).toBe(1);
        expect(out.verified[0].refId).toBe('scn_aaaaaaaa');
        expect(out.warnings.some(w => w.stage === 'ref_label_mismatch')).toBe(true);
        const mismatch = out.warnings.find(w => w.stage === 'ref_label_mismatch')!;
        expect(mismatch.message).toContain('valid scene id with mismatched label/path metadata');
        expect(mismatch.message).toContain('scn_aaaaaaaa');
        expect(mismatch.message).toContain('scn_bbbbbbbb');
        expect(out.verified[0].rawRef).toBeDefined();
    });

    it('preserves partial header data on quarantined findings so the UI can show what the AI claimed', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_deadbeef',
                ref_label: 'Nowhere.md',
                kind: 'continuity',
                headline: 'Ghost',
                bullets: ['one', 'two'],
                role: 'context',
                lens: 'flow'
            }],
            singleSceneIndex()
        );

        expect(out.unverified[0].headline).toBe('Ghost');
        expect(out.unverified[0].warning.length).toBeGreaterThan(0);
    });

    it('completes the run with a strong warning state when every finding is unverified', () => {
        const verify = getVerifier();
        const out = verify(
            [
                { ref_id: 'scn_deadbeef', headline: 'A', bullets: [] },
                { ref_id: 'scn_feedface', headline: 'B', bullets: [] }
            ],
            singleSceneIndex()
        );

        expect(out.verified.length).toBe(0);
        expect(out.unverified.length).toBe(2);
        expect(out.warnings.length).toBeGreaterThanOrEqual(2);
        expect(out.warnings.every(w => w.stage === 'unresolved_ref')).toBe(true);
    });

    it('emits no warnings when every finding is clean', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_a1b2c3d4',
                ref_label: '3 Party.md',
                ref_path: 'Book 1 Shail + Trisan/3 Party.md',
                headline: 'Clean',
                bullets: []
            }],
            singleSceneIndex()
        );

        expect(out.warnings.length).toBe(0);
    });

    it('verifies saga primary refs against book anchors instead of scene anchors', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'book_aaaaaaaa',
                ref_label: 'B1',
                ref_path: 'Books/Book 1',
                kind: 'thread',
                headline: 'Thread loses pressure between books',
                subject: 'Succession thread',
                span: 'B1-B2',
                bullets: ['Book 2 inherits the premise without enough pressure.'],
                supporting_refs: [{
                    ref_id: 'scn_a1b2c3d4',
                    ref_label: '3 Party.md',
                    ref_path: 'Book 1 Shail + Trisan/3 Party.md',
                    quote: 'A quoted setup.'
                }]
            }],
            twoBookIndex(),
            {
                primaryRefType: 'book',
                supportingBookRefIndex: twoBookIndex(),
                supportingSceneRefIndex: singleSceneIndex()
            }
        );

        expect(out.verified).toHaveLength(1);
        expect(out.verified[0].refId).toBe('book_aaaaaaaa');
        expect(out.verified[0].subject).toBe('Succession thread');
        expect(out.verified[0].span).toBe('B1-B2');
        expect(out.verified[0].supportingRefs?.[0].refId).toBe('scn_a1b2c3d4');
        expect(out.unverified).toHaveLength(0);
    });

    it('quarantines saga findings that use scene ids as primary refs', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'scn_a1b2c3d4',
                ref_label: '3 Party.md',
                ref_path: 'Book 1 Shail + Trisan/3 Party.md',
                kind: 'arc',
                headline: 'Too local for saga primary anchor',
                bullets: []
            }],
            twoBookIndex(),
            { primaryRefType: 'book', supportingBookRefIndex: twoBookIndex(), supportingSceneRefIndex: singleSceneIndex() }
        );

        expect(out.verified).toHaveLength(0);
        expect(out.unverified).toHaveLength(1);
        expect(out.warnings[0].message).toContain('could not be matched');
    });

    it('keeps a saga finding bound when one supporting ref is invalid', () => {
        const verify = getVerifier();
        const out = verify(
            [{
                ref_id: 'book_bbbbbbbb',
                ref_label: 'B2',
                ref_path: 'Books/Book 2',
                kind: 'payoff',
                headline: 'Payoff is deferred without pressure',
                bullets: [],
                supporting_refs: [{ ref_id: 'scn_deadbeef', ref_label: 'Missing.md', ref_path: 'Nope/Missing.md', quote: 'Ghost.' }]
            }],
            twoBookIndex(),
            { primaryRefType: 'book', supportingBookRefIndex: twoBookIndex(), supportingSceneRefIndex: singleSceneIndex() }
        );

        expect(out.verified).toHaveLength(1);
        expect(out.verified[0].refId).toBe('book_bbbbbbbb');
        expect(out.warnings.some(w => w.message.includes('supporting citation'))).toBe(true);
    });
});
