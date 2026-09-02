/*
 * OnboardingService — orchestrates the existing-vault onboarding spine:
 *   preflight (local model ready, tier >= 2)
 *   -> ingest (md adapter -> Manuscript Model)
 *   -> survey (one aiClient.run)
 *   -> per-scene extract (sequential aiClient.run, abortable)
 *   -> materialize into a NEW book folder (source untouched) + register the book.
 *
 * The two review checkpoints (Split, Review) are owned by the modal, which
 * sequences these methods with the user's approval between them. Pure transforms
 * live in ./extraction and ./paths so this file is the integration layer.
 *
 * See docs/engineering/plans/one-button-onboarding-local-llm-plan.md.
 */

import { normalizePath, TFile, TFolder } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getAIClient } from '../ai/runtime/aiClient';
import { validateAiSettings } from '../ai/settings/validateAiSettings';
import { getCredential } from '../ai/credentials/credentials';
import type { AIProviderId } from '../ai/types';
import { getLocalLlmClient } from '../ai/localLlm/client';
import { inferLocalLlmCapability } from '../ai/localLlm/capabilityInference';
import { createBookId, normalizeBookProfile } from '../utils/books';
import type { BookProfile } from '../types/settings';
import {
  createObsidianMarkdownSource,
  ingestMarkdownFolder,
  titleFromFileName,
  type MarkdownIngestResult,
} from './adapters/mdAdapter';
import { ingestSingleFile } from './adapters/singleFileAdapter';
import { ingestDocxFile, DocxParseError } from './adapters/docxAdapter';
import {
  createObsidianScrivenerSource,
  findScrivenerSidecarFile,
  ingestScrivenerFolder,
  isScrivenerAuxiliaryFile,
  isSnapshotFolderName,
} from './adapters/scrivenerAdapter';
import {
  flattenScenes,
  type ManuscriptModel,
  type ManuscriptScene,
} from './adapters/manuscriptModel';
import {
  getOnboardingSurveyJsonSchema,
  getOnboardingSceneJsonSchema,
  getOnboardingEntityJsonSchema,
  getOnboardingSplitJsonSchema,
  getOnboardingSurveyInstructions,
  getOnboardingSceneInstructions,
  getOnboardingEntityInstructions,
  getOnboardingSplitInstructions,
  buildOnboardingSurveyPrompt,
  buildOnboardingScenePrompt,
  buildOnboardingEntityPrompt,
  buildOnboardingSplitPrompt,
} from '../ai/prompts/onboarding';
import {
  parseSurveyResult,
  parseSceneExtraction,
  parseEntityEnrichment,
  parseSplitProposal,
  buildSceneFrontmatter,
  deterministicExtraction,
  linkedCharacters,
  linkedPlaces,
  effectiveFlags,
  resolveActs,
  type SurveyResult,
} from './extraction';
import {
  breaksFromStarts,
  clampBreaksToCount,
  forcedEvenBreaks,
  mergeShortSegments,
  type ScenePlan,
} from './sceneSplitting';
import { basename, openingWords, sanitizeFileName, suggestOnboardingFolderName } from './paths';
import { selectModel } from '../ai/router/selectModel';
import { BUILTIN_MODELS } from '../ai/registry/builtinModels';
import { buildEntityNoteContent, entityFolderFor, type EntityKind } from '../utils/entityNotes';
import type { Stage } from '../utils/constants';

export interface PreflightResult {
  ok: boolean;
  tier: number;
  reason: string;
  /** The active local model id (for the modal's header pill), when reachable. */
  modelId?: string;
}

/** The four import lanes (see the plan's "Import flows" section). */
export type ImportFlow = 'single' | 'docx' | 'scrivener' | 'folder';

/**
 * Which AI runs the onboarding calls. `local` (default) forces the local-model
 * path — the zero-cost author route. `cloud` drops the override so the router
 * uses the provider configured in Settings → AI (BYO key) — frontier grade for
 * demo-vault conversions and authors who opt in. Same pipeline either way.
 */
export type OnboardingEngine = 'local' | 'cloud';

export interface CloudEngineStatus {
  ok: boolean;
  provider: AIProviderId;
  /** Author-facing provider name ('' when no cloud provider is selected). */
  label: string;
  reason?: string;
  /**
   * Model the cloud engine will actually run, resolved through the same
   * feature-profile → global-policy chain the AI client uses. Present only
   * when `ok`. The spend forecast prices THIS model; pricing anything else
   * would quote a number for a run that will not happen.
   */
  modelId?: string;
  /** Author-facing label for that model. */
  modelLabel?: string;
  /**
   * Set when the resolved model is NOT the one policy asked for.
   *
   * `selectModel` does not throw on an unavailable pinned alias — it falls
   * back to the provider's latest stable model and records a warning. That
   * warning used to be dropped here, which meant a forecast could quote one
   * model while the run used another. Surfacing it is the difference between
   * an estimate and a guess.
   */
  substitutedFromAlias?: string;
}

