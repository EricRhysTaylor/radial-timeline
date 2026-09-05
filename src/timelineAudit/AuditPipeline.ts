/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Auditor - Audit Pipeline
 */

import type { Vault } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getAIClient } from '../ai/runtime/aiClient';
import type { AIProviderId, Capability } from '../ai/types';
import { parseWhenField } from '../utils/date';
import { buildChronologyEntries, buildChronologyPositionMap } from './chronology';
import { loadScopedSceneNotes } from '../timeline/sharedSceneNotes';
import type {
    TimelineAuditAiResponse,
    TimelineAuditAiRunSummary,
    TimelineAuditAiScope,
    TimelineAuditCallbacks,
    TimelineAuditCue,
    TimelineAuditDetectionSource,
    TimelineAuditEvidence,
    TimelineAuditEvidenceSource,
    TimelineAuditEvidenceTier,
    TimelineAuditFinding,
    TimelineAuditIssue,
    TimelineAuditIssueType,
    TimelineAuditPipelineConfig,
    TimelineAuditResult,
    TimelineAuditSceneInput,
    TimelineAuditStatus,
    TimelineAuditSuggestion,
    TimelineAuditTimeBucket
} from './types';

interface WorkingFinding extends TimelineAuditFinding {
    cues: TimelineAuditCue[];
    notes: string[];
    detectionSources: Set<TimelineAuditDetectionSource>;
}

const DEFAULT_CONFIG: TimelineAuditPipelineConfig = {
    runDeterministicPass: true,
    runContinuityPass: true,
    runAiInference: false,
    bodyExcerptChars: 2600,
    chronologyWindow: 2
};

const TIME_BUCKET_HOURS: Record<TimelineAuditTimeBucket, number> = {
    morning: 8,
    afternoon: 13,
    evening: 19,
    night: 23
};

const CONTRADICTION_ISSUES = new Set<TimelineAuditIssueType>([
    'time_of_day_conflict',
    'relative_order_conflict',
    'impossible_sequence',
    'summary_body_disagree'
]);

type PatternDef = {
    pattern: RegExp;
    cue: Omit<TimelineAuditCue, 'source' | 'snippet' | 'normalizedText' | 'label'> & { label: string };
};

const TIME_OF_DAY_PATTERNS: PatternDef[] = [
    { pattern: /\b(?:at\s+)?dawn\b/i, cue: { kind: 'time_of_day', label: 'dawn', bucket: 'morning', tier: 'direct' } },
    { pattern: /\b(?:next|that|this|the|early)\s+morning\b/i, cue: { kind: 'time_of_day', label: 'morning', bucket: 'morning', tier: 'direct' } },
    { pattern: /\b(?:that|this|the|late)\s+afternoon\b/i, cue: { kind: 'time_of_day', label: 'afternoon', bucket: 'afternoon', tier: 'direct' } },
    { pattern: /\b(?:that|this|the|late)\s+evening\b/i, cue: { kind: 'time_of_day', label: 'evening', bucket: 'evening', tier: 'direct' } },
    { pattern: /\blater\s+that\s+night\b/i, cue: { kind: 'time_of_day', label: 'later that night', bucket: 'night', tier: 'strong_inference' } },
    { pattern: /\bmidnight\b/i, cue: { kind: 'time_of_day', label: 'midnight', bucket: 'night', tier: 'direct' } },
    { pattern: /\bnoon\b/i, cue: { kind: 'time_of_day', label: 'noon', bucket: 'afternoon', tier: 'direct' } },
    { pattern: /\bmorning\b/i, cue: { kind: 'time_of_day', label: 'morning', bucket: 'morning', tier: 'direct' } },
    { pattern: /\bafternoon\b/i, cue: { kind: 'time_of_day', label: 'afternoon', bucket: 'afternoon', tier: 'direct' } },
    { pattern: /\bevening\b/i, cue: { kind: 'time_of_day', label: 'evening', bucket: 'evening', tier: 'direct' } },
    { pattern: /\bnight\b/i, cue: { kind: 'time_of_day', label: 'night', bucket: 'night', tier: 'direct' } },
    // Removed weak: bare "later" — too ambiguous without temporal context
];

const RELATIVE_PATTERNS: PatternDef[] = [
    { pattern: /\b(?:the\s+)?next\s+morning\b/i, cue: { kind: 'relative_offset', label: 'next morning', bucket: 'morning', dayOffset: 1, tier: 'direct' } },
    { pattern: /\b(?:the\s+)?following\s+morning\b/i, cue: { kind: 'relative_offset', label: 'following morning', bucket: 'morning', dayOffset: 1, tier: 'direct' } },
    { pattern: /\blater\s+that\s+night\b/i, cue: { kind: 'relative_offset', label: 'later that night', bucket: 'night', dayOffset: 0, tier: 'strong_inference' } },
    { pattern: /\b(?:the\s+)?next\s+day\b/i, cue: { kind: 'relative_offset', label: 'next day', dayOffset: 1, tier: 'direct' } },
    { pattern: /\b(?:the\s+)?following\s+week\b/i, cue: { kind: 'relative_offset', label: 'following week', dayOffset: 7, tier: 'direct' } },
    { pattern: /\b(?:the\s+)?next\s+week\b/i, cue: { kind: 'relative_offset', label: 'next week', dayOffset: 7, tier: 'direct' } },
    { pattern: /\bthree\s+days?\s+later\b/i, cue: { kind: 'relative_offset', label: 'three days later', dayOffset: 3, tier: 'direct' } },
    { pattern: /\btwo\s+days?\s+later\b/i, cue: { kind: 'relative_offset', label: 'two days later', dayOffset: 2, tier: 'direct' } },
    // Removed weak: "a few days later" — ambiguous offset, unreliable for audit evidence
    { pattern: /\b(\d+)\s+days?\s+later\b/i, cue: { kind: 'relative_offset', label: 'days later', tier: 'direct' } },
    { pattern: /\bimmediately\s+after\b/i, cue: { kind: 'continuity', label: 'immediately after', minuteOffset: 5, tier: 'direct' } },
    { pattern: /\bmoments?\s+later\b/i, cue: { kind: 'continuity', label: 'moments later', minuteOffset: 10, tier: 'direct' } },
    { pattern: /\ban?\s+hour\s+later\b/i, cue: { kind: 'continuity', label: 'an hour later', minuteOffset: 60, tier: 'direct' } }
];

