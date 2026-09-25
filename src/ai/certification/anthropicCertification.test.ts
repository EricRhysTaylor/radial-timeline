import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const liveAnthropicKey = (process.env.RT_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '').trim();
const liveRequestTransportEnabled = process.env.RT_USE_LIVE_OBSIDIAN_REQUEST === '1';

vi.mock('../credentials/credentials', () => ({
    getCredential: vi.fn(async (_plugin: unknown, provider: string) => provider === 'anthropic' ? liveAnthropicKey : '')
}));

import { countAnthropicTokens } from '../../api/anthropicApi';
import { getAIClient } from '../runtime/aiClient';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { resetPricingToBuiltin } from '../cost/providerPricing';
import { extractTokenUsage } from '../usage/providerUsage';
import type { AIRunPreparedEstimate, AIRunRequest, AIRunResult, AIRunValidation, EvidenceDocument } from '../types';

type CertificationCaseResult = {
    id: string;
    passed: boolean;
    durationMs: number;
    summary: string;
    details?: Record<string, unknown>;
    error?: string;
};

type CertificationReport = {
    provider: 'anthropic';
    generatedAt: string;
    modelId: string;
    cases: CertificationCaseResult[];
};

// Certification targets the current Anthropic depth model. Re-run live
// (RT_ANTHROPIC_API_KEY + RT_USE_LIVE_OBSIDIAN_REQUEST=1) after any Opus
// promotion — the recorded report in docs/audits/ still reflects the last
// live run's model until then. RT_CERT_ANTHROPIC_MODEL certifies another
// catalog model (e.g. the continuity or pro-channel entry).
const MODEL_ID = (process.env.RT_CERT_ANTHROPIC_MODEL ?? '').trim() || 'claude-opus-5-5';
const PINNED_ANTHROPIC_POLICY = { type: 'pinned', pinnedAlias: MODEL_ID } as const;
const REPORT_JSON_PATH = resolve(process.cwd(), 'docs', 'audits', 'anthropic-certification.json');
const REPORT_MD_PATH = resolve(process.cwd(), 'docs', 'audits', 'anthropic-certification.md');