const CLOUD_PROVIDER_LABELS: Partial<Record<AIProviderId, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

export interface FlowDetection {
  /** The lane the folder's contents suggest. */
  flow: ImportFlow;
  /** Human-readable evidence, e.g. "24 scene files + outline sidecar (Outline.csv)". */
  evidence: string;
  /** Other lanes these contents could plausibly support (author may override). */
  alternatives: ImportFlow[];
}

export interface SceneProposal {
  sourceRef: string;
  title: string;
  /** Canonical frontmatter to write, or null when extraction failed. */
  frontmatter: Record<string, unknown> | null;
  body: string;
  flags: string[];
  /** Bare character names to stub (filed under Characters/). */
  characters: string[];
  /** Bare place names to stub (filed under Places/). */
  places: string[];
  error?: string;
}

/** One Character/Place note to create, with its grounded enrichment (if any). */
export interface EntityProposal {
  kind: EntityKind;
  name: string;
  /** Scenes this entity is linked from. */
  sceneCount: number;
  /** Grounded appositive for the character header line ('' = leave placeholder). */
  role: string;
  /** Grounded prose written into the note's YAML `Summary` ('' = leave blank). */
  summary: string;
}

export interface MaterializeReport {
  bookFolder: string;
  notesCreated: number;
  stubsCreated: number;
  needsReview: SceneProposal[];
  errors: string[];
}

export interface ExtractOptions {
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, title: string) => void;
  /** Book-wide publish stage chosen at Checkpoint 1 (defaults to Zero). */
  publishStage?: Stage;
  /**
   * Proposals from an interrupted run, keyed by sourceRef. Scenes with a
   * successful prior proposal are reused instead of re-extracted, so resuming
   * after the modal was dismissed doesn't repeat finished AI work.
   */
  reuse?: Map<string, SceneProposal>;
}

export interface SplitOptions {
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, title: string) => void;
}

export interface EnrichOptions {
  /** Which entity kinds to create profile notes for (empty = none). */
  kinds: EntityKind[];
  /**
   * Run the (slow) grounded per-entity AI summary pass. When false, profiles are
   * created as plain scaffolds with no AI calls — fast.
   */
  generateSummaries: boolean;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, name: string) => void;
}

const OVERRIDES = { temperature: 0.1, jsonStrict: true } as const;

/** Cap on grounding text fed to one entity call, so a heavily-linked entity can't blow the context. */
const ENTITY_GROUNDING_CHAR_BUDGET = 12000;

/**
 * When the AI split leaves a unit whole, fall back to a deterministic split
 * targeting ~this many chars per scene (~1.3k words) — so a book that couldn't
 * be split automatically still becomes several scenes instead of one giant one
 * the author has to hand-break. Also keeps per-scene extraction inside context.
 */
const FALLBACK_SCENE_CHAR_TARGET = 9000;

/** Minimum size for an AI-split scene (~450 words) — smaller segments merge into a neighbor. */
const MIN_SCENE_CHARS = 3000;

/** Pick up to `max` evenly-spaced items across an array (endpoints included). */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.min(items.length - 1, Math.floor(i * step))]);
  return out;
}

export class OnboardingService {
  private engine: OnboardingEngine = 'local';

  constructor(private readonly plugin: RadialTimelinePlugin) {}

  setEngine(engine: OnboardingEngine): void {
    this.engine = engine;
  }

  /** Local engine pins the local-model route; cloud defers to the configured provider. */
  private get engineOverride(): 'ollama' | undefined {
    return this.engine === 'cloud' ? undefined : 'ollama';
  }