const ABSOLUTE_DATE_PATTERNS: Array<{ pattern: RegExp; extract: (match: RegExpMatchArray) => string | null; label: string }> = [
    {
        pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
        extract: (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`,
        label: 'explicit date'
    },
    {
        pattern: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
        extract: (m) => `${m[3]}-${monthNameToIndex(m[1])}-${m[2].padStart(2, '0')}`,
        label: 'explicit date'
    }
];

function monthNameToIndex(name: string): string {
    const index = [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december'
    ].indexOf(name.toLowerCase());
    return String(index + 1).padStart(2, '0');
}

function excerpt(text: string, maxChars: number): string {
    const trimmed = text.trim();
    if (maxChars <= 0) return trimmed;
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars).trim()}…`;
}

function getBucketForWhen(date: Date): TimelineAuditTimeBucket {
    const hour = date.getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
}

function adjustDateToBucket(date: Date, bucket: TimelineAuditTimeBucket): Date {
    const adjusted = new Date(date);
    adjusted.setHours(TIME_BUCKET_HOURS[bucket], 0, 0, 0);
    return adjusted;
}

function formatWhen(date: Date | null): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Missing';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * Human-readable duration for a gap between two scenes, always positive —
 * direction (before/after) is expressed by the surrounding sentence.
 */
function formatGapDuration(ms: number): string {
    const minutes = Math.round(Math.abs(ms) / 60000);
    if (minutes < 2) return 'about a minute';
    if (minutes < 60) return `about ${minutes} minutes`;
    const hours = Math.round(minutes / 60);
    if (hours < 2) return 'about an hour';
    if (hours < 48) return `about ${hours} hours`;
    const days = Math.round(hours / 24);
    if (days < 60) return `about ${days} days`;
    const months = Math.round(days / 30.44);
    if (months < 24) return `about ${months} months`;
    const years = Math.round(days / 365.25);
    return `about ${years} years`;
}

function roundDays(ms: number): number {
    return Math.round(ms / (24 * 60 * 60 * 1000));
}

function hasSignalCue(cues: TimelineAuditCue[], predicate: (cue: TimelineAuditCue) => boolean): boolean {
    return cues.some(predicate);
}

function strongestCue(cues: TimelineAuditCue[]): TimelineAuditCue | null {
    if (cues.length === 0) return null;
    const order: Record<TimelineAuditEvidenceTier, number> = { direct: 0, strong_inference: 1, ambiguous: 2 };
    return cues.slice().sort((a, b) => {
        const aScore = order[a.tier] ?? 99;
        const bScore = order[b.tier] ?? 99;
        if (aScore !== bScore) return aScore - bScore;
        if (a.kind === b.kind) return 0;
        if (a.kind === 'absolute_date') return -1;
        if (b.kind === 'absolute_date') return 1;
        return 0;
    })[0];
}

function cueToEvidence(cue: TimelineAuditCue, detectionSource: TimelineAuditDetectionSource): TimelineAuditEvidence {
    return {
        source: cue.source,
        detectionSource,
        tier: cue.tier,
        label: cue.label,
        snippet: cue.snippet
    };
}

function addIssue(
    finding: WorkingFinding,
    type: TimelineAuditIssueType,
    detectionSource: TimelineAuditDetectionSource,
    tier: TimelineAuditEvidenceTier,
    summary: string
): void {
    if (finding.issues.some((issue) => issue.type === type && issue.summary === summary)) return;

    const severity: TimelineAuditIssue['severity'] = CONTRADICTION_ISSUES.has(type) && tier !== 'ambiguous'
        ? 'contradiction'
        : 'warning';

    finding.issues.push({
        type,
        severity,
        tier,
        detectionSource,
        summary
    });
    finding.detectionSources.add(detectionSource);
    finding.notes.push(summary);
}

function addEvidence(
    finding: WorkingFinding,
    evidence: TimelineAuditEvidence
): void {
    if (finding.evidence.some((item) => item.source === evidence.source && item.snippet === evidence.snippet && item.label === evidence.label)) {
        return;
    }
    finding.evidence.push(evidence);
    finding.detectionSources.add(evidence.detectionSource);
}

function setSuggestion(
    finding: WorkingFinding,
    suggestion: TimelineAuditSuggestion,
    replaceSafeSuggestion = false
): void {
    if (finding.suggestedWhen && finding.safeApplyEligible && !replaceSafeSuggestion) return;
    finding.suggestedWhen = suggestion.when;
    finding.suggestedConfidence = suggestion.confidence;
    finding.suggestedProvenance = suggestion.provenance;
    finding.safeApplyEligible = suggestion.safeApply;
    finding.aiSuggested = suggestion.source === 'ai';
    finding.notes.push(suggestion.reason);
    finding.detectionSources.add(suggestion.source);
}

function createWorkingFinding(
    input: TimelineAuditSceneInput,
    chronologyPositionMap: Map<string, number>
): WorkingFinding {
    const issues: TimelineAuditIssue[] = [];
    const notes: string[] = [];

    if (input.whenParseIssue === 'missing_when') {
        issues.push({
            type: 'missing_when',
            severity: 'warning',
            tier: 'direct',
            detectionSource: 'deterministic',
            summary: 'Scene is missing a YAML When value.'
        });
        notes.push('Missing When prevents stable chronology placement.');
    } else if (input.whenParseIssue === 'invalid_when') {
        issues.push({
            type: 'invalid_when',
            severity: 'warning',
            tier: 'direct',
            detectionSource: 'deterministic',
            summary: 'Scene has an invalid YAML When value.'
        });
        notes.push('Invalid When prevents reliable chronology placement.');
    }

    return {
        file: input.file,
        sceneId: input.sceneId,
        title: input.title,
        path: input.path,
        manuscriptOrderIndex: input.manuscriptOrderIndex,
        currentWhenRaw: input.rawWhen,
        currentWhen: input.parsedWhen,
        whenValid: input.whenValid,
        whenParseIssue: input.whenParseIssue,
        currentWhenConfidence: input.whenConfidence,
        expectedChronologyPosition: chronologyPositionMap.get(input.path) ?? null,
        inferredWrittenTimelinePosition: null,
        status: 'aligned',
        issues,
        evidence: [],
        rationale: '',
        suggestedWhen: null,
        suggestedConfidence: null,
        suggestedProvenance: null,
        allowedActions: ['keep'],
        reviewAction: 'keep',
        unresolved: issues.length > 0,
        aiSuggested: false,
        aiChecked: false,
        aiTimelineRole: null,
        safeApplyEligible: false,
        cues: [],
        notes,
        detectionSources: new Set(issues.length > 0 ? ['deterministic'] : [])
    };
}

function extractCues(text: string, source: TimelineAuditEvidenceSource): TimelineAuditCue[] {
    const cues: TimelineAuditCue[] = [];
    if (!text.trim()) return cues;

    for (const def of TIME_OF_DAY_PATTERNS) {
        const match = text.match(def.pattern);
        if (!match) continue;
        cues.push({
            ...def.cue,
            source,
            snippet: match[0],
            normalizedText: match[0].toLowerCase()
        });
    }

    for (const def of RELATIVE_PATTERNS) {
        const match = text.match(def.pattern);
        if (!match) continue;
        const cue: TimelineAuditCue = {
            ...def.cue,
            source,
            snippet: match[0],
            normalizedText: match[0].toLowerCase()
        };
        if (cue.label === 'days later' && match[1]) {
            cue.dayOffset = Number.parseInt(match[1], 10);
            cue.label = `${cue.dayOffset} days later`;
        }
        cues.push(cue);
    }

    for (const def of ABSOLUTE_DATE_PATTERNS) {
        const match = text.match(def.pattern);
        if (!match) continue;
        const raw = def.extract(match);
        if (!raw) continue;
        const absoluteWhen = parseWhenField(raw);
        if (!absoluteWhen) continue;
        cues.push({
            kind: 'absolute_date',
            label: def.label,
            source,
            tier: 'direct',
            absoluteWhen,
            snippet: match[0],
            normalizedText: raw
        });
    }

    return cues;
}

function compareSummaryAndBodyCues(
    finding: WorkingFinding,
    summaryCues: TimelineAuditCue[],
    bodyCues: TimelineAuditCue[]
): void {
    const summaryPrimary = strongestCue(summaryCues.filter((cue) => cue.kind !== 'continuity'));
    const bodyPrimary = strongestCue(bodyCues.filter((cue) => cue.kind !== 'continuity'));
    if (!summaryPrimary || !bodyPrimary) return;

    const bucketMismatch = summaryPrimary.bucket && bodyPrimary.bucket && summaryPrimary.bucket !== bodyPrimary.bucket;
    const absoluteMismatch = summaryPrimary.absoluteWhen && bodyPrimary.absoluteWhen
        && summaryPrimary.absoluteWhen.getTime() !== bodyPrimary.absoluteWhen.getTime();

    if (!bucketMismatch && !absoluteMismatch) return;

    addIssue(
        finding,
        'summary_body_disagree',
        'deterministic',
        summaryPrimary.tier === 'direct' && bodyPrimary.tier === 'direct' ? 'direct' : 'strong_inference',
        'Summary and body imply different timeline signals.'
    );
    addEvidence(finding, cueToEvidence(summaryPrimary, 'deterministic'));
    addEvidence(finding, cueToEvidence(bodyPrimary, 'deterministic'));
}

function compareWhenAgainstCue(
    finding: WorkingFinding,
    cue: TimelineAuditCue
): void {
    if (!finding.currentWhen) return;

    if (cue.kind === 'absolute_date' && cue.absoluteWhen) {
        const sameDate = cue.absoluteWhen.getFullYear() === finding.currentWhen.getFullYear()
            && cue.absoluteWhen.getMonth() === finding.currentWhen.getMonth()
            && cue.absoluteWhen.getDate() === finding.currentWhen.getDate();
        if (!sameDate) {
            addIssue(
                finding,
                'relative_order_conflict',
                'deterministic',
                cue.tier,
                `Body evidence points to ${formatWhen(cue.absoluteWhen)}, but YAML says ${formatWhen(finding.currentWhen)}.`
            );
            addEvidence(finding, cueToEvidence(cue, 'deterministic'));
            setSuggestion(finding, {
                when: cue.absoluteWhen,
                confidence: 'high',
                provenance: 'keyword',
                reason: 'Direct date evidence suggests a different calendar day.',
                source: 'deterministic',
                safeApply: true
            });
        }
        return;
    }

    if (cue.kind === 'time_of_day' && cue.bucket) {
        const yamlBucket = getBucketForWhen(finding.currentWhen);
        if (yamlBucket !== cue.bucket) {
            addIssue(
                finding,
                cue.tier === 'ambiguous' ? 'ambiguous_time_signal' : 'time_of_day_conflict',
                'deterministic',
                cue.tier,
                `Text implies ${cue.bucket}, but YAML When is ${yamlBucket}.`
            );
            addEvidence(finding, cueToEvidence(cue, 'deterministic'));
            if (cue.tier !== 'ambiguous') {
                setSuggestion(finding, {
                    when: adjustDateToBucket(finding.currentWhen, cue.bucket),
                    confidence: cue.tier === 'direct' ? 'high' : 'med',
                    provenance: 'keyword',
                    reason: `Direct ${cue.source} time-of-day evidence suggests ${cue.bucket}.`,
                    source: 'deterministic',
                    safeApply: cue.tier === 'direct'
                });
            }
        }
    }
}

function detectInsufficientEvidence(
    finding: WorkingFinding,
    input: TimelineAuditSceneInput
): void {
    const hasAnyText = Boolean(input.summary || input.synopsis || input.bodyExcerpt);
    if (!hasAnyText) {
        addIssue(
            finding,
            'insufficient_evidence',
            'deterministic',
            'ambiguous',
            'No usable scene text was available for timeline auditing.'
        );
        return;
    }

    if (finding.whenParseIssue && finding.cues.length === 0) {
        addIssue(
            finding,
            'insufficient_evidence',
            'deterministic',
            'ambiguous',
            'No clear temporal evidence was found to replace the missing or invalid When.'
        );
    }
}

function detectDeterministicFindings(inputs: TimelineAuditSceneInput[], findingMap: Map<string, WorkingFinding>): void {
    for (const input of inputs) {
        const finding = findingMap.get(input.path);
        if (!finding) continue;

        const summaryCues = extractCues(input.summary, 'summary');
        const synopsisCues = extractCues(input.synopsis, 'synopsis');
        const bodyCues = extractCues(input.bodyExcerpt, 'body');
        finding.cues.push(...summaryCues, ...synopsisCues, ...bodyCues);

        compareSummaryAndBodyCues(finding, summaryCues, bodyCues);

        const strongestDirectCue = strongestCue(finding.cues.filter((cue) => cue.tier !== 'ambiguous'));
        if (strongestDirectCue) {
            compareWhenAgainstCue(finding, strongestDirectCue);
            addEvidence(finding, cueToEvidence(strongestDirectCue, 'deterministic'));
        } else {
            const ambiguousCue = strongestCue(finding.cues);
            if (ambiguousCue) {
                addIssue(
                    finding,
                    'ambiguous_time_signal',
                    'deterministic',
                    ambiguousCue.tier,
                    `Temporal evidence is suggestive but not decisive: ${ambiguousCue.label}.`
                );
                addEvidence(finding, cueToEvidence(ambiguousCue, 'deterministic'));
            }
        }

        detectInsufficientEvidence(finding, input);
    }
}

function findingHasLargeJumpCue(finding: WorkingFinding): boolean {
    return hasSignalCue(
        finding.cues,
        (cue) =>
            cue.kind === 'absolute_date'
            || (cue.kind === 'relative_offset' && typeof cue.dayOffset === 'number' && cue.dayOffset >= 2)
    );
}

function continuityIssueSummary(currentTitle: string, previousTitle: string, deltaMs: number): string {
    if (deltaMs < 0) {
        return `${currentTitle} lands ${formatGapDuration(deltaMs)} before ${previousTitle}, earlier than its chronological neighbor.`;
    }
    return `${currentTitle} lands ${formatGapDuration(deltaMs)} after ${previousTitle} in chronology.`;
}

function applyRelativeCueAgainstAnchor(
    finding: WorkingFinding,
    currentInput: TimelineAuditSceneInput,
    cue: TimelineAuditCue,
    anchorInput: TimelineAuditSceneInput,
    anchorLabel: string
): void {
    if (!currentInput.parsedWhen || !anchorInput.parsedWhen) return;

    const deltaMs = currentInput.parsedWhen.getTime() - anchorInput.parsedWhen.getTime();

    if (cue.dayOffset !== undefined) {
        const deltaDays = roundDays(deltaMs);
        const expectedDays = cue.dayOffset;
        const mismatch = Math.abs(deltaDays - expectedDays) > (cue.tier === 'ambiguous' ? 2 : 0);
        if (!mismatch) return;

        const issueType: TimelineAuditIssueType = cue.tier === 'direct' && expectedDays <= 1 && deltaDays >= 3
            ? 'impossible_sequence'
            : 'relative_order_conflict';

        addIssue(
            finding,
            issueType,
            'continuity',
            cue.tier,
            `${cue.label} conflicts with the ${anchorLabel.toLowerCase()} gap from ${anchorInput.title}.`
        );
        addEvidence(finding, {
            source: 'neighbor',
            detectionSource: 'continuity',
            tier: cue.tier,
            label: anchorLabel,
            snippet: continuityIssueSummary(currentInput.title, anchorInput.title, deltaMs)
        });

        if (cue.bucket) {
            const suggested = new Date(anchorInput.parsedWhen);
            suggested.setDate(suggested.getDate() + expectedDays);
            suggested.setHours(TIME_BUCKET_HOURS[cue.bucket], 0, 0, 0);
            setSuggestion(finding, {
                when: suggested,
                confidence: cue.tier === 'direct' ? 'high' : 'med',
                provenance: 'keyword',
                reason: `Relative cue "${cue.label}" is anchored against ${anchorInput.title}.`,
                source: 'continuity',
                safeApply: cue.tier === 'direct'
            });
        }

        finding.inferredWrittenTimelinePosition = {
            label: `After ${anchorInput.title} by about ${cue.label}`,
            basis: cue.tier === 'direct' ? 'explicit' : 'inferred'
        };
        return;
    }

    if (cue.minuteOffset !== undefined) {
        const mismatch = deltaMs > 12 * 60 * 60 * 1000;
        if (!mismatch) return;
        addIssue(
            finding,
            'impossible_sequence',
            'continuity',
            cue.tier,
            `${cue.label} conflicts with the ${anchorLabel.toLowerCase()} gap from ${anchorInput.title}.`
        );
        addEvidence(finding, {
            source: 'neighbor',
            detectionSource: 'continuity',
            tier: cue.tier,
            label: anchorLabel,
            snippet: continuityIssueSummary(currentInput.title, anchorInput.title, deltaMs)
        });
    }
}

function pickRelativeContinuityCue(cues: TimelineAuditCue[]): TimelineAuditCue | null {
    const relevant = cues.filter((cue) => cue.kind === 'relative_offset' || cue.kind === 'continuity');
    if (relevant.length === 0) return null;
    return relevant.find((cue) => cue.tier === 'direct' && (cue.dayOffset !== undefined || cue.minuteOffset !== undefined))
        ?? relevant.find((cue) => cue.dayOffset !== undefined || cue.minuteOffset !== undefined)
        ?? strongestCue(relevant);
}

function detectContinuityFindings(inputs: TimelineAuditSceneInput[], findingMap: Map<string, WorkingFinding>, windowSize: number): void {
    const chronologyEntries = buildChronologyEntries(inputs);
    if (chronologyEntries.length < 2) return;

    const gaps = chronologyEntries
        .slice(1)
        .map((entry, index) => entry.input.parsedWhen!.getTime() - chronologyEntries[index].input.parsedWhen!.getTime())
        .filter((gap) => gap > 0);
    const sortedGaps = gaps.slice().sort((a, b) => a - b);
    const baselineGap = sortedGaps[0] ?? 24 * 60 * 60 * 1000;
    const largeGapThreshold = Math.max(baselineGap * 4, 48 * 60 * 60 * 1000);

    for (let index = 0; index < chronologyEntries.length; index += 1) {
        const currentEntry = chronologyEntries[index];
        const currentFinding = findingMap.get(currentEntry.input.path);
        if (!currentFinding || !currentEntry.input.parsedWhen) continue;
        const currentRelativeCue = pickRelativeContinuityCue(currentFinding.cues);

        const previousEntry = chronologyEntries[index - 1];
        if (previousEntry?.input.parsedWhen) {
            const deltaMs = currentEntry.input.parsedWhen.getTime() - previousEntry.input.parsedWhen.getTime();

            if (currentRelativeCue?.dayOffset !== undefined) {
                const deltaDays = roundDays(deltaMs);
                const expectedDays = currentRelativeCue.dayOffset;
                const mismatch = Math.abs(deltaDays - expectedDays) > (currentRelativeCue.tier === 'ambiguous' ? 2 : 0);
                if (mismatch) {
                    const issueType: TimelineAuditIssueType = currentRelativeCue.tier === 'direct' && expectedDays <= 1 && deltaDays >= 3
                        ? 'impossible_sequence'
                        : 'relative_order_conflict';
                    addIssue(
                        currentFinding,
                        issueType,
                        'continuity',
                        currentRelativeCue.tier,
                        `${currentRelativeCue.label} conflicts with the current chronological gap from ${previousEntry.input.title}.`
                    );
                    addEvidence(currentFinding, {
                        source: 'neighbor',
                        detectionSource: 'continuity',
                        tier: currentRelativeCue.tier,
                        label: 'Neighbor chronology',
                        snippet: continuityIssueSummary(currentEntry.input.title, previousEntry.input.title, deltaMs)
                    });

                    if (currentFinding.currentWhen && currentRelativeCue.bucket && expectedDays >= 0) {
                        const suggested = new Date(previousEntry.input.parsedWhen);
                        suggested.setDate(suggested.getDate() + expectedDays);
                        suggested.setHours(TIME_BUCKET_HOURS[currentRelativeCue.bucket], 0, 0, 0);
                        setSuggestion(currentFinding, {
                            when: suggested,
                            confidence: currentRelativeCue.tier === 'direct' ? 'high' : 'med',
                            provenance: 'keyword',
                            reason: `Relative cue "${currentRelativeCue.label}" is anchored against the previous chronological scene.`,
                            source: 'continuity',
                            safeApply: currentRelativeCue.tier === 'direct'
                        });
                    }
                    currentFinding.inferredWrittenTimelinePosition = {
                        label: `After ${previousEntry.input.title} by about ${currentRelativeCue.label}`,
                        basis: currentRelativeCue.tier === 'direct' ? 'explicit' : 'inferred'
                    };
                }
            } else if (currentRelativeCue?.minuteOffset !== undefined) {
                const mismatch = deltaMs > 12 * 60 * 60 * 1000;
                if (mismatch) {
                    addIssue(
                        currentFinding,
                        'impossible_sequence',
                        'continuity',
                        currentRelativeCue.tier,
                        `${currentRelativeCue.label} conflicts with the much larger chronology gap from ${previousEntry.input.title}.`
                    );
                    addEvidence(currentFinding, {
                        source: 'neighbor',
                        detectionSource: 'continuity',
                        tier: currentRelativeCue.tier,
                        label: 'Neighbor chronology',
                        snippet: continuityIssueSummary(currentEntry.input.title, previousEntry.input.title, deltaMs)
                    });
                }
            } else if (deltaMs > largeGapThreshold) {
                const previousFinding = findingMap.get(previousEntry.input.path);
                const hasJustification = findingHasLargeJumpCue(currentFinding) || (previousFinding ? findingHasLargeJumpCue(previousFinding) : false);
                if (!hasJustification) {
                    addIssue(
                        currentFinding,
                        'continuity_conflict',
                        'continuity',
                        'strong_inference',
                        `Large chronology jump from ${previousEntry.input.title} is not clearly justified in nearby text.`
                    );
                    addEvidence(currentFinding, {
                        source: 'neighbor',
                        detectionSource: 'continuity',
                        tier: 'strong_inference',
                        label: 'Neighbor chronology',
                        snippet: continuityIssueSummary(currentEntry.input.title, previousEntry.input.title, deltaMs)
                    });
                }
            }
        }

        const previousNarrative = currentEntry.input.manuscriptOrderIndex > 0
            ? inputs[currentEntry.input.manuscriptOrderIndex - 1]
            : null;
        if (
            currentRelativeCue
            && previousNarrative
            && previousNarrative.path !== previousEntry?.input.path
            && previousNarrative.parsedWhen instanceof Date
        ) {
            applyRelativeCueAgainstAnchor(
                currentFinding,
                currentEntry.input,
                currentRelativeCue,
                previousNarrative,
                'Narrative neighbor'
            );
        }

        const windowStart = Math.max(0, index - windowSize);
        const windowEnd = Math.min(chronologyEntries.length, index + windowSize + 1);
        const localTitles = chronologyEntries
            .slice(windowStart, windowEnd)
            .filter((entry) => entry.input.path !== currentEntry.input.path)
            .map((entry) => entry.input.title);
        if (localTitles.length > 0 && currentFinding.inferredWrittenTimelinePosition === null && currentFinding.cues.length > 0) {
            const cue = strongestCue(currentFinding.cues.filter((item) => item.kind === 'relative_offset' || item.kind === 'continuity'));
            if (cue) {
                currentFinding.inferredWrittenTimelinePosition = {
                    label: `${cue.label} relative to nearby chronology (${localTitles[0]})`,
                    basis: cue.tier === 'direct' ? 'explicit' : 'inferred'
                };
            }
        }
    }
}

function compactNeighborEvidence(input: TimelineAuditSceneInput | null): string {
    if (!input) return 'N/A';
    const evidence = input.synopsis.trim() || input.summary.trim() || 'No synopsis or summary.'; // SAFE: prompt copy explicitly identifies absent neighbor context
    const compact = evidence.replace(/\s+/g, ' ');
    const clipped = compact.length > 900 ? `${compact.slice(0, 899).trimEnd()}…` : compact;
    return `${input.title} | current When: ${formatWhen(input.parsedWhen)} | ${clipped}`;
}

function buildManuscriptNarrativeMap(inputs: TimelineAuditSceneInput[]): string {
    return inputs
        .slice()
        .sort((a, b) => a.manuscriptOrderIndex - b.manuscriptOrderIndex)
        .map(input => `${input.manuscriptOrderIndex + 1}. ${input.title} | provisional When: ${formatWhen(input.parsedWhen)}`)
        .join('\n');
}

export function buildTimelineAuditAiPrompt(
    input: TimelineAuditSceneInput,
    previousNarrative: TimelineAuditSceneInput | null,
    nextNarrative: TimelineAuditSceneInput | null,
    manuscriptInputs: TimelineAuditSceneInput[]
): string {
    const provisionalWhen = input.rawWhen ?? 'Missing'; // SAFE: prompt must label a genuinely missing provisional date
    const summary = input.summary || 'N/A'; // SAFE: prompt must label an absent optional scene summary
    const synopsis = input.synopsis || 'N/A'; // SAFE: prompt must label an absent optional scene synopsis
    const body = input.bodyExcerpt || 'N/A'; // SAFE: prompt must label an empty scene body
    return `You are reconstructing a fiction manuscript chronology scene by scene.

The current YAML When may be a rough scaffold. Treat it as provisional evidence, not truth. Read the manuscript evidence and decide whether this scene is mainline action, a flashback, a flash-forward, parallel action, or unclear. Infer an updated timestamp only when the text and neighboring narrative scenes support one. Preserve uncertainty instead of inventing precision.

Manuscript narrative map (all dates are provisional):
${buildManuscriptNarrativeMap(manuscriptInputs)}

Current narrative position: ${input.manuscriptOrderIndex + 1} of ${manuscriptInputs.length}
Current scene: ${input.title}
Current provisional YAML When: ${provisionalWhen}

Previous scene in narrative order:
${compactNeighborEvidence(previousNarrative)}

Next scene in narrative order:
${compactNeighborEvidence(nextNarrative)}

Current scene summary:
${summary}

Current scene synopsis:
${synopsis}

Current scene manuscript text:
${body}

Check all of the following:
- explicit dates, ages, elapsed time, day names, seasons, and time of day;
- continuity with the previous and next narrative scenes;
- memories, dreams, backstory, flashbacks, flash-forwards, and parallel action;
- whether the provisional When puts the scene in the wrong era, day, order, or time bucket.

Return JSON only. Use an empty string when no issue, position, or timestamp can be supported. suggestedWhen must be YYYY-MM-DD HH:mm when present.
{
  "rationale": string,
  "evidenceQuotes": string[],
  "issueType": "time_of_day_conflict" | "relative_order_conflict" | "continuity_conflict" | "ambiguous_time_signal" | "insufficient_evidence" | "",
  "evidenceTier": "direct" | "strong_inference" | "ambiguous",
  "writtenTimelinePosition": string,
  "timelineRole": "mainline" | "flashback" | "flash_forward" | "parallel" | "unclear",
  "suggestedWhen": string,
  "confidence": "high" | "med" | "low"
}`;
}

/**
 * JSON schema for the TimelineAuditAI per-scene response. Exported so the
 * strict-schema test in src/ai/prompts/strictSchemas.test.ts can assert
 * OpenAI structured-output compatibility (additionalProperties: false +
 * required covers every property key). The previous inline definition
 * had only 2 of 7 fields in required and no additionalProperties, which
 * would silently break OpenAI strict mode.
 */
export function getTimelineAuditAiResponseSchema(): Record<string, unknown> {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            rationale: { type: 'string' },
            evidenceQuotes: { type: 'array', items: { type: 'string' } },
            issueType: {
                type: 'string',
                enum: [
                    'time_of_day_conflict',
                    'relative_order_conflict',
                    'continuity_conflict',
                    'ambiguous_time_signal',
                    'insufficient_evidence',
                    ''
                ]
            },
            evidenceTier: { type: 'string', enum: ['direct', 'strong_inference', 'ambiguous'] },
            writtenTimelinePosition: { type: 'string' },
            timelineRole: { type: 'string', enum: ['mainline', 'flashback', 'flash_forward', 'parallel', 'unclear'] },
            suggestedWhen: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'med', 'low'] }
        },
        required: [
            'rationale',
            'evidenceQuotes',
            'issueType',
            'evidenceTier',
            'writtenTimelinePosition',
            'timelineRole',
            'suggestedWhen',
            'confidence'
        ]
    };
}

