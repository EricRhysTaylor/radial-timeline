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
import type { AIRunPreparedEstimate, AIRunRequest, AIRunResult, AIRunValidation, EvidenceDocument, SourceCitation } from '../types';

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
// live run's model until then.
const PINNED_ANTHROPIC_POLICY = { type: 'pinned', pinnedAlias: 'claude-opus-5' } as const;
const MODEL_ID = 'claude-opus-5';
const UNIQUE_CODE = 'AURORA-LATTICE';
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

function buildLargeEvidenceDocument(cacheGroup: string): EvidenceDocument {
    const fillerParagraph = 'Stable manuscript evidence paragraph for Anthropic cache certification. ';
    const filler = fillerParagraph.repeat(220);
    const codename = `${UNIQUE_CODE}-${cacheGroup}`;
    return {
        title: 'Scene S1',
        content: [
            `Codename ${codename} appears in the manuscript evidence and should be cited directly.`,
            filler,
            'The answer should remain grounded in the attached evidence document.'
        ].join('\n\n')
    };
}

function buildCacheableInquiryRequest(task: string, cacheGroup: string): AIRunRequest {
    const codename = `${UNIQUE_CODE}-${cacheGroup}`;
    return {
        feature: 'InquiryMode',
        task,
        requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
        featureModeInstructions: 'Answer only from the attached manuscript evidence.',
        userInput: 'Use the attached evidence only.',
        userQuestion: `What codename appears in evidence? Reply with the codename ${codename}.`,
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
        const freshBypassTask = 'AnthropicCertificationFreshBypassWarm';
        const freshBypassRequest = buildCacheableInquiryRequest(freshBypassTask, `fresh-bypass-${runNonce}`);

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
            expect(run.aiStatus).toBe('success');
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
            expect(run.aiStatus).toBe('success');
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

        cases.push(await executeCase('document_citations_text_run', async () => {
            const { run, validation } = await prepareAndRun(client, {
                ...baselineInquiryRequest,
                task: 'AnthropicCertificationCitations',
                bypassInMemoryCache: true,
                bypassProviderReuse: true
            });
            expect(run.aiStatus).toBe('success');
            expect(validation.evidenceTransport).toBe('document_blocks');
            expect(validation.citationsRequested).toBe(true);
            expect((run.citations?.length ?? 0) > 0).toBe(true);
            expect((run.content ?? '').includes(`${UNIQUE_CODE}-baseline-${runNonce}`)).toBe(true);
            return {
                summary: 'Inquiry-style text run used Anthropic document blocks and returned direct manuscript citations.',
                details: {
                    content: run.content,
                    citations: run.citations as SourceCitation[] | undefined,
                    validation
                }
            };
        }));

        cases.push(await executeCase('provider_cache_create', async () => {
            const { run, validation, usage } = await prepareAndRun(client, {
                ...cacheRepeatRequest,
                bypassInMemoryCache: true
            });
            expect(run.aiStatus).toBe('success');
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
            expect(run.aiStatus).toBe('success');
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
            expect(warmup.run.aiStatus).toBe('success');
            const { run, validation, usage } = await prepareAndRun(client, {
                ...freshBypassRequest,
                bypassInMemoryCache: true,
                bypassProviderReuse: true
            });
            expect(run.aiStatus).toBe('success');
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
