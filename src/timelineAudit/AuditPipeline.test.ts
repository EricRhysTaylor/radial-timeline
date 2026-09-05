import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import { getAIClient } from '../ai/runtime/aiClient';
import {
    buildTimelineAuditAiPrompt,
    getTimelineAuditAiRequiredCapabilities,
    parseAuditAiResponse,
    runTimelineAuditFromInputs,
    selectTimelineAuditAiInputs
} from './AuditPipeline';
import type { TimelineAuditSceneInput } from './types';

vi.mock('../ai/runtime/aiClient', () => ({ getAIClient: vi.fn() }));

function makeInput(params: Partial<TimelineAuditSceneInput> & { path: string; manuscriptOrderIndex: number }): TimelineAuditSceneInput {
    const rawWhen = params.rawWhen ?? null;
    const parsedWhen = params.parsedWhen ?? (rawWhen ? new Date(rawWhen.replace(' ', 'T')) : null);
    return {
        file: params.file ?? makeFile(params.path),
        sceneId: params.sceneId ?? params.path,
        title: params.title ?? params.path.split('/').pop()?.replace(/\.md$/i, '') ?? params.path,
        path: params.path,
        manuscriptOrderIndex: params.manuscriptOrderIndex,
        rawWhen,
        parsedWhen,
        whenValid: params.whenValid ?? Boolean(parsedWhen),
        whenParseIssue: params.whenParseIssue ?? (rawWhen === null ? 'missing_when' : parsedWhen ? null : 'invalid_when'),
        whenSource: params.whenSource,
        whenConfidence: params.whenConfidence,
        summary: params.summary ?? '',
        synopsis: params.synopsis ?? '',
        bodyExcerpt: params.bodyExcerpt ?? ''
    };
}

