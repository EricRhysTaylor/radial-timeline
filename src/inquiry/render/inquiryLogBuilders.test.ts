import { describe, expect, it } from 'vitest';
import { buildInquiryLogContent, type InquiryLogBuilderDependencies } from './inquiryLogBuilders';

describe('buildInquiryLogContent', () => {
    const deps: InquiryLogBuilderDependencies = {
        getQuestionLabel: () => 'Pres2: Underwritten Beats',
        getBriefModelLabel: () => 'GPT-5.5',
        getFiniteTokenEstimateInput: () => 174000,
        getTokenTier: () => 'red',
        buildInquiryLogCostEstimateInput: () => null,
        formatTokenUsageVisibility: () => 'known',
        isErrorResult: () => false,
        isDegradedResult: () => false,
        formatMetricDisplay: (value: number) => String(Math.round(value)),
        resolveManifestEntryLabel: entry => entry.path,
        normalizeEvidenceMode: mode => mode === 'summary' ? 'summary' : mode === 'full' ? 'full' : 'excluded',
        normalizeLegacyResult: result => result,
        resolveInquiryBriefZoneLabel: () => 'Pressure',
        resolveInquiryBriefLensLabel: () => 'Flow',
        formatInquiryIdFromResult: () => 'inq_123',
        pluginVersion: 'test',
        estimateSnapshot: null,
        geminiCacheTtlSeconds: 900
    };

    it('surfaces cache summary near the top and moves corpus toc to the bottom', () => {
        const content = buildInquiryLogContent({
            result: {
                scope: 'book',
                scopeLabel: 'B1',
                aiProvider: 'openai',
                aiModelResolved: 'gpt-5.5',
                aiModelRequested: 'gpt-5.5',
                evidenceDocumentMeta: [
                    {
                        title: '1 Bingley Arrives',
                        path: 'Pride & Prejudice/1 Bingley Arrives.md',
                        sceneId: 'scn_a1b2c3d4',
                        evidenceClass: 'scene'
                    }
                ],
                findings: [
                    {
                        headline: 'Underwritten setup beats',
                        bullets: ['Arrival beat lands softly before social tension locks in.'],
                        evidenceQuote: 'Bingley walked in without ceremony, scarcely glancing at the crowd.',
                        refId: 'scn_a1b2c3d4',
                        severity: 'medium'
                    }
                ],
                verdict: {
                    flow: 86,
                    depth: 88
                }
            } as never,
            trace: {
                tokenUsageKnown: true,
                tokenUsageScope: 'known',
                cacheReuseState: 'warm',
                cacheStatus: 'hit',
                cachedStableRatio: 1,
                cachedStableTokens: 164224,
                usage: {
                    inputTokens: 164434,
                    outputTokens: 988,
                    totalTokens: 165422,
                    cacheReadInputTokens: 164224
                }
            } as never,
            manifest: {
                entries: [
                    { class: 'scene', mode: 'full', path: 'Book 1/1 Scene.md' }
                ],
                classCounts: {
                    scene: 1,
                    outline: 0
                }
            } as never,
            deps,
            contentLogWritten: true
        });

        expect(content).toContain('- Citation support: Sources · Limited implementation');
        expect(content).toContain('- Source results: 1 item · scene=1');
        expect(content).toContain('- Cache: warm · status=hit · prefix=100% · tokens=164k · read=164k');
        expect(content).toContain('- Actual usage cost: $');
        expect(content.indexOf('## Cost Breakdown')).toBeGreaterThan(content.indexOf('## Run Summary'));
        expect(content.indexOf('## Cost Breakdown')).toBeLessThan(content.indexOf('## Corpus Summary'));
        expect(content.indexOf('- Citation support: Sources · Limited implementation')).toBeGreaterThan(content.indexOf('## Run Summary'));
        expect(content.indexOf('- Source results: 1 item · scene=1')).toBeLessThan(content.indexOf('## Corpus Summary'));
        expect(content.indexOf('- Cache: warm')).toBeGreaterThan(content.indexOf('## Run Summary'));
        expect(content.indexOf('- Cache: warm')).toBeLessThan(content.indexOf('## Corpus Summary'));
        expect(content.indexOf('## Corpus TOC')).toBeGreaterThan(content.indexOf('## Suggested Fixes'));
        expect(content.indexOf('## Corpus TOC')).toBeLessThan(content.indexOf('Content Log: written'));
        expect(content).toContain('- Reference classes: none');
        expect(content).not.toContain('- Context:');
    });

    it('separates reference-class corpus entries from saga book anchors', () => {
        const content = buildInquiryLogContent({
            result: {
                scope: 'saga',
                scopeLabel: 'Σ',
                aiProvider: 'anthropic',
                aiModelResolved: 'claude-opus-4-7',
                aiModelRequested: 'claude-opus-4-7',
                evidenceDocumentMeta: [],
                findings: [],
                verdict: {
                    flow: 44,
                    depth: 38
                }
            } as never,
            trace: {
                tokenUsageKnown: true,
                tokenUsageScope: 'known',
                usage: {
                    inputTokens: 145772,
                    outputTokens: 6529,
                    totalTokens: 152301
                }
            } as never,
            manifest: {
                entries: [
                    { class: 'scene', mode: 'full', path: 'Book 1/1 Scene.md' },
                    { class: 'character', mode: 'full', path: 'Cast/Shail.md' },
                    { class: 'theme', mode: 'full', path: 'Notes/Trauma Arc.md' },
                    { class: 'book', mode: 'excluded', path: 'Book 1' }
                ],
                classCounts: {
                    scene: 1,
                    outline: 0,
                    character: 1,
                    theme: 1,
                    book: 1
                }
            } as never,
            deps,
            contentLogWritten: true
        });

        expect(content).toContain('- Reference classes: Characters 1, Theme 1');
        expect(content).toContain('- Saga book anchors: 1 (not sent as evidence)');
        expect(content).not.toContain('- Other: Book 1');
        expect(content).not.toContain('- Context:');
    });

    it('reports Gemini cache transport without OpenAI prompt-cache fallback claims', () => {
        const content = buildInquiryLogContent({
            result: {
                scope: 'saga',
                scopeLabel: 'Σ',
                aiProvider: 'google',
                aiModelResolved: 'gemini-3.1-pro-preview',
                aiModelRequested: 'gemini-3.1-pro-preview',
                findings: [],
                verdict: {
                    flow: 85,
                    depth: 80
                },
                cacheReuseFingerprint: 'h540625845'
            } as never,
            trace: {
                userPrompt: 'stable prefix\n\nscene text',
                evidenceText: 'scene text',
                tokenUsageKnown: true,
                tokenUsageScope: 'known',
                cacheReuseState: 'warm',
                cacheStatus: 'hit',
                cachedStableRatio: 1,
                cachedStableTokens: 281000,
                requestPayload: {
                    cachedContent: 'cachedContents/abc123'
                },
                response: null,
                usage: {
                    inputTokens: 264606,
                    outputTokens: 531,
                    totalTokens: 270000,
                    cacheReadInputTokens: 264584
                }
            } as never,
            manifest: {
                entries: [],
                classCounts: {
                    scene: 56,
                    outline: 0
                }
            } as never,
            deps,
            contentLogWritten: true
        });

        expect(content).toContain('- Gemini cachedContent: cachedContents/abc123');
        // Exact dollar amount depends on the active pricing table;
        // assert format only (catalog trim 2026-05-22).
        expect(content).toMatch(/- Actual usage cost: \$\d+(\.\d{1,3})?/);
        expect(content).toContain('- Raw provider usage JSON: not captured; normalized token usage available');
        expect(content).not.toContain('prompt_cache_key sent');
        expect(content).not.toContain('unsupported');
    });

    it('reports OpenAI prompt cache keys only for OpenAI payloads', () => {
        const content = buildInquiryLogContent({
            result: {
                scope: 'book',
                scopeLabel: 'B1',
                aiProvider: 'openai',
                aiModelResolved: 'gpt-5.5',
                aiModelRequested: 'gpt-5.5',
                findings: [],
                verdict: {
                    flow: 68,
                    depth: 74
                },
                cacheReuseFingerprint: 'h578972009'
            } as never,
            trace: {
                userPrompt: 'stable prefix\n\nscene text',
                evidenceText: 'scene text',
                tokenUsageKnown: true,
                tokenUsageScope: 'known',
                requestPayload: {
                    prompt_cache_key: 'h578972009'
                },
                response: null,
                usage: {
                    inputTokens: 258554,
                    outputTokens: 2190,
                    totalTokens: 260744,
                    cacheReadInputTokens: 258432
                }
            } as never,
            manifest: null,
            deps,
            contentLogWritten: true
        });

        expect(content).toContain('- OpenAI prompt_cache_key: h578972009');
        expect(content).not.toContain('bypassProviderReuse or unsupported');
    });

    // ── Audit 4 doctrine lock ────────────────────────────────────────
    // The cacheable-prefix diagnostic MUST measure the real outgoing
    // provider request payload, never the scaffold trace.userPrompt
    // (which OpenAI never receives).
    describe('Audit 4: cacheable-prefix diagnostic measures the provider payload', () => {
        const CACHE_BREAK = '<<<CACHE_BREAK>>>';
        const baseResult = {
            scope: 'book',
            scopeLabel: 'B1',
            aiProvider: 'openai',
            aiModelResolved: 'gpt-5.5',
            aiModelRequested: 'gpt-5.5',
            findings: [],
            verdict: { flow: 60, depth: 70 },
            cacheReuseFingerprint: 'h1479981785'
        } as never;

        it('derives the prefix from requestPayload.input, not trace.userPrompt', () => {
            const systemText = 'SYS: editorial engine';
            const stablePrefix = 'INSTRUCTIONS\nSCHEMA\nMANIFEST\nEVIDENCE: ' + 'x'.repeat(5000);
            const userText = `${stablePrefix}\n\n${CACHE_BREAK}\n\nUser Question: Pres8`;
            const content = buildInquiryLogContent({
                result: baseResult,
                trace: {
                    // Deliberately a DIFFERENT, short scaffold string that
                    // OpenAI never receives — must NOT drive the metric.
                    userPrompt: 'SCAFFOLD-ONLY-NEVER-SENT',
                    evidenceText: 'unused-by-new-diagnostic',
                    tokenUsageKnown: true,
                    tokenUsageScope: 'known',
                    requestPayload: {
                        model: 'gpt-5.5',
                        input: [
                            { role: 'system', content: [{ type: 'input_text', text: systemText }] },
                            { role: 'user', content: [{ type: 'input_text', text: userText }] }
                        ],
                        prompt_cache_key: 'h1479981785'
                    },
                    response: null,
                    usage: { inputTokens: 5100, outputTokens: 10, totalTokens: 5110 }
                } as never,
                manifest: null,
                deps,
                contentLogWritten: true
            });

            const expectedPrefixLen = systemText.length + userText.indexOf(CACHE_BREAK);
            expect(content).toContain(
                `- Cacheable prefix chars (real request, system + user up to cache break): ${expectedPrefixLen}`
            );
            expect(content).toContain('- Cache break present in request: yes');
            expect(content).toMatch(/- Cacheable prefix fingerprint: [0-9a-f]+/);
            // The scaffold length (24 chars) must never appear as the metric.
            expect(content).not.toContain('Cacheable prefix chars (user prompt minus evidence)');
            expect(content).not.toContain(': 24\n');
        });

        it('says payload not captured (no scaffold fallback) when no input/messages present', () => {
            const content = buildInquiryLogContent({
                result: baseResult,
                trace: {
                    userPrompt: 'SCAFFOLD-ONLY-NEVER-SENT',
                    evidenceText: 'scene text',
                    tokenUsageKnown: true,
                    tokenUsageScope: 'known',
                    requestPayload: { prompt_cache_key: 'h1479981785' },
                    response: null,
                    usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 }
                } as never,
                manifest: null,
                deps,
                contentLogWritten: true
            });
            expect(content).toContain('- Cacheable prefix: request payload not captured — cannot measure (scaffold prompt is NOT a substitute)');
            expect(content).not.toContain('Cacheable prefix chars');
        });
    });
});
