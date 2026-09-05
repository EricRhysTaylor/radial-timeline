/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Auditor - Lightweight Overview Strip Helpers
 */

import type { TimelineAuditFinding } from './types';
import { describeAuditIssue } from './presentation';

export type TimelineOverviewSeverity = 'clean' | 'missing_when' | 'warning' | 'contradiction' | 'impossible';

export interface TimelineOverviewEntry {
    finding: TimelineAuditFinding;
    severity: TimelineOverviewSeverity;
    issueSummary: string;
}

export function getTimelineOverviewSeverity(finding: TimelineAuditFinding): TimelineOverviewSeverity {
    if (finding.issues.some((issue) => issue.type === 'impossible_sequence')) {
        return 'impossible';
    }

    if (finding.status === 'contradiction') {
        return 'contradiction';
    }

    const hasOnlyMissingWhenIssue = finding.whenParseIssue === 'missing_when'
        && finding.issues.length > 0
        && finding.issues.every((issue) => issue.type === 'missing_when');

    if (hasOnlyMissingWhenIssue) {
        return 'missing_when';
    }

    if (finding.status === 'warning') {
        return 'warning';
    }

    if (finding.whenParseIssue === 'missing_when') {
        return 'missing_when';
    }

    return 'clean';
}

export function sortFindingsForTimelineOverview(a: TimelineAuditFinding, b: TimelineAuditFinding): number {
    const aHasPosition = a.expectedChronologyPosition !== null;
    const bHasPosition = b.expectedChronologyPosition !== null;

    if (aHasPosition && bHasPosition) {
        return (a.expectedChronologyPosition ?? 0) - (b.expectedChronologyPosition ?? 0);
    }

    if (aHasPosition && !bHasPosition) return -1;
    if (!aHasPosition && bHasPosition) return 1;
    return a.manuscriptOrderIndex - b.manuscriptOrderIndex;
}

export function summarizeTimelineOverviewIssues(finding: TimelineAuditFinding): string {
    const issues = Array.from(new Set(finding.issues.map((issue) => describeAuditIssue(issue.type))));
    if (issues.length === 0) return 'No issues';

    const head = issues.slice(0, 2).join(' ');
    const remainder = issues.length - 2;
    return remainder > 0 ? `${head} +${remainder} more` : head;
}

export function buildTimelineOverviewEntries(findings: TimelineAuditFinding[]): TimelineOverviewEntry[] {
    return findings
        .slice()
        .sort(sortFindingsForTimelineOverview)
        .map((finding) => ({
            finding,
            severity: getTimelineOverviewSeverity(finding),
            issueSummary: summarizeTimelineOverviewIssues(finding)
        }));
}

export function scrollFindingCardIntoView(cardEls: Map<string, HTMLElement>, path: string): boolean {
    const cardEl = cardEls.get(path);
    if (!cardEl) return false;

    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof cardEl.focus === 'function') {
        cardEl.focus({ preventScroll: true });
    }
    return true;
}