export function parseAuditAiResponse(content: string): TimelineAuditAiResponse | null {
    try {
        let json = content.trim();
        const fenced = json.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenced) {
            json = fenced[1].trim();
        }
        const parsed = JSON.parse(json) as Record<string, unknown>;
        if (!parsed || typeof parsed.rationale !== 'string') return null;

        const issueTypes = new Set<TimelineAuditIssueType>([
            'time_of_day_conflict',
            'relative_order_conflict',
            'continuity_conflict',
            'ambiguous_time_signal',
            'insufficient_evidence'
        ]);
        const evidenceTiers = new Set<TimelineAuditEvidenceTier>(['direct', 'strong_inference', 'ambiguous']);
        const timelineRoles = new Set<TimelineAuditAiResponse['timelineRole']>([
            'mainline',
            'flashback',
            'flash_forward',
            'parallel',
            'unclear'
        ]);
        const confidenceValues = new Set<TimelineAuditAiResponse['confidence']>(['high', 'med', 'low']);
        const issueType = typeof parsed.issueType === 'string' && issueTypes.has(parsed.issueType as TimelineAuditIssueType)
            ? parsed.issueType as TimelineAuditIssueType
            : undefined;

        return {
            rationale: parsed.rationale,
            evidenceQuotes: Array.isArray(parsed.evidenceQuotes)
                ? parsed.evidenceQuotes.filter((quote): quote is string => typeof quote === 'string')
                : [],
            issueType,
            evidenceTier: typeof parsed.evidenceTier === 'string'
                && evidenceTiers.has(parsed.evidenceTier as TimelineAuditEvidenceTier)
                ? parsed.evidenceTier as TimelineAuditEvidenceTier
                : 'ambiguous',
            writtenTimelinePosition: typeof parsed.writtenTimelinePosition === 'string'
                ? parsed.writtenTimelinePosition
                : '',
            timelineRole: typeof parsed.timelineRole === 'string'
                && timelineRoles.has(parsed.timelineRole as TimelineAuditAiResponse['timelineRole'])
                ? parsed.timelineRole as TimelineAuditAiResponse['timelineRole']
                : 'unclear',
            suggestedWhen: typeof parsed.suggestedWhen === 'string' ? parsed.suggestedWhen : '',
            confidence: typeof parsed.confidence === 'string'
                && confidenceValues.has(parsed.confidence as TimelineAuditAiResponse['confidence'])
                ? parsed.confidence as TimelineAuditAiResponse['confidence']
                : 'low'
        };
    } catch {
        return null;
    }
}

