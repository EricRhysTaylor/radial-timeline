/*
 * Gossamer Commands and State - Manual Score Entry
 */
import type RadialTimelinePlugin from './main';
import { ANTHROPIC_REQUESTED_CACHE_TTL } from './ai/settings/aiSettings';
import type { RadialTimelineView } from './view/TimeLineView';
import {
  applyGossamerRunMetadata,
  appendGossamerScore,
  buildAllGossamerRuns,
  collectGossamerManagedSnapshot,
  createGossamerRunId,
  detectDominantStage,
  filterBeatsBySystem,
  GossamerRun,
  willAppendGossamerPrune
} from './utils/gossamer';
import { Notice, TFile, normalizePath } from 'obsidian';
import { t } from './i18n';
import { GossamerScoreModal } from './modals/GossamerScoreModal';
import { GossamerProcessingModal, type ManuscriptInfo, type AnalysisOptions } from './modals/GossamerProcessingModal';
import { tokenEstimateFromMethod } from './ai/estimates';
import { TimelineMode } from './modes/ModeDefinition';
import { getSortedSceneFiles } from './utils/manuscript';
import { buildUnifiedBeatAnalysisCacheParts, getUnifiedBeatAnalysisJsonSchema, type UnifiedBeatInfo } from './ai/prompts/unifiedBeatAnalysis';
import { DEFAULT_GOSSAMER_SIGNAL, GOSSAMER_SIGNAL_METADATA, type GossamerSignalType } from './types/gossamerSignals';
import { validateGossamerResponse, type SubmittedBeat, type ValidatedBeat, type ValidationResult } from './ai/gossamer/responseValidation';
import { describeAiRunModel } from './utils/modelResolver';
import { buildGossamerCacheWindow, getGossamerCacheContext, recordGossamerCacheWindow, resolveGossamerCacheWindow } from './gossamer/cacheWindow';
import { estimateUsageCost } from './ai/cost/estimateCorpusCost';
import { validateAiSettings } from './ai/settings/validateAiSettings';
import { buildDefaultAiSettings } from './ai/settings/aiSettings';
import { unwrapStructuredEnvelope } from './ai/structuredResponseUnwrap';
import { getAIClient } from './ai/runtime/aiClient';
import {
  extractTokenUsage,
  formatAiLogContent,
  formatSummaryLogContent,
  formatLogTimestamp,
  resolveAvailableLogPath,
  sanitizeLogPayload
} from './ai/log';
import {
  archiveGossamerFrontmatterFields,
  ensureGossamerContentLogFolder,
  ensureGossamerLogFolder,
  resolveGossamerContentLogFolder,
  resolveGossamerLogFolder
} from './gossamer/logs';
import { resolveSelectedBeatModelFromSettings } from './utils/beatSystemState';
import { FORECAST_CHARS_PER_TOKEN, FORECAST_PROMPT_OVERHEAD_TOKENS } from './ai/forecast/estimateTokensFromVault';
import type { AIRunRequest, AIProviderId } from './ai/types';
import type { TimelineItem } from './types';
import { buildGossamerEvidenceDocument } from './gossamer/evidence/buildGossamerEvidence';
import { logCountingForensics } from './ai/diagnostics/countingForensics';
import { toBeatModelMatchKey } from './utils/beatsInputNormalize';
import { getActiveFrontmatterMappings, asBeatFrontmatter, readBeatPurpose } from './utils/frontmatter';
import { estimateTokensFromChars } from './ai/estimates';
import { fnv1a32Hex } from './utils/hash';

interface ResolvedGossamerEvidence {
  evidenceDocument: Awaited<ReturnType<typeof buildGossamerEvidenceDocument>>;
  label: string;
}

/**
 * Gossamer always uses full scene bodies. No summary mode, no fallback.
 */
export const resolveGossamerEvidence = async (params: {
  plugin: RadialTimelinePlugin;
  sceneFiles: TFile[];
}): Promise<ResolvedGossamerEvidence> => {
  const document = await buildGossamerEvidenceDocument({
    sceneFiles: params.sceneFiles,
    vault: params.plugin.app.vault,
    metadataCache: params.plugin.app.metadataCache,
    frontmatterMappings: getActiveFrontmatterMappings(params.plugin.settings)
  });
  return { evidenceDocument: document, label: 'Scene bodies' };
};

type GossamerLogPayload = {
  status: 'success' | 'error';
  provider: Exclude<AIProviderId, 'none'>;
  beatSystemLabel: string;
  signal: GossamerSignalType;
  modelRequested: string;
  modelResolved?: string;
  prompt: string;
  manuscriptText: string;
  requestPayload: unknown;
  responseData?: unknown;
  assistantContent?: string | null;
  parsedOutput?: unknown;
  submittedAt?: Date | null;
  returnedAt?: Date | null;
  derivedSummary?: string;
  schemaWarnings?: string[];
};

function sanitizeSegment(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^-+|-+$/g, '');
}

