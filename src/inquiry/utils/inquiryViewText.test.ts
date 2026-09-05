import { describe, expect, it } from 'vitest';
import type { InquiryStaleReason } from '../state';
import {
    buildStaleShortLabel,
    buildStaleTooltipLines,
    countSynopsisWords,
    getCorpusCcOrderNumber,
    getCorpusClassShort,
    resolveFindingChipLabel,
    sanitizeInquirySummary,
    extractSpendCapResetDate,
    formatApiErrorClassification,
    formatApiErrorReason,
    formatAuthorFacingErrorDetail,
    formatAuthorFacingErrorHero,
    formatCacheCountdown,
    formatElapsedRunClock,
    formatInquiryBriefTimestamp,
    formatInquiryId,
    formatPendingEditsSuccessMessage,
    formatRunDurationEstimate,
    formatTokenCountFailureReason,
    formatPendingEditsTargetsTooltip,
    formatSessionOverrides,
    formatSessionProviderModel,
    formatSessionScope,
    formatTokenUsageVisibility,
    getDocumentStatusFields,
    getOrdinalSuffix,
    readFrontmatterWordCount,
    replaceInquiryReferenceTokens,
    renderInquiryBrief,
    resolveInquiryScopeIndicator,
    sanitizeDossierText,
    stripInquiryReferenceArtifacts
} from './inquiryViewText';
import type { InquiryBriefModel } from '../types/inquiryViewTypes';
import type { InquiryResult } from '../state';