export function getTimelineAuditAiRequiredCapabilities(provider: AIProviderId): Capability[] {
    if (provider === 'ollama') return ['jsonStrict'];
    return ['jsonStrict', 'reasoningStrong'];
}

export function selectTimelineAuditAiInputs(
    inputs: TimelineAuditSceneInput[],
    scope: TimelineAuditAiScope | undefined
): TimelineAuditSceneInput[] {
    const inNarrativeOrder = inputs.slice().sort((a, b) => a.manuscriptOrderIndex - b.manuscriptOrderIndex);
    if (!scope || scope.mode === 'manuscript') return inNarrativeOrder;

    const selectedPaths = new Set(scope.paths ?? []); // SAFE: non-manuscript scope without paths intentionally selects no scenes
    return inNarrativeOrder.filter(input => selectedPaths.has(input.path));
}

async function runAiInference(
    plugin: RadialTimelinePlugin,
    inputs: TimelineAuditSceneInput[],
    findingMap: Map<string, WorkingFinding>,
    callbacks: TimelineAuditCallbacks,
    scope: TimelineAuditAiScope | undefined
): Promise<TimelineAuditAiRunSummary> {
    const allNarrativeInputs = inputs.slice().sort((a, b) => a.manuscriptOrderIndex - b.manuscriptOrderIndex);
    const aiCandidates = selectTimelineAuditAiInputs(allNarrativeInputs, scope);
    const summary: TimelineAuditAiRunSummary = {
        scopeMode: scope?.mode ?? 'manuscript', // SAFE: omitted AI scope is the documented whole-manuscript mode
        requested: aiCandidates.length,
        checked: 0,
        suggestions: 0,
        failed: 0
    };

    callbacks.onAiQueue?.(aiCandidates.length);
    if (aiCandidates.length === 0) return summary;

    const aiClient = getAIClient(plugin);
    const aiSettings = plugin.settings.aiSettings;
    if (!aiSettings) {
        throw new Error('Timeline Audit AI requires configured AI settings.');
    }

    for (let index = 0; index < aiCandidates.length; index += 1) {
        if (callbacks.abortSignal?.aborted) break;
        const input = aiCandidates[index];
        const narrativeIndex = allNarrativeInputs.findIndex(candidate => candidate.path === input.path);
        const previous = narrativeIndex > 0 ? allNarrativeInputs[narrativeIndex - 1] : null;
        const next = narrativeIndex >= 0 && narrativeIndex < allNarrativeInputs.length - 1 ? allNarrativeInputs[narrativeIndex + 1] : null;
        const finding = findingMap.get(input.path);
        if (!finding) continue;

        callbacks.onAiProgress?.(index + 1, aiCandidates.length, input.title);

        try {
            const run = await aiClient.run({
                feature: 'TimelineAuditAI',
                task: 'TimelineDiagnosis',
                requiredCapabilities: getTimelineAuditAiRequiredCapabilities(aiSettings.provider),
                featureModeInstructions: 'Reconstruct fiction-scene chronology conservatively from manuscript evidence. Treat scaffolded dates as provisional and prefer uncertainty over invented precision.',
                userInput: buildTimelineAuditAiPrompt(input, previous, next, allNarrativeInputs),
                returnType: 'json',
                responseSchema: getTimelineAuditAiResponseSchema(),
                overrides: {
                    temperature: 0.2,
                    jsonStrict: true,
                    maxOutputMode: 'auto',
                    reasoningDepth: 'standard'
                }
            });

            if (run.aiStatus !== 'success' || !run.content) {
                summary.failed += 1;
                continue;
            }

            const parsed = parseAuditAiResponse(run.content);
            if (!parsed) {
                summary.failed += 1;
                continue;
            }

            finding.aiChecked = true;
            finding.aiTimelineRole = parsed.timelineRole;
            summary.checked += 1;
            finding.notes.push(parsed.rationale);
            finding.detectionSources.add('ai');

            for (const quote of parsed.evidenceQuotes) {
                addEvidence(finding, {
                    source: 'ai',
                    detectionSource: 'ai',
                    tier: parsed.evidenceTier,
                    label: 'AI evidence',
                    snippet: quote
                });
            }

            if (parsed.issueType) {
                addIssue(
                    finding,
                    parsed.issueType,
                    'ai',
                    parsed.evidenceTier,
                    parsed.rationale
                );
            }

            if (parsed.writtenTimelinePosition) {
                finding.inferredWrittenTimelinePosition = {
                    label: parsed.writtenTimelinePosition,
                    basis: parsed.evidenceTier === 'direct' ? 'explicit' : 'inferred'
                };
            }

            if (parsed.suggestedWhen) {
                const suggestedWhen = parseWhenField(parsed.suggestedWhen);
                if (suggestedWhen) {
                    const suggestionDiffers = !finding.currentWhen
                        || suggestedWhen.getTime() !== finding.currentWhen.getTime();
                    if (suggestionDiffers) {
                        setSuggestion(finding, {
                            when: suggestedWhen,
                            confidence: parsed.confidence,
                            provenance: 'ai',
                            reason: parsed.rationale,
                            source: 'ai',
                            safeApply: false
                        }, true);
                        summary.suggestions += 1;
                        if (!parsed.issueType) {
                            addIssue(
                                finding,
                                'ambiguous_time_signal',
                                'ai',
                                parsed.evidenceTier,
                                parsed.rationale
                            );
                        }
                    }
                }
            }
        } catch {
            summary.failed += 1;
        }
    }

    return summary;
}

