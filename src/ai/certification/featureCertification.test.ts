/**
 * Live feature certification — runs the three AI features (Pulse triplet
 * analysis, Gossamer, Inquiry) end-to-end against ONE real provider model,
 * on a real manuscript read from an Obsidian vault on disk.
 *
 * The request builders, response parsers and validators are the production
 * ones; only the Obsidian app (vault / metadataCache / modals / Notices) is
 * replaced by the in-memory test app. A model is certified for RT when all
 * three features return output that passes the production validators.
 *
 * Run (skipped unless live transport and the provider's key are present):
 *   RT_CERT_PROVIDER=anthropic RT_CERT_MODEL=claude-opus-5-5 npm run certify:features
 *
 * Env:
 *   RT_CERT_PROVIDER   anthropic | openai | google          (required)
 *   RT_CERT_MODEL      catalog model id, e.g. gpt-6-sol       (required)
 *   RT_CERT_VAULT      vault folder (default: ../Test Vaults/Obsidian Vault AI Certification)
 *   RT_CERT_BOOK       book folder inside the vault (default: Pride & Prejudice)
 *   RT_CERT_FEATURES   comma list of pulse,gossamer,inquiry (default: all three)
 *   RT_CERT_PULSE_TRIPLETS  how many Pulse triplets to run (default: 3)
 *   Keys: RT_<PROVIDER>_API_KEY or ANTHROPIC_API_KEY / OPENAI_API_KEY /
 *         GEMINI_API_KEY (GOOGLE_API_KEY)
 *
 * Reports: docs/audits/feature-certification/<model>.json and .md
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type CertProvider = 'anthropic' | 'openai' | 'google';

const PROVIDER = (process.env.RT_CERT_PROVIDER ?? '').trim() as CertProvider | '';
const MODEL_ID = (process.env.RT_CERT_MODEL ?? '').trim();
const VAULT_PATH = (process.env.RT_CERT_VAULT ?? '').trim()
    || resolve(process.cwd(), '..', 'Test Vaults', 'Obsidian Vault AI Certification');
const BOOK_FOLDER = (process.env.RT_CERT_BOOK ?? '').trim() || 'Pride & Prejudice';
const FEATURES = new Set(((process.env.RT_CERT_FEATURES ?? '').trim() || 'pulse,gossamer,inquiry')
    .split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean));
const PULSE_TRIPLETS = Math.max(1, Number.parseInt(process.env.RT_CERT_PULSE_TRIPLETS ?? '3', 10) || 3);
const LIVE_TRANSPORT = process.env.RT_USE_LIVE_OBSIDIAN_REQUEST === '1';

function readKey(provider: CertProvider | ''): string {
    const env = process.env;
    if (provider === 'anthropic') return (env.RT_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY ?? '').trim();
    if (provider === 'openai') return (env.RT_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? '').trim();
    if (provider === 'google') return (env.RT_GEMINI_API_KEY ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim();
    return '';
}
const API_KEY = readKey(PROVIDER);

vi.mock('../credentials/credentials', () => ({
    getCredential: vi.fn(async (_plugin: unknown, provider: string) => provider === PROVIDER ? API_KEY : '')
}));

import { TFile } from 'obsidian';
import { createInMemoryApp } from '../../../tests/helpers/inMemoryObsidian';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { resetPricingToBuiltin } from '../cost/providerPricing';
import { estimateUsageCost } from '../cost/estimateCorpusCost';
import { extractTokenUsage, type TokenUsage } from '../usage/providerUsage';
import { getAIClient } from '../runtime/aiClient';
import { BUILTIN_MODELS } from '../registry/builtinModels';
import type { AIRunRequest, AIRunResult } from '../types';
import { getAllSceneData } from '../../sceneAnalysis/data';
import { buildTripletsByIndex } from '../../sceneAnalysis/TripletBuilder';
import { getActiveContextPrompt } from '../../sceneAnalysis/Processor';
import { parsePulseAnalysisResponse } from '../../sceneAnalysis/responseParsing';
import { buildSceneAnalysisPrompt, getSceneAnalysisJsonSchema, getSceneAnalysisSystemPrompt } from '../prompts/sceneAnalysis';
import { readSceneId, resolveSceneReferenceId } from '../../utils/sceneIds';
import { asBeatFrontmatter, readBeatPurpose } from '../../utils/frontmatter';
import { buildGossamerEvidenceDocument } from '../../gossamer/evidence/buildGossamerEvidence';
import { buildUnifiedBeatAnalysisCacheParts, getUnifiedBeatAnalysisJsonSchema, type UnifiedBeatInfo } from '../prompts/unifiedBeatAnalysis';
import { unwrapStructuredEnvelope } from '../structuredResponseUnwrap';
import { validateGossamerResponse } from '../gossamer/responseValidation';
import { InquiryRunnerService } from '../../inquiry/runner/InquiryRunnerService';
import { ALL_CANONICAL_QUESTIONS } from '../../inquiry/questions/canonicalQuestions';
import type { CorpusManifestEntry, InquiryRunnerInput } from '../../inquiry/runner/types';
import { INQUIRY_SCHEMA_VERSION } from '../../inquiry/constants';
import { hashString } from '../../inquiry/services/InquiryCorpusService';
import { OutputProfileStore } from '../cost/outputProfile';

type FeatureCase = {
    id: string;
    feature: 'pulse' | 'gossamer' | 'inquiry';
    passed: boolean;
    durationMs: number;
    summary: string;
    refusal?: string;
    error?: string;
    usage?: TokenUsage | null;
    costUSD?: number;
    sample?: unknown;
};

const REPORT_DIR = resolve(process.cwd(), 'docs', 'audits', 'feature-certification');

function placementOf(name: string): number {
    const match = name.match(/^(\d+(?:\.\d+)?)/);
    return match ? Number.parseFloat(match[1]) : Number.POSITIVE_INFINITY;
}

function loadBookFiles(): Record<string, string> {
    const bookDir = join(VAULT_PATH, BOOK_FOLDER);
    if (!existsSync(bookDir)) {
        throw new Error(`Certification book folder not found: ${bookDir}`);
    }
    const files: Record<string, string> = {};
    for (const name of readdirSync(bookDir)) {
        if (!name.endsWith('.md')) continue;
        files[`${BOOK_FOLDER}/${name}`] = readFileSync(join(bookDir, name), 'utf8');
    }
    return files;
}

function createPlugin(app: ReturnType<typeof createInMemoryApp>) {
    const aiSettings = buildDefaultAiSettings();
    aiSettings.provider = PROVIDER as CertProvider;
    aiSettings.modelPolicy = { type: 'pinned', pinnedAlias: modelAlias() };
    aiSettings.privacy.allowProviderSnapshot = false;
    aiSettings.privacy.allowTelemetry = false;
    // Inquiry sizes its output request from the learned output profile. Start
    // it empty and keep it in memory so certification never reads or writes
    // an author's profile file.
    const outputProfileStore = new OutputProfileStore({
        manifest: { id: 'radial-timeline' },
        app: {
            vault: {
                configDir: '.obsidian',
                adapter: {
                    exists: async () => false,
                    read: async () => '',
                    write: async () => undefined
                }
            }
        }
    } as never);
    return {
        app,
        getOutputProfileStore: () => outputProfileStore,
        settings: {
            ...structuredClone(DEFAULT_SETTINGS),
            sourcePath: BOOK_FOLDER,
            aiSettings,
            aiPricingCacheJson: null,
            aiProviderSnapshotCacheJson: null
        },
        lastAnalysisError: '',
        saveSettings: vi.fn(async () => undefined),
        getActiveBookTitle: () => BOOK_FOLDER
    } as never;
}

function modelAlias(): string {
    const model = BUILTIN_MODELS.find(entry => entry.provider === PROVIDER && entry.id === MODEL_ID);
    if (!model) throw new Error(`${PROVIDER}/${MODEL_ID} is not in BUILTIN_MODELS.`);
    return model.alias;
}

function primeClient(client: ReturnType<typeof getAIClient>): void {
    const internal = client as unknown as Record<string, unknown>;
    internal.registryReady = true;
    internal.pricingReady = true;
    internal.providerSnapshotReady = true;
    internal.providerSnapshot = { source: 'none', snapshot: null };
}

function pinned(): Pick<AIRunRequest, 'providerOverride' | 'policyOverride'> {
    return {
        providerOverride: PROVIDER as CertProvider,
        policyOverride: { type: 'pinned', pinnedAlias: modelAlias() }
    };
}

function refusalOf(run: AIRunResult): string | undefined {
    const data = run.responseData as { stop_reason?: string; stop_details?: { category?: string } } | undefined;
    if (data?.stop_reason === 'refusal') return data.stop_details?.category ?? 'unspecified';
    return undefined;
}

function costOf(usage: TokenUsage | null | undefined): number | undefined {
    if (!usage) return undefined;
    return estimateUsageCost(PROVIDER as CertProvider, MODEL_ID, usage)?.totalCostUSD;
}

async function timed(
    id: string,
    feature: FeatureCase['feature'],
    body: () => Promise<Omit<FeatureCase, 'id' | 'feature' | 'durationMs'>>
): Promise<FeatureCase> {
    const startedAt = Date.now();
    try {
        const outcome = await body();
        return { id, feature, durationMs: Date.now() - startedAt, ...outcome };
    } catch (error) {
        return {
            id,
            feature,
            passed: false,
            durationMs: Date.now() - startedAt,
            summary: 'Harness error',
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

async function certifyPulse(plugin: never, app: ReturnType<typeof createInMemoryApp>): Promise<FeatureCase[]> {
    const client = getAIClient(plugin);
    primeClient(client);
    const scenes = (await getAllSceneData(plugin, app.vault as never))
        .sort((a, b) => placementOf(a.file.name) - placementOf(b.file.name));
    if (scenes.length < 3) throw new Error(`Pulse needs at least 3 scenes; found ${scenes.length}.`);
    // Evenly spaced interior scenes so the triplets sample the whole book.
    const step = Math.max(1, Math.floor((scenes.length - 2) / (PULSE_TRIPLETS + 1)));
    const targets = Array.from({ length: PULSE_TRIPLETS }, (_, index) => scenes[Math.min(scenes.length - 2, 1 + step * (index + 1))]);
    const triplets = buildTripletsByIndex(scenes, targets, scene => scene.file.path);
    const contextPrompt = getActiveContextPrompt(plugin);
    const cases: FeatureCase[] = [];
    for (const triplet of triplets) {
        const ref = (scene: typeof triplet.current | null) => scene
            ? resolveSceneReferenceId(readSceneId(scene.frontmatter), scene.file.path)
            : undefined;
        const num = (scene: typeof triplet.current | null) => scene ? String(scene.sceneNumber ?? 'N/A') : 'N/A';
        cases.push(await timed(`pulse:${triplet.current.file.basename}`, 'pulse', async () => {
            const userPrompt = buildSceneAnalysisPrompt(
                triplet.prev?.body ?? null,
                triplet.current.body,
                triplet.next?.body ?? null,
                num(triplet.prev),
                num(triplet.current),
                num(triplet.next),
                contextPrompt,
                { prevRefId: ref(triplet.prev), currentRefId: ref(triplet.current)!, nextRefId: ref(triplet.next) }
            );
            const run = await client.run({
                feature: 'PulseAnalysis',
                task: 'ScenePulseTriplet',
                requiredCapabilities: ['jsonStrict', 'reasoningStrong'],
                featureModeInstructions: getSceneAnalysisSystemPrompt(),
                userInput: userPrompt,
                returnType: 'json',
                responseSchema: getSceneAnalysisJsonSchema(),
                ...pinned(),
                overrides: { temperature: 0.1, maxOutputMode: 'high', reasoningDepth: 'deep', jsonStrict: true }
            });
            const usage = extractTokenUsage(run.provider, run.responseData);
            const refusal = refusalOf(run);
            if (run.aiStatus !== 'success' || !run.content) {
                return { passed: false, summary: `Run ${run.aiStatus}`, refusal, error: run.error, usage, costUSD: costOf(usage) };
            }
            const parsed = parsePulseAnalysisResponse(run.content, plugin);
            const lastError = (plugin as unknown as { lastAnalysisError: string }).lastAnalysisError;
            return {
                passed: parsed !== null,
                summary: parsed ? 'Parsed and validated by the production Pulse parser.' : `Pulse parser rejected the response: ${lastError}`,
                usage,
                costUSD: costOf(usage),
                sample: parsed
            };
        }));
    }
    return cases;
}

async function certifyGossamer(plugin: never, app: ReturnType<typeof createInMemoryApp>): Promise<FeatureCase> {
    return timed('gossamer:momentum', 'gossamer', async () => {
        const client = getAIClient(plugin);
        primeClient(client);
        const markdown = app.vault.getMarkdownFiles();
        const beatSystem = 'Save The Cat';
        const beats: UnifiedBeatInfo[] = markdown
            .map(file => ({ file, fm: asBeatFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter) }))
            .filter(entry => entry.fm && String((entry.fm as Record<string, unknown>).Class ?? '').toLowerCase() === 'beat'
                && String((entry.fm as Record<string, unknown>)['Beat Model'] ?? '') === beatSystem)
            .sort((a, b) => placementOf(a.file.basename) - placementOf(b.file.basename))
            .map((entry, index) => {
                const title = entry.file.basename;
                const placement = title.match(/^(\d+(?:\.\d+)?)/)?.[1];
                const range = (entry.fm as Record<string, unknown>).Range;
                return {
                    beatName: title.replace(/^\d+(?:\.\d+)?\s+/, ''),
                    beatNumber: index + 1,
                    idealRange: typeof range === 'string' ? range : '0-100',
                    placement,
                    description: readBeatPurpose(entry.fm)
                };
            });
        if (!beats.length) throw new Error(`No "${beatSystem}" beat notes in ${BOOK_FOLDER}.`);
        const scenes = (await getAllSceneData(plugin, app.vault as never))
            .sort((a, b) => placementOf(a.file.name) - placementOf(b.file.name));
        const evidence = await buildGossamerEvidenceDocument({
            sceneFiles: scenes.map(scene => scene.file as TFile),
            vault: app.vault as never,
            metadataCache: app.metadataCache as never
        });
        const signal = 'momentum' as const;
        const { stableInput, volatileQuestion } = buildUnifiedBeatAnalysisCacheParts(evidence.text, beats, beatSystem, signal);
        const run = await client.run({
            feature: 'Gossamer',
            task: 'BeatMomentumAnalysis',
            requiredCapabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
            featureModeInstructions: 'Evaluate the requested narrative signal at each beat using only the submitted manuscript and beat list. The signal and its scoring rubric follow the manuscript.',
            projectContext: `Project: Radial Timeline\nBook: ${BOOK_FOLDER}\nFeature: Gossamer\nTask: Beat signal analysis`,
            userInput: stableInput,
            userQuestion: volatileQuestion,
            placeUserQuestionLast: true,
            returnType: 'json',
            responseSchema: getUnifiedBeatAnalysisJsonSchema(),
            bypassRoleTemplate: true,
            ...pinned(),
            overrides: { temperature: 0.3, maxOutputMode: 'high', reasoningDepth: 'deep', jsonStrict: true }
        });
        const usage = extractTokenUsage(run.provider, run.responseData);
        const refusal = refusalOf(run);
        if (run.aiStatus !== 'success' || !run.content) {
            return { passed: false, summary: `Run ${run.aiStatus}`, refusal, error: run.error, usage, costUSD: costOf(usage) };
        }
        const parsed: unknown = JSON.parse(run.content);
        const validation = validateGossamerResponse(unwrapStructuredEnvelope(parsed, ['beats', 'overallAssessment']).value, beats, signal);
        return {
            passed: validation.ok,
            summary: validation.ok
                ? `All ${beats.length} beats scored and validated (${evidence.includedScenes} scenes, ${evidence.totalWords} words).`
                : `Validator rejected ${validation.failures.length} beat row(s): ${validation.failures.slice(0, 3).map(f => `[${f.code}] ${f.detail}`).join('; ')}`,
            usage,
            costUSD: costOf(usage),
            sample: validation.ok ? validation.beats.slice(0, 3) : validation.failures.slice(0, 5)
        };
    });
}

async function certifyInquiry(plugin: never, app: ReturnType<typeof createInMemoryApp>): Promise<FeatureCase> {
    return timed('inquiry:setup-core', 'inquiry', async () => {
        const client = getAIClient(plugin);
        primeClient(client);
        const scenes = (await getAllSceneData(plugin, app.vault as never))
            .sort((a, b) => placementOf(a.file.name) - placementOf(b.file.name));
        const entries: CorpusManifestEntry[] = scenes.map(scene => ({
            path: scene.file.path,
            sceneId: readSceneId(scene.frontmatter) ?? undefined,
            mtime: 0,
            class: 'scene',
            mode: 'full',
            isTarget: false
        }));
        const question = ALL_CANONICAL_QUESTIONS.find(entry => entry.id === 'setup-core');
        if (!question) throw new Error('Canonical question setup-core is missing.');
        const fingerprintSource = entries.map(entry => `${entry.path}:${entry.sceneId ?? ''}:${entry.mtime}:${entry.mode}`).sort().join('|');
        const input: InquiryRunnerInput = {
            scope: 'book',
            scopeLabel: BOOK_FOLDER,
            targetSceneIds: [],
            selectionMode: 'discover',
            mode: 'flow',
            questionId: question.id,
            questionText: question.standardPrompt,
            questionPromptForm: 'standard',
            questionZone: question.zone,
            corpus: {
                entries,
                fingerprint: hashString(`${INQUIRY_SCHEMA_VERSION}|${question.id}|${MODEL_ID}|${fingerprintSource}`),
                corpusOnlyFingerprint: hashString(`${INQUIRY_SCHEMA_VERSION}|${question.id}|${fingerprintSource}`),
                cacheReuseFingerprint: hashString(`${INQUIRY_SCHEMA_VERSION}|${MODEL_ID}|${fingerprintSource}`),
                snapshot: entries.map(({ path, sceneId, mtime, class: entryClass, mode, isTarget }) => ({ path, sceneId, mtime, class: entryClass, mode, isTarget })),
                generatedAt: Date.now(),
                resolvedRoots: [BOOK_FOLDER],
                allowedClasses: ['scene'],
                synopsisOnly: false,
                classCounts: { scene: entries.length }
            },
            rules: { sagaOutlineScope: 'saga-only', bookOutlineScope: 'book-only', crossScopeUsage: 'conflict-only' },
            ai: { provider: PROVIDER as CertProvider, modelId: MODEL_ID, modelLabel: MODEL_ID },
            citationsEnabled: false
        };
        const runner = new InquiryRunnerService(plugin, app.vault as never, app.metadataCache as never);
        const { result, trace } = await runner.runWithTrace(input);
        const usage = (trace as { usage?: TokenUsage }).usage ?? null;
        const findings = result.findings ?? [];
        const passed = result.aiStatus === 'success' && findings.length > 0;
        return {
            passed,
            summary: passed
                ? `Inquiry returned ${findings.length} finding(s) over ${entries.length} scenes; verdict and refs passed the production result builder.`
                : `Inquiry ${result.aiStatus ?? 'unknown'}: ${result.aiReason ?? ''}`,
            error: passed ? undefined : (result as { aiError?: string }).aiError ?? result.aiReason,
            usage,
            costUSD: costOf(usage),
            sample: passed ? { verdict: result.verdict, summary: result.summary, firstFinding: findings[0] } : undefined
        };
    });
}

/**
 * A run limited by RT_CERT_FEATURES keeps the model's recorded cases for the
 * features it did not run, so one report per model always shows all three.
 */
