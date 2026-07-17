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
  linkedCharacters,
  linkedPlaces,
  effectiveFlags,
  positionalAct,
  type SurveyResult,
} from './extraction';
import { breaksFromStarts, forcedEvenBreaks, type ScenePlan } from './sceneSplitting';
import { basename, openingWords, sanitizeFileName, suggestOnboardingFolderName } from './paths';
import { buildEntityNoteContent, entityFolderFor, type EntityKind } from '../utils/entityNotes';
import type { Stage } from '../utils/constants';

export interface PreflightResult {
  ok: boolean;
  tier: number;
  reason: string;
  /** The active local model id (for the modal's header pill), when reachable. */
  modelId?: string;
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
 * A still-unsplit unit larger than this gets a deterministic paragraph split so
 * per-scene extraction can't blow the context window (~10k tokens; Book XXIV
 * failed whole at ~21k tokens against a 17k threshold).
 */
const FORCED_SPLIT_CHAR_LIMIT = 40000;

export class OnboardingService {
  constructor(private readonly plugin: RadialTimelinePlugin) {}

  /** Gate: the local model must produce strict JSON and reach capability tier >= 2. */
  async preflight(): Promise<PreflightResult> {
    const client = getLocalLlmClient(this.plugin);
    const diagnostics = await client.runDiagnostics();
    if (!diagnostics.structuredJson.ok) {
      return {
        ok: false,
        tier: 0,
        reason: diagnostics.structuredJson.message || 'The local model could not produce strict JSON.',
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

  /** Parse a folder of prose notes into a Manuscript Model (reading order resolved). */
  async ingest(folderPath: string): Promise<MarkdownIngestResult> {
    // Route by folder contents: exactly one prose file → single-file flow (detect
    // internal book/chapter structure); several files → one unit per file.
    const proseFiles = this.listProseFiles(folderPath);
    if (proseFiles.length === 1) {
      const file = proseFiles[0];
      const content = await this.plugin.app.vault.read(file);
      return { kind: 'ok', model: ingestSingleFile(file.name, content) };
    }
    const source = createObsidianMarkdownSource(this.plugin.app);
    return ingestMarkdownFolder(source, folderPath);
  }

  /** Prose files (md/txt/html) directly in the book folder; TOC excluded. */
  private listProseFiles(folderPath: string): TFile[] {
    const folder = this.plugin.app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return [];
    const proseExts = new Set(['md', 'txt', 'html', 'htm']);
    return folder.children.filter(
      (child): child is TFile =>
        child instanceof TFile &&
        proseExts.has(child.extension.toLowerCase()) &&
        child.name.toLowerCase() !== 'toc.md'
    );
  }

  /** One structured survey call establishing acts, subplot vocabulary, and scene classification. */
  async survey(model: ManuscriptModel): Promise<SurveyResult | null> {
    const scenes = this.candidateScenes(model);
    if (scenes.length === 0) return null;
    // Keep the survey prompt bounded: at 100+ scenes, 80-word openings blow the
    // context and the whole survey fails — which collapses every subplot to
    // Main Plot downstream. Shorter openings at scale keep the call reliable.
    const openingLength = scenes.length > 40 ? 25 : 80;
    const surveyInput = scenes.map((scene) => ({
      fileName: basename(scene.sourceRef),
      opening: openingWords(scene.rawText, openingLength),
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
        providerOverride: 'ollama',
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
  async extractScenes(
    model: ManuscriptModel,
    survey: SurveyResult | null,
    options: ExtractOptions = {}
  ): Promise<SceneProposal[]> {
    const actCount = Math.max(3, this.plugin.settings.actCount ?? 3);
    const scenes = this.candidateScenes(model);
    const nonScenes = new Set(
      (survey?.scenes ?? []).filter((entry) => !entry.isScene).map((entry) => entry.fileName)
    );
    const subplotVocabulary = survey?.subplots ?? [];
    const aiClient = getAIClient(this.plugin);
    const proposals: SceneProposal[] = [];

    for (let i = 0; i < scenes.length; i++) {
      if (options.signal?.aborted) break;
      const scene = scenes[i];
      // Split scenes carry real titles ("Book I — The gods in council"); only
      // fall back to the filename when the source didn't provide one.
      const title = scene.title ?? titleFromFileName(basename(scene.sourceRef));
      options.onProgress?.(i + 1, scenes.length, title);

      if (nonScenes.has(basename(scene.sourceRef))) continue; // classified as a non-scene note

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
          providerOverride: 'ollama',
          overrides: { ...OVERRIDES },
        });
        if (result.aiStatus !== 'success' || !result.content) {
          proposals.push(this.failed(scene, title, result.error || 'No response from the local model.'));
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
    written.forEach((proposal, index) => {
      (proposal.frontmatter as Record<string, unknown>).Act = positionalAct(index, written.length, actCount);
      proposal.flags = proposal.flags.filter((flag) => flag.toLowerCase() !== 'act');
    });

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
  async proposeSplits(plans: ScenePlan[], options: SplitOptions = {}): Promise<Map<string, 'split' | 'failed'>> {
    const targets = plans.filter(
      (plan) => !plan.alreadyOnboarded && plan.paragraphs.length > 1 && plan.breaks.length === 0
    );
    const outcomes = new Map<string, 'split' | 'failed'>();
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
          providerOverride: 'ollama',
          overrides: { ...OVERRIDES },
        });
        if (result.aiStatus === 'success' && result.content) {
          const parsed = parseSplitProposal(result.content);
          if (parsed.ok) {
            plan.breaks = breaksFromStarts(parsed.value.starts, plan.paragraphs.length);
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
      // Safety net: if the model left an oversized unit whole, split it
      // deterministically at paragraph boundaries so per-scene extraction can't
      // blow the context window (Book XXIV failed whole at ~21k tokens). The
      // outcome stays 'failed' so the review still draws the author's eye to it.
      if (plan.breaks.length === 0) {
        const totalChars = plan.paragraphs.reduce((sum, paragraph) => sum + paragraph.length + 2, 0);
        if (totalChars > FORCED_SPLIT_CHAR_LIMIT) {
          plan.breaks = forcedEvenBreaks(plan.paragraphs, FORCED_SPLIT_CHAR_LIMIT);
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
    const targetWords = Math.max(50, this.plugin.settings.synopsisTargetWords ?? 200);
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
          providerOverride: 'ollama',
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
      options?.folderName ?? suggestOnboardingFolderName(sourceBook?.sourceFolder ?? 'Book')
    );
    if (!(vault.getAbstractFileByPath(destFolder) instanceof TFolder)) {
      await vault.createFolder(destFolder);
    }

    const errors: string[] = [];
    let notesCreated = 0;
    let index = 0;

    for (const proposal of proposals) {
      if (!proposal.frontmatter) continue;
      index += 1;
      const noteName = sanitizeFileName(`${String(index).padStart(2, '0')} ${proposal.title || 'Scene'}`);
      const path = normalizePath(`${destFolder}/${noteName}.md`);
      try {
        const file = await vault.create(path, proposal.body ? `\n${proposal.body}\n` : '\n');
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const target = frontmatter as Record<string, unknown>;
          for (const [key, value] of Object.entries(proposal.frontmatter as Record<string, unknown>)) {
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
    this.plugin.settings.books = [...(this.plugin.settings.books ?? []), newBook];
    this.plugin.settings.activeBookId = newBook.id;
    await this.plugin.persistBookSettings();
  }
}