function finalizeFinding(finding: WorkingFinding): TimelineAuditFinding {
    const { notes } = finding;
    const workingCopy: Partial<WorkingFinding> = { ...finding };
    delete workingCopy.cues;
    delete workingCopy.notes;
    delete workingCopy.detectionSources;
    const baseFinding = workingCopy as Omit<WorkingFinding, 'cues' | 'notes' | 'detectionSources'>;
    let status: TimelineAuditStatus = 'aligned';
    if (finding.issues.some((issue) => issue.severity === 'contradiction')) {
        status = 'contradiction';
    } else if (finding.issues.length > 0) {
        status = 'warning';
    }

    const hasDirectOrAnchoredEvidence = finding.issues.some((issue) =>
        issue.detectionSource !== 'ai' && (issue.tier === 'direct' || issue.tier === 'strong_inference')
    );

    const safeApplyEligible = Boolean(
        finding.suggestedWhen
        && finding.suggestedConfidence === 'high'
        && finding.suggestedProvenance
        && hasDirectOrAnchoredEvidence
        && !finding.aiSuggested
    ) || finding.safeApplyEligible;

    const hasSuggestion = finding.suggestedWhen instanceof Date && Boolean(finding.suggestedProvenance);
    const allowedActions: TimelineAuditFinding['allowedActions'] = hasSuggestion
        ? ['apply', 'keep', 'mark_review']
        : status === 'aligned'
            ? ['keep']
            : ['keep', 'mark_review'];

    const unresolved = status !== 'aligned';

    return {
        ...baseFinding,
        status,
        rationale: notes.filter(Boolean).join(' '),
        allowedActions,
        reviewAction: 'keep',
        unresolved,
        safeApplyEligible
    };
}

