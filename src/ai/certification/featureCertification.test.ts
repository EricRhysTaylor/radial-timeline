/**
 * Live feature certification — runs the AI features (Pulse triplet analysis,
 * Summary and Synopsis, Gossamer, Inquiry) end-to-end against ONE real
 * provider model, on a manuscript read from an Obsidian vault on disk.
 *
 * The request builders, response parsers and validators are the production
 * ones; only the Obsidian app (vault / metadataCache / modals / Notices) is
 * replaced by the in-memory test app. A model is certified for Radial Timeline
 * when every feature returns output that passes the production validators.
 *
 * The default corpus is the model onboarding test vault checked into this
 * repo (tests/fixtures/model-onboarding): a short original novella, about
 * 8,300 words in 12 scenes, with 15 Save The Cat beat notes. It is small to
 * keep a run cheap, and unpublished so a model cannot answer Inquiry from
 * memory when the plugin sent it a broken corpus. Its answer key lists faults
 * planted in the prose; the report says which ones the Inquiry run found.
 * Detection is reported, never gated. The small corpus never reaches a
 * long-context price tier, so before a release also run the full Pride &
 * Prejudice book (RT_CERT_VAULT + RT_CERT_BOOK below).
 *
 * Run (skipped unless live transport and the provider's key are present):
 *   RT_CERT_PROVIDER=anthropic RT_CERT_MODEL=claude-opus-5-5 npm run certify:features
 *
 * Env:
 *   RT_CERT_PROVIDER   anthropic | openai | google          (required)
 *   RT_CERT_MODEL      catalog model id, e.g. gpt-6.1-sol     (required)
 *   RT_CERT_VAULT      vault folder (default: tests/fixtures/model-onboarding/vault)
 *   RT_CERT_BOOK       book folder inside the vault (default: The Tidewater Ledger)
 *                      Long run: RT_CERT_VAULT='../Test Vaults/Obsidian Vault AI Certification'
 *                      RT_CERT_BOOK='Pride & Prejudice'
 *   RT_CERT_FEATURES   comma list of pulse,summary,gossamer,inquiry (default: all four)
 *   RT_CERT_PULSE_TRIPLETS  how many Pulse triplets to run (default: 3)
 *   RT_CERT_SUMMARY_SCENES  how many scenes get a Summary + Synopsis (default: 2)
 *   RT_CERT_INQUIRY_QUESTION  canonical question id (default: payoff-abandoned-threads)
 *   RT_CERT_ANSWER_KEY planted-fault answer key (default: the fixture's, used
 *                      only when its book matches RT_CERT_BOOK)
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
const FIXTURE_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'model-onboarding');
const VAULT_PATH = (process.env.RT_CERT_VAULT ?? '').trim() || join(FIXTURE_DIR, 'vault');
const BOOK_FOLDER = (process.env.RT_CERT_BOOK ?? '').trim() || 'The Tidewater Ledger';
const FEATURE_ORDER = ['pulse', 'summary', 'gossamer', 'inquiry'] as const;
const FEATURES = new Set(((process.env.RT_CERT_FEATURES ?? '').trim() || FEATURE_ORDER.join(','))
    .split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean));
const PULSE_TRIPLETS = Math.max(1, Number.parseInt(process.env.RT_CERT_PULSE_TRIPLETS ?? '3', 10) || 3);
const SUMMARY_SCENES = Math.max(1, Number.parseInt(process.env.RT_CERT_SUMMARY_SCENES ?? '2', 10) || 2);
const INQUIRY_QUESTION_ID = (process.env.RT_CERT_INQUIRY_QUESTION ?? '').trim() || 'payoff-abandoned-threads';
const ANSWER_KEY_PATH = (process.env.RT_CERT_ANSWER_KEY ?? '').trim() || join(FIXTURE_DIR, 'answer-key.json');
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
import { bindAiNetworkGate } from '../runtime/aiNetworkGate';
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
import { extractJsonPayload } from '../runtime/jsonValidator';
import { countWords } from '../../utils/text';
import { validateGossamerResponse } from '../gossamer/responseValidation';
import { InquiryRunnerService } from '../../inquiry/runner/InquiryRunnerService';
import { ALL_CANONICAL_QUESTIONS } from '../../inquiry/questions/canonicalQuestions';
import type { CorpusManifestEntry, InquiryRunnerInput } from '../../inquiry/runner/types';
import { INQUIRY_SCHEMA_VERSION } from '../../inquiry/constants';
import { hashString } from '../../inquiry/services/InquiryCorpusService';
import { OutputProfileStore } from '../cost/outputProfile';
import {
    buildSummaryRunRequest,
    buildSynopsisRunRequest,
    parseSummaryReply,
    parseSynopsisReply,
    resolveSummaryTargetWords
} from '../../sceneAnalysis/summaryRefresh';
import { getSynopsisGenerationWordLimit } from '../../utils/synopsisLimits';
import type { InquiryFinding } from '../../inquiry/state';

type FeatureCase = {
    id: string;
    feature: typeof FEATURE_ORDER[number];
    passed: boolean;
    durationMs: number;
    summary: string;
    refusal?: string;
    error?: string;
    usage?: TokenUsage | null;
    costUSD?: number;
    sample?: unknown;
    /** Inquiry only: which answer-key faults its findings mention. */
    plantedFaults?: { id: string; found: boolean }[];
};