async function writeGossamerLog(
  plugin: RadialTimelinePlugin,
  payload: GossamerLogPayload
): Promise<TFile | null> {
  const timestampSource = payload.returnedAt ?? payload.submittedAt ?? new Date();
  const readableTimestamp = formatLogTimestamp(timestampSource);
  const safeBeatSystem = sanitizeSegment(payload.beatSystemLabel) || 'Gossamer';
  const signalLabel = GOSSAMER_SIGNAL_METADATA[payload.signal].label;
  const safeSignal = sanitizeSegment(signalLabel) || 'Momentum';
  const scopeTarget = `Manuscript · ${signalLabel} · ${payload.beatSystemLabel}`;

  const { sanitized: sanitizedPayload, hadRedactions } = sanitizeLogPayload(payload.requestPayload ?? null);
  const sanitizationNotes = hadRedactions
    ? ['Redacted sensitive credential values from request payload.']
    : [];
  const tokenUsage = extractTokenUsage(payload.provider, payload.responseData);
  const schemaWarnings = payload.schemaWarnings ?? [];
  const durationMs = payload.submittedAt && payload.returnedAt
    ? payload.returnedAt.getTime() - payload.submittedAt.getTime()
    : null;

  const isError = payload.status === 'error';
  const shouldWriteContent = plugin.settings.logApiInteractions || isError;

  // Write Content Log first (if enabled) so we know whether to mark it as written
  let contentLogWritten = false;
  if (shouldWriteContent) {
    try {
      const contentFolder = await ensureGossamerContentLogFolder(plugin.app);
      if (contentFolder) {
        const contentTitle = `Gossamer Content Log — ${signalLabel} — ${payload.beatSystemLabel} ${readableTimestamp}`;
        const contentBaseName = `Gossamer Content Log — ${safeSignal} — ${safeBeatSystem} ${readableTimestamp}`;

        const contentLogContent = formatAiLogContent({
          title: contentTitle,
          metadata: {
            feature: 'Gossamer',
            scopeTarget,
            provider: payload.provider,
            modelRequested: payload.modelRequested,
            modelResolved: payload.modelResolved ?? payload.modelRequested,
            submittedAt: payload.submittedAt ?? null,
            returnedAt: payload.returnedAt ?? null,
            durationMs,
            status: payload.status,
            tokenUsage
          },
          request: {
            systemPrompt: '',
            userPrompt: payload.prompt,
            evidenceText: payload.manuscriptText,
            requestPayload: sanitizedPayload
          },
          response: {
            rawResponse: payload.responseData ?? null,
            assistantContent: payload.assistantContent ?? '',
            parsedOutput: payload.parsedOutput ?? null
          },
          notes: {
            sanitizationSteps: sanitizationNotes,
            retryAttempts: 0,
            schemaWarnings
          },
          derivedSummary: payload.derivedSummary
        });

        const contentFolderPath = resolveGossamerContentLogFolder();
        const contentFilePath = resolveAvailableLogPath(plugin.app.vault, contentFolderPath, contentBaseName);
        await plugin.app.vault.create(contentFilePath, contentLogContent.trim());
        contentLogWritten = true;
      }
    } catch (e) {
      console.error('[Gossamer][log] Failed to write content log:', sanitizeLogPayload(e).sanitized);
      // Non-blocking: continue with summary log
    }
  }

  // Write Summary Log (always written for AI runs)
  let summaryFile: TFile | null = null;
  try {
    const summaryFolder = await ensureGossamerLogFolder(plugin.app);
    if (!summaryFolder) {
      console.error('[Gossamer][log] Gossamer log folder path is not a folder.');
      return null;
    }
    const summaryFolderPath = normalizePath(summaryFolder.path);

    const summaryTitle = `Gossamer Log — ${signalLabel} — ${payload.beatSystemLabel} ${readableTimestamp}`;
    const summaryBaseName = `Gossamer Log — ${safeSignal} — ${safeBeatSystem} ${readableTimestamp}`;

    // Build result summary from derived summary (first line or key info)
    let resultSummary: string | undefined;
    if (payload.status === 'success' && payload.derivedSummary) {
      const firstLine = payload.derivedSummary.split('\n').find(line => line.trim().length > 0);
      resultSummary = firstLine ? firstLine.trim().slice(0, 100) : 'Analysis complete.';
    }

    const summaryContent = formatSummaryLogContent({
      title: summaryTitle,
      feature: 'Gossamer',
      scopeTarget,
      provider: payload.provider,
      modelRequested: payload.modelRequested,
      modelResolved: payload.modelResolved ?? payload.modelRequested,
      submittedAt: payload.submittedAt ?? null,
      returnedAt: payload.returnedAt ?? null,
      durationMs,
      status: payload.status,
      tokenUsage,
      resultSummary,
      errorReason: isError ? (payload.assistantContent || 'Unknown error.') : null,
      suggestedFixes: isError ? [t('gossamer.notices.retryGemini')] : undefined,
      contentLogWritten,
      retryAttempts: 0
    });

    // Append the full prompt envelope (sans manuscript body) so the summary log
    // makes the payload structure self-evident without enabling Content Logs.
    const manuscriptChars = payload.manuscriptText.length;
    const promptWithoutManuscript = manuscriptChars > 0
      ? payload.prompt.replace(payload.manuscriptText, `[Manuscript text — ${manuscriptChars.toLocaleString()} chars — omitted here; see Content Log for full body]`)
      : payload.prompt;
    const payloadSection = [
      '',
      '## Payload sent to AI',
      `- Signal: ${signalLabel}`,
      `- Beat system: ${payload.beatSystemLabel}`,
      `- Manuscript length: ${manuscriptChars.toLocaleString()} characters`,
      '',
      '```',
      promptWithoutManuscript,
      '```',
      ''
    ].join('\n');

    const summaryFilePath = resolveAvailableLogPath(plugin.app.vault, summaryFolderPath, summaryBaseName);
    summaryFile = await plugin.app.vault.create(summaryFilePath, `${summaryContent.trim()}\n${payloadSection}`);
  } catch (e) {
    console.error('[Gossamer][log] Failed to write summary log:', sanitizeLogPayload(e).sanitized);
    // Non-blocking: logging failures should not break the AI run
  }

  return summaryFile;
}

/**
 * Remove citation/footnote artifacts that some LLM clients inject when they
 * reference an uploaded attachment. These include:
 *   • ChatGPT's `[oai_citation:0‡filename.md](sediment://file_...)` markdown link
 *   • Bare `[oai_citation:N‡...]` tags without a URL
 *   • Chinese-bracket form `【N†source】` used by older ChatGPT builds
 *   • Stray `(sediment://...)` parenthetical links
 * Returns the trimmed result, or undefined if nothing remains.
 */
export function scrubAiCitationArtifacts(text: string): string | undefined {
  if (!text) return undefined;
  let out = text;
  // Markdown-link form: [oai_citation:...](sediment://...)
  out = out.replace(/\s*\[oai_citation:[^\]]*\]\(sediment:\/\/[^)]*\)\s*/g, ' ');
  // Bare tag form
  out = out.replace(/\s*\[oai_citation:[^\]]*\]\s*/g, ' ');
  // Chinese-bracket citation
  out = out.replace(/\s*【[^】]*†[^】]*】\s*/g, ' ');
  // Orphaned sediment link without wrapper
  out = out.replace(/\s*\(sediment:\/\/[^)]*\)\s*/g, ' ');
  // Collapse whitespace introduced by the replacements
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out.length > 0 ? out : undefined;
}

/**
 * The beat list a Gossamer run scores, in submission order. The API run and the
 * score modal's Copy/Paste share it, so a pasted response is validated against
 * the same beats, in the same order, that the prompt listed.
 */
export async function loadGossamerBeats(
  plugin: RadialTimelinePlugin,
  beatSystem: string
): Promise<{ plotBeats: TimelineItem[]; beats: UnifiedBeatInfo[] }> {
  const scenes = await plugin.getSceneData();
  let plotBeats = scenes.filter(s => (s.itemType === 'Beat' || s.itemType === 'Plot'));
  if (beatSystem.trim() !== '' && plotBeats.some(p => p["Beat Model"])) {
    plotBeats = filterBeatsBySystem(plotBeats, beatSystem);
  }
  plotBeats.sort((a, b) => {
    const aMatch = (a.title || '').match(/^(\d+(?:\.\d+)?)/);
    const bMatch = (b.title || '').match(/^(\d+(?:\.\d+)?)/);
    const aNum = aMatch ? parseFloat(aMatch[1]) : 0;
    const bNum = bMatch ? parseFloat(bMatch[1]) : 0;
    return aNum - bNum;
  });

  const beats: UnifiedBeatInfo[] = plotBeats.map((beat, index) => {
    // Get cache for this beat note to read frontmatter fields. asBeatFrontmatter
    // narrows the untyped Obsidian cache to BeatFrontmatter so `fm.Synopsis`
    // (a legacy *Backdrop* key, never valid on a Beat) is a compile-time error.
    const file = plugin.app.vault.getAbstractFileByPath(beat.path || '');
    const cache = file instanceof TFile ? plugin.app.metadataCache.getFileCache(file) : null;
    const fm = asBeatFrontmatter(cache?.frontmatter);

    const rangeValue = (typeof fm?.Range === 'string' ? fm.Range : '0-100');
    const rawTitle = beat.title || 'Unknown Beat';
    const placementMatch = rawTitle.match(/^(\d+(?:\.\d+)?)/);
    const placement = placementMatch ? placementMatch[1] : undefined;
    const beatName = rawTitle.replace(/^\d+(?:\.\d+)?\s+/, '');
    const purpose = readBeatPurpose(fm);

    return {
      beatName,
      beatNumber: index + 1,
      idealRange: rangeValue,
      placement,
      description: purpose
      // Note: idealRange, previous scores, and previous justifications are intentionally NOT
      // sent to the AI to avoid anchoring bias. idealRange is used downstream (after response)
      // for range validation. Historical scores remain in metadata for user reference.
    };
  });

  return { plotBeats, beats };
}