export function sortAuditFindingsForDisplay(a: TimelineAuditFinding, b: TimelineAuditFinding): number {
    const severityOrder: Record<TimelineAuditStatus, number> = {
        contradiction: 0,
        warning: 1,
        aligned: 2
    };
    const severityDelta = severityOrder[a.status] - severityOrder[b.status];
    if (severityDelta !== 0) return severityDelta;

    const aHasPosition = a.expectedChronologyPosition !== null;
    const bHasPosition = b.expectedChronologyPosition !== null;
    if (aHasPosition && bHasPosition) {
        return (a.expectedChronologyPosition ?? 0) - (b.expectedChronologyPosition ?? 0);
    }
    if (aHasPosition && !bHasPosition) return -1;
    if (!aHasPosition && bHasPosition) return 1;
    return a.manuscriptOrderIndex - b.manuscriptOrderIndex;
}

export async function buildTimelineAuditSceneInputs(
    plugin: RadialTimelinePlugin,
    vault: Vault = plugin.app.vault,
    excerptChars = DEFAULT_CONFIG.bodyExcerptChars ?? 2600
): Promise<TimelineAuditSceneInput[]> {
    const sceneNotes = await loadScopedSceneNotes(plugin, vault);
    return sceneNotes.map((scene) => {
        return {
            file: scene.file,
            sceneId: scene.sceneId,
            title: scene.title,
            path: scene.path,
            manuscriptOrderIndex: scene.manuscriptOrderIndex,
            rawWhen: scene.rawWhen,
            parsedWhen: scene.parsedWhen,
            whenValid: scene.parsedWhen instanceof Date,
            whenParseIssue: scene.whenParseIssue,
            whenConfidence: typeof scene.frontmatter.WhenConfidence === 'string' ? scene.frontmatter.WhenConfidence as TimelineAuditSceneInput['whenConfidence'] : undefined,
            summary: scene.summary,
            synopsis: scene.synopsis,
            bodyExcerpt: excerpt(scene.body, excerptChars)
        };
    });
}