  /** Can the configured Settings → AI provider serve as the cloud engine? */
  async cloudAvailability(): Promise<CloudEngineStatus> {
    const aiSettings = validateAiSettings(this.plugin.settings.aiSettings ?? null).value;
    const provider = aiSettings.provider;
    const label = CLOUD_PROVIDER_LABELS[provider] ?? '';
    if (!label) {
      return { ok: false, provider, label, reason: 'No cloud provider selected in Settings → AI.' };
    }
    const key = await getCredential(this.plugin, provider);
    if (!key) {
      return { ok: false, provider, label, reason: `${label} API key is not set.` };
    }
    // Resolve the model the same way aiClient will: the Onboarding feature
    // profile first, then the global policy.
    //
    // Two distinct outcomes, and they must not be conflated:
    //   - selectModel THROWS only when no catalog model satisfies the
    //     capability floor for this provider. Then there is no model, and
    //     modelId stays undefined.
    //   - selectModel SUBSTITUTES when a pinned alias is merely unavailable
    //     (e.g. a Claude alias under an OpenAI provider). It returns a
    //     different model and records a warning. That is not a failure, but
    //     it is also not what was asked for, so it is reported.
    let modelId: string | undefined;
    let modelLabel: string | undefined;
    let substitutedFromAlias: string | undefined;
    const policy = aiSettings.featureProfiles?.Onboarding?.modelPolicy ?? aiSettings.modelPolicy;
    try {
      const selection = selectModel(BUILTIN_MODELS, {
        provider,
        policy,
        requiredCapabilities: ['jsonStrict'],
        accessTier: 1
      });
      modelId = selection.model.id;
      modelLabel = selection.model.label;
      const requestedAlias = policy.type === 'pinned' ? policy.pinnedAlias : undefined;
      if (requestedAlias && selection.model.alias !== requestedAlias) {
        substitutedFromAlias = requestedAlias;
      }
    } catch {
      modelId = undefined;
    }
    return { ok: true, provider, label, modelId, modelLabel, substitutedFromAlias };
  }

  /** Gate: the local model must produce strict JSON and reach capability tier >= 2. */
  async preflight(): Promise<PreflightResult> {
    const client = getLocalLlmClient(this.plugin);
    const diagnostics = await client.runDiagnostics();
    if (!diagnostics.structuredJson.ok) {
      return {
        ok: false,
        tier: 0,
        reason: diagnostics.structuredJson.message || 'The local model could not produce strict JSON.', // SAFE: names the diagnostic when the validator reported a failure without a message
      };
    }
    const capability = inferLocalLlmCapability({ modelId: diagnostics.modelId, diagnostics });
    if (capability.tier < 2) {
      return {
        ok: false,
        tier: capability.tier,
        reason: `Local model is ${capability.tierName} — onboarding needs tier 2 or higher.`,
        modelId: diagnostics.modelId,
      };
    }
    return { ok: true, tier: capability.tier, reason: capability.tierSummary, modelId: diagnostics.modelId };
  }

  /**
   * Inspect the book folder and say which import flow its contents suggest,
   * with human-readable evidence and any credible alternatives. The author
   * sees this on the Prepare screen and can override when contents are
   * ambiguous (e.g. numbered .md notes next to an unrelated .csv).
   */
  detectImportFlow(folderPath: string): FlowDetection | null {
    const folder = this.plugin.app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return null;
    const proseFiles = this.listProseFiles(folderPath);
    if (proseFiles.length === 0) return null;

    // Same search the ingest uses: inside the book folder, then ancestor
    // folders — Scrivener drops the outline CSV BESIDE the exported tree.
    const csv = findScrivenerSidecarFile(this.plugin.app, folderPath);
    const txtCount = proseFiles.filter((file) => file.extension.toLowerCase() === 'txt').length;
    const mdCount = proseFiles.filter((file) => file.extension.toLowerCase() === 'md').length;

    if (proseFiles.length === 1) {
      const only = proseFiles[0];
      if (only.extension.toLowerCase() === 'docx') {
        return { flow: 'docx', evidence: `one Word file (${only.name})`, alternatives: [] };
      }
      return { flow: 'single', evidence: `one manuscript file (${only.name})`, alternatives: [] };
    }

    if (csv || txtCount > 0) {
      const bits = [`${proseFiles.length} scene files`];
      if (csv) bits.push(`outline sidecar (${csv.name})`);
      return {
        flow: 'scrivener',
        evidence: bits.join(' + '),
        // With .md notes present the folder also reads as a vault-native book.
        alternatives: mdCount > 0 ? ['folder'] : [],
      };
    }

    return {
      flow: 'folder',
      evidence: `${proseFiles.length} notes`,
      alternatives: ['scrivener'],
    };
  }

