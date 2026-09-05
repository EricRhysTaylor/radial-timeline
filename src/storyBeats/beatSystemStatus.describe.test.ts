import { describe, expect, it } from 'vitest';
import type { BeatStructuralBeatStatus, BeatStructuralSummary, BeatSystemStructuralStatus } from './types';
import { describeStructuralStatus, getPreviewIssueEntries, getPreviewIssueSummaryLabel } from './beatSystemStatus';

const summary = (overrides: Partial<BeatStructuralSummary> = {}): BeatStructuralSummary => ({
    expectedCount: 5, presentCount: 5, matchedCount: 5, completeCount: 5, issueCount: 0, missingCount: 0,
    duplicateCount: 0, misalignedCount: 0, outOfSequenceCount: 0, missingModelNoteCount: 0, missingModelBeatCount: 0,
    wrongModelBeatCount: 0, nonBeatClassBeatCount: 0, missingCreateableCount: 0,
    ...overrides
} as BeatStructuralSummary);
const beat = (ordinal: number, kind: 'present' | 'missing', issueCodes: string[] = []): BeatStructuralBeatStatus => ({
    expected: { key: `k${ordinal}`, name: `Beat ${ordinal}`, actNumber: 1, actLabel: 'Act 1', ordinal },
    kind, present: kind !== 'missing', matchedNotes: [],
    issues: issueCodes.map(code => ({ code })), issueCount: issueCodes.length, isAligned: issueCodes.length === 0, label: ''
} as unknown as BeatStructuralBeatStatus); // SAFE: the fields the readers touch
const status = (s: BeatStructuralSummary, beats: BeatStructuralBeatStatus[] = []): BeatSystemStructuralStatus =>
    ({ summary: s, beats } as unknown as BeatSystemStructuralStatus); // SAFE: summary and beats are all these readers use

describe('getPreviewIssueEntries', () => {
    it('lists missing and incomplete beats in ordinal order, ignoring act placement alone', () => {
        const entries = getPreviewIssueEntries(status(summary(), [
            beat(3, 'present', ['act_mismatch']), beat(2, 'missing'), beat(1, 'present', ['missing_purpose'])
        ]));
        expect(entries.map(e => `${e.beat.expected.ordinal}:${e.kind}`)).toEqual(['1:incomplete', '2:missing']);
        expect(getPreviewIssueSummaryLabel(entries)).toEqual(['Missing', 'Incomplete']);
    });
});

describe('describeStructuralStatus', () => {
    it('explains an inactive or empty system in one line', () => {
        expect(describeStructuralStatus(null)).toEqual([]);
        expect(describeStructuralStatus(status(summary({ expectedCount: 0 })))).toEqual(['Structure: No beats are defined for this system yet.']);
        expect(describeStructuralStatus(status(summary({ matchedCount: 0, wrongModelBeatCount: 1 })))[0]).toContain('different Beat Model');
        expect(describeStructuralStatus(status(summary({ matchedCount: 0, missingModelNoteCount: 1 })))[0]).toContain('missing Beat Model');
        expect(describeStructuralStatus(status(summary({ matchedCount: 0 })))).toEqual(['Structure: This system is not active in the manuscript yet.']);
    });

    it('reports alignment, then each kind of drift with correct plurals', () => {
        expect(describeStructuralStatus(status(summary()))).toEqual(['Structure: Aligned to the current beat template.']);
        const lines = describeStructuralStatus(status(
            summary({ issueCount: 1, misalignedCount: 1, missingModelNoteCount: 2, duplicateCount: 1 }),
            [beat(1, 'present', ['missing_purpose'])]
        ));
        expect(lines).toEqual([
            'Structure: 1 beat is incomplete.',
            '1 beat is placed in a different act than the template.',
            'Order remains intact.',
            '2 matching notes are missing Beat Model.',
            '1 duplicate beat note was found.'
        ]);
        const missing = describeStructuralStatus(status(summary({ missingCount: 2, outOfSequenceCount: 2 }), [beat(1, 'missing'), beat(2, 'missing')]));
        expect(missing[0]).toBe('Structure: 2 beats are missing from the manuscript.');
        expect(missing[1]).toContain('2 beats are out of manuscript sequence');
    });
});