export async function runTimelineAuditFromInputs(
    inputs: TimelineAuditSceneInput[],
    config: TimelineAuditPipelineConfig,
    plugin?: RadialTimelinePlugin,
    callbacks: TimelineAuditCallbacks = {}
): Promise<TimelineAuditResult> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const chronologyPositionMap = buildChronologyPositionMap(inputs);
    const workingFindings = new Map<string, WorkingFinding>();
    let aiRunSummary: TimelineAuditAiRunSummary | undefined;

    for (const input of inputs) {
        workingFindings.set(input.path, createWorkingFinding(input, chronologyPositionMap));
    }

    if (mergedConfig.runDeterministicPass) {
        callbacks.onStageChange?.('deterministic');
        detectDeterministicFindings(inputs, workingFindings);
    }

    if (callbacks.abortSignal?.aborted) {
        return buildAuditResult(Array.from(workingFindings.values()).map(finalizeFinding));
    }

    if (mergedConfig.runContinuityPass) {
        callbacks.onStageChange?.('continuity');
        detectContinuityFindings(inputs, workingFindings, mergedConfig.chronologyWindow ?? 2);
    }

    if (callbacks.abortSignal?.aborted) {
        return buildAuditResult(Array.from(workingFindings.values()).map(finalizeFinding));
    }

    if (mergedConfig.runAiInference && plugin) {
        callbacks.onStageChange?.('ai');
        aiRunSummary = await runAiInference(plugin, inputs, workingFindings, callbacks, mergedConfig.aiScope);
    }

    callbacks.onStageChange?.('complete');
    return buildAuditResult(Array.from(workingFindings.values()).map(finalizeFinding), aiRunSummary);
}