  /**
   * Parse the book folder into a Manuscript Model. The flow is auto-detected
   * from the folder contents; `flowOverride` (the author's Prepare-screen
   * choice) wins when provided.
   */
  async ingest(folderPath: string, flowOverride?: ImportFlow): Promise<MarkdownIngestResult> {
    const detection = this.detectImportFlow(folderPath);
    const flow = flowOverride ?? detection?.flow ?? 'folder'; // SAFE: detectImportFlow already returns 'folder' as its terminal case, so this keeps the same answer when detection returns nothing

    if (flow === 'docx' || flow === 'single') {
      const proseFiles = this.listProseFiles(folderPath);
      const file = proseFiles[0];
      if (!file) return { kind: 'needs-order', reason: 'The book folder contains no manuscript files.' };
      if (flow === 'docx') {
        // .docx is a ZIP — must be read as binary, never through vault.read.
        try {
          const data = await this.plugin.app.vault.readBinary(file);
          return { kind: 'ok', model: ingestDocxFile(file.name, data) };
        } catch (error) {
          if (error instanceof DocxParseError) {
            return { kind: 'needs-order', reason: error.message };
          }
          throw error;
        }
      }
      const content = await this.plugin.app.vault.read(file);
      return { kind: 'ok', model: ingestSingleFile(file.name, content) };
    }

    if (flow === 'scrivener') {
      return ingestScrivenerFolder(createObsidianScrivenerSource(this.plugin.app), folderPath);
    }
    const source = createObsidianMarkdownSource(this.plugin.app);
    return ingestMarkdownFolder(source, folderPath);
  }