describe('inquiryViewText', () => {
    it('splits rendered brief findings into target and context sections', () => {
        const brief: InquiryBriefModel = {
            questionTitle: 'Question',
            questionText: 'What is breaking?',
            scopeIndicator: 'Book B1',
            selectionMode: 'focused',
            roleValidation: 'ok',
            pills: [],
            flowSummary: 'Flow summary',
            depthSummary: 'Depth summary',
            findings: [
                {
                    headline: 'Primary scene issue',
                    sceneLabel: '24 Shail Grounded',
                    role: 'target',
                    lens: 'Flow',
                    bullets: ['Target bullet']
                },
                {
                    headline: 'Supporting context issue',
                    sceneLabel: '50 Long Road Up',
                    role: 'context',
                    lens: 'Depth',
                    bullets: ['Context bullet']
                }
            ],
            sources: [],
            sceneNotes: [],
            sceneReferences: [],
            pendingActions: [],
            logTitle: null
        };

        const content = renderInquiryBrief(brief);

        expect(content).toContain('## Primary Findings');
        expect(content).toContain('### Primary scene issue');
        expect(content).toContain('Scene: 24 Shail Grounded');
        expect(content).toContain('## Context Findings');
        expect(content).toContain('### Supporting context issue');
        expect(content).toContain('Scene: 50 Long Road Up');
    });

    const briefWithNoActions = (over: Partial<InquiryBriefModel> = {}): InquiryBriefModel => ({
        questionTitle: 'Question',
        questionText: 'What is assumed?',
        scopeIndicator: 'Book B1',
        selectionMode: 'discover',
        roleValidation: 'ok',
        pills: [],
        flowSummary: 'Flow summary',
        depthSummary: 'Depth summary',
        findings: [
            { headline: 'A precondition', sceneLabel: '7 Entail', role: 'context', lens: 'Depth', bullets: ['x'] }
        ],
        sources: [],
        sceneNotes: [],
        sceneReferences: [],
        pendingActions: [],
        logTitle: null,
        ...over
    });

    it('renders a scoped "No Action Items" empty-state only for a completed pass', () => {
        const content = renderInquiryBrief(briefWithNoActions({ showNoActionItems: true }));
        expect(content).toContain('## Pending Author Actions');
        expect(content).toContain('**No Action Items** — no pending edits were identified for this inquiry.');
        // Scoped to the inquiry, never a manuscript-quality claim.
        expect(content).not.toContain('excellent');
        expect(content).not.toContain('No separate author actions');
    });

    it('suppresses the empty-state when the pass did not complete usably (showNoActionItems falsy)', () => {
        const content = renderInquiryBrief(briefWithNoActions({ showNoActionItems: false }));
        expect(content).not.toContain('No Action Items');
        expect(content).not.toContain('no pending edits were identified');
    });

    it('builds scope indicators from the canonical scopeLabel field', () => {
        const result: InquiryResult = {
            runId: 'run-1',
            scope: 'book',
            scopeLabel: 'B2',
            mode: 'flow',
            selectionMode: 'discover',
            roleValidation: 'ok',
            questionId: 'q-1',
            summary: 'Summary',
            verdict: {
                flow: 0.5,
                depth: 0.5
            },
            findings: []
        };

        expect(resolveInquiryScopeIndicator(result)).toBe('Book B2');
    });

    it('renders a focused-analysis warning when target roles are missing', () => {
        const brief: InquiryBriefModel = {
            questionTitle: 'Question',
            questionText: 'What is breaking?',
            scopeIndicator: 'Book B1',
            selectionMode: 'focused',
            roleValidation: 'missing-target-roles',
            pills: [],
            flowSummary: 'Flow summary',
            depthSummary: 'Depth summary',
            findings: [],
            sources: [],
            sceneNotes: [],
            sceneReferences: [],
            pendingActions: [],
            logTitle: null
        };

        const content = renderInquiryBrief(brief);
        expect(content).toContain('Incomplete Focused Analysis');
    });

    it('strips scene ref ids and markdown anchor links from rendered dossier text', () => {
        expect(stripInquiryReferenceArtifacts('Pressure spike [Jump](#^scene-jump) in (scn_5b3a3162).'))
            .toBe('Pressure spike Jump in.');
        expect(sanitizeDossierText('Scene 11: [[Brief#^scene-11|Open brief]] shows scn_da9872d7 clearly.'))
            .toBe('Open brief shows clearly.');
    });

    it('renders neither citation-integrity banner nor unverified section when a legacy brief has no integrity fields', () => {
        const brief: InquiryBriefModel = {
            questionTitle: 'Question',
            questionText: 'What is breaking?',
            scopeIndicator: 'Book B1',
            selectionMode: 'discover',
            roleValidation: 'ok',
            pills: [],
            flowSummary: 'Flow summary',
            depthSummary: 'Depth summary',
            findings: [],
            sources: [],
            sceneNotes: [],
            sceneReferences: [],
            pendingActions: [],
            logTitle: null
        };

        const content = renderInquiryBrief(brief);
        expect(content).not.toContain('Citation integrity warning');
        expect(content).not.toContain('Evidence compromised');
        expect(content).not.toContain('Unverified AI Citations');
    });

    it('renders the normal integrity warning banner (not the compromised one) when some findings were verified', () => {
        const brief: InquiryBriefModel = {
            questionTitle: 'Question',
            questionText: 'What is breaking?',
            scopeIndicator: 'Book B1',
            selectionMode: 'discover',
            roleValidation: 'ok',
            pills: [],
            flowSummary: 'Flow',
            depthSummary: 'Depth',
            findings: [
                { headline: 'Clean finding', role: 'target', lens: 'Flow', bullets: [] }
            ],
            sources: [],
            sceneNotes: [],
            sceneReferences: [],
            pendingActions: [],
            logTitle: null,
            citationIntegrityWarnings: [
                { stage: 'unresolved_ref', message: 'bad' }
            ],
            unverifiedFindings: [
                { headline: 'Ghost', bullets: [], lens: 'Flow', rawRefId: 'scn_deadbeef', warning: 'nope' }
            ]
        };

        const content = renderInquiryBrief(brief);
        expect(content).toContain('Citation integrity warning');
        expect(content).not.toContain('Evidence compromised');
        expect(content).toContain('Unverified AI Citations');
        expect(content).toContain('should not be trusted as evidence');
    });

    it('renders the "Evidence compromised" banner when the run has no verified findings and some unverified ones', () => {
        const brief: InquiryBriefModel = {
            questionTitle: 'Question',
            questionText: 'What is breaking?',
            scopeIndicator: 'Book B1',
            selectionMode: 'discover',
            roleValidation: 'ok',
            pills: [],
            flowSummary: 'Flow',
            depthSummary: 'Depth',
            findings: [],
            sources: [],
            sceneNotes: [],
            sceneReferences: [],
            pendingActions: [],
            logTitle: null,
            evidenceCompromised: true,
            citationIntegrityWarnings: [
                { stage: 'unresolved_ref', message: 'bad' }
            ],
            unverifiedFindings: [
                { headline: 'Ghost', bullets: [], lens: 'Flow', rawRefId: 'scn_deadbeef', warning: 'nope' }
            ]
        };

        const content = renderInquiryBrief(brief);
        expect(content).toContain('Evidence compromised');
        expect(content).toContain('not trustworthy');
        expect(content).toContain('Unverified AI Citations');
    });

    it('replaces canonical scene ids with readable scene labels before rendering', () => {
        const refs = new Map<string, string>([
            ['scn_70a8d14e', '16 Chae Ban hears about the Homo'],
            ['scn_9329bdc2', '17 Johnsonian'],
            ['s1', '1 Trisan Training'],
            ['s4', '4 Party'],
            ['s5', '5 Aftermath from Ravix Pool'],
            ['s6', '6 Therapist'],
            ['s23', '23 Shail Grounded'],
            ['s34', '34 Stage 3 Volcano']
        ]);

        expect(replaceInquiryReferenceTokens(
            'Revise Scenes 16 (scn_70a8d14e) and 17 (scn_9329bdc2) at this stage',
            refs
        )).toBe('Revise Scenes 16 Chae Ban hears about the Homo and 17 Johnsonian at this stage');
        expect(replaceInquiryReferenceTokens(
            'The jump to scn_9329bdc2 (Johnsonian) lands too abruptly.',
            refs
        )).toBe('The jump to 17 Johnsonian lands too abruptly.');
        expect(replaceInquiryReferenceTokens(
            'nothing in S1-S5 prepares the reader. S6 is the first scene where AEA feels personal.',
            refs
        )).toBe('nothing in 1 Trisan Training - 5 Aftermath from Ravix Pool prepares the reader. 6 Therapist is the first scene where AEA feels personal.');
        expect(replaceInquiryReferenceTokens(
            'Shail\'s hybrid nature must be implied here for S23/S34 revelation to read as payoff.',
            refs
        )).toBe('Shail\'s hybrid nature must be implied here for 23 Shail Grounded / 34 Stage 3 Volcano revelation to read as payoff.');
    });

    describe('getDocumentStatusFields', () => {
        it('reads scalar Status/Due strings and trims them', () => {
            expect(getDocumentStatusFields({ Status: '  Working ', Due: ' 2026-05-18 ' }))
                .toEqual({ statusRaw: 'Working', due: '2026-05-18' });
        });
        it('reads the first element of an array Status', () => {
            expect(getDocumentStatusFields({ Status: ['  Done ', 'Ignored'] }))
                .toEqual({ statusRaw: 'Done', due: undefined });
        });
        it('returns undefined for missing/empty/non-string fields', () => {
            expect(getDocumentStatusFields({})).toEqual({ statusRaw: undefined, due: undefined });
            expect(getDocumentStatusFields({ Status: '   ', Due: 42 }))
                .toEqual({ statusRaw: undefined, due: undefined });
        });
    });

    describe('countSynopsisWords', () => {
        it('counts whitespace/punctuation-separated words', () => {
            expect(countSynopsisWords('The quick brown fox')).toBe(4);
        });
        it('treats apostrophes and hyphens as intra-word', () => {
            expect(countSynopsisWords("Shail's hybrid mother-ship")).toBe(3);
        });
        it('returns 0 for empty or whitespace-only input', () => {
            expect(countSynopsisWords('')).toBe(0);
            expect(countSynopsisWords('   \n\t ')).toBe(0);
        });
    });

    describe('readFrontmatterWordCount', () => {
        it('reads a finite numeric Words field, rounded and clamped', () => {
            expect(readFrontmatterWordCount({ Words: 1234.6 })).toBe(1235);
            expect(readFrontmatterWordCount({ words: -5 })).toBe(0);
        });
        it('parses a comma-formatted string Words field', () => {
            expect(readFrontmatterWordCount({ Words: ' 12,345 ' })).toBe(12345);
        });
        it('returns null when absent or unparseable', () => {
            expect(readFrontmatterWordCount({})).toBeNull();
            expect(readFrontmatterWordCount({ Words: 'n/a' })).toBeNull();
        });
    });

    describe('getOrdinalSuffix', () => {
        it('uses th for the 11-13 teen exception', () => {
            expect(getOrdinalSuffix(11)).toBe('th');
            expect(getOrdinalSuffix(12)).toBe('th');
            expect(getOrdinalSuffix(13)).toBe('th');
            expect(getOrdinalSuffix(113)).toBe('th');
        });
        it('uses st/nd/rd for 1/2/3 and 21/22/23', () => {
            expect(getOrdinalSuffix(1)).toBe('st');
            expect(getOrdinalSuffix(2)).toBe('nd');
            expect(getOrdinalSuffix(3)).toBe('rd');
            expect(getOrdinalSuffix(21)).toBe('st');
            expect(getOrdinalSuffix(22)).toBe('nd');
            expect(getOrdinalSuffix(23)).toBe('rd');
        });
        it('uses th for other days', () => {
            expect(getOrdinalSuffix(4)).toBe('th');
            expect(getOrdinalSuffix(30)).toBe('th');
        });
    });

    const sessionWith = (result: Record<string, unknown>): InquiryResult & Record<string, unknown> =>
        result as unknown as InquiryResult & Record<string, unknown>;

    describe('formatPendingEdits messages', () => {
        it('handles empty and populated target label lists', () => {
            expect(formatPendingEditsTargetsTooltip([])).toBe('No pending edits');
            expect(formatPendingEditsTargetsTooltip(['A', 'B'])).toBe('Write to Pending Edits: A, B');
            expect(formatPendingEditsSuccessMessage(['Scene 1'])).toBe('Pending Edits updated for Scene 1.');
        });
    });

    describe('formatSessionScope', () => {
        it('labels saga vs book and trims missing focus', () => {
            expect(formatSessionScope({ result: sessionWith({ scope: 'saga', scopeLabel: 'My Saga' }) } as never))
                .toBe('Saga My Saga');
            expect(formatSessionScope({ result: sessionWith({ scope: 'book', scopeLabel: '' }) } as never))
                .toBe('Book');
        });
    });

    describe('formatSessionOverrides', () => {
        it('returns null when overrides inactive', () => {
            expect(formatSessionOverrides({ result: sessionWith({ corpusOverridesActive: false }) } as never)).toBeNull();
        });
        it('summarizes class/item counts when present', () => {
            expect(formatSessionOverrides({ result: sessionWith({
                corpusOverridesActive: true,
                corpusOverrideSummary: { classCount: 2, itemCount: 5 }
            }) } as never)).toBe('Overrides 2c/5i');
            expect(formatSessionOverrides({ result: sessionWith({ corpusOverridesActive: true }) } as never))
                .toBe('Overrides on');
        });
    });

    describe('formatSessionProviderModel', () => {
        it('reports Engine unknown when no model is resolved or requested', () => {
            expect(formatSessionProviderModel({ result: sessionWith({}) } as never)).toBe('Engine unknown');
        });
    });

    const resultWith = (r: Record<string, unknown>): InquiryResult =>
        r as unknown as InquiryResult;

    describe('formatTokenUsageVisibility', () => {
        it('returns unknown when usage is not known', () => {
            expect(formatTokenUsageVisibility(false)).toBe('unknown');
            expect(formatTokenUsageVisibility(false, 'full')).toBe('unknown');
        });
        it('maps each known scope', () => {
            expect(formatTokenUsageVisibility(true, 'full')).toBe('full multi-pass');
            expect(formatTokenUsageVisibility(true, 'partial')).toBe('partial multi-pass');
            expect(formatTokenUsageVisibility(true, 'synthesis_only')).toBe('synthesis-only');
            expect(formatTokenUsageVisibility(true)).toBe('known');
        });
    });

    describe('formatApiErrorClassification', () => {
        it('formats status with and without a reason', () => {
            expect(formatApiErrorClassification(resultWith({ aiStatus: 'rejected', aiReason: 'spend_cap' })))
                .toBe('rejected (spend_cap)');
            expect(formatApiErrorClassification(resultWith({ aiStatus: 'timeout' }))).toBe('timeout');
            expect(formatApiErrorClassification(resultWith({}))).toBe('unknown');
        });
        it('appends execution + usage bits when present', () => {
            expect(formatApiErrorClassification(resultWith({
                aiStatus: 'rejected',
                aiReason: 'multi_pass_failed',
                executionState: 'failed',
                executionPath: 'segmented',
                failureStage: 'synthesis',
                tokenUsageKnown: true,
                tokenUsageScope: 'partial'
            }))).toBe('rejected (multi_pass_failed) [state=failed, path=segmented, stage=synthesis, usage=partial multi-pass]');
        });
    });

    describe('formatApiErrorReason', () => {
        it('appends aiErrorDetail on a new line when present', () => {
            expect(formatApiErrorReason(resultWith({ aiStatus: 'auth', aiErrorDetail: 'bad key' })))
                .toBe('auth\nbad key');
        });
        it('returns just the classification when no detail', () => {
            expect(formatApiErrorReason(resultWith({ aiStatus: 'auth' }))).toBe('auth');
        });
    });

    describe('formatAuthorFacingErrorHero', () => {
        it('maps rejected reasons to author-facing copy', () => {
            const hero = (aiStatus: string, aiReason?: string) =>
                formatAuthorFacingErrorHero(resultWith({ aiStatus, aiReason }));
            expect(hero('rejected', 'spend_cap')).toBe('Monthly spend cap reached.');
            expect(hero('rejected', 'quota_exceeded')).toBe('OpenAI API quota exceeded.');
            expect(hero('rejected', 'invalid_response')).toBe('Briefing received with errors.');
            expect(hero('rejected', 'citation_binding_failed')).toBe('AI response could not be matched to this corpus.');
            expect(hero('rejected', 'multi_pass_failed')).toBe('Multi-pass analysis could not complete.');
            expect(hero('rejected', 'unsupported_param')).toBe('Request rejected by provider.');
            expect(hero('rejected')).toBe('Request rejected by provider.');
            expect(hero('auth')).toBe('Authentication failed.');
            expect(hero('timeout')).toBe('Request timed out.');
            expect(hero('rate_limit')).toBe('Rate limit reached. Try again shortly.');
            expect(hero('unavailable')).toBe('Provider unavailable.');
            expect(hero('something-else')).toBe('Inquiry could not complete.');
        });
    });

    describe('extractSpendCapResetDate', () => {
        it('returns null for missing or non-matching detail', () => {
            expect(extractSpendCapResetDate(null)).toBeNull();
            expect(extractSpendCapResetDate('')).toBeNull();
            expect(extractSpendCapResetDate('no date here')).toBeNull();
        });
        it('extracts a bare date and a date+time UTC', () => {
            expect(extractSpendCapResetDate('Resets on 2026-06-01.')).toBe('2026-06-01');
            expect(extractSpendCapResetDate('on 2026-06-01 at 00:00 UTC')).toBe('2026-06-01 00:00 UTC');
        });
    });

    describe('formatAuthorFacingErrorDetail', () => {
        it('explains the spend cap with and without a reset line', () => {
            const withReset = formatAuthorFacingErrorDetail(resultWith({
                aiReason: 'spend_cap', aiErrorDetail: 'on 2026-06-01 at 00:00 UTC'
            }));
            expect(withReset).toContain('Anthropic Console');
            expect(withReset).toContain('Resets 2026-06-01 00:00 UTC.');
            const noReset = formatAuthorFacingErrorDetail(resultWith({ aiReason: 'spend_cap' }));
            expect(noReset).toContain('Anthropic Console');
            expect(noReset).not.toContain('Resets');
        });
        it('covers quota, passthrough, citation, invalid, and empty default', () => {
            expect(formatAuthorFacingErrorDetail(resultWith({ aiReason: 'quota_exceeded' })))
                .toContain('OpenAI API account');
            expect(formatAuthorFacingErrorDetail(resultWith({ aiErrorDetail: 'raw detail' })))
                .toBe('raw detail');
            expect(formatAuthorFacingErrorDetail(resultWith({ aiReason: 'citation_binding_failed' })))
                .toBe('No findings could be placed on the minimap.');
            expect(formatAuthorFacingErrorDetail(resultWith({ aiReason: 'invalid_response' })))
                .toBe('Invalid structured response from AI.');
            expect(formatAuthorFacingErrorDetail(resultWith({}))).toBe('');
        });
    });

    describe('formatRunDurationEstimate', () => {
        it('formats seconds with singular/plural and ranges', () => {
            expect(formatRunDurationEstimate(1, 1)).toBe('1 second');
            expect(formatRunDurationEstimate(5, 5)).toBe('5 seconds');
            expect(formatRunDurationEstimate(5, 30)).toBe('5-30 seconds');
        });
        it('clamps sub-1 inputs to a 1-second floor', () => {
            expect(formatRunDurationEstimate(0, 0)).toBe('1 second');
            expect(formatRunDurationEstimate(-10, 0.4)).toBe('1 second');
        });
        it('rolls into minutes with singular/plural and ranges', () => {
            expect(formatRunDurationEstimate(60, 60)).toBe('1 minute');
            expect(formatRunDurationEstimate(120, 120)).toBe('2 minutes');
            expect(formatRunDurationEstimate(90, 300)).toBe('2-5 minutes');
        });
    });

    describe('formatInquiryBriefTimestamp', () => {
        // Local-component Date so getMonth/getHours are timezone-stable.
        it('formats am/pm with 12-hour wrap', () => {
            expect(formatInquiryBriefTimestamp(new Date(2026, 4, 18, 13, 5, 9)))
                .toBe('May 18 2026 @ 1.05pm');
            expect(formatInquiryBriefTimestamp(new Date(2026, 0, 1, 0, 0, 0)))
                .toBe('Jan 1 2026 @ 12.00am');
            expect(formatInquiryBriefTimestamp(new Date(2026, 11, 31, 12, 30, 0)))
                .toBe('Dec 31 2026 @ 12.30pm');
        });
        it('optionally includes zero-padded seconds', () => {
            expect(formatInquiryBriefTimestamp(new Date(2026, 4, 18, 9, 7, 3), { includeSeconds: true }))
                .toBe('May 18 2026 @ 9.07.03am');
        });
        it('returns Unknown date for an invalid Date', () => {
            expect(formatInquiryBriefTimestamp(new Date('not-a-date'))).toBe('Unknown date');
        });
    });

    describe('formatInquiryId', () => {
        it('produces a zero-padded sortable id', () => {
            expect(formatInquiryId(new Date(2026, 0, 5, 4, 8, 2)))
                .toBe('2026-01-05 04.08.02');
        });
    });

    describe('formatElapsedRunClock', () => {
        it('formats elapsed milliseconds as zero-padded MM:SS', () => {
            expect(formatElapsedRunClock(0)).toBe('00:00');
            expect(formatElapsedRunClock(65_000)).toBe('01:05');
            expect(formatElapsedRunClock(599_000)).toBe('09:59');
            expect(formatElapsedRunClock(3_600_000)).toBe('60:00');
        });
        it('floors sub-second remainders and clamps negatives to zero', () => {
            expect(formatElapsedRunClock(1_999)).toBe('00:01');
            expect(formatElapsedRunClock(-5_000)).toBe('00:00');
        });
    });

    describe('formatCacheCountdown', () => {
        it('formats remaining milliseconds as zero-padded HH:MM (no seconds)', () => {
            expect(formatCacheCountdown(0)).toBe('00:00');
            expect(formatCacheCountdown(90_000)).toBe('00:01');
            expect(formatCacheCountdown(3_600_000)).toBe('01:00');
            expect(formatCacheCountdown(3_661_000)).toBe('01:01');
        });
        it('ceils to the next second (crossing the minute boundary) and clamps negatives', () => {
            // 59_001ms -> ceil 60s -> 1 minute; floor would yield 00:00.
            expect(formatCacheCountdown(59_001)).toBe('00:01');
            expect(formatCacheCountdown(1)).toBe('00:00');
            expect(formatCacheCountdown(-5_000)).toBe('00:00');
        });
    });

    describe('buildStaleShortLabel', () => {
        const r = (kind: InquiryStaleReason['kind'], paths: string[]): InquiryStaleReason =>
            ({ kind, paths } as InquiryStaleReason);
        it('uses singular vs plural for edited/added/removed', () => {
            expect(buildStaleShortLabel([r('scenes_edited', ['a'])])).toBe('1 scene edited');
            expect(buildStaleShortLabel([r('scenes_edited', ['a', 'b'])])).toBe('2 scenes edited');
            expect(buildStaleShortLabel([r('scenes_added', ['a'])])).toBe('1 scene added');
            expect(buildStaleShortLabel([r('scenes_removed', ['a', 'b', 'c'])])).toBe('3 scenes removed');
        });
        it('prefers edited > added > removed precedence', () => {
            expect(buildStaleShortLabel([r('scenes_removed', ['x']), r('scenes_edited', ['y'])]))
                .toBe('1 scene edited');
        });
        it('falls back to inclusion/target/corpus phrases', () => {
            expect(buildStaleShortLabel([r('inclusion_changed', [])])).toBe('inclusion changed');
            expect(buildStaleShortLabel([r('target_changed', [])])).toBe('targets changed');
            expect(buildStaleShortLabel([r('corpus_changed', [])])).toBe('corpus changed');
            expect(buildStaleShortLabel([])).toBe('corpus changed');
        });
    });

    describe('buildStaleTooltipLines', () => {
        const r = (kind: InquiryStaleReason['kind'], paths: string[]): InquiryStaleReason =>
            ({ kind, paths } as InquiryStaleReason);
        it('strips folders and .md, joins up to 3 then summarizes overflow', () => {
            expect(buildStaleTooltipLines([r('scenes_edited', ['Book/Ch/Scene One.md', 'b/Two.md'])]))
                .toEqual(['Edited: Scene One, Two']);
            expect(buildStaleTooltipLines([r('scenes_added', ['1.md', '2.md', '3.md', '4.md', '5.md'])]))
                .toEqual(['Added: 1, 2, 3 +2 more']);
        });
        it('emits one line per reason with the corpus_changed special case', () => {
            expect(buildStaleTooltipLines([
                r('inclusion_changed', ['x.md']),
                r('target_changed', ['y.md']),
                r('corpus_changed', [])
            ])).toEqual([
                'Inclusion changed: x',
                'Target changed: y',
                'Corpus changed (details unavailable for this run)'
            ]);
        });
    });

    describe('getCorpusClassShort', () => {
        it('maps known classes and falls back to an uppercased initial', () => {
            expect(getCorpusClassShort('outline-saga')).toBe(String.fromCharCode(931));
            expect(getCorpusClassShort('character')).toBe('C');
            expect(getCorpusClassShort('scene')).toBe('S');
            expect(getCorpusClassShort('outline')).toBe('O');
            expect(getCorpusClassShort('reference')).toBe('R');
            expect(getCorpusClassShort('   ')).toBe('C');
        });
    });

    describe('getCorpusCcOrderNumber', () => {
        it('parses scene ordinals from several spellings', () => {
            expect(getCorpusCcOrderNumber('Scene 12 — Title', 'scene')).toBe(12);
            expect(getCorpusCcOrderNumber('S5 Something', 'scene')).toBe(5);
            expect(getCorpusCcOrderNumber('07 Foo', 'scene')).toBe(7);
            expect(getCorpusCcOrderNumber('Prologue scene #3', 'scene')).toBe(3);
        });
        it('parses book/outline ordinals', () => {
            expect(getCorpusCcOrderNumber('Book 3', 'outline')).toBe(3);
            expect(getCorpusCcOrderNumber('bk2 arc', 'outline-saga')).toBe(2);
            expect(getCorpusCcOrderNumber('4 Outline', 'outline')).toBe(4);
        });
        it('uses the leading-number default for other classes and returns null on no match', () => {
            expect(getCorpusCcOrderNumber('9 Character', 'character')).toBe(9);
            expect(getCorpusCcOrderNumber('no digits', 'scene')).toBeNull();
        });
    });

    describe('sanitizeInquirySummary', () => {
        it('returns the unavailable fallback for empty input', () => {
            expect(sanitizeInquirySummary(null)).toBe('Summary unavailable.');
            expect(sanitizeInquirySummary('   ')).toBe('Summary unavailable.');
        });
        it('collapses whitespace and strips leading summary prefixes iteratively', () => {
            expect(sanitizeInquirySummary('Summary: The plot   works well.'))
                .toBe('The plot works well.');
            expect(sanitizeInquirySummary('In summary, the analysis shows that pacing lags.'))
                .toBe('pacing lags.');
        });
        it('returns the fallback when nothing survives sanitization', () => {
            expect(sanitizeInquirySummary('Summary:')).toBe('Summary unavailable.');
        });
    });

    describe('resolveFindingChipLabel', () => {
        const finding = (refId?: string) => ({ refId } as unknown as Parameters<typeof resolveFindingChipLabel>[0]);
        const result = (scope: string) => ({ scope } as unknown as Parameters<typeof resolveFindingChipLabel>[1]);
        const item = (o: Partial<{ id: string; displayLabel: string; filePaths: string[]; sceneId: string }>) =>
            ({ id: '', displayLabel: '', filePaths: [], ...o } as Parameters<typeof resolveFindingChipLabel>[2][number]);

        it('returns null for a missing or whitespace refId', () => {
            expect(resolveFindingChipLabel(finding(undefined), result('book'), [])).toBeNull();
            expect(resolveFindingChipLabel(finding('   '), result('book'), [])).toBeNull();
        });
        it('matches displayLabel case-insensitively', () => {
            const items = [item({ id: 'x', displayLabel: '24 Shail Grounded' })];
            expect(resolveFindingChipLabel(finding('24 shail grounded'), result('book'), items))
                .toBe('24 Shail Grounded');
        });
        it('matches id exactly and case-insensitively', () => {
            const items = [item({ id: 'scn_AB', displayLabel: 'Scene AB' })];
            expect(resolveFindingChipLabel(finding('scn_AB'), result('book'), items)).toBe('Scene AB');
            expect(resolveFindingChipLabel(finding('SCN_ab'), result('book'), items)).toBe('Scene AB');
        });
        it('matches sceneId case-insensitively', () => {
            const items = [item({ id: 'a', displayLabel: 'Scene Q', sceneId: 'Scn_99' })];
            expect(resolveFindingChipLabel(finding('scn_99'), result('book'), items)).toBe('Scene Q');
        });
        it('matches an exact file path', () => {
            const items = [item({ id: 'a', displayLabel: 'Path Scene', filePaths: ['Book/Ch/Scene.md'] })];
            expect(resolveFindingChipLabel(finding('Book/Ch/Scene.md'), result('book'), items))
                .toBe('Path Scene');
        });
        it('uppercases an Sxx ref for non-saga scope when nothing else matches', () => {
            expect(resolveFindingChipLabel(finding('s12'), result('book'), [])).toBe('S12');
            expect(resolveFindingChipLabel(finding('b12'), result('book'), [])).toBeNull();
        });
        it('uppercases a Bxx ref for saga scope when nothing else matches', () => {
            expect(resolveFindingChipLabel(finding('b3'), result('saga'), [])).toBe('B3');
            expect(resolveFindingChipLabel(finding('s3'), result('saga'), [])).toBeNull();
        });
        it('returns null when no match and ref is not a scope-prefixed ordinal', () => {
            expect(resolveFindingChipLabel(finding('totally-unknown'), result('book'), []))
                .toBeNull();
        });
    });

    describe('formatTokenCountFailureReason', () => {
        it('extracts the canonical "STATUS (HTTP nnn): message" segment', () => {
            const msg = 'google countTokens failed for model "gemini-3.5-flash": '
                + 'Gemini countTokens failed for "gemini-3.5-flash" — NOT_FOUND (HTTP 404): Model not found.';
            expect(formatTokenCountFailureReason(msg)).toBe('NOT_FOUND (HTTP 404): Model not found');
        });

        it('falls back to HTTP-only when no status name is present', () => {
            const msg = 'Some prefix — HTTP 503: Service unavailable.';
            expect(formatTokenCountFailureReason(msg)).toBe('HTTP 503: Service unavailable');
        });

        it('falls back to the tail after the last colon when no HTTP segment exists', () => {
            const msg = 'google countTokens failed for model "gemini-x": API key invalid';
            expect(formatTokenCountFailureReason(msg)).toBe('API key invalid');
        });

        it('keeps a trailing clock time intact instead of chopping at its colon', () => {
            // Regression: the old last-colon split turned "…14:00 UTC" into the
            // fragment "00 UTC", which the caller rendered as "00 UTC..".
            const msg = 'google countTokens failed for model "gemini-x": rate limited, retry after 14:00 UTC.';
            expect(formatTokenCountFailureReason(msg)).toBe('rate limited, retry after 14:00 UTC');
        });

        it('returns empty string for null/undefined/empty input', () => {
            expect(formatTokenCountFailureReason(undefined)).toBe('');
            expect(formatTokenCountFailureReason(null)).toBe('');
            expect(formatTokenCountFailureReason('')).toBe('');
        });

        it('truncates very long messages with an ellipsis to fit chip width', () => {
            const longTail = 'x'.repeat(200);
            const msg = `prefix: ${longTail}`;
            const result = formatTokenCountFailureReason(msg);
            expect(result.length).toBeLessThanOrEqual(90);
            expect(result.endsWith('…')).toBe(true);
        });
    });
});
