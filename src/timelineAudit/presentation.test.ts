import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import {
    describeAuditIssue,
    getAuditDisplayTitle,
    formatAuditIssueLabel,
    formatAuditStatusLabel,
    getAuditFindingBadgeLabels,
    getAuditFindingPreviewSnippet,
    getInitialExpandedFindingPath
} from './presentation';
import type { TimelineAuditFinding, TimelineAuditIssue, TimelineAuditStatus } from './types';

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

function makeFinding(params: {
    path: string;
    status?: TimelineAuditStatus;
    issues?: TimelineAuditIssue[];
    snippet?: string;
}): TimelineAuditFinding {
    return {
        file: makeFile(params.path),
        sceneId: params.path,
        title: params.path,
        path: params.path,
        manuscriptOrderIndex: 0,
        currentWhenRaw: null,
        currentWhen: null,
        whenValid: false,
        whenParseIssue: null,
        currentWhenSource: undefined,
        currentWhenConfidence: undefined,
        expectedChronologyPosition: null,
        inferredWrittenTimelinePosition: null,
        status: params.status ?? 'aligned',
        issues: params.issues ?? [],
        evidence: params.snippet ? [{
            source: 'body',
            detectionSource: 'deterministic',
            tier: 'direct',
            label: 'Body',
            snippet: params.snippet
        }] : [],
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

describe('timeline audit presentation helpers', () => {
    it('maps technical issue keys to human-facing labels', () => {
        expect(formatAuditIssueLabel('time_of_day_conflict')).toBe('Time-of-day conflict');
        expect(formatAuditIssueLabel('relative_order_conflict')).toBe('Order conflict');
        expect(formatAuditIssueLabel('missing_when')).toBe('Missing When value');
        expect(describeAuditIssue('missing_when')).toBe('YAML has no When value for this scene.');
        expect(formatAuditStatusLabel('contradiction')).toBe('Contradiction');
    });

    it('derives compact badge labels and a single-line preview snippet', () => {
        const finding = makeFinding({
            path: 'Story/Scene.md',
            status: 'warning',
            issues: [
                makeIssue('time_of_day_conflict'),
                makeIssue('relative_order_conflict'),
                makeIssue('time_of_day_conflict')
            ],
            snippet: 'The following week they returned to the station after sunset and waited.'
        });

        expect(getAuditFindingBadgeLabels(finding)).toEqual(['Time-of-day conflict', 'Order conflict']);
        expect(getAuditFindingPreviewSnippet(finding, 24)).toBe('The following week they…');
    });

    it('strips duplicated numeric scene prefixes from display titles', () => {
        expect(getAuditDisplayTitle('45 Goodbye to Sister')).toBe('Goodbye to Sister');
        expect(getAuditDisplayTitle('#12 - Night Watch')).toBe('Night Watch');
        expect(getAuditDisplayTitle('Standalone Title')).toBe('Standalone Title');
    });

    it('selects the first flagged finding for initial expansion', () => {
        const findings = [
            makeFinding({ path: 'Story/1.md', status: 'aligned' }),
            makeFinding({ path: 'Story/2.md', status: 'warning', issues: [makeIssue('continuity_conflict')] }),
            makeFinding({ path: 'Story/3.md', status: 'contradiction', issues: [makeIssue('impossible_sequence', 'contradiction')] })
        ];

        expect(getInitialExpandedFindingPath(findings)).toBe('Story/2.md');
        expect(getInitialExpandedFindingPath([makeFinding({ path: 'Story/1.md', status: 'aligned' })])).toBeNull();
    });
});