type AnswerKey = {
    book: string;
    faults: { id: string; kind: string; description: string; keywords: string[] }[];
};

/** The answer key for the corpus under test, or null when the book has none. */
function loadAnswerKey(): AnswerKey | null {
    if (!existsSync(ANSWER_KEY_PATH)) return null;
    const key = JSON.parse(readFileSync(ANSWER_KEY_PATH, 'utf8')) as AnswerKey;
    return key.book === BOOK_FOLDER ? key : null;
}

/** A planted fault counts as found when one finding mentions any of its keywords. */
function scorePlantedFaults(findings: InquiryFinding[]): FeatureCase['plantedFaults'] {
    const key = loadAnswerKey();
    if (!key) return undefined;
    const texts = findings.map(finding => [finding.headline, ...(finding.bullets ?? []), finding.recommendedAction ?? '']
        .join(' ').toLowerCase());
    return key.faults.map(fault => ({
        id: fault.id,
        found: texts.some(text => fault.keywords.some(keyword => text.includes(keyword.toLowerCase())))
    }));
}

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
            // AIClient.run refuses every request while the AI master switch is
            // off (170313b5); a certification run is the explicit opt-in.
            enableAiSceneAnalysis: true,
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

/**
 * Gemini reports cachedContentTokenCount on the call that CREATES the cache
 * too, so the run's cache status must be passed through or a first run is
 * priced at the read discount.
 */
function costOf(usage: TokenUsage | null | undefined, cacheStatus?: 'hit' | 'created'): number | undefined {
    if (!usage) return undefined;
    return estimateUsageCost(PROVIDER as CertProvider, MODEL_ID, usage, cacheStatus)?.totalCostUSD;
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
                return { passed: false, summary: `Run ${run.aiStatus}`, refusal, error: run.error, usage, costUSD: costOf(usage, run.validation?.providerCacheStatus) };
            }
            const parsed = parsePulseAnalysisResponse(run.content, plugin);
            const lastError = (plugin as unknown as { lastAnalysisError: string }).lastAnalysisError;
            return {
                passed: parsed !== null,
                summary: parsed ? 'Parsed and validated by the production Pulse parser.' : `Pulse parser rejected the response: ${lastError}`,
                usage,
                costUSD: costOf(usage, run.validation?.providerCacheStatus),
                sample: parsed
            };
        }));
    }
    return cases;
}

/**
 * Summary then Synopsis, the two passes of a Summary refresh, through the
 * production request builders and reply parsers. The Synopsis is written
 * from the new Summary, as in the plugin. Production truncates an over-long
 * Synopsis, so the case checks the raw reply: a model that ignores the hard
 * word cap fails here instead of having its last sentence cut off silently.
 */