/**
 * The Gossamer AI request for one signal. The API run sends it; the score
 * modal's Copy AI prompt compiles this same request into text for an AI the
 * author runs themselves. One definition, so the two cannot drift apart in
 * role, rubric, beat list or response shape.
 */
export function buildGossamerRunRequest(
  plugin: RadialTimelinePlugin,
  params: {
    beats: UnifiedBeatInfo[];
    beatSystem: string;
    signal: GossamerSignalType;
    manuscriptText: string;
  }
): AIRunRequest {
  const signalMeta = GOSSAMER_SIGNAL_METADATA[params.signal];
  // Cache-split layout: the manuscript + beat list (stableInput) is byte-identical
  // across all four signals, so it lands in the provider cache prefix and the
  // second-through-fourth signal runs on the same manuscript reuse it instead of
  // re-billing the corpus. The signal rubric (volatileQuestion) rides after the
  // cache break via placeUserQuestionLast. Everything else in the envelope is kept
  // signal-neutral below so the cached prefix stays identical run-to-run.
  const { stableInput, volatileQuestion } = buildUnifiedBeatAnalysisCacheParts(
    params.manuscriptText,
    params.beats,
    params.beatSystem,
    params.signal
  );
  const activeBookTitle = typeof plugin.getActiveBookTitle === 'function'
    ? plugin.getActiveBookTitle()
    : 'Unknown Book';
  return {
    feature: 'Gossamer',
    task: `Beat${signalMeta.short.charAt(0) + signalMeta.short.slice(1).toLowerCase()}Analysis`,
    requiredCapabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
    // Signal-neutral so the cached prefix is byte-identical across all four signals;
    // the per-signal rubric rides in userQuestion after the cache break.
    featureModeInstructions: 'Evaluate the requested narrative signal at each beat using only the submitted manuscript and beat list. The signal and its scoring rubric follow the manuscript.',
    // Explicit signal-neutral project context. getProjectContext() would otherwise
    // embed the per-signal `task` into the stable prefix and break cross-signal reuse.
    projectContext: `Project: Radial Timeline\nBook: ${activeBookTitle}\nFeature: Gossamer\nTask: Beat signal analysis`,
    userInput: stableInput,
    userQuestion: volatileQuestion,
    // Place the signal rubric after the cache-break delimiter so the manuscript
    // prefix is reused across the four per-signal runs (provider prompt caching).
    placeUserQuestionLast: true,
    returnType: 'json',
    responseSchema: getUnifiedBeatAnalysisJsonSchema(),
    // Bypass the user's active role template so a "literary fiction editor" or
    // "commercial genre editor" persona cannot bias a structural scoring pass.
    // aiClient swaps in a neutral "Gossamer Neutral Scoring" role; logs still
    // record the bypass plainly via the role template name.
    bypassRoleTemplate: true,
    // Every score is a new reading: each run appends Gossamer<N> to the beat
    // notes, and repeat readings of an unchanged manuscript are compared
    // across runs. RT's in-memory answer cache would hand a re-score the
    // previous answer verbatim — a duplicate run that flattens the history
    // and can prune a real one. Only the OUTPUT cache is skipped: the
    // provider's manuscript-prefix cache still makes the re-score cheap.
    bypassInMemoryCache: true,
    overrides: {
      // 0.3 stabilizes score histories run-to-run (less random drift between
      // re-scores of an unchanged manuscript) while keeping justifications
      // natural. Was 0.7 — too noisy for a scoring task where the user
      // compares Gossamer<N> values across runs.
      temperature: 0.3,
      maxOutputMode: 'high',
      reasoningDepth: 'deep',
      jsonStrict: true
    }
  };
}

interface GossamerReading {
  inputFingerprint: string;
  scoredAt: number;
}

/**
 * This plugin session's last API reading per signal: a fingerprint of the
 * input sent (beat list + manuscript, everything before the signal rubric)
 * and when it returned. The run confirmation uses it to tell the author they
 * are about to re-score unchanged input. Session memory only.
 */
const lastReadingByPlugin = new WeakMap<RadialTimelinePlugin, Map<GossamerSignalType, GossamerReading>>();

function gossamerInputFingerprint(request: AIRunRequest): string {
  return fnv1a32Hex(request.userInput ?? '');
}

export function recordGossamerReading(
  plugin: RadialTimelinePlugin,
  signal: GossamerSignalType,
  request: AIRunRequest,
  scoredAt: number
): void {
  let readings = lastReadingByPlugin.get(plugin);
  if (!readings) {
    readings = new Map();
    lastReadingByPlugin.set(plugin, readings);
  }
  readings.set(signal, { inputFingerprint: gossamerInputFingerprint(request), scoredAt });
}

/** When this signal was last scored on exactly this input this session, or null. */
export function findPriorGossamerReading(
  plugin: RadialTimelinePlugin,
  signal: GossamerSignalType,
  request: AIRunRequest
): number | null {
  const reading = lastReadingByPlugin.get(plugin)?.get(signal);
  return reading && reading.inputFingerprint === gossamerInputFingerprint(request)
    ? reading.scoredAt
    : null;
}

/**
 * Validate a Gossamer response pasted back from an AI the author ran
 * themselves, with the same validator the API run uses. Chat apps wrap the
 * JSON (a code fence, a sentence before it), so the JSON object is cut from
 * the reply; ChatGPT tags attachment citations into the text, so those are
 * stripped from justifications before validation. A justification that was
 * only a citation is then empty and fails, as any empty justification does.
 */
export function parsePastedGossamerResponse(
  text: string,
  submittedBeats: readonly SubmittedBeat[],
  signal: GossamerSignalType
): ValidationResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { ok: false, failures: [{ index: -1, code: 'shape', detail: 'no JSON object found in the pasted response' }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, failures: [{ index: -1, code: 'shape', detail: `pasted response is not valid JSON: ${detail}` }] };
  }
  const rows = (parsed as { beats?: unknown }).beats;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row && typeof row === 'object' && typeof (row as { justification?: unknown }).justification === 'string') {
        const cleaned = scrubAiCitationArtifacts((row as { justification: string }).justification);
        (row as { justification: string }).justification = cleaned ?? '';
      }
    }
  }
  return validateGossamerResponse(parsed, submittedBeats, signal);
}