function buildAuditResult(
    findings: TimelineAuditFinding[],
    aiRunSummary?: TimelineAuditAiRunSummary
): TimelineAuditResult {
    const sorted = findings.slice().sort(sortAuditFindingsForDisplay);
    const stats = {
        totalScenes: sorted.length,
        aligned: sorted.filter((finding) => finding.status === 'aligned').length,
        warnings: sorted.filter((finding) => finding.status === 'warning').length,
        contradictions: sorted.filter((finding) => finding.status === 'contradiction').length,
        missingWhen: sorted.filter((finding) => finding.whenParseIssue === 'missing_when').length
    };

    return {
        findings: sorted,
        stats,
        appliedSuggestionCount: sorted.filter((finding) => finding.reviewAction === 'apply').length,
        unresolvedCount: sorted.filter((finding) => finding.unresolved).length,
        aiRunSummary
    };
}

export async function runAuditPipeline(
    plugin: RadialTimelinePlugin,
    config: TimelineAuditPipelineConfig,
    callbacks: TimelineAuditCallbacks = {}
): Promise<TimelineAuditResult> {
    const inputs = await buildTimelineAuditSceneInputs(plugin, plugin.app.vault, config.bodyExcerptChars);
    return runTimelineAuditFromInputs(inputs, config, plugin, callbacks);
}
