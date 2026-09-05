import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it, vi } from 'vitest';
import {
    buildTimelineOverviewEntries,
    getTimelineOverviewSeverity,
    scrollFindingCardIntoView
} from './TimelineOverviewStrip';
import type { TimelineAuditFinding, TimelineAuditIssue, TimelineAuditStatus } from './types';

function makeFinding(params: {
    path: string;
    manuscriptOrderIndex: number;
    expectedChronologyPosition?: number | null;
    whenParseIssue?: 'missing_when' | 'invalid_when' | null;
    status?: TimelineAuditStatus;
    issues?: TimelineAuditIssue[];
}): TimelineAuditFinding {
    return {
        file: makeFile(params.path),
        sceneId: params.path,
        title: params.path.split('/').pop()?.replace(/\.md$/i, '') ?? params.path,
        path: params.path,
        manuscriptOrderIndex: params.manuscriptOrderIndex,
        currentWhenRaw: null,
        currentWhen: null,
        whenValid: params.expectedChronologyPosition !== null,
        whenParseIssue: params.whenParseIssue ?? null,
        currentWhenSource: undefined,
        currentWhenConfidence: undefined,
        expectedChronologyPosition: params.expectedChronologyPosition ?? null,
        inferredWrittenTimelinePosition: null,
        status: params.status ?? 'aligned',
        issues: params.issues ?? [],
        evidence: [],
        rationale: '',
        suggestedWhen: null,
        suggestedConfidence: null,
        suggestedProvenance: null,
        allowedActions: ['keep'],
        reviewAction: 'keep',
        unresolved: false,
        aiSuggested: false,
        safeApplyEligible: false
    };
}

function makeIssue(
    type: TimelineAuditIssue['type'],
    severity: TimelineAuditIssue['severity'] = 'warning'
): TimelineAuditIssue {
    return {
        type,
        severity,
        tier: 'direct',
        detectionSource: 'deterministic',
        summary: type
    };
}

describe('timeline overview strip helpers', () => {
    it('orders overview scenes by chronology position, then manuscript order for unplaced scenes', () => {
        const entries = buildTimelineOverviewEntries([
            makeFinding({ path: 'Story/3 Missing.md', manuscriptOrderIndex: 2, expectedChronologyPosition: null, whenParseIssue: 'missing_when', status: 'warning', issues: [makeIssue('missing_when')] }),
            makeFinding({ path: 'Story/2 Later.md', manuscriptOrderIndex: 1, expectedChronologyPosition: 2 }),
            makeFinding({ path: 'Story/1 Earlier.md', manuscriptOrderIndex: 0, expectedChronologyPosition: 1 }),
            makeFinding({ path: 'Story/4 Invalid.md', manuscriptOrderIndex: 3, expectedChronologyPosition: null, whenParseIssue: 'invalid_when', status: 'warning', issues: [makeIssue('invalid_when')] })
        ]);

        expect(entries.map((entry) => entry.finding.path)).toEqual([
            'Story/1 Earlier.md',
            'Story/2 Later.md',
            'Story/3 Missing.md',
            'Story/4 Invalid.md'
        ]);
    });

    it('maps overview colors by severity and lets the highest severity win', () => {
        expect(getTimelineOverviewSeverity(
            makeFinding({ path: 'Story/Clean.md', manuscriptOrderIndex: 0, expectedChronologyPosition: 1, status: 'aligned' })
        )).toBe('clean');

        expect(getTimelineOverviewSeverity(
            makeFinding({
                path: 'Story/Missing.md',
                manuscriptOrderIndex: 1,
                expectedChronologyPosition: null,
                whenParseIssue: 'missing_when',
                status: 'warning',
                issues: [makeIssue('missing_when')]
            })
        )).toBe('missing_when');

        expect(getTimelineOverviewSeverity(
            makeFinding({
                path: 'Story/Warning.md',
                manuscriptOrderIndex: 2,
                expectedChronologyPosition: 2,
                status: 'warning',
                issues: [makeIssue('continuity_conflict')]
            })
        )).toBe('warning');

        expect(getTimelineOverviewSeverity(
            makeFinding({
                path: 'Story/Contradiction.md',
                manuscriptOrderIndex: 3,
                expectedChronologyPosition: 3,
                status: 'contradiction',
                issues: [makeIssue('time_of_day_conflict', 'contradiction')]
            })
        )).toBe('contradiction');

        expect(getTimelineOverviewSeverity(
            makeFinding({
                path: 'Story/Impossible.md',
                manuscriptOrderIndex: 4,
                expectedChronologyPosition: 4,
                status: 'contradiction',
                issues: [
                    makeIssue('missing_when'),
                    makeIssue('time_of_day_conflict', 'contradiction'),
                    makeIssue('impossible_sequence', 'contradiction')
                ]
            })
        )).toBe('impossible');
    });

    it('uses human-readable issue summaries for overview tooltips', () => {
        const [entry] = buildTimelineOverviewEntries([
            makeFinding({
                path: 'Story/Conflict.md',
                manuscriptOrderIndex: 0,
                expectedChronologyPosition: 1,
                status: 'contradiction',
                issues: [
                    makeIssue('time_of_day_conflict', 'contradiction'),
                    makeIssue('relative_order_conflict', 'contradiction')
                ]
            })
        ]);

        expect(entry.issueSummary).toBe(
            'The scene text points to a different time of day than YAML. The scene text places this scene earlier or later than its current chronology slot.'
        );
    });

    it('preserves the filtered input set for overview rendering', () => {
        const filtered = [
            makeFinding({
                path: 'Story/A.md',
                manuscriptOrderIndex: 0,
                expectedChronologyPosition: 3,
                status: 'contradiction',
                issues: [makeIssue('time_of_day_conflict', 'contradiction')]
            }),
            makeFinding({
                path: 'Story/B.md',
                manuscriptOrderIndex: 1,
                expectedChronologyPosition: 1,
                status: 'contradiction',
                issues: [makeIssue('relative_order_conflict', 'contradiction')]
            })
        ];

        expect(buildTimelineOverviewEntries(filtered).map((entry) => entry.finding.path)).toEqual([
            'Story/B.md',
            'Story/A.md'
        ]);
    });

    it('scrolls the matching scene card into view on overview selection', () => {
        const scrollIntoView = vi.fn();
        const focus = vi.fn();
        const el = { scrollIntoView, focus } as unknown as HTMLElement;
        const cardEls = new Map<string, HTMLElement>([['Story/2 Scene.md', el]]);

        expect(scrollFindingCardIntoView(cardEls, 'Story/2 Scene.md')).toBe(true);
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(scrollFindingCardIntoView(cardEls, 'Story/missing.md')).toBe(false);
    });
});