/**
 * Write one Gossamer run's validated scores to the beat notes, row i of
 * `scores` to `plotBeats[i]` (the order the prompt listed them). Detects the
 * manuscript's dominant stage, archives the fields it changes, appends a run
 * slot with its metadata, stamps "Gossamer Last Updated … by <attribution>",
 * reveals the new run and refreshes the timeline. The API run and AI jobs both
 * write through here.
 */
export async function writeGossamerScores(
  plugin: RadialTimelinePlugin,
  params: {
    plotBeats: TimelineItem[];
    scores: readonly ValidatedBeat[];
    signal: GossamerSignalType;
    /** Run metadata: the provider id, or AI_JOB_PROVIDER for an AI job. */
    provider: string;
    /** Run metadata: the model id, or the client's name for itself for an AI job. */
    model: string;
    /** Who produced the scores, for the "Gossamer Last Updated" stamp. */
    attribution: string;
  }
): Promise<{ runId: string; updateCount: number; unmatchedBeats: string[]; snapshotPath: string | null }> {
  let dominantStage = 'Zero';
  try {
    dominantStage = detectDominantStage(await plugin.getSceneData());
  } catch (e) {
    console.error('[Gossamer] Failed to detect dominant stage, defaulting to Zero:', sanitizeLogPayload(e).sanitized);
  }

  const runId = createGossamerRunId();
  const createdAt = new Date().toISOString();
  const unmatchedBeats: string[] = [];
  const matchedTargets: Array<{ beat: ValidatedBeat; file: TFile }> = [];
  params.scores.forEach((beat, i) => {
    const path = params.plotBeats[i]?.path;
    const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
    if (file instanceof TFile) matchedTargets.push({ beat, file });
    else unmatchedBeats.push(beat.beatName);
  });

  const filesToSnapshot = matchedTargets
    .map(({ file }) => file)
    .filter((file, index, array) => array.findIndex((candidate) => candidate.path === file.path) === index)
    .filter((file) => {
      const priorFrontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!priorFrontmatter) return false;
      return willAppendGossamerPrune(priorFrontmatter) || Object.keys(collectGossamerManagedSnapshot(priorFrontmatter)).length > 0;
    });
  const snapshotPath = await archiveGossamerFrontmatterFields(plugin.app, filesToSnapshot, {
    operation: 'gossamer-ai-run',
    selectFields: (frontmatter) => collectGossamerManagedSnapshot(frontmatter),
    meta: {
      scope: 'beat-note',
      signal: params.signal,
      beatCount: filesToSnapshot.length
    }
  });

  const timestamp = new Date().toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  for (const { beat, file } of matchedTargets) {
    await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      // Append new score to end (G1=oldest, newest=highest number)
      const { nextIndex, updated } = appendGossamerScore(fm);
      Object.assign(fm, updated);
      fm[`Gossamer${nextIndex}`] = beat.score;
      fm[`Gossamer${nextIndex} Justification`] = beat.justification;
      applyGossamerRunMetadata(fm, nextIndex, {
        runId,
        createdAt,
        provider: params.provider,
        model: params.model,
        stage: dominantStage,
        signal: params.signal
      });
      fm['Gossamer Last Updated'] = `${timestamp} by ${params.attribution}`;
    });
  }

  // Auto-reveal the new run. latestOnly already shows the newest; an empty
  // visibleRunIds already means "show all". Only explicit compare selections
  // need the new runId appended so the stack keeps the fresh data visible.
  if (!plugin.gossamerLatestOnly && plugin.gossamerVisibleRunIds.length > 0) {
    const existing = plugin.gossamerVisibleRunIds.filter((id) => id !== runId);
    plugin.gossamerVisibleRunIds = [...existing, runId].slice(-30);
    await plugin.saveGossamerRunFilterState();
  }

  // Direct refresh on all views bypasses the debounce for immediate feedback.
  plugin.getTimelineViews().forEach(v => v.refreshTimeline());

  return { runId, updateCount: matchedTargets.length, unmatchedBeats, snapshotPath };
}

const lastRunByPlugin = new WeakMap<RadialTimelinePlugin, GossamerRun>();

function setInMemoryRun(plugin: RadialTimelinePlugin, run: GossamerRun): void {
  lastRunByPlugin.set(plugin, run);
  // Provide compatibility for renderer access
  plugin._gossamerLastRun = run;
}

/**
 * Open Gossamer score entry modal
 */
export async function openGossamerScoreEntry(plugin: RadialTimelinePlugin): Promise<void> {
  // Get story beat notes filtered by Beat Model setting (same as gossamer rendering)
  const scenes = await plugin.getSceneData();
  const plotBeats = scenes.filter(s => s.itemType === 'Beat');
  
  if (plotBeats.length === 0) {
    new Notice(t('gossamer.notices.noStoryBeats'));
    return;
  }

  // Open score entry modal
  const modal = new GossamerScoreModal(plugin.app, plugin, plotBeats);
  modal.open();
}

export async function syncGossamerPresentationState(
  plugin: RadialTimelinePlugin,
  scenesInput?: Awaited<ReturnType<RadialTimelinePlugin['getSceneData']>>
) {
  const scenes = scenesInput ?? await plugin.getSceneData();
  const selectedBeatModel = resolveSelectedBeatModelFromSettings(plugin.settings);
  const allRuns = buildAllGossamerRuns(
    scenes as unknown as { itemType?: string; [key: string]: unknown }[], // SAFE: the beat extractor reads only itemType and frontmatter keys from timeline items
    selectedBeatModel,
    {
      latestOnly: plugin.gossamerLatestOnly,
      visibleRunIds: plugin.gossamerVisibleRunIds,
      beatSystemKey: plugin.gossamerFilterBeatSystemKey,
      signal: plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL
    }
  );

  plugin.gossamerRunInventory = allRuns.runs;
  plugin.gossamerVisibleRunInventory = allRuns.visibleRuns;
  plugin.gossamerVisibleRunIds = allRuns.latestOnly ? [] : allRuns.visibleRunIds;
  plugin.gossamerLatestOnly = allRuns.latestOnly;
  plugin.gossamerFilterBeatSystemKey = allRuns.beatSystemKey;

  setInMemoryRun(plugin, allRuns.current);
  plugin._gossamerHistoricalRuns = allRuns.historical;
  plugin._gossamerMinMax = allRuns.minMax;
  plugin._gossamerHasAnyScores = allRuns.hasAnyScores;

  return allRuns;
}