describe('timeline audit pipeline', () => {
    it('flags missing and invalid When values as first-class issues', async () => {
        const result = await runTimelineAuditFromInputs([
            makeInput({ path: 'Story/1 Missing.md', manuscriptOrderIndex: 0, rawWhen: null, parsedWhen: null, whenValid: false, whenParseIssue: 'missing_when' }),
            makeInput({ path: 'Story/2 Invalid.md', manuscriptOrderIndex: 1, rawWhen: 'not-a-date', parsedWhen: null, whenValid: false, whenParseIssue: 'invalid_when' })
        ], {
            runDeterministicPass: true,
            runContinuityPass: false,
            runAiInference: false
        });

        expect(result.findings[0].issues.some((issue) => issue.type === 'missing_when')).toBe(true);
        expect(result.findings[1].issues.some((issue) => issue.type === 'invalid_when')).toBe(true);
    });

    it('detects direct body vs YAML time-of-day conflict and offers a safe suggestion', async () => {
        const result = await runTimelineAuditFromInputs([
            makeInput({
                path: 'Story/1 Evening Conflict.md',
                manuscriptOrderIndex: 0,
                rawWhen: '2026-01-01 08:00',
                bodyExcerpt: 'By evening the house was silent.'
            })
        ], {
            runDeterministicPass: true,
            runContinuityPass: false,
            runAiInference: false
        });

        const finding = result.findings[0];
        expect(finding.issues.some((issue) => issue.type === 'time_of_day_conflict')).toBe(true);
        expect(finding.suggestedWhen).not.toBeNull();
        expect(finding.safeApplyEligible).toBe(true);
    });

    it('detects relative-order conflict for "next morning" against the previous chronology neighbor', async () => {
        const result = await runTimelineAuditFromInputs([
            makeInput({
                path: 'Story/1 Prior.md',
                manuscriptOrderIndex: 0,
                rawWhen: '2026-01-01 08:00',
                bodyExcerpt: 'They leave town.'
            }),
            makeInput({
                path: 'Story/2 Next Morning.md',
                manuscriptOrderIndex: 1,
                rawWhen: '2026-01-01 09:00',
                bodyExcerpt: 'The next morning, she returned to the station.'
            })
        ], {
            runDeterministicPass: true,
            runContinuityPass: true,
            runAiInference: false
        });

        const finding = result.findings.find((entry) => entry.path.endsWith('Next Morning.md'));
        expect(finding?.issues.some((issue) => issue.type === 'relative_order_conflict' || issue.type === 'impossible_sequence')).toBe(true);
    });

    it('treats large chronology jumps as suspicious when not justified', async () => {
        const result = await runTimelineAuditFromInputs([
            makeInput({ path: 'Story/1 Early.md', manuscriptOrderIndex: 0, rawWhen: '2026-01-01 08:00', bodyExcerpt: 'Breakfast on the road.' }),
            makeInput({ path: 'Story/2 Jump.md', manuscriptOrderIndex: 1, rawWhen: '2026-01-10 08:00', bodyExcerpt: 'She opens the same notebook.' }),
            makeInput({ path: 'Story/3 Later.md', manuscriptOrderIndex: 2, rawWhen: '2026-01-11 08:00', bodyExcerpt: 'Another breakfast.' })
        ], {
            runDeterministicPass: true,
            runContinuityPass: true,
            runAiInference: false
        });

        const finding = result.findings.find((entry) => entry.path.endsWith('Jump.md'));
        expect(finding?.issues.some((issue) => issue.type === 'continuity_conflict')).toBe(true);
    });

    it('does not flag a large jump when the manuscript explicitly justifies it', async () => {
        const result = await runTimelineAuditFromInputs([
            makeInput({ path: 'Story/1 Early.md', manuscriptOrderIndex: 0, rawWhen: '2026-01-01 08:00', bodyExcerpt: 'Breakfast on the road.' }),
            makeInput({ path: 'Story/2 Jump.md', manuscriptOrderIndex: 1, rawWhen: '2026-01-08 08:00', bodyExcerpt: 'The following week, she came back with witnesses.' })
        ], {
            runDeterministicPass: true,
            runContinuityPass: true,
            runAiInference: false
        });

        const finding = result.findings.find((entry) => entry.path.endsWith('Jump.md'));
        expect(finding?.issues.some((issue) => issue.type === 'continuity_conflict')).toBe(false);
    });

    it('flags summary and body disagreement', async () => {
        const result = await runTimelineAuditFromInputs([
            makeInput({
                path: 'Story/1 Disagree.md',
                manuscriptOrderIndex: 0,
                rawWhen: '2026-01-01 08:00',
                summary: 'That evening they meet in the square.',
                bodyExcerpt: 'In the morning fog, he arrives alone.'
            })
        ], {
            runDeterministicPass: true,
            runContinuityPass: false,
            runAiInference: false
        });

        expect(result.findings[0].issues.some((issue) => issue.type === 'summary_body_disagree')).toBe(true);
    });

    it('treats later-that-night cues as safe-apply eligible when time-of-day is direct', async () => {
        const result = await runTimelineAuditFromInputs([
            makeInput({
                path: 'Story/1 Ambiguous.md',
                manuscriptOrderIndex: 0,
                rawWhen: '2026-01-01 08:00',
                bodyExcerpt: 'Later that night, the carriage finally arrives.'
            })
        ], {
            runDeterministicPass: true,
            runContinuityPass: false,
            runAiInference: false
        });

        const finding = result.findings[0];
        expect(finding.issues.some((issue) => issue.type === 'time_of_day_conflict')).toBe(true);
        expect(finding.safeApplyEligible).toBe(true);
    });

    it('validates AI response parsing conservatively', () => {
        expect(parseAuditAiResponse('not json')).toBeNull();
        expect(parseAuditAiResponse('{"rationale":"Mixed signals","evidenceQuotes":["later that night"],"evidenceTier":"ambiguous"}')?.evidenceTier).toBe('ambiguous');
        expect(parseAuditAiResponse('{"rationale":"Maybe","evidenceQuotes":[],"issueType":"invented_issue","evidenceTier":"certain","timelineRole":"memory-ish","confidence":"certain"}')).toMatchObject({
            issueType: undefined,
            evidenceTier: 'ambiguous',
            timelineRole: 'unclear',
            confidence: 'low'
        });
    });

    it('builds explicit whole-manuscript and limited AI queues in narrative order', () => {
        const inputs = [
            makeInput({ path: 'Story/3.md', manuscriptOrderIndex: 2 }),
            makeInput({ path: 'Story/1.md', manuscriptOrderIndex: 0 }),
            makeInput({ path: 'Story/2.md', manuscriptOrderIndex: 1 })
        ];

        expect(selectTimelineAuditAiInputs(inputs, { mode: 'manuscript' }).map(input => input.path))
            .toEqual(['Story/1.md', 'Story/2.md', 'Story/3.md']);
        expect(selectTimelineAuditAiInputs(inputs, {
            mode: 'range',
            startScene: 2,
            endScene: 3,
            paths: ['Story/2.md', 'Story/3.md']
        }).map(input => input.path)).toEqual(['Story/2.md', 'Story/3.md']);
    });

    it('treats scaffolded dates as provisional and gives AI narrative-neighbor manuscript context', () => {
        const previous = makeInput({
            path: 'Story/1 Before.md',
            manuscriptOrderIndex: 0,
            rawWhen: '2085-04-01 08:00',
            synopsis: 'They leave for the tournament.'
        });
        const current = makeInput({
            path: 'Story/2 Memory.md',
            manuscriptOrderIndex: 1,
            rawWhen: '2085-04-01 13:00',
            bodyExcerpt: 'When he was six, the tower filled the whole sky.'
        });
        const next = makeInput({
            path: 'Story/3 After.md',
            manuscriptOrderIndex: 2,
            rawWhen: '2085-04-01 19:00',
            summary: 'The tournament resumes.'
        });

        const prompt = buildTimelineAuditAiPrompt(current, previous, next, [previous, current, next]);
        expect(prompt).toContain('rough scaffold');
        expect(prompt).toContain('Manuscript narrative map');
        expect(prompt).toContain('1. 1 Before | provisional When: 2085-04-01 08:00');
        expect(prompt).toContain('Previous scene in narrative order');
        expect(prompt).toContain('When he was six');
        expect(prompt).toContain('flashback');
        expect(prompt).toContain('2 of 3');
    });

    it('uses the Local LLM strict-JSON baseline while retaining stronger cloud-model routing', () => {
        expect(getTimelineAuditAiRequiredCapabilities('ollama')).toEqual(['jsonStrict']);
        expect(getTimelineAuditAiRequiredCapabilities('openai')).toEqual(['jsonStrict', 'reasoningStrong']);
    });

    it('replaces a shallow deterministic suggestion with a differing AI chronology suggestion', async () => {
        vi.mocked(getAIClient).mockReturnValue({
            run: vi.fn(async () => ({
                aiStatus: 'success',
                content: JSON.stringify({
                    rationale: 'The scene is explicitly a childhood flashback.',
                    evidenceQuotes: ['When he was six'],
                    issueType: 'relative_order_conflict',
                    evidenceTier: 'direct',
                    writtenTimelinePosition: 'Eight years before the mainline',
                    timelineRole: 'flashback',
                    suggestedWhen: '2077-10-14 13:13',
                    confidence: 'high'
                })
            }))
        } as unknown as ReturnType<typeof getAIClient>);
        const plugin = {
            settings: { aiSettings: { provider: 'ollama' } }
        } as unknown as RadialTimelinePlugin;

        const result = await runTimelineAuditFromInputs([
            makeInput({
                path: 'Story/7 FB Red Rover.md',
                manuscriptOrderIndex: 0,
                rawWhen: '2085-04-01 08:00',
                bodyExcerpt: 'That evening he remembered. When he was six, the tower filled the sky.'
            })
        ], {
            runDeterministicPass: true,
            runContinuityPass: false,
            runAiInference: true,
            aiScope: { mode: 'manuscript' }
        }, plugin);

        expect(result.findings[0]).toMatchObject({
            aiSuggested: true,
            aiTimelineRole: 'flashback',
            suggestedProvenance: 'ai',
            safeApplyEligible: false
        });
        expect(result.findings[0].suggestedWhen?.getFullYear()).toBe(2077);
    });

    it('does not offer Apply when AI repeats the existing timestamp', async () => {
        vi.mocked(getAIClient).mockReturnValue({
            run: vi.fn(async () => ({
                aiStatus: 'success',
                content: JSON.stringify({
                    rationale: 'The provisional timestamp fits the scene.',
                    evidenceQuotes: [],
                    issueType: '',
                    evidenceTier: 'ambiguous',
                    writtenTimelinePosition: '',
                    timelineRole: 'mainline',
                    suggestedWhen: '2085-04-01 08:00',
                    confidence: 'med'
                })
            }))
        } as unknown as ReturnType<typeof getAIClient>);
        const plugin = {
            settings: { aiSettings: { provider: 'ollama' } }
        } as unknown as RadialTimelinePlugin;

        const result = await runTimelineAuditFromInputs([
            makeInput({
                path: 'Story/1 Mainline.md',
                manuscriptOrderIndex: 0,
                rawWhen: '2085-04-01 08:00',
                bodyExcerpt: 'They cross the field.'
            })
        ], {
            runDeterministicPass: true,
            runContinuityPass: false,
            runAiInference: true,
            aiScope: { mode: 'manuscript' }
        }, plugin);

        expect(result.findings[0].suggestedWhen).toBeNull();
        expect(result.findings[0].allowedActions).toEqual(['keep']);
        expect(result.aiRunSummary?.suggestions).toBe(0);
    });
});
