/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Auditor - Presentation Helpers
 */

import type { TimelineAuditFinding, TimelineAuditIssueType, TimelineAuditStatus } from './types';

const ISSUE_LABELS: Record<TimelineAuditIssueType, string> = {
    missing_when: 'Missing When value',
    invalid_when: 'Invalid When value',
    time_of_day_conflict: 'Time-of-day conflict',
    relative_order_conflict: 'Order conflict',
    continuity_conflict: 'Continuity problem',
    impossible_sequence: 'Impossible sequence',
    summary_body_disagree: 'Summary/body disagreement',
    ambiguous_time_signal: 'Ambiguous timing',
    insufficient_evidence: 'Insufficient timing evidence'
};

const ISSUE_DESCRIPTIONS: Record<TimelineAuditIssueType, string> = {
    missing_when: 'YAML has no When value for this scene.',
    invalid_when: 'YAML has a When value, but it does not parse as a real date/time.',
    time_of_day_conflict: 'The scene text points to a different time of day than YAML.',
    relative_order_conflict: 'The scene text places this scene earlier or later than its current chronology slot.',
    continuity_conflict: 'The jump from nearby chronology neighbors looks suspicious or weakly justified.',
    impossible_sequence: 'The current chronology would make the sequence impossible.',
    summary_body_disagree: 'The summary and the body point to different timing or sequence.',
    ambiguous_time_signal: 'The scene hints at timing, but not clearly enough to trust a date change.',
    insufficient_evidence: 'The scene does not contain enough timing evidence to place it safely.'
};

const STATUS_LABELS: Record<TimelineAuditStatus, string> = {
    aligned: 'Aligned',
    warning: 'Warning',
    contradiction: 'Contradiction'
};

export function formatAuditIssueLabel(issueType: TimelineAuditIssueType): string {
    return ISSUE_LABELS[issueType] ?? issueType;
}

export function describeAuditIssue(issueType: TimelineAuditIssueType): string {
    return ISSUE_DESCRIPTIONS[issueType] ?? formatAuditIssueLabel(issueType);
}

export function formatAuditStatusLabel(status: TimelineAuditStatus): string {
    return STATUS_LABELS[status] ?? status;
}

export function getAuditDisplayTitle(title: string): string {
    const trimmed = title.trim();
    const match = trimmed.match(/^#?\d+(?:\.\d+)?(?:\s*[-.)]?\s+)(.+)$/);
    return match?.[1]?.trim() || trimmed;
}

export function getAuditFindingBadgeLabels(finding: TimelineAuditFinding, max = 2): string[] {
    const unique = new Set<string>();
    for (const issue of finding.issues) {
        const label = formatAuditIssueLabel(issue.type);
        if (!unique.has(label)) {
            unique.add(label);
        }
        if (unique.size >= max) break;
    }
    return Array.from(unique);
}

export function getAuditFindingPreviewSnippet(finding: TimelineAuditFinding, maxChars = 72): string | null {
    const raw = finding.evidence[0]?.snippet?.trim() || '';
    if (!raw) return null;

    const compact = raw.replace(/\s+/g, ' ');
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

export function getInitialExpandedFindingPath(findings: TimelineAuditFinding[]): string | null {
    const firstFlagged = findings.find((finding) => finding.status === 'contradiction' || finding.status === 'warning');
    return firstFlagged?.path ?? null;
}