  /**
   * Prose files (md/txt/html/docx) in the book folder — RECURSIVE, because
   * Scrivener exports preserve the binder hierarchy (Book/ACT 1/…). Snapshot
   * folders, per-doc MetaData/Notes sidecars, and TOC.md are excluded.
   */
  private listProseFiles(folderPath: string): TFile[] {
    const root = this.plugin.app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(root instanceof TFolder)) return [];
    const files: TFile[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          if (!isSnapshotFolderName(child.name)) walk(child);
        } else if (child instanceof TFile && !isScrivenerAuxiliaryFile(child.name)) {
          files.push(child);
        }
      }
    };
    walk(root);
    // NOTE: .docx participates in the count but only the SINGLE-file path reads
    // it (a mixed folder falls to the md adapter, which reads .md only — the
    // folder-of-docx variant is a later slice).
    const proseExts = new Set(['md', 'txt', 'html', 'htm', 'docx']);
    return files.filter(
      (file) => proseExts.has(file.extension.toLowerCase()) && file.name.toLowerCase() !== 'toc.md'
    );
  }

  /** One structured survey call establishing acts, subplot vocabulary, and scene classification. */
  async survey(model: ManuscriptModel): Promise<SurveyResult | null> {
    const scenes = this.candidateScenes(model);
    if (scenes.length === 0) return null;
    // Naming subplots is a whole-book gestalt task — a representative SAMPLE of
    // openings is plenty, and keeping the prompt small (input AND, via the
    // one-field schema, output) is what makes the call reliable on a local model.
    const sampled = sampleEvenly(scenes, 30);
    const surveyInput = sampled.map((scene) => ({
      opening: openingWords(scene.rawText, 40),
    }));
    try {
      const result = await getAIClient(this.plugin).run({
        feature: 'Onboarding',
        task: 'OnboardingSurvey',
        requiredCapabilities: ['jsonStrict'],
        featureModeInstructions: getOnboardingSurveyInstructions(),
        userInput: buildOnboardingSurveyPrompt(surveyInput),
        returnType: 'json',
        responseSchema: getOnboardingSurveyJsonSchema(),
        providerOverride: this.engineOverride,
        overrides: { ...OVERRIDES },
      });
      if (result.aiStatus !== 'success' || !result.content) return null;
      const parsed = parseSurveyResult(result.content);
      return parsed.ok ? parsed.value : null;
    } catch {
      // Survey is best-effort context; extraction can proceed without it.
      return null;
    }
  }

  /** Sequential per-scene extraction. Skips already-onboarded notes and survey-classified non-scenes. */
  /**
   * Structure-only extraction — NO local model required. Builds every scene
   * proposal from what the source carried: split/filename titles, sidecar
   * synopses, mapped Subplot/When via carried metadata, positional acts. The
   * AI-derived fields (characters, places, invented synopses) stay empty for
   * the author or a later AI pass. Instant; used when preflight finds no model.
   */
  buildStructureOnlyProposals(model: ManuscriptModel, options: { publishStage?: Stage } = {}): SceneProposal[] {
    const actCount = Math.max(3, this.plugin.settings.actCount ?? 3); // SAFE: three acts is the plugin's structural minimum and its shipped default
    const scenes = this.candidateScenes(model);
    const proposals: SceneProposal[] = scenes.map((scene) => {
      const extraction = deterministicExtraction(scene);
      return {
        sourceRef: scene.sourceRef,
        title: scene.title ?? titleFromFileName(basename(scene.sourceRef)),
        frontmatter: buildSceneFrontmatter(extraction, {
          actCount,
          publishStage: options.publishStage,
          subplotVocabulary: extraction.subplot,
          carriedMetadata: scene.knownMetadata,
        }),
        body: scene.rawText,
        flags: [],
        // Carried Character/Place columns feed profile creation like AI names do.
        characters: linkedCharacters(extraction),
        places: linkedPlaces(extraction),
      };
    });
    const acts = resolveActs(scenes.map((scene) => scene.sourceAct), actCount);
    proposals.forEach((proposal, index) => {
      (proposal.frontmatter as Record<string, unknown>).Act = acts[index];
    });
    return proposals;
  }

  /** A scene's structural act, looked up by sourceRef (split refs fall back to their base file). */
  private sourceActFor(scenes: ManuscriptScene[], sourceRef: string): number | undefined {
    const exact = scenes.find((scene) => scene.sourceRef === sourceRef);
    if (exact) return exact.sourceAct;
    const base = sourceRef.replace(/#\d+$/, '');
    return scenes.find((scene) => scene.sourceRef === base)?.sourceAct;
  }

  async extractScenes(
    model: ManuscriptModel,
    survey: SurveyResult | null,
    options: ExtractOptions = {}
  ): Promise<SceneProposal[]> {
    const actCount = Math.max(3, this.plugin.settings.actCount ?? 3); // SAFE: three acts is the plugin's structural minimum and its shipped default
    const scenes = this.candidateScenes(model);
    const subplotVocabulary = survey?.subplots ?? []; // SAFE: no survey answers yet means an empty vocabulary, which enforceSubplotVocabulary handles explicitly
    const aiClient = getAIClient(this.plugin);
    const proposals: SceneProposal[] = [];

    for (let i = 0; i < scenes.length; i++) {
      if (options.signal?.aborted) break;
      const scene = scenes[i];
      // Split scenes carry real titles ("Book I — The gods in council"); only
      // fall back to the filename when the source didn't provide one.
      const title = scene.title ?? titleFromFileName(basename(scene.sourceRef));
      options.onProgress?.(i + 1, scenes.length, title);

      // Resume: a successful proposal from an interrupted run stands as-is.
      const prior = options.reuse?.get(scene.sourceRef);
      if (prior?.frontmatter) {
        proposals.push(prior);
        continue;
      }

      try {
        const result = await aiClient.run({
          feature: 'Onboarding',
          task: 'OnboardingScene',
          requiredCapabilities: ['jsonStrict'],
          featureModeInstructions: getOnboardingSceneInstructions(),
          userInput: buildOnboardingScenePrompt({
            body: scene.rawText,
            subplotVocabulary,
            knownMetadata: scene.knownMetadata,
            knownSynopsis: scene.knownSynopsis,
          }),
          returnType: 'json',
          responseSchema: getOnboardingSceneJsonSchema(),
          providerOverride: this.engineOverride,
          overrides: { ...OVERRIDES },
        });
        if (result.aiStatus !== 'success' || !result.content) {
          proposals.push(this.failed(scene, title, result.error || 'No response from the local model.')); // SAFE: the proposal is marked failed either way; this text covers a transport failure that carried no message
          continue;
        }
        const parsed = parseSceneExtraction(result.content);
        if (!parsed.ok) {
          proposals.push(this.failed(scene, title, parsed.error));
          continue;
        }
        proposals.push({
          sourceRef: scene.sourceRef,
          // Best name wins: the model's short action title ("Leaving home"),
          // else the split/source title, else the filename fallback.
          title: parsed.value.title.length > 0 ? parsed.value.title : title,
          frontmatter: buildSceneFrontmatter(parsed.value, {
            actCount,
            publishStage: options.publishStage,
            subplotVocabulary,
            carriedMetadata: scene.knownMetadata,
          }),
          body: scene.rawText,
          flags: effectiveFlags(parsed.value),
          characters: linkedCharacters(parsed.value),
          places: linkedPlaces(parsed.value),
        });
      } catch (error) {
        proposals.push(this.failed(scene, title, error instanceof Error ? error.message : String(error)));
      }
    }

    // Acts are ORDINAL — scene N can never precede scene N-1's act — so they are
    // computed from position, not asked of the model (which sees one scene at a
    // time and cannot know where it falls): the written sequence divides into
    // actCount contiguous blocks. "Act" also leaves the flag list — it is no
    // longer a guess.
    const written = proposals.filter((proposal) => proposal.frontmatter);
    const acts = resolveActs(written.map((proposal) => this.sourceActFor(scenes, proposal.sourceRef)), actCount);
    written.forEach((proposal, index) => {
      (proposal.frontmatter as Record<string, unknown>).Act = acts[index];
      proposal.flags = proposal.flags.filter((flag) => flag.toLowerCase() !== 'act');
    });

    // Substantial-subplot rule (Eric: a thread needs 2+ scenes): a subplot used
    // by exactly one scene is trivia, not a thread — collapse it into Main Plot.
    const subplotCounts = new Map<string, number>();
    const subplotOf = (proposal: SceneProposal): string => {
      const value = (proposal.frontmatter as Record<string, unknown>).Subplot;
      return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : 'Main Plot';
    };
    for (const proposal of written) {
      const name = subplotOf(proposal);
      subplotCounts.set(name, (subplotCounts.get(name) ?? 0) + 1); // SAFE: first sighting of a subplot starts its tally at 0
    }
    for (const proposal of written) {
      const name = subplotOf(proposal);
      if (name !== 'Main Plot' && subplotCounts.get(name) === 1) {
        (proposal.frontmatter as Record<string, unknown>).Subplot = ['Main Plot'];
      }
    }

    return proposals;
  }

  /**
   * AI scene splitting: for each plan without breaks yet, ask the model where
   * each scene begins (aligned to the argument beats when present) and set the
   * plan's breaks in place. Best-effort and abortable — a failed file is left as
   * the author had it. Skips already-onboarded, single-paragraph, and
   * already-broken files (markers or manual edits win).
   *
   * Returns per-file outcomes keyed by sourceRef so the checkpoint can show
   * exactly which files the AI split and which it could not.
   */
  async proposeSplits(plans: ScenePlan[], options: SplitOptions = {}): Promise<Map<string, 'split' | 'failed' | 'fallback'>> {
    const targets = plans.filter(
      (plan) => !plan.alreadyOnboarded && plan.paragraphs.length > 1 && plan.breaks.length === 0
    );
    const outcomes = new Map<string, 'split' | 'failed' | 'fallback'>();
    const aiClient = getAIClient(this.plugin);
    for (let i = 0; i < targets.length; i++) {
      if (options.signal?.aborted) break;
      const plan = targets[i];
      options.onProgress?.(i + 1, targets.length, plan.baseTitle ?? plan.sourceRef);
      outcomes.set(plan.sourceRef, 'failed');
      try {
        const result = await aiClient.run({
          feature: 'Onboarding',
          task: 'OnboardingSplit',
          requiredCapabilities: ['jsonStrict'],
          featureModeInstructions: getOnboardingSplitInstructions(),
          userInput: buildOnboardingSplitPrompt({ paragraphs: plan.paragraphs, labels: plan.labels }),
          returnType: 'json',
          responseSchema: getOnboardingSplitJsonSchema(),
          providerOverride: this.engineOverride,
          overrides: { ...OVERRIDES },
        });
        if (result.aiStatus === 'success' && result.content) {
          const parsed = parseSplitProposal(result.content);
          if (parsed.ok) {
            let breaks = breaksFromStarts(parsed.value.starts, plan.paragraphs.length);
            // Hold the split to the file's own argument structure: N section
            // titles = N scenes. An eager model otherwise shatters a chapter
            // into fragments (212 scenes where the arguments say ~90).
            if (plan.labels.length >= 2) {
              breaks = clampBreaksToCount(breaks, plan.labels.length);
            }
            // Scene-size floor: scenes are substantial units, not fragments.
            plan.breaks = mergeShortSegments(plan.paragraphs, breaks, MIN_SCENE_CHARS);
            // Adopt AI labels only when the file had no argument beats of its own.
            if (plan.labels.length === 0) {
              plan.labels = parsed.value.labels.filter((label) => label.length > 0);
            }
            outcomes.set(plan.sourceRef, 'split');
          }
        }
      } catch {
        // best-effort — leave this file's breaks unchanged
      }
      // The AI couldn't place breaks — never leave a whole book as one scene for
      // the author to hand-break. Fall back to a deterministic even split so it
      // still becomes several scenes; the author refines boundaries if they want.
      if (plan.breaks.length === 0) {
        const fallback = forcedEvenBreaks(plan.paragraphs, FALLBACK_SCENE_CHAR_TARGET);
        if (fallback.length > 0) {
          plan.breaks = fallback;
          outcomes.set(plan.sourceRef, 'fallback');
        }
      }
    }
    return outcomes;
  }

  /**
   * Aggregate linked entities of one kind from scene proposals: distinct name →
   * scene count + the scene bodies it appears in (reading order). Names are
   * already sanitized/capped upstream by linkedCharacters/linkedPlaces.
   */
  private aggregateEntities(
    proposals: SceneProposal[],
    kind: EntityKind
  ): Array<{ name: string; sceneCount: number; bodies: string[] }> {
    const map = new Map<string, { name: string; sceneCount: number; bodies: string[] }>();
    for (const proposal of proposals) {
      if (!proposal.frontmatter) continue;
      const names = kind === 'character' ? proposal.characters : proposal.places;
      for (const name of names) {
        const key = name.toLowerCase();
        const entry = map.get(key) ?? { name, sceneCount: 0, bodies: [] };
        entry.sceneCount += 1;
        if (proposal.body) entry.bodies.push(proposal.body);
        map.set(key, entry);
      }
    }
    return [...map.values()];
  }

  /** Keep whole linked-scene bodies until the grounding char budget is spent. */
  private budgetedExcerpts(bodies: string[]): string[] {
    const out: string[] = [];
    let used = 0;
    for (const body of bodies) {
      if (used >= ENTITY_GROUNDING_CHAR_BUDGET) break;
      const text = body.slice(0, ENTITY_GROUNDING_CHAR_BUDGET - used);
      out.push(text);
      used += text.length;
    }
    return out;
  }

  /**
   * Second AI phase: for each linked Character/Place, generate a grounded role +
   * Summary from ONLY that entity's own scenes (never outside knowledge of the
   * name). Best-effort — a failed, empty, or aborted entity still yields a
   * proposal with blank role/summary so the note is created as a plain scaffold.
   */
  async enrichEntities(
    proposals: SceneProposal[],
    options: EnrichOptions
  ): Promise<EntityProposal[]> {
    const items = options.kinds.flatMap((kind) =>
      this.aggregateEntities(proposals, kind).map((entry) => ({ kind, ...entry }))
    );
    if (items.length === 0) return [];
    // Fast path: create the profile scaffolds with no AI calls.
    if (!options.generateSummaries) {
      return items.map((item) => ({
        kind: item.kind,
        name: item.name,
        sceneCount: item.sceneCount,
        role: '',
        summary: '',
      }));
    }
    const targetWords = Math.max(50, this.plugin.settings.synopsisTargetWords ?? 200); // SAFE: 200 words is the shipped synopsis target; the Math.max floor is the hard minimum
    const aiClient = getAIClient(this.plugin);
    const results: EntityProposal[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const blank: EntityProposal = { kind: item.kind, name: item.name, sceneCount: item.sceneCount, role: '', summary: '' };
      if (options.signal?.aborted) {
        // Remaining entities still get created — just as blank scaffolds.
        for (let j = i; j < items.length; j++) {
          const rest = items[j];
          results.push({ kind: rest.kind, name: rest.name, sceneCount: rest.sceneCount, role: '', summary: '' });
        }
        break;
      }
      options.onProgress?.(i + 1, items.length, item.name);
      try {
        const result = await aiClient.run({
          feature: 'Onboarding',
          task: 'OnboardingEntity',
          requiredCapabilities: ['jsonStrict'],
          featureModeInstructions: getOnboardingEntityInstructions(),
          userInput: buildOnboardingEntityPrompt({
            kind: item.kind,
            name: item.name,
            targetWords,
            sceneExcerpts: this.budgetedExcerpts(item.bodies),
          }),
          returnType: 'json',
          responseSchema: getOnboardingEntityJsonSchema(),
          providerOverride: this.engineOverride,
          overrides: { ...OVERRIDES },
        });
        if (result.aiStatus === 'success' && result.content) {
          const parsed = parseEntityEnrichment(result.content);
          if (parsed.ok) {
            results.push({
              ...blank,
              role: item.kind === 'character' ? parsed.value.role : '',
              summary: parsed.value.summary,
            });
            continue;
          }
        }
      } catch {
        // best-effort — fall through to the blank scaffold
      }
      results.push(blank);
    }
    return results;
  }

  /**
   * Write accepted proposals into a NEW book folder (source untouched), create
   * profile notes for linked entities, and register the folder as a book.
   */
  async materialize(
    sourceBook: BookProfile | null,
    proposals: SceneProposal[],
    entityProposals: EntityProposal[],
    options?: { folderName?: string }
  ): Promise<MaterializeReport> {
    const vault = this.plugin.app.vault;
    const destFolder = normalizePath(
      options?.folderName ?? suggestOnboardingFolderName(sourceBook?.sourceFolder ?? 'Book') // SAFE: caller did not name the destination, so it is derived; 'Book' is the stem when there is no source folder
    );
    if (!(vault.getAbstractFileByPath(destFolder) instanceof TFolder)) {
      await vault.createFolder(destFolder);
    }

    const errors: string[] = [];
    let notesCreated = 0;
    let index = 0;

    for (const proposal of proposals) {
      if (!proposal.frontmatter) continue;
      const sceneFrontmatter = proposal.frontmatter;
      index += 1;
      const noteName = sanitizeFileName(`${String(index).padStart(2, '0')} ${proposal.title || 'Scene'}`); // SAFE: filenames must be non-empty; the index prefix still disambiguates an untitled scene
      const path = normalizePath(`${destFolder}/${noteName}.md`);
      try {
        const file = await vault.create(path, proposal.body ? `\n${proposal.body}\n` : '\n');
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const target = frontmatter as Record<string, unknown>;
          for (const [key, value] of Object.entries(sceneFrontmatter)) {
            target[key] = value;
          }
        });
        notesCreated += 1;
      } catch (error) {
        errors.push(`${noteName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Entity notes are full Character/Place profiles (Class, Book, Scene Count,
    // optional grounded Summary + header), filed in Character/ and Place/ folders
    // PARALLEL to the book folder — the author-vault convention. Only the kinds
    // the author enabled at Checkpoint 1 are present in entityProposals; an empty
    // list means "scenes only". Craft sections always stay blank.
    const bookTitle = sourceBook?.title ?? basename(destFolder);
    const stubsCreated = await this.createEntityNotes(destFolder, entityProposals, bookTitle);
    await this.registerBook(sourceBook, destFolder);

    return {
      bookFolder: destFolder,
      notesCreated,
      stubsCreated,
      needsReview: proposals.filter((proposal) => proposal.error || proposal.flags.length > 0),
      errors,
    };
  }

  private candidateScenes(model: ManuscriptModel): ManuscriptScene[] {
    return flattenScenes(model).filter((scene) => !scene.alreadyOnboarded);
  }

  private failed(scene: ManuscriptScene, title: string, error: string): SceneProposal {
    return {
      sourceRef: scene.sourceRef,
      title,
      frontmatter: null,
      body: scene.rawText,
      flags: [],
      characters: [],
      places: [],
      error,
    };
  }

  /**
   * Create Character/Place profile notes for linked entities in the entity folder
   * parallel to the book folder. Existing notes are never overwritten. A grounded
   * Summary is written into YAML via processFrontMatter (safe escaping); the role
   * fills the character header line through the scaffold builder.
   */
  private async createEntityNotes(
    bookFolder: string,
    entities: EntityProposal[],
    bookTitle: string
  ): Promise<number> {
    if (entities.length === 0) return 0;
    const vault = this.plugin.app.vault;
    const ensuredFolders = new Set<string>();
    let created = 0;
    for (const entity of entities) {
      const noteName = sanitizeFileName(entity.name);
      if (!noteName) continue;
      const entityFolder = normalizePath(entityFolderFor(bookFolder, entity.kind));
      if (!ensuredFolders.has(entityFolder)) {
        if (!(vault.getAbstractFileByPath(entityFolder) instanceof TFolder)) {
          try {
            await vault.createFolder(entityFolder);
          } catch {
            // Already exists (race) — fall through and write into it.
          }
        }
        ensuredFolders.add(entityFolder);
      }
      const path = normalizePath(`${entityFolder}/${noteName}.md`);
      if (vault.getAbstractFileByPath(path)) continue;
      try {
        const file = await vault.create(
          path,
          buildEntityNoteContent(entity.kind, {
            book: bookTitle,
            sceneCount: entity.sceneCount,
            name: entity.name,
            role: entity.role,
          })
        );
        if (entity.summary && file instanceof TFile) {
          await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            (frontmatter as Record<string, unknown>).Summary = entity.summary;
          });
        }
        created += 1;
      } catch {
        // A collision or invalid name shouldn't abort the run.
      }
    }
    return created;
  }

  private async registerBook(sourceBook: BookProfile | null, destFolder: string): Promise<void> {
    const newBook = normalizeBookProfile({
      id: createBookId(),
      title: sourceBook?.title ?? basename(destFolder),
      sourceFolder: destFolder,
      genre: sourceBook?.genre,
      projectStage: sourceBook?.projectStage,
    });
    this.plugin.settings.books = [...(this.plugin.settings.books ?? []), newBook]; // SAFE: the first onboarded book seeds an empty list
    this.plugin.settings.activeBookId = newBook.id;
    await this.plugin.persistBookSettings();
  }
}