export async function toggleGossamerMode(plugin: RadialTimelinePlugin): Promise<void> {
  const view = getFirstView(plugin);
  if (!view) return;
  const current = getInteractionMode(view) === 'gossamer';
  if (current) {
    void exitGossamerMode(plugin);
  } else {
    // ALWAYS rebuild run from fresh scene data (reads latest Gossamer1 scores from YAML)
    const scenes = await plugin.getSceneData();
    
    // Check if there are any story beat notes (Beat or legacy Plot)
    const beatNotes = scenes.filter(s => s.itemType === 'Beat' || s.itemType === 'Plot');
    if (beatNotes.length === 0) {
      const selectedSystem = resolveSelectedBeatModelFromSettings(plugin.settings) ?? '';
      const systemHint = selectedSystem
        ? t('gossamer.notices.systemHintWithModel', { system: selectedSystem })
        : t('gossamer.notices.systemHintNoModel');
      new Notice(t('gossamer.notices.cannotEnterMode', { hint: systemHint }), 8000);
      return;
    }
    
    // Use beat system from settings if explicitly set (not empty)
    const selectedBeatModel = resolveSelectedBeatModelFromSettings(plugin.settings);
    const selectedBeatModelKey = toBeatModelMatchKey(selectedBeatModel ?? '');
    if (plugin.gossamerFilterBeatSystemKey !== selectedBeatModelKey) {
      plugin.gossamerLatestOnly = false;
      plugin.gossamerVisibleRunIds = [];
      plugin.gossamerFilterBeatSystemKey = selectedBeatModelKey;
      void plugin.saveGossamerRunFilterState();
    }

    // Build all runs (Gossamer1-30) with min/max band
    const allRuns = await syncGossamerPresentationState(plugin, scenes);
    
    if (allRuns.current.beats.length === 0) {
      const systemHint = selectedBeatModel
        ? t('gossamer.notices.modeMatchHintWithModel', { system: selectedBeatModel })
        : t('gossamer.notices.modeMatchHintNoModel');
      new Notice(t('gossamer.notices.cannotEnterMode', { hint: systemHint }), 8000);
      return;
    }

    // Show info message if no scores exist (graceful, not a warning)
    if (!allRuns.hasAnyScores) {
      const activeSignalLabel = GOSSAMER_SIGNAL_METADATA[plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL].label.toLowerCase();
      new Notice(t('gossamer.notices.noScoresInfo', { signal: activeSignalLabel }));
    }
    
    setBaseModeAllScenes(plugin);
    resetRotation(plugin);
    plugin.clearSearch();
    void enterGossamerMode(plugin);
  }
}

async function enterGossamerMode(plugin: RadialTimelinePlugin) {
  const view = getFirstView(plugin);
  if (!view) return;
  
  // ModeManager handles settings persistence, lifecycle hooks, and refresh.
  await view.getModeManager().switchMode(TimelineMode.GOSSAMER);
}

async function exitGossamerMode(plugin: RadialTimelinePlugin) {
  // Guard against double-execution
  if (_isExitingGossamer) {
    return;
  }
  
  const view = getFirstView(plugin);
  if (!view) {
    return;
  }
  
  // Set guard flag
  _isExitingGossamer = true;
  
  const restoredMode = restoreBaseMode(plugin);
  // ModeManager handles lifecycle hooks and the refresh.
  await view.getModeManager().switchMode(coerceTimelineMode(restoredMode));

  // Reset guard flag after a short delay
  window.setTimeout(() => {
    _isExitingGossamer = false;
  }, 100);
}

// Base-mode helpers
let _previousBaseMode: string | null = null;

// Guard to prevent double-execution of exit
let _isExitingGossamer = false;

export function setBaseModeAllScenes(plugin: RadialTimelinePlugin) {
  // Save the current mode before entering Gossamer (if not already saved)
  if (_previousBaseMode === null) {
    _previousBaseMode = plugin.settings.currentMode || 'narrative';
  }
}

export function restoreBaseMode(plugin: RadialTimelinePlugin): string {
  // Restore the saved mode
  if (_previousBaseMode !== null) {
    const mode = _previousBaseMode;
    _previousBaseMode = null;
    return mode;
  }
  // Default to narrative if no saved mode
  return 'narrative';
}

export function resetRotation(plugin: RadialTimelinePlugin) {
  getAllViews(plugin).forEach((view) => view.setRotationState(false));
}

// --- View access helpers ---
function getAllViews(plugin: RadialTimelinePlugin): RadialTimelineView[] {
    return plugin.getTimelineViews();
}

function getFirstView(plugin: RadialTimelinePlugin): RadialTimelineView | null {
    const views = getAllViews(plugin);
    return views.length > 0 ? views[0] : null;
}

const TIMELINE_MODE_VALUES = new Set<string>(Object.values(TimelineMode));

/** Narrow a persisted mode string to the TimelineMode enum, defaulting to narrative. */
function coerceTimelineMode(mode: string): TimelineMode {
  return TIMELINE_MODE_VALUES.has(mode) ? (mode as TimelineMode) : TimelineMode.NARRATIVE;
}

function getInteractionMode(view: RadialTimelineView): 'narrative' | 'subplot' | 'gossamer' | undefined {
  const val = view.currentMode;
  if (val === 'narrative' || val === 'gossamer' || val === 'subplot') return val;
  return undefined;
}

/**
 * Run Gemini AI analysis of manuscript momentum across story beats
 */