function mergeWithPriorReport(cases: FeatureCase[]): FeatureCase[] {
    const priorPath = join(REPORT_DIR, `${MODEL_ID}.json`);
    if (!existsSync(priorPath)) return cases;
    const prior = JSON.parse(readFileSync(priorPath, 'utf8')) as { book?: string; cases?: FeatureCase[] };
    if (prior.book !== BOOK_FOLDER || !Array.isArray(prior.cases)) return cases;
    const rerun = new Set(cases.map(entry => entry.feature));
    return [...prior.cases.filter(entry => !rerun.has(entry.feature)), ...cases]
        .sort((a, b) => ['pulse', 'gossamer', 'inquiry'].indexOf(a.feature) - ['pulse', 'gossamer', 'inquiry'].indexOf(b.feature));
}

function writeReport(runCases: FeatureCase[]): void {
    mkdirSync(REPORT_DIR, { recursive: true });
    const cases = mergeWithPriorReport(runCases);
    const generatedAt = new Date().toISOString();
    const report = { provider: PROVIDER, modelId: MODEL_ID, vault: VAULT_PATH, book: BOOK_FOLDER, generatedAt, cases };
    writeFileSync(join(REPORT_DIR, `${MODEL_ID}.json`), JSON.stringify(report, null, 2));
    const totalCost = cases.reduce((sum, entry) => sum + (entry.costUSD ?? 0), 0);
    const lines = [
        `# Feature certification — ${PROVIDER}/${MODEL_ID}`,
        '',
        `- Generated at: ${generatedAt}`,
        `- Corpus: ${BOOK_FOLDER} (${VAULT_PATH})`,
        `- Result: ${cases.every(entry => entry.passed) ? 'PASS' : 'FAIL'}`,
        `- Estimated spend: $${totalCost.toFixed(4)}`,
        '',
        '| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...cases.map(entry => `| ${entry.id} | ${entry.passed ? 'PASS' : 'FAIL'} | ${(entry.durationMs / 1000).toFixed(1)} | ${entry.usage?.inputTokens ?? '—'} | ${entry.usage?.outputTokens ?? '—'} | ${entry.costUSD !== undefined ? `$${entry.costUSD.toFixed(4)}` : '—'} | ${(entry.refusal ? `refusal: ${entry.refusal}. ` : '') + (entry.passed ? entry.summary : (entry.error ?? entry.summary))}`.replace(/\n/g, ' ') + ' |'),
        ''
    ];
    writeFileSync(join(REPORT_DIR, `${MODEL_ID}.md`), lines.join('\n'));
}

describe.skipIf(!LIVE_TRANSPORT || !PROVIDER || !MODEL_ID || !API_KEY)('Live feature certification', () => {
    it(`certifies Pulse, Gossamer and Inquiry on ${PROVIDER}/${MODEL_ID}`, async () => {
        resetPricingToBuiltin();
        const app = createInMemoryApp(loadBookFiles());
        const plugin = createPlugin(app);
        const cases: FeatureCase[] = [];
        if (FEATURES.has('pulse')) cases.push(...await certifyPulse(plugin, app));
        if (FEATURES.has('gossamer')) cases.push(await certifyGossamer(plugin, app));
        if (FEATURES.has('inquiry')) cases.push(await certifyInquiry(plugin, app));
        writeReport(cases);
        const failures = cases.filter(entry => !entry.passed);
        expect(failures, JSON.stringify(failures.map(({ id, summary, refusal, error }) => ({ id, summary, refusal, error })), null, 2)).toEqual([]);
    }, 30 * 60 * 1000);
});