async function certifySummary(plugin: never, app: ReturnType<typeof createInMemoryApp>): Promise<FeatureCase[]> {
    const client = getAIClient(plugin);
    primeClient(client);
    const settings = (plugin as { settings: Parameters<typeof resolveSummaryTargetWords>[0] }).settings;
    const targetWords = resolveSummaryTargetWords(settings);
    const maxWords = getSynopsisGenerationWordLimit(settings);
    const scenes = (await getAllSceneData(plugin, app.vault as never))
        .sort((a, b) => placementOf(a.file.name) - placementOf(b.file.name));
    const step = Math.max(1, Math.floor(scenes.length / (SUMMARY_SCENES + 1)));
    const targets = Array.from({ length: Math.min(SUMMARY_SCENES, scenes.length) }, (_, index) => scenes[Math.min(scenes.length - 1, step * (index + 1))]);
    const cases: FeatureCase[] = [];
    for (const scene of targets) {
        cases.push(await timed(`summary:${scene.file.basename}`, 'summary', async () => {
            const summaryRun = await client.run({ ...buildSummaryRunRequest(scene, targetWords), ...pinned() });
            const summaryUsage = extractTokenUsage(summaryRun.provider, summaryRun.responseData);
            const summaryCost = costOf(summaryUsage, summaryRun.validation?.providerCacheStatus);
            if (summaryRun.aiStatus !== 'success' || !summaryRun.content) {
                return { passed: false, summary: `Summary run ${summaryRun.aiStatus}`, refusal: refusalOf(summaryRun), error: summaryRun.error, usage: summaryUsage, costUSD: summaryCost };
            }
            const summary = parseSummaryReply(summaryRun.content);
            if (!summary.ok) {
                return { passed: false, summary: `Summary parser rejected the reply: ${summary.problem}`, usage: summaryUsage, costUSD: summaryCost };
            }
            const synopsisRun = await client.run({ ...buildSynopsisRunRequest(scene, summary.text, maxWords), ...pinned() });
            const synopsisUsage = extractTokenUsage(synopsisRun.provider, synopsisRun.responseData);
            const usage = sumUsage(summaryUsage, synopsisUsage);
            const costUSD = (summaryCost ?? 0) + (costOf(synopsisUsage, synopsisRun.validation?.providerCacheStatus) ?? 0);
            if (synopsisRun.aiStatus !== 'success' || !synopsisRun.content) {
                return { passed: false, summary: `Synopsis run ${synopsisRun.aiStatus}`, refusal: refusalOf(synopsisRun), error: synopsisRun.error, usage, costUSD };
            }
            const synopsis = parseSynopsisReply(synopsisRun.content, maxWords);
            if (!synopsis.ok) {
                return { passed: false, summary: `Synopsis parser rejected the reply: ${synopsis.problem}`, usage, costUSD };
            }
            const rawSynopsis = (JSON.parse(extractJsonPayload(synopsisRun.content)) as { synopsis: string }).synopsis.trim();
            const rawWords = countWords(rawSynopsis);
            const summaryWords = countWords(summary.text);
            const overCap = rawWords > maxWords;
            return {
                passed: !overCap,
                summary: overCap
                    ? `Synopsis ran ${rawWords} words, over the ${maxWords}-word cap.`
                    : `Summary ${summaryWords} words (target ${targetWords}); Synopsis ${rawWords} words (cap ${maxWords}); both passed the production parsers.`,
                usage,
                costUSD,
                sample: { summary: summary.text, synopsis: rawSynopsis }
            };
        }));
    }
    return cases;
}

function sumUsage(a: TokenUsage | null | undefined, b: TokenUsage | null | undefined): TokenUsage | null {
    if (!a || !b) return a ?? b ?? null;
    const total = { ...a } as Record<string, unknown>;
    for (const [field, value] of Object.entries(b)) {
        if (typeof value === 'number') total[field] = (typeof total[field] === 'number' ? total[field] as number : 0) + value;
    }
    return total as TokenUsage;
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
            return { passed: false, summary: `Run ${run.aiStatus}`, refusal, error: run.error, usage, costUSD: costOf(usage, run.validation?.providerCacheStatus) };
        }
        const parsed: unknown = JSON.parse(run.content);
        const validation = validateGossamerResponse(unwrapStructuredEnvelope(parsed, ['beats', 'overallAssessment']).value, beats, signal);
        return {
            passed: validation.ok,
            summary: validation.ok
                ? `All ${beats.length} beats scored and validated (${evidence.includedScenes} scenes, ${evidence.totalWords} words).`
                : `Validator rejected ${validation.failures.length} beat row(s): ${validation.failures.slice(0, 3).map(f => `[${f.code}] ${f.detail}`).join('; ')}`,
            usage,
            costUSD: costOf(usage, run.validation?.providerCacheStatus),
            sample: validation.ok ? validation.beats.slice(0, 3) : validation.failures.slice(0, 5)
        };
    });
}