function assertCondition(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function createCertificationPlugin() {
    const aiSettings = buildDefaultAiSettings();
    aiSettings.provider = 'anthropic';
    aiSettings.privacy.allowProviderSnapshot = false;
    aiSettings.privacy.allowTelemetry = false;

    return {
        app: {},
        settings: {
            aiSettings,
            aiPricingCacheJson: null,
            aiProviderSnapshotCacheJson: null
        },
        saveSettings: vi.fn(async () => undefined),
        getActiveBookTitle: () => 'Anthropic Certification'
    } as never;
}

function primeClientForBuiltinData(client: ReturnType<typeof getAIClient>): void {
    const internal = client as unknown as {
        registryReady?: boolean;
        pricingReady?: boolean;
        providerSnapshotReady?: boolean;
        providerSnapshot?: unknown;
    };
    internal.registryReady = true;
    internal.pricingReady = true;
    internal.providerSnapshotReady = true;
    internal.providerSnapshot = { source: 'none', snapshot: null };
}

// The evidence reads like an ordinary manuscript scene. An earlier fixture —
// a "codename … cite directly" canary over one sentence repeated 220 times —
// read like a prompt-extraction probe and drew nondeterministic safety
// refusals (cyber / reasoning_extraction) from Opus 5 and 5.5 on 2026-09-25.
// The unique ferry name makes each cache group's prefix distinct, and the
// question never states the answer.
const SCENE_PEOPLE = ['Mara', 'Tobias', 'the harbormaster', 'Aunt Delphine', 'the schoolteacher', 'Old Ruen'];
const SCENE_PLACES = ['the breakwater', 'the fish market', 'the chapel steps', 'the salt flats', 'the lighthouse stair', 'the ropewalk'];
const SCENE_WEATHER = ['a thin rain', 'a white fog', 'a hard east wind', 'low winter sun', 'sleet off the water', 'a still grey morning'];
const SCENE_ACTIONS = [
    'mended nets without speaking',
    'counted the boats that had not come back',
    'argued about the price of coal',
    'read the old letters again',
    'watched the tide turn against the pilings',
    'carried bread down to the quay'
];

function buildScenePara(index: number): string {
    const person = SCENE_PEOPLE[index % SCENE_PEOPLE.length];
    const place = SCENE_PLACES[(index * 5 + 1) % SCENE_PLACES.length];
    const weather = SCENE_WEATHER[(index * 7 + 2) % SCENE_WEATHER.length];
    const action = SCENE_ACTIONS[(index * 11 + 3) % SCENE_ACTIONS.length];
    return `On the ${index + 1}th day of the thaw, under ${weather}, ${person} ${action} at ${place}. `
        + `Nobody in the village said what they were all thinking, and the gulls went on crying over the harbor as if nothing had changed.`;
}

function ferryName(cacheGroup: string): string {
    return `Kestrel-${cacheGroup}`;
}

function buildLargeEvidenceDocument(cacheGroup: string): EvidenceDocument {
    const paragraphs = Array.from({ length: 90 }, (_, index) => buildScenePara(index));
    paragraphs.splice(45, 0, `That winter Mara crossed the strait every Thursday on the old ferry, the ${ferryName(cacheGroup)}, which smelled of tar and wet wool.`);
    return {
        title: 'Scene S1',
        content: paragraphs.join('\n\n')
    };
}

function buildCacheableInquiryRequest(task: string, cacheGroup: string): AIRunRequest {
    return {
        feature: 'InquiryMode',
        task,
        requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
        featureModeInstructions: 'Answer only from the attached manuscript evidence.',
        userInput: 'Use the attached evidence only.',
        userQuestion: 'In the attached scene, what is the name of the ferry Mara takes across the strait? Answer with the name only.',
        promptText: 'Use the attached evidence only.',
        returnType: 'text',
        providerOverride: 'anthropic',
        policyOverride: PINNED_ANTHROPIC_POLICY,
        overrides: {
            temperature: 0.1
        },
        evidenceDocuments: [buildLargeEvidenceDocument(cacheGroup)]
    };
}

function requestUsesAnthropicCacheControl(requestPayload: unknown): boolean {
    const payload = requestPayload && typeof requestPayload === 'object'
        ? requestPayload as { requestBody?: { messages?: Array<{ content?: Array<{ cache_control?: unknown }> }> } }
        : undefined;
    const messages = Array.isArray(payload?.requestBody?.messages) ? payload.requestBody.messages : [];
    return messages.some(message => {
        const content = Array.isArray(message.content) ? message.content : [];
        return content.some(block => typeof block?.cache_control === 'object' && block.cache_control !== null);
    });
}

async function prepareAndRun(
    client: ReturnType<typeof getAIClient>,
    request: AIRunRequest
): Promise<{ prepared: AIRunPreparedEstimate; run: AIRunResult; validation: AIRunValidation; usage: ReturnType<typeof extractTokenUsage> }> {
    const preparedResult = await client.prepareRunEstimate(request);
    assertCondition(preparedResult.ok, `prepareRunEstimate failed: ${preparedResult.ok ? 'unexpected success state' : preparedResult.result.error ?? 'unknown error'}`);
    const prepared = preparedResult.estimate;
    const run = await client.run({
        ...request,
        preparedEstimate: prepared
    });
    assertCondition(run.validation, 'run.validation was not populated.');
    const usage = extractTokenUsage(run.provider, run.responseData);
    return {
        prepared,
        run,
        validation: run.validation,
        usage
    };
}

async function executeCase(
    id: string,
    execute: () => Promise<{ summary: string; details?: Record<string, unknown> }>
): Promise<CertificationCaseResult> {
    const startedAt = Date.now();
    try {
        const outcome = await execute();
        return {
            id,
            passed: true,
            durationMs: Date.now() - startedAt,
            summary: outcome.summary,
            details: outcome.details
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            id,
            passed: false,
            durationMs: Date.now() - startedAt,
            summary: 'Failed',
            error: message
        };
    }
}

function buildMarkdownReport(report: CertificationReport): string {
    const lines: string[] = [];
    lines.push('# Anthropic Certification');
    lines.push('');
    lines.push(`- Generated at: ${report.generatedAt}`);
    lines.push(`- Provider: ${report.provider}`);
    lines.push(`- Model: ${report.modelId}`);
    lines.push('');
    lines.push('| Case | Result | Summary |');
    lines.push('| --- | --- | --- |');
    report.cases.forEach(testCase => {
        lines.push(`| ${testCase.id} | ${testCase.passed ? 'PASS' : 'FAIL'} | ${testCase.summary.replace(/\|/g, '\\|')} |`);
    });
    report.cases.forEach(testCase => {
        lines.push('');
        lines.push(`## ${testCase.id}`);
        lines.push(`- Result: ${testCase.passed ? 'PASS' : 'FAIL'}`);
        lines.push(`- Duration: ${testCase.durationMs}ms`);
        lines.push(`- Summary: ${testCase.summary}`);
        if (testCase.error) {
            lines.push(`- Error: ${testCase.error}`);
        }
        if (testCase.details) {
            lines.push('```json');
            lines.push(JSON.stringify(testCase.details, null, 2));
            lines.push('```');
        }
    });
    lines.push('');
    return lines.join('\n');
}

function writeReport(report: CertificationReport): void {
    const reportDir = resolve(process.cwd(), 'docs', 'audits');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
    writeFileSync(REPORT_MD_PATH, buildMarkdownReport(report));
}

describe.skipIf(!liveAnthropicKey || !liveRequestTransportEnabled)('Anthropic live certification', () => {
    it('certifies the shared Anthropic runtime contract', async () => {
        resetPricingToBuiltin();
        const plugin = createCertificationPlugin();
        const client = getAIClient(plugin);
        primeClientForBuiltinData(client);

        const runNonce = Date.now().toString(36);
        const baselineInquiryRequest = buildCacheableInquiryRequest('AnthropicCertificationCacheableInquiry', `baseline-${runNonce}`);
        const cacheRepeatTask = 'AnthropicCertificationCacheRepeat';
        const cacheRepeatRequest = buildCacheableInquiryRequest(cacheRepeatTask, `cache-repeat-${runNonce}`);
        const freshBypassTask = 'AnthropicCertificationFreshRunWarm';
        const freshBypassRequest = buildCacheableInquiryRequest(freshBypassTask, `fresh-run-${runNonce}`);

        const strictTextRequest: AIRunRequest = {
            feature: 'AnthropicCertification',
            task: 'AnthropicCertificationText',
            requiredCapabilities: ['longContext'],
            featureModeInstructions: 'Reply with the requested token and nothing else.',
            userInput: 'Reply with ACK.',
            promptText: 'Reply with ACK.',
            returnType: 'text',
            providerOverride: 'anthropic',
            policyOverride: PINNED_ANTHROPIC_POLICY,
            overrides: {
                temperature: 0.1
            },
            bypassInMemoryCache: true,
            bypassProviderReuse: true
        };

        const strictJsonRequest: AIRunRequest = {
            feature: 'AnthropicCertification',
            task: 'AnthropicCertificationJson',
            requiredCapabilities: ['longContext', 'jsonStrict'],
            featureModeInstructions: 'Return the requested structured JSON object only.',
            userInput: 'Return a JSON object with {"answer":"ACK"}.',
            promptText: 'Return a JSON object with {"answer":"ACK"}.',
            returnType: 'json',
            responseSchema: {
                type: 'object',
                properties: {
                    answer: { type: 'string' }
                },
                required: ['answer'],
                additionalProperties: false
            },
            providerOverride: 'anthropic',
            policyOverride: PINNED_ANTHROPIC_POLICY,
            overrides: {
                temperature: 0.1,
                jsonStrict: true
            },
            bypassInMemoryCache: true,
            bypassProviderReuse: true
        };

        const cases: CertificationCaseResult[] = [];

        cases.push(await executeCase('prepared_count_matches_provider_count', async () => {
            const preparedResult = await client.prepareRunEstimate(baselineInquiryRequest);
            assertCondition(preparedResult.ok, `prepareRunEstimate failed: ${preparedResult.ok ? 'unexpected success state' : preparedResult.result.error ?? 'unknown error'}`);
            const prepared = preparedResult.estimate;
            const providerCount = await countAnthropicTokens(
                liveAnthropicKey,
                prepared.model.id,
                prepared.systemPrompt,
                prepared.userPrompt,
                prepared.citationsEnabled,
                prepared.evidenceDocuments,
                undefined,
                undefined
            );
            expect(prepared.tokenEstimateMethod).toBe('anthropic_count');
            expect(prepared.tokenEstimateInput).toBe(providerCount.inputTokens);
            return {
                summary: 'Prepared estimate used Anthropic count_tokens and matched the direct provider count exactly.',
                details: {
                    tokenEstimateMethod: prepared.tokenEstimateMethod,
                    preparedInputTokens: prepared.tokenEstimateInput,
                    providerCountInputTokens: providerCount.inputTokens
                }
            };
        }));

        cases.push(await executeCase('one_pass_text_success', async () => {
            const { prepared, run, validation, usage } = await prepareAndRun(client, strictTextRequest);
            expect(run.aiStatus, run.error).toBe('success');
            expect(run.content).toBeTruthy();
            expect(validation.schemaMode).toBe('none');
            expect(validation.requestPayloadCaptured).toBe(true);
            expect(validation.actualUsageCaptured).toBe(true);
            expect(validation.bypassedProviderReuse).toBe(true);
            expect(validation.bypassedInMemoryCache).toBe(true);
            expect(usage?.inputTokens).toBe(prepared.tokenEstimateInput);
            return {
                summary: 'One-pass text run succeeded with exact input token accounting.',
                details: {
                    content: run.content,
                    preparedInputTokens: prepared.tokenEstimateInput,
                    actualInputTokens: usage?.inputTokens,
                    validation
                }
            };
        }));

        cases.push(await executeCase('one_pass_json_success', async () => {
            const { prepared, run, validation, usage } = await prepareAndRun(client, strictJsonRequest);
            expect(run.aiStatus, run.error).toBe('success');
            expect(validation.schemaMode).toBe('json_schema');
            expect(validation.requestPayloadCaptured).toBe(true);
            expect(validation.actualUsageCaptured).toBe(true);
            expect(usage?.inputTokens).toBe(prepared.tokenEstimateInput);
            const parsed = JSON.parse(run.content ?? '{}') as { answer?: string };
            expect(parsed.answer).toBe('ACK');
            return {
                summary: 'One-pass JSON run succeeded with exact input token accounting and valid structured output.',
                details: {
                    parsed,
                    preparedInputTokens: prepared.tokenEstimateInput,
                    actualInputTokens: usage?.inputTokens,
                    validation
                }
            };
        }));

        cases.push(await executeCase('evidence_grounded_text_run', async () => {
            // Provider citations are disabled product-wide (resolveCitationsEnabled
            // returns false; Sources come from the schema's evidence_quote field),
            // so this case certifies that attached evidence reaches the model and
            // grounds the answer, and that no citation request is sent.
            const { run, validation } = await prepareAndRun(client, {
                ...baselineInquiryRequest,
                task: 'AnthropicCertificationEvidence',
                bypassInMemoryCache: true,
                bypassProviderReuse: true
            });
            expect(run.aiStatus, run.error).toBe('success');
            expect(validation.citationsRequested).toBe(false);
            expect(run.content ?? '', 'answer is not grounded in the evidence').toContain(ferryName(`baseline-${runNonce}`));
            return {
                summary: 'Inquiry-style text run answered from the attached evidence without a provider citation request.',
                details: {
                    content: run.content,
                    validation
                }
            };
        }));

        cases.push(await executeCase('provider_cache_create', async () => {
            const { run, validation, usage } = await prepareAndRun(client, {
                ...cacheRepeatRequest,
                bypassInMemoryCache: true
            });
            expect(run.aiStatus, run.error).toBe('success');
            expect(validation.bypassedInMemoryCache).toBe(true);
            expect(validation.bypassedProviderReuse).toBe(false);
            expect(validation.providerReuseRequested).toBe(true);
            expect(validation.providerCacheStatus).toBe('created');
            expect(requestUsesAnthropicCacheControl(run.requestPayload)).toBe(true);
            expect(usage?.cacheCreationInputTokens || usage?.cacheCreation1hInputTokens || usage?.cacheCreation5mInputTokens).toBeTruthy();
            return {
                summary: 'First cacheable Anthropic run created provider-side cached input.',
                details: {
                    requestPayload: run.requestPayload,
                    usage,
                    validation
                }
            };
        }));

        cases.push(await executeCase('provider_cache_hit_repeat', async () => {
            const { run, validation, usage } = await prepareAndRun(client, {
                ...cacheRepeatRequest,
                bypassInMemoryCache: true
            });
            expect(run.aiStatus, run.error).toBe('success');
            expect(validation.providerReuseRequested).toBe(true);
            expect(validation.providerCacheStatus).toBe('hit');
            expect(validation.reuseState).toBe('warm');
            expect((usage?.cacheReadInputTokens ?? 0) > 0).toBe(true);
            return {
                summary: 'Second identical Anthropic run hit provider-side cached input.',
                details: {
                    requestPayload: run.requestPayload,
                    usage,
                    validation
                }
            };
        }));

        cases.push(await executeCase('fresh_run_bypass', async () => {
            const warmup = await prepareAndRun(client, {
                ...freshBypassRequest,
                bypassInMemoryCache: true
            });
            expect(warmup.run.aiStatus, `warmup: ${warmup.run.error ?? ''}`).toBe('success');
            const { run, validation, usage } = await prepareAndRun(client, {
                ...freshBypassRequest,
                bypassInMemoryCache: true,
                bypassProviderReuse: true
            });
            expect(run.aiStatus, run.error).toBe('success');
            expect(validation.bypassedInMemoryCache).toBe(true);
            expect(validation.bypassedProviderReuse).toBe(true);
            expect(validation.providerReuseRequested).toBe(false);
            expect(validation.reuseState).toBe('idle');
            expect(validation.providerCacheStatus).toBeUndefined();
            expect(requestUsesAnthropicCacheControl(run.requestPayload)).toBe(false);
            expect((usage?.cacheReadInputTokens ?? 0)).toBe(0);
            return {
                summary: 'Fresh-run bypass disabled both RT cache reuse and Anthropic provider reuse.',
                details: {
                    warmupValidation: warmup.validation,
                    requestPayload: run.requestPayload,
                    usage,
                    validation
                }
            };
        }));

        const report: CertificationReport = {
            provider: 'anthropic',
            generatedAt: new Date().toISOString(),
            modelId: MODEL_ID,
            cases
        };
        writeReport(report);

        const failures = cases.filter(testCase => !testCase.passed);
        expect(failures, `Anthropic certification failures recorded in ${REPORT_MD_PATH}`).toEqual([]);
    }, 180000);
});
