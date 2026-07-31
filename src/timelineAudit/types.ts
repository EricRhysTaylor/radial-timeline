/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Auditor - Core Types
 */

import type { TFile } from 'obsidian';
import type { WhenConfidence, WhenSource } from '../timelineRepair/types';

export type TimelineAuditIssueType =
    | 'missing_when'
    | 'invalid_when'
    | 'time_of_day_conflict'
    | 'relative_order_conflict'
    | 'continuity_conflict'
    | 'impossible_sequence'
    | 'summary_body_disagree'
    | 'ambiguous_time_signal'
    | 'insufficient_evidence';

export type TimelineAuditEvidenceTier = 'direct' | 'strong_inference' | 'ambiguous';

export type TimelineAuditEvidenceSource = 'summary' | 'synopsis' | 'body' | 'neighbor' | 'ai';

export type TimelineAuditDetectionSource = 'deterministic' | 'continuity' | 'ai';

export type TimelineAuditStatus = 'aligned' | 'warning' | 'contradiction';

export type TimelineAuditReviewAction = 'apply' | 'keep' | 'mark_review';

export type TimelineAuditAction = TimelineAuditReviewAction;

export type TimelineAuditTimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';

export type TimelineAuditAiScopeMode = 'manuscript' | 'range' | 'marked' | 'focused';

export type TimelineAuditAiTimelineRole = 'mainline' | 'flashback' | 'flash_forward' | 'parallel' | 'unclear';

/**
 * Explicit scene queue for an AI chronology pass. Manuscript mode reads every
 * scoped scene; every narrower mode carries the exact vault paths to read.
 */
export interface TimelineAuditAiScope {
    mode: TimelineAuditAiScopeMode;
    paths?: string[];
    startScene?: number;
    endScene?: number;
}

export interface TimelineAuditAiRunSummary {
    scopeMode: TimelineAuditAiScopeMode;
    requested: number;
    checked: number;
    suggestions: number;
    failed: number;
}

export interface TimelineAuditCue {
    kind: 'time_of_day' | 'relative_offset' | 'absolute_date' | 'continuity';
    label: string;
    source: TimelineAuditEvidenceSource;
    tier: TimelineAuditEvidenceTier;
    bucket?: TimelineAuditTimeBucket;
    dayOffset?: number;
    minuteOffset?: number;
    absoluteWhen?: Date;
    normalizedText?: string;
    snippet: string;
}

export interface TimelineAuditSceneInput {
    file: TFile;
    sceneId: string;
    title: string;
    path: string;
    manuscriptOrderIndex: number;
    rawWhen: string | null;
    parsedWhen: Date | null;
    whenValid: boolean;
    whenParseIssue: 'missing_when' | 'invalid_when' | null;
    whenConfidence?: WhenConfidence;
    summary: string;
    synopsis: string;
    bodyExcerpt: string;
}

export interface TimelineAuditEvidence {
    source: TimelineAuditEvidenceSource;
    detectionSource: TimelineAuditDetectionSource;
    tier: TimelineAuditEvidenceTier;
    label: string;
    snippet: string;
}

export interface TimelineAuditIssue {
    type: TimelineAuditIssueType;
    severity: 'warning' | 'contradiction';
    tier: TimelineAuditEvidenceTier;
    detectionSource: TimelineAuditDetectionSource;
    summary: string;
}

export interface TimelineAuditWrittenPosition {
    label: string;
    basis: 'explicit' | 'inferred' | 'unknown';
}

export interface TimelineAuditSuggestion {
    when: Date;
    confidence: WhenConfidence;
    provenance: WhenSource;
    reason: string;
    source: TimelineAuditDetectionSource;
    safeApply: boolean;
}

export interface TimelineAuditFinding {
    file: TFile;
    sceneId: string;
    title: string;
    path: string;
    manuscriptOrderIndex: number;
    currentWhenRaw: string | null;
    currentWhen: Date | null;
    whenValid: boolean;
    whenParseIssue: 'missing_when' | 'invalid_when' | null;
    currentWhenConfidence?: WhenConfidence;
    expectedChronologyPosition: number | null;
    inferredWrittenTimelinePosition: TimelineAuditWrittenPosition | null;
    status: TimelineAuditStatus;
    issues: TimelineAuditIssue[];
    evidence: TimelineAuditEvidence[];
    rationale: string;
    suggestedWhen: Date | null;
    suggestedConfidence: WhenConfidence | null;
    suggestedProvenance: WhenSource | null;
    allowedActions: TimelineAuditAction[];
    reviewAction: TimelineAuditReviewAction;
    unresolved: boolean;
    aiSuggested: boolean;
    /** True when this scene returned a valid response in the latest AI pass. */
    aiChecked?: boolean;
    aiTimelineRole?: TimelineAuditAiTimelineRole | null;
    safeApplyEligible: boolean;
}

export interface TimelineAuditStats {
    totalScenes: number;
    aligned: number;
    warnings: number;
    contradictions: number;
    missingWhen: number;
}

export interface TimelineAuditResult {
    findings: TimelineAuditFinding[];
    stats: TimelineAuditStats;
    appliedSuggestionCount: number;
    unresolvedCount: number;
    aiRunSummary?: TimelineAuditAiRunSummary;
}

export interface TimelineAuditPipelineConfig {
    runDeterministicPass: boolean;
    runContinuityPass: boolean;
    runAiInference: boolean;
    bodyExcerptChars?: number;
    chronologyWindow?: number;
    aiScope?: TimelineAuditAiScope;
}

export interface TimelineAuditAiResponse {
    rationale: string;
    evidenceQuotes: string[];
    issueType?: TimelineAuditIssueType;
    evidenceTier: TimelineAuditEvidenceTier;
    writtenTimelinePosition: string;
    timelineRole: TimelineAuditAiTimelineRole;
    suggestedWhen: string;
    confidence: WhenConfidence;
}

export interface TimelineAuditCallbacks {
    onStageChange?: (stage: 'deterministic' | 'continuity' | 'ai' | 'complete') => void;
    onAiQueue?: (total: number) => void;
    onAiProgress?: (current: number, total: number, sceneName: string) => void;
    abortSignal?: AbortSignal;
}