async function certifyInquiry(plugin: never, app: ReturnType<typeof createInMemoryApp>): Promise<FeatureCase> {
    return timed(`inquiry:${INQUIRY_QUESTION_ID}`, 'inquiry', async () => {
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
        const question = ALL_CANONICAL_QUESTIONS.find(entry => entry.id === INQUIRY_QUESTION_ID);
        if (!question) throw new Error(`Canonical question ${INQUIRY_QUESTION_ID} is missing.`);
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
        const plantedFaults = passed ? scorePlantedFaults(findings) : undefined;
        const plantedNote = plantedFaults
            ? ` Planted faults found: ${plantedFaults.filter(fault => fault.found).length}/${plantedFaults.length}.`
            : '';
        return {
            passed,
            summary: passed
                ? `Inquiry returned ${findings.length} finding(s) over ${entries.length} scenes; verdict and refs passed the production result builder.${plantedNote}`
                : `Inquiry ${result.aiStatus ?? 'unknown'}: ${result.aiReason ?? ''}`,
            plantedFaults,
            error: passed ? undefined : (result as { aiError?: string }).aiError ?? result.aiReason,
            usage,
            costUSD: costOf(usage, trace.cacheStatus),
            sample: passed ? { verdict: result.verdict, summary: result.summary, firstFinding: findings[0] } : undefined
        };
    });
}

/**
 * A run limited by RT_CERT_FEATURES keeps the model's recorded cases for the
 * features it did not run, so one report per model always shows every feature.
 */
function mergeWithPriorReport(cases: FeatureCase[]): FeatureCase[] {
    const priorPath = join(REPORT_DIR, `${MODEL_ID}.json`);
    if (!existsSync(priorPath)) return cases;
    const prior = JSON.parse(readFileSync(priorPath, 'utf8')) as { book?: string; cases?: FeatureCase[] };
    if (prior.book !== BOOK_FOLDER || !Array.isArray(prior.cases)) return cases;
    const rerun = new Set(cases.map(entry => entry.feature));
    return [...prior.cases.filter(entry => !rerun.has(entry.feature)), ...cases]
        .sort((a, b) => FEATURE_ORDER.indexOf(a.feature) - FEATURE_ORDER.indexOf(b.feature));
}

function plantedFaultLines(cases: FeatureCase[]): string[] {
    const scored = cases.find(entry => entry.plantedFaults);
    const key = loadAnswerKey();
    if (!scored?.plantedFaults || !key) return [];
    return [
        `Planted faults (${scored.id}; reported, not gated):`,
        '',
        ...scored.plantedFaults.map(fault => `- ${fault.found ? 'found' : 'missed'}: ${fault.id} — ${key.faults.find(entry => entry.id === fault.id)?.description ?? ''}`),
        ''
    ];
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
        ...plantedFaultLines(cases),
        '| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...cases.map(entry => `| ${entry.id} | ${entry.passed ? 'PASS' : 'FAIL'} | ${(entry.durationMs / 1000).toFixed(1)} | ${entry.usage?.inputTokens ?? '—'} | ${entry.usage?.outputTokens ?? '—'} | ${entry.costUSD !== undefined ? `$${entry.costUSD.toFixed(4)}` : '—'} | ${(entry.refusal ? `refusal: ${entry.refusal}. ` : '') + (entry.passed ? entry.summary : (entry.error ?? entry.summary))}`.replace(/\n/g, ' ') + ' |'),
        ''
    ];
    writeFileSync(join(REPORT_DIR, `${MODEL_ID}.md`), lines.join('\n'));
}

describe.skipIf(!LIVE_TRANSPORT || !PROVIDER || !MODEL_ID || !API_KEY)('Live feature certification', () => {
    it(`certifies Pulse, Summary, Gossamer and Inquiry on ${PROVIDER}/${MODEL_ID}`, async () => {
        resetPricingToBuiltin();
        const app = createInMemoryApp(loadBookFiles());
        const plugin = createPlugin(app);
        // The plugin binds the AI network gate to its master switch on load
        // (main.ts); unbound, every request is refused. Bind it the same way.
        const unbindGate = bindAiNetworkGate(() => (plugin as { settings: { enableAiSceneAnalysis?: boolean } }).settings.enableAiSceneAnalysis === true);
        const cases: FeatureCase[] = [];
        try {
            if (FEATURES.has('pulse')) cases.push(...await certifyPulse(plugin, app));
            if (FEATURES.has('summary')) cases.push(...await certifySummary(plugin, app));
            if (FEATURES.has('gossamer')) cases.push(await certifyGossamer(plugin, app));
            if (FEATURES.has('inquiry')) cases.push(await certifyInquiry(plugin, app));
        } finally {
            unbindGate();
        }
        writeReport(cases);
        const failures = cases.filter(entry => !entry.passed);
        expect(failures, JSON.stringify(failures.map(({ id, summary, refusal, error }) => ({ id, summary, refusal, error })), null, 2)).toEqual([]);
    }, 30 * 60 * 1000);
});
