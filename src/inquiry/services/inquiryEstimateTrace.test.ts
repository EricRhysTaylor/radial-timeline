import { describe, expect, it, vi } from 'vitest';
import type { InquiryRunnerInput, InquiryRunTrace } from '../runner/types';
import type { InquiryRunnerService } from '../runner/InquiryRunnerService';
import { buildInquiryEstimateTrace } from './inquiryEstimateTrace';

describe('buildInquiryEstimateTrace', () => {
    it('injects deterministic estimate scene ids for scene entries that lack canonical ids', async () => {
        const seenInputs: InquiryRunnerInput[] = [];
        const runner = {
            buildTrace: vi.fn(async (input: InquiryRunnerInput) => {
                seenInputs.push(input);
                return {
                    systemPrompt: '',
                    userPrompt: '',
                    evidenceText: '',
                    tokenEstimate: {
                        inputTokens: 0,
                        outputTokens: 0,
                        totalTokens: 0,
                        inputChars: 0,
                        estimationMethod: 'heuristic_chars',
                        uncertaintyTokens: 0,
                        effectiveInputCeiling: 0,
                        expectedPassCount: 1
                    },
                    outputTokenCap: 1200,
                    response: null,
                    sanitizationNotes: [],
                    notes: []
                } satisfies InquiryRunTrace;
            })
        } as unknown as InquiryRunnerService;

        const input: InquiryRunnerInput = {
            scope: 'book',
            scopeLabel: 'B1',
            targetSceneIds: [],
            selectionMode: 'discover',
            questionId: 'estimate-snapshot',
            questionText: 'Analyze corpus-level flow and depth quality.',
            questionPromptForm: 'standard',
            questionZone: 'setup',
            mode: 'flow',
            citationsEnabled: true,
            corpus: {
                entries: [{
                    path: 'Book 1/Scene 1.md',
                    mtime: 1,
                    class: 'scene',
                    mode: 'full'
                }],
                fingerprint: 'fingerprint',
                generatedAt: 1,
                resolvedRoots: [],
                allowedClasses: ['scene'],
                synopsisOnly: false,
                classCounts: { scene: 1 }
            },
            rules: {
                sagaOutlineScope: 'saga-only',
                bookOutlineScope: 'book-only',
                crossScopeUsage: 'conflict-only'
            },
            ai: {
                provider: 'anthropic',
                modelId: 'claude-opus-4-7',
                modelLabel: 'Claude Sonnet 4.6'
            }
        };

        await buildInquiryEstimateTrace(runner, input);
        await buildInquiryEstimateTrace(runner, input);

        expect(seenInputs).toHaveLength(2);
        const firstId = seenInputs[0]?.corpus.entries[0]?.sceneId;
        const secondId = seenInputs[1]?.corpus.entries[0]?.sceneId;
        expect(firstId).toMatch(/^scn_[a-f0-9]{8}$/);
        expect(secondId).toBe(firstId);
    });
});
