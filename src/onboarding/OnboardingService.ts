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
import {
  flattenScenes,
  type ManuscriptModel,
  type ManuscriptScene,
} from './adapters/manuscriptModel';
import {
  getOnboardingSurveyJsonSchema,
  getOnboardingSceneJsonSchema,
  getOnboardingSurveyInstructions,
  getOnboardingSceneInstructions,
  buildOnboardingSurveyPrompt,
  buildOnboardingScenePrompt,
} from '../ai/prompts/onboarding';
import {
  parseSurveyResult,
  parseSceneExtraction,
  buildSceneFrontmatter,
  linkedCharacters,
  linkedPlaces,
  effectiveFlags,
  type SurveyResult,
} from './extraction';
import { basename, openingWords, sanitizeFileName, suggestOnboardingFolderName } from './paths';
import { buildEntityNoteContent, entityFolderFor, type EntityKind } from '../utils/entityNotes';

export interface PreflightResult {
  ok: boolean;
  tier: number;
  reason: string;
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
}

const OVERRIDES = { temperature: 0.1, jsonStrict: true } as const;

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
      };
    }
    return { ok: true, tier: capability.tier, reason: capability.tierSummary };
  }

  /** Parse a folder of prose notes into a Manuscript Model (reading order resolved). */
  async ingest(folderPath: string): Promise<MarkdownIngestResult> {
    const source = createObsidianMarkdownSource(this.plugin.app);
    return ingestMarkdownFolder(source, folderPath);
  }

  /** One structured survey call establishing acts, subplot vocabulary, and scene classification. */
  async survey(model: ManuscriptModel): Promise<SurveyResult | null> {
    const scenes = this.candidateScenes(model);
    if (scenes.length === 0) return null;
    const surveyInput = scenes.map((scene) => ({
      fileName: basename(scene.sourceRef),
      opening: openingWords(scene.rawText, 80),
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
      const title = titleFromFileName(basename(scene.sourceRef));
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
          title,
          frontmatter: buildSceneFrontmatter(parsed.value, {
            actCount,
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
    return proposals;
  }

  /**
   * Write accepted proposals into a NEW book folder (source untouched), create
   * stub notes for linked entities, and register the folder as a book.
   */
  async materialize(
    sourceBook: BookProfile | null,
    proposals: SceneProposal[],
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
    const characterCounts = new Map<string, number>();
    const placeCounts = new Map<string, number>();
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
        proposal.characters.forEach((name) => characterCounts.set(name, (characterCounts.get(name) ?? 0) + 1));
        proposal.places.forEach((name) => placeCounts.set(name, (placeCounts.get(name) ?? 0) + 1));
      } catch (error) {
        errors.push(`${noteName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Entity notes are full Character/Place profiles (Class, Book, Scene Count +
    // section scaffold), filed in Character/ and Place/ folders PARALLEL to the
    // book folder — the author-vault convention. Sections stay blank on purpose.
    const bookTitle = sourceBook?.title ?? basename(destFolder);
    const stubsCreated =
      (await this.createEntityNotes('character', destFolder, characterCounts, bookTitle))
      + (await this.createEntityNotes('place', destFolder, placeCounts, bookTitle));
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
   * parallel to the book folder. Existing notes are never overwritten.
   */
  private async createEntityNotes(
    kind: EntityKind,
    bookFolder: string,
    counts: Map<string, number>,
    bookTitle: string
  ): Promise<number> {
    if (counts.size === 0) return 0;
    const vault = this.plugin.app.vault;
    const entityFolder = normalizePath(entityFolderFor(bookFolder, kind));
    if (!(vault.getAbstractFileByPath(entityFolder) instanceof TFolder)) {
      try {
        await vault.createFolder(entityFolder);
      } catch {
        // Already exists (race) — fall through and write into it.
      }
    }
    let created = 0;
    for (const [name, sceneCount] of counts) {
      const noteName = sanitizeFileName(name);
      if (!noteName) continue;
      const path = normalizePath(`${entityFolder}/${noteName}.md`);
      if (vault.getAbstractFileByPath(path)) continue;
      try {
        await vault.create(path, buildEntityNoteContent(kind, { book: bookTitle, sceneCount }));
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