export async function runGossamerAiAnalysis(plugin: RadialTimelinePlugin): Promise<void> {
  // Get beat system from settings (used by both pre-check and processing)
  const settingsBeatSystem = resolveSelectedBeatModelFromSettings(plugin.settings);
  if (!settingsBeatSystem) {
    new Notice(t('gossamer.notices.noActiveBeatSystemRun'));
    return;
  }
  const recognizedSystems = ['Save The Cat', 'Hero\'s Journey', 'Classic Dramatic Structure'];

  // Resolve the display name from the active beat model first.
  let beatSystemDisplayName = settingsBeatSystem;
  if (!recognizedSystems.includes(settingsBeatSystem)) {
    const scenes = await plugin.getSceneData({ filterBeatsBySystem: false });
    const allBeats = scenes.filter(s => (s.itemType === 'Beat' || s.itemType === 'Plot'));

    for (const beat of allBeats) {
      if (!beat.path) continue;
      const file = plugin.app.vault.getAbstractFileByPath(beat.path);
      if (!(file instanceof TFile)) continue;
      const cache = plugin.app.metadataCache.getFileCache(file);
      const beatModel = cache?.frontmatter?.["Beat Model"] as string | undefined;
      
      // If we find a custom beat model (not one of the recognized systems)
      if (beatModel && !recognizedSystems.includes(beatModel)) {
        beatSystemDisplayName = beatModel;
        break;
      }
    }
  }
  
  const beatSystem = settingsBeatSystem; // Use settings value for filtering logic
  
  // Define the actual processing function
  const processAnalysis = async (options: AnalysisOptions, modal: GossamerProcessingModal) => {
    try {
      modal.setStatus(t('gossamer.notices.validating'));

      modal.setStatus(t('gossamer.notices.loadingBeats'));
      
      const { plotBeats, beats } = await loadGossamerBeats(plugin, beatSystem);

      if (plotBeats.length === 0) {
        modal.addError(t('gossamer.notices.noStoryBeats'));
        modal.completeProcessing(false, 'No beats found');
        new Notice(t('gossamer.notices.noStoryBeats'));
        return;
      }

    modal.setStatus(t('gossamer.notices.assemblingEvidence'));

    // Get sorted scene files (single source of truth)
    const { files: sceneFiles } = await getSortedSceneFiles(plugin);

    if (sceneFiles.length === 0) {
      modal.addError(t('gossamer.notices.noScenesInBook'));
      modal.completeProcessing(false, 'No scenes found');
      new Notice(t('gossamer.notices.noScenesInBook'));
      return;
    }

    const resolvedEvidence = await resolveGossamerEvidence({
      plugin,
      sceneFiles
    });
    const evidenceModeLabel = resolvedEvidence.label;
    modal.setStatus(t('gossamer.notices.assemblingEvidenceWithMode', { mode: evidenceModeLabel }));
    const evidenceDocument = resolvedEvidence.evidenceDocument;

    if (!evidenceDocument.text || evidenceDocument.text.trim().length === 0 || evidenceDocument.includedScenes === 0) {
      modal.addError(t('gossamer.notices.noSceneBodyContent'));
      modal.completeProcessing(false, 'Empty manuscript');
      new Notice(t('gossamer.notices.noSceneBodyContent'));
      return;
    }

    const corpusEstimatedTokens = estimateTokensFromChars(evidenceDocument.text.length, FORECAST_CHARS_PER_TOKEN);

    // Update modal with manuscript info
    const manuscriptInfo: ManuscriptInfo = {
      totalScenes: evidenceDocument.totalScenes,
      totalWords: evidenceDocument.totalWords,
      estimatedTokens: tokenEstimateFromMethod('heuristic_chars', corpusEstimatedTokens),
      beatCount: beats.length,
      beatSystem: beatSystemDisplayName, // Use display name (may include custom name)
      evidenceMode: evidenceModeLabel,
      hasIterativeContext: false // Always false - we don't send previous scores to avoid anchoring bias
    };
    modal.setManuscriptInfo(manuscriptInfo);

    // Build prompt
    modal.setStatus(t('gossamer.notices.buildingPrompt'));
    const selectedSignal: GossamerSignalType = plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
    const signalMeta = GOSSAMER_SIGNAL_METADATA[selectedSignal];
    const runRequest = buildGossamerRunRequest(plugin, {
      beats,
      beatSystem,
      signal: selectedSignal,
      manuscriptText: evidenceDocument.text
    });
    // Capture ownership before the asynchronous request: switching books mid-run
    // must never assign the returned cache to the newly active book.
    const cacheContext = getGossamerCacheContext(plugin.settings);
    modal.setCacheWindow(resolveGossamerCacheWindow(plugin.gossamerCacheWindows, cacheContext, Date.now(), runRequest));
    // Full prompt string for the log envelope (stable corpus first, volatile rubric last).
    const prompt = `${runRequest.userInput}\n\n${runRequest.userQuestion}`;
    const aiClient = getAIClient(plugin);
    const prepared = await aiClient.prepareRunEstimate(runRequest);
    const providerExecutionTokens = prepared.ok
      ? prepared.estimate.tokenEstimateInput
      : corpusEstimatedTokens + FORECAST_PROMPT_OVERHEAD_TOKENS;
    const providerExecutionMethod = prepared.ok
      ? prepared.estimate.tokenEstimateMethod
      : 'heuristic_chars';
    const promptEnvelopeCharsAdded = prepared.ok
      ? Math.max(0, (prepared.estimate.systemPrompt?.length ?? 0) + (prepared.estimate.userPrompt?.length ?? 0))
      : Math.max(0, prompt.length - evidenceDocument.text.length);
    logCountingForensics({
      path: 'gossamer',
      phase: 'analysis_run',
      scope: 'book',
      filesIncluded: sceneFiles.map(file => file.path).sort((a, b) => a.localeCompare(b)),
      sceneCount: evidenceDocument.totalScenes,
      outlineCount: 0,
      referenceCount: 0,
      totalEvidenceChars: evidenceDocument.text.length,
      promptEnvelopeCharsAdded: 0,
      tokenMethodUsed: 'rt_chars_heuristic',
      finalTokenEstimate: corpusEstimatedTokens
    });
    logCountingForensics({
      path: 'gossamer',
      phase: 'analysis_run_provider_execution',
      scope: 'book',
      filesIncluded: sceneFiles.map(file => file.path).sort((a, b) => a.localeCompare(b)),
      sceneCount: evidenceDocument.totalScenes,
      outlineCount: 0,
      referenceCount: 0,
      totalEvidenceChars: evidenceDocument.text.length,
      promptEnvelopeCharsAdded,
      tokenMethodUsed: providerExecutionMethod,
      finalTokenEstimate: providerExecutionTokens
    });

    // Call unified AI client
    modal.setStatus(t('gossamer.notices.sendingToAi', { signal: signalMeta.label.toLowerCase() }));
    modal.apiCallStarted();

    const submittedAt = new Date();
    const result = await aiClient.run({
      ...runRequest,
      ...(prepared.ok ? { preparedEstimate: prepared.estimate } : {})
    });
    const returnedAt = new Date();
    modal.setAiAdvancedContext(result.advancedContext ?? null);
    const providerNormalizationWarnings = result.sanitizationNotes ?? [];

    if (result.aiStatus !== 'success' || !result.content) {
      modal.apiCallError(result.error || t('gossamer.notices.aiResponseError'));
      modal.completeProcessing(false, 'API call failed');

      // Check for rate limit
      if (result.error?.toLowerCase().includes('rate limit')) {
        modal.showRateLimitWarning();
      }
      const providerForLog: Exclude<AIProviderId, 'none'> = result.provider === 'none' ? 'openai' : result.provider;

      const failureLog = await writeGossamerLog(plugin, {
        status: 'error',
        provider: providerForLog,
        beatSystemLabel: beatSystemDisplayName,
        signal: selectedSignal,
        modelRequested: result.modelRequested,
        modelResolved: result.modelResolved,
        prompt,
        manuscriptText: evidenceDocument.text,
        requestPayload: result.requestPayload ?? null,
        responseData: result.responseData,
        assistantContent: result.content,
        parsedOutput: null,
        submittedAt,
        returnedAt,
        schemaWarnings: [
          ...providerNormalizationWarnings,
          ...(result.error ? [`Error: ${result.error}`] : [])
        ]
      });
      if (failureLog) modal.addErrorLogLink(failureLog);

      throw new Error(result.error || t('gossamer.notices.aiResponseError'));
    }

    modal.apiCallSuccess();
    modal.setStatus('Parsing AI response...');

    // Arm the provider-cache window when the provider proved a cache write or
    // read on this run, independent of whether our downstream validation
    // passes — so the remaining signals can reuse it from here. A null window
    // (non-caching provider / no proven cache) clears any stale window. See
    // gossamer/cacheWindow.ts.
    const cacheWindow = buildGossamerCacheWindow(
      result.advancedContext ?? null,
      returnedAt.getTime(),
      validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings()).value
    );
    // Record the FACTUAL billed cost of this run on the window from the
    // provider's usage payload (no projection of future runs). Best-effort:
    // the countdown still shows if pricing is unavailable for the model.
    if (cacheWindow && result.provider !== 'none') {
      try {
        const usage = extractTokenUsage(result.provider, result.responseData);
        const modelId = result.modelResolved || result.modelRequested;
        if (usage && modelId) {
          const cost = estimateUsageCost(result.provider, modelId, usage, result.advancedContext?.cacheStatus, ANTHROPIC_REQUESTED_CACHE_TTL);
          if (typeof cost?.totalCostUSD === 'number' && Number.isFinite(cost.totalCostUSD)) {
            cacheWindow.lastRunCostUSD = cost.totalCostUSD;
          }
        }
      } catch (e) {
        console.warn('[Gossamer] Cache-cost capture unavailable:', sanitizeLogPayload(e).sanitized);
      }
    }
    if (cacheContext && result.provider !== 'none') {
      recordGossamerCacheWindow(plugin.gossamerCacheWindows, {
        ...cacheContext,
        provider: result.provider,
        modelId: result.modelResolved || result.modelRequested
      }, runRequest, cacheWindow);
    }
    modal.setCacheWindow(cacheWindow);

    // Parse response - AI returns raw scores without range info (to avoid anchoring bias)
    interface AiBeatAnalysis {
      beatName: string;
      signal: GossamerSignalType;
      score: number;
      justification: string;
    }

    interface AiAnalysisResponse {
      beats: AiBeatAnalysis[];
      overallAssessment: {
        summary: string;
        strengths: string[];
        improvements: string[];
      };
    }

    // Enriched beat with computed range comparison
    interface EnrichedBeatAnalysis extends AiBeatAnalysis {
      idealRange: string;
      isWithinRange: boolean;
    }

    interface EnrichedAnalysisResponse {
      beats: EnrichedBeatAnalysis[];
      overallAssessment: {
        summary: string;
        strengths: string[];
        improvements: string[];
      };
    }

    // Parse JSON, then prove the response actually corresponds to the beat
    // list we submitted before any score reaches a beat note. Index-only
    // matching + silent score/signal fallbacks (the prior shape) made the
    // failure mode "wrong score written to the wrong beat" indistinguishable
    // from a healthy run.
    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(result.content);
    } catch (parseError) {
      const detail = parseError instanceof Error ? parseError.message : String(parseError);
      const providerForLog: Exclude<AIProviderId, 'none'> = result.provider === 'none' ? 'openai' : result.provider;
      const failureLog = await writeGossamerLog(plugin, {
        status: 'error',
        provider: providerForLog,
        beatSystemLabel: beatSystemDisplayName,
        signal: selectedSignal,
        modelRequested: result.modelRequested,
        modelResolved: result.modelResolved,
        prompt,
        manuscriptText: evidenceDocument.text,
        requestPayload: result.requestPayload ?? null,
        responseData: result.responseData,
        assistantContent: result.content,
        parsedOutput: null,
        submittedAt,
        returnedAt,
        schemaWarnings: [...providerNormalizationWarnings, `JSON parse error: ${detail}`]
      });
      modal.apiCallError(t('gossamer.notices.validationFailed', { count: 1 }));
      modal.addError(`JSON parse error: ${detail}`);
      if (failureLog) modal.addErrorLogLink(failureLog);
      modal.completeProcessing(false, 'Validation failed');
      throw new Error(t('gossamer.notices.validationFailed', { count: 1 }));
    }

    // Defensive envelope unwrap: Opus 4.7's tool_use occasionally returns a
    // semantically correct response wrapped in a single-key envelope (observed
    // keys: "$PARAMETER_NAME", "input"). The unwrap is narrow and auditable —
    // see src/ai/structuredResponseUnwrap.ts for the exact gating conditions.
    // The validator still runs on the unwrapped value; this only repairs the
    // shape, never the content.
    const envelopeWarnings: string[] = [];
    const unwrap = unwrapStructuredEnvelope(parsedResponse, ['beats', 'overallAssessment'], {
      onUnwrap: (key) => {
        const note = `Unwrapped Anthropic tool envelope key "${key}" before validation`;
        envelopeWarnings.push(note);
        console.warn(`[Gossamer] ${note}`);
      }
    });
    const responseForValidation = unwrap.value;

    const validation = validateGossamerResponse(responseForValidation, beats, selectedSignal);
    if (!validation.ok) {
      const failureDetails = validation.failures.map(f => `[${f.code}@${f.index}] ${f.detail}`);
      const providerForLog: Exclude<AIProviderId, 'none'> = result.provider === 'none' ? 'openai' : result.provider;
      const failureLog = await writeGossamerLog(plugin, {
        status: 'error',
        provider: providerForLog,
        beatSystemLabel: beatSystemDisplayName,
        signal: selectedSignal,
        modelRequested: result.modelRequested,
        modelResolved: result.modelResolved,
        prompt,
        manuscriptText: evidenceDocument.text,
        requestPayload: result.requestPayload ?? null,
        responseData: result.responseData,
        assistantContent: result.content,
        parsedOutput: responseForValidation,
        submittedAt,
        returnedAt,
        schemaWarnings: [...providerNormalizationWarnings, ...envelopeWarnings, ...failureDetails]
      });
      modal.apiCallError(t('gossamer.notices.validationFailed', { count: validation.failures.length }));
      for (const detail of failureDetails) modal.addError(detail);
      if (failureLog) modal.addErrorLogLink(failureLog);
      modal.completeProcessing(false, 'Validation failed');
      throw new Error(t('gossamer.notices.validationFailed', { count: validation.failures.length }));
    }

    const overall = (responseForValidation as { overallAssessment?: AiAnalysisResponse['overallAssessment'] }).overallAssessment;
    const rawAnalysis: AiAnalysisResponse = {
      beats: validation.beats,
      overallAssessment: overall ?? { summary: '', strengths: [], improvements: [] }
    };

    // Import range utilities for computing isWithinRange
    const { parseRange, isScoreInRange } = await import('./utils/rangeValidation');

    // Range comparison is only meaningful for momentum (canonical target logic).
    // Other signals leave isWithinRange = true (structure preserved for future per-signal ranges).
    const analysis: EnrichedAnalysisResponse = {
      ...rawAnalysis,
      beats: rawAnalysis.beats.map((aiBeat, idx) => {
        const ourBeat = beats[idx];
        const idealRange = ourBeat?.idealRange || '0-100';
        const parsed = parseRange(idealRange);
        const isWithinRange = (selectedSignal === 'momentum' && parsed)
          ? isScoreInRange(aiBeat.score, parsed)
          : true;

        return {
          ...aiBeat,
          idealRange,
          isWithinRange
        };
      })
    };

    // Save results to beat notes
    modal.setStatus(t('gossamer.notices.updatingBeats'));
    // A successful run always names the provider that answered.
    const runProvider = result.provider as Exclude<AIProviderId, 'none'>;
    const runModel = result.modelResolved || result.modelRequested;
    const { updateCount, unmatchedBeats, snapshotPath } = await writeGossamerScores(plugin, {
      plotBeats,
      scores: analysis.beats,
      signal: selectedSignal,
      provider: runProvider,
      model: runModel,
      attribution: describeAiRunModel(runProvider, runModel)
    });
    recordGossamerReading(plugin, selectedSignal, runRequest, returnedAt.getTime());

    // Log unmatched beats
    if (unmatchedBeats.length > 0) {
      modal.addError(t('gossamer.notices.unmatchedBeats', { count: unmatchedBeats.length, list: unmatchedBeats.join(', ') }));
    }
    if (snapshotPath) {
      new Notice(t('gossamer.notices.archivedSnapshot'));
    }

    // Create analysis log (unified AI log envelope)
    modal.setStatus(t('gossamer.notices.generatingLog'));

    const derivedLines: string[] = [];
    derivedLines.push(`Beats updated: ${updateCount}`);
    derivedLines.push(`Beats analyzed: ${analysis.beats.length}`);
    if (analysis.overallAssessment?.summary) {
      derivedLines.push(`Overall summary: ${analysis.overallAssessment.summary}`);
    }
    if (analysis.overallAssessment?.strengths?.length) {
      derivedLines.push(`Strengths: ${analysis.overallAssessment.strengths.join('; ')}`);
    }
    if (analysis.overallAssessment?.improvements?.length) {
      derivedLines.push(`Improvements: ${analysis.overallAssessment.improvements.join('; ')}`);
    }
    if (unmatchedBeats.length > 0) {
      derivedLines.push(`Unmatched beats: ${unmatchedBeats.join(', ')}`);
    }
    derivedLines.push('');
    derivedLines.push(`| Beat | Signal | Score | Ideal Range | Status |`);
    derivedLines.push(`|------|--------|-------|-------------|--------|`);
    for (const beat of analysis.beats) {
      const status = selectedSignal === 'momentum'
        ? (beat.isWithinRange ? 'In range' : 'Out of range')
        : '—';
      derivedLines.push(`| ${beat.beatName} | ${beat.signal} | ${beat.score} | ${beat.idealRange} | ${status} |`);
    }

    const schemaWarnings = [...providerNormalizationWarnings, ...envelopeWarnings];

    await writeGossamerLog(plugin, {
      status: 'success',
      provider: result.provider === 'none' ? 'openai' : result.provider,
      beatSystemLabel: beatSystemDisplayName,
      signal: selectedSignal,
      modelRequested: result.modelRequested,
      modelResolved: result.modelResolved,
      prompt,
      manuscriptText: evidenceDocument.text,
      requestPayload: result.requestPayload ?? null,
      responseData: result.responseData,
      assistantContent: result.content,
      parsedOutput: analysis,
      submittedAt,
      returnedAt,
      derivedSummary: derivedLines.join('\n'),
      // Envelope warnings are not failures — they record that the response
      // arrived wrapped and we recovered it. Surfacing them in the log gives
      // us the audit trail for tracking how often each provider/model wraps.
      schemaWarnings: schemaWarnings.length > 0 ? schemaWarnings : undefined
    });

    const successMessage = t('gossamer.notices.successUpdated', { count: updateCount, signal: signalMeta.label.toLowerCase() });

    const aiFolderPath = resolveGossamerLogFolder();
    const logMessage = plugin.settings.logApiInteractions
      ? t('gossamer.notices.successLogWithContent', { message: successMessage, path: aiFolderPath, mode: evidenceModeLabel.toLowerCase() })
      : t('gossamer.notices.successLogWithoutContent', { message: successMessage, path: aiFolderPath });

    modal.completeProcessing(true, successMessage);
    new Notice(logMessage);

    } catch (e) {
      const errorMsg = (e as Error)?.message || 'Unknown error';
      modal.addError(t('gossamer.notices.processingFailed', { error: errorMsg }));
      modal.completeProcessing(false, 'Processing failed');
      new Notice(t('gossamer.notices.aiAnalysisFailed', { error: errorMsg }));
      console.error('[Gossamer AI]', sanitizeLogPayload(e).sanitized);
    }
  };

  // Pre-gather manuscript info for confirmation view
  try {
    // Beats to show in confirmation — the same list the run submits.
    const { plotBeats, beats } = await loadGossamerBeats(plugin, beatSystem);
    
    // Get sorted scene files (single source of truth)
    const { files: sceneFiles } = await getSortedSceneFiles(plugin);
    const resolvedEvidence = await resolveGossamerEvidence({
      plugin,
      sceneFiles
    });
    const evidenceModeLabel = resolvedEvidence.label;
    const evidenceDocument = resolvedEvidence.evidenceDocument;
    const corpusEstimatedTokens = estimateTokensFromChars(evidenceDocument.text.length, FORECAST_CHARS_PER_TOKEN);
    const providerExecutionTokens = corpusEstimatedTokens + FORECAST_PROMPT_OVERHEAD_TOKENS;
    logCountingForensics({
      path: 'gossamer',
      phase: 'precheck',
      scope: 'book',
      filesIncluded: sceneFiles.map(file => file.path).sort((a, b) => a.localeCompare(b)),
      sceneCount: evidenceDocument.totalScenes,
      outlineCount: 0,
      referenceCount: 0,
      totalEvidenceChars: evidenceDocument.text.length,
      promptEnvelopeCharsAdded: 0,
      tokenMethodUsed: 'rt_chars_heuristic',
      finalTokenEstimate: corpusEstimatedTokens
    });
    logCountingForensics({
      path: 'gossamer',
      phase: 'precheck_provider_execution',
      scope: 'book',
      filesIncluded: sceneFiles.map(file => file.path).sort((a, b) => a.localeCompare(b)),
      sceneCount: evidenceDocument.totalScenes,
      outlineCount: 0,
      referenceCount: 0,
      totalEvidenceChars: evidenceDocument.text.length,
      promptEnvelopeCharsAdded: FORECAST_PROMPT_OVERHEAD_TOKENS * FORECAST_CHARS_PER_TOKEN,
      tokenMethodUsed: 'heuristic_chars',
      finalTokenEstimate: providerExecutionTokens
    });

    const manuscriptInfo: ManuscriptInfo = {
      totalScenes: evidenceDocument.totalScenes,
      totalWords: evidenceDocument.totalWords,
      estimatedTokens: tokenEstimateFromMethod('heuristic_chars', corpusEstimatedTokens),
      beatCount: plotBeats.length,
      beatSystem: beatSystemDisplayName, // Use display name (may include custom name)
      evidenceMode: evidenceModeLabel,
      hasIterativeContext: false // Always false - we don't send previous scores to avoid anchoring bias
    };

    // Create modal with the processing callback
    const modal = new GossamerProcessingModal(plugin.app, plugin, async (options: AnalysisOptions) => {
      await processAnalysis(options, modal);
    });
    
    // Re-scoring unchanged input is allowed (it adds a reading); the
    // confirmation says so before the author spends a run on it.
    const confirmSignal: GossamerSignalType = plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
    const confirmRequest = buildGossamerRunRequest(plugin, {
      beats,
      beatSystem,
      signal: confirmSignal,
      manuscriptText: evidenceDocument.text
    });
    const priorReadingAt = findPriorGossamerReading(plugin, confirmSignal, confirmRequest);
    modal.setCacheWindow(resolveGossamerCacheWindow(
      plugin.gossamerCacheWindows, getGossamerCacheContext(plugin.settings), Date.now(), confirmRequest
    ));

    // Set manuscript info in confirmation view before opening
    modal.open();
    modal.setManuscriptInfo(manuscriptInfo);
    modal.setPriorReading(priorReadingAt);
    
  } catch (e) {
    const errorMsg = (e as Error)?.message || 'Unknown error';
    new Notice(t('gossamer.notices.prepareFailed', { error: errorMsg }));
    console.error('[Gossamer AI Pre-check]', sanitizeLogPayload(e).sanitized);
  }
}
