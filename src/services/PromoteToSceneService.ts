/*
 * Promote to scene
 * ----------------
 * Turns a note that already sits in a book folder into a proper manuscript
 * scene, so it appears on the timeline. A note is eligible only when it has no
 * Class or is a Sketch; Beats, Backdrops, matter pages and every other classed
 * note are never converted.
 *
 * Promotion is additive. It sets Class: Scene, inserts the scene-template
 * properties the note is missing (the same template right-click "Add scene"
 * uses) and gives the note a scene ID. Existing properties, comments, and
 * note text are preserved in place.
 *
 * See docs/engineering/plans/timeline-table-and-sketches-plan.md §1.
 */

import { type App, TFile, parseYaml } from 'obsidian';
import type { BookProfile, RadialTimelineSettings, TimelineItem } from '../types';
import { getBookIdForPath } from '../utils/books';
import { extractKeysInOrder, getTemplateParts } from '../utils/yamlTemplateNormalize';
import { findMissingTemplateKeys, getActiveFrontmatterMappings } from '../utils/frontmatter';
import { extractPrefixToken } from '../utils/prefixOrder';
import { safeTitle, splitNumberPrefix } from '../utils/noteTitle';
import { buildDecimalSceneInsertionPrefix, isSafeSceneInsertionPrefix } from './SceneInsertService';
import { readSceneId } from '../utils/sceneIds';
import { sketchAnchor } from '../timetable/sketchPlacementFields';
import { promoteSceneContent, replaceSketchAnchor } from '../timetable/sceneIntakeTemplate';
import { sleep } from '../utils/sleep';

const CLASS_KEY = 'Class';

export type PromotionSkipReason = 'notMarkdown' | 'notInBook' | 'alreadyScene' | 'otherClass';

export interface PromotionEntry {
    file: TFile;
    book: BookProfile;
    /** The note is a Sketch (`Class: Sketch`) rather than an unclassed note. */
    fromSketch: boolean;
    /** Template keys the note lacks with the Core template. */
    missingCoreKeys: string[];
    /** Additional keys the note lacks when advanced properties are included. */
    missingAdvancedKeys: string[];
    /** The filename's numeric prefix, or null when it has none. */
    prefix: string | null;
}

export interface PromotionSkip {
    file: TFile;
    reason: PromotionSkipReason;
    /** For `otherClass`, the class the note carries. */
    className?: string;
}

export interface PromotionPlan {
    entries: PromotionEntry[];
    skipped: PromotionSkip[];
}

export interface PromotionOptions {
    /** Include the advanced template properties. */
    advanced: boolean;
    /**
     * Single-note promotion only: number the note after this scene. Ignored when
     * the note already has a numeric prefix or when promoting several notes.
     */
    anchorPath?: string | null;
    /** The book's scenes in manuscript order, required when `anchorPath` is set. */
    sceneData?: TimelineItem[];
    beatModel?: string;
    /** Single-note promotion only: the scene's title, replacing a placeholder name. Any number prefix stays. */
    title?: string | null;
    sketchPlacement?: { anchorId: string; followingSketches: string[] };
    /** Several notes promoted together: the number each sketch takes, by path, so the book keeps their order. */
    sketchNumbers?: ReadonlyMap<string, string>;
    onProgress?: (current: number, total: number, name: string) => void;
}

export interface PromotionResult {
    promoted: TFile[];
    renamed: Array<{ from: string; to: string }>;
    failed: Array<{ file: TFile; message: string }>;
}

export type PromotionClass =
    | { kind: 'eligible'; fromSketch: boolean }
    | { kind: 'alreadyScene' }
    | { kind: 'otherClass'; className: string };

function findKeyCaseInsensitive(record: Record<string, unknown>, key: string): string | undefined {
    const target = key.toLowerCase();
    return Object.keys(record).find(candidate => candidate.toLowerCase() === target);
}

function classValues(frontmatter: Record<string, unknown> | undefined): string[] {
    if (!frontmatter) return [];
    const key = findKeyCaseInsensitive(frontmatter, CLASS_KEY);
    if (!key) return [];
    const raw = frontmatter[key];
    const values = Array.isArray(raw) ? raw : [raw];
    return values
        .map(value => String(value ?? '').trim())
        .filter(value => value.length > 0);
}

/** Decide whether a note's frontmatter allows promotion. */
export function classifyForPromotion(frontmatter: Record<string, unknown> | undefined): PromotionClass {
    const values = classValues(frontmatter);
    if (values.length === 0) return { kind: 'eligible', fromSketch: false };
    const lowered = values.map(value => value.toLowerCase());
    if (lowered.includes('scene')) return { kind: 'alreadyScene' };
    if (lowered.length === 1 && lowered[0] === 'sketch') return { kind: 'eligible', fromSketch: true };
    return { kind: 'otherClass', className: values.join(', ') };
}

export function filenamePrefix(basename: string): string | null {
    return extractPrefixToken(`${basename} `);
}

function frontmatterOf(app: App, file: TFile): Record<string, unknown> | undefined {
    return app.metadataCache.getFileCache(file)?.frontmatter;
}

/** Sort the candidate notes into those that can be promoted and those skipped. */
export function planPromotion(app: App, settings: RadialTimelineSettings, files: TFile[]): PromotionPlan {
    const mappings = getActiveFrontmatterMappings(settings);
    const templates = getTemplateParts('Scene', settings);
    const coreKeys = extractKeysInOrder(templates.base);
    const allKeys = extractKeysInOrder(templates.merged);
    const advancedOnlyKeys = allKeys.filter(key => !coreKeys.includes(key));
    const plan: PromotionPlan = { entries: [], skipped: [] };

    for (const file of files) {
        if (file.extension !== 'md') {
            plan.skipped.push({ file, reason: 'notMarkdown' });
            continue;
        }
        const bookId = getBookIdForPath(settings.books, file.path);
        const book = bookId ? settings.books?.find(candidate => candidate.id === bookId) : undefined;
        if (!book) {
            plan.skipped.push({ file, reason: 'notInBook' });
            continue;
        }
        const frontmatter = frontmatterOf(app, file);
        const classification = classifyForPromotion(frontmatter);
        if (classification.kind === 'alreadyScene') {
            plan.skipped.push({ file, reason: 'alreadyScene' });
            continue;
        }
        if (classification.kind === 'otherClass') {
            plan.skipped.push({ file, reason: 'otherClass', className: classification.className });
            continue;
        }
        plan.entries.push({
            file,
            book,
            fromSketch: classification.fromSketch,
            missingCoreKeys: findMissingTemplateKeys(coreKeys, frontmatter, mappings),
            missingAdvancedKeys: findMissingTemplateKeys(advancedOnlyKeys, frontmatter, mappings),
            prefix: filenamePrefix(file.basename),
        });
    }
    return plan;
}

/** Whether a single note can be promoted, for menus and the command palette. */
export function isPromotable(app: App, settings: RadialTimelineSettings, file: TFile): boolean {
    return planPromotion(app, settings, [file]).entries.length === 1;
}

function readNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readField(frontmatter: Record<string, unknown> | undefined, key: string): unknown {
    if (!frontmatter) return undefined;
    const found = findKeyCaseInsensitive(frontmatter, key);
    return found ? frontmatter[found] : undefined;
}

function uniqueSiblingPath(app: App, file: TFile, basename: string): string {
    const slash = file.path.lastIndexOf('/');
    const parent = slash >= 0 ? file.path.slice(0, slash + 1) : '';
    let candidate = `${parent}${basename}.md`;
    let counter = 2;
    while (app.vault.getAbstractFileByPath(candidate)) {
        candidate = `${parent}${basename} ${counter}.md`;
        counter += 1;
    }
    return candidate;
}

/** Wait, up to `timeoutMs`, until the cache shows every file as a scene. */
async function waitForSceneClass(app: App, files: TFile[], timeoutMs = 5000, pollMs = 120): Promise<void> {
    const start = Date.now();
    const isScene = (file: TFile) => classifyForPromotion(frontmatterOf(app, file)).kind === 'alreadyScene';
    let pending = files.filter(file => !isScene(file));
    while (pending.length > 0 && Date.now() - start < timeoutMs) {
        await sleep(pollMs);
        pending = pending.filter(file => !isScene(file));
    }
}

/**
 * Promote every entry in the plan, one note at a time; a failure on one note is
 * reported and the rest continue.
 */
export async function applyPromotion(
    app: App,
    settings: RadialTimelineSettings,
    plan: PromotionPlan,
    options: PromotionOptions
): Promise<PromotionResult> {
    const result: PromotionResult = { promoted: [], renamed: [], failed: [] };
    const single = plan.entries.length === 1;

    // Validate the filename before changing Class or touching any note. The
    // numeric midpoint is not always between two natural-sort prefixes.
    let insertionPrefix: string | null = null;
    if (single && !plan.entries[0].prefix && options.anchorPath && options.sceneData) {
        insertionPrefix = buildDecimalSceneInsertionPrefix(options.sceneData, options.anchorPath, options.beatModel);
        // Numeric midpoints can sort outside the gap under Obsidian's natural
        // filename ordering. Try other decimal suffixes before giving up.
        if (!isSafeSceneInsertionPrefix(options.sceneData, options.anchorPath, insertionPrefix, options.beatModel)) {
            const anchorName = options.anchorPath.slice(options.anchorPath.lastIndexOf('/') + 1);
            const major = extractPrefixToken(anchorName)?.split('.')[0];
            if (major) {
                for (let suffix = 1; suffix <= 999; suffix++) {
                    const candidate = `${major}.${suffix}`;
                    if (isSafeSceneInsertionPrefix(options.sceneData, options.anchorPath, candidate, options.beatModel)) {
                        insertionPrefix = candidate;
                        break;
                    }
                }
            }
        }
        if (!isSafeSceneInsertionPrefix(options.sceneData, options.anchorPath, insertionPrefix, options.beatModel)) {
            result.failed.push({ file: plan.entries[0].file, message: 'No safe scene number is available at this position.' });
            return result;
        }
    }

    const anchorItem = single && options.anchorPath
        ? options.sceneData?.find(item => item.path === options.anchorPath)
        : undefined;
    const anchorFile = anchorItem?.path ? app.vault.getAbstractFileByPath(anchorItem.path) : null;
    const anchorFrontmatter = anchorFile instanceof TFile ? frontmatterOf(app, anchorFile) : undefined;
    const anchorAct = readNumber(readField(anchorFrontmatter, 'Act')) ?? anchorItem?.actNumber ?? null;
    const anchorWhenRaw = readField(anchorFrontmatter, 'When');
    const anchorWhen = typeof anchorWhenRaw === 'string' ? anchorWhenRaw : '';

    for (let index = 0; index < plan.entries.length; index++) {
        const entry = plan.entries[index];
        options.onProgress?.(index + 1, plan.entries.length, entry.file.basename);
        try {
            const frontmatter = frontmatterOf(app, entry.file);
            const act = readNumber(readField(frontmatter, 'Act')) ?? anchorAct ?? 1;
            await app.vault.process(entry.file, content => {
                if (options.sketchPlacement) {
                    const raw = content.match(/^---\s*\r?\n([\s\S]*?)^---\s*$/m)?.[1];
                    const fm = raw ? parseYaml(raw) as Record<string, unknown> : undefined;
                    if (sketchAnchor(fm) !== options.sketchPlacement.anchorId) throw new Error('Sketch placement changed.');
                }
                return promoteSceneContent(content, settings, { advanced: options.advanced, act, when: anchorWhen, expectedSketch: entry.fromSketch });
            });
            result.promoted.push(entry.file);
        } catch (error) {
            result.failed.push({
                file: entry.file,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    if (result.promoted.length > 0) {
        await waitForSceneClass(app, result.promoted);
    }

    for (const file of result.promoted) {
        const prefix = options.sketchNumbers?.get(file.path);
        if (!prefix) continue;
        const from = file.path;
        try {
            const to = uniqueSiblingPath(app, file, promotedBasename(file.basename, prefix, null));
            await app.fileManager.renameFile(file, to);
            result.renamed.push({ from, to });
        } catch (error) {
            result.failed.push({ file, message: error instanceof Error ? error.message : String(error) });
        }
    }

    // A single note may be renamed: numbered after an anchor (when it has no
    // number yet), given the title the author typed, or both.
    const only = single ? plan.entries[0] : undefined;
    if (only && result.promoted.includes(only.file)) {
        const basename = promotedBasename(only.file.basename, insertionPrefix, options.title ?? null);
        if (basename !== only.file.basename) {
            const from = only.file.path;
            const to = uniqueSiblingPath(app, only.file, basename);
            await app.fileManager.renameFile(only.file, to);
            result.renamed.push({ from, to });
        }
        if (options.sketchPlacement?.followingSketches.length) {
            try {
                const raw = (await app.vault.read(only.file)).match(/^---\s*\r?\n([\s\S]*?)^---\s*$/m)?.[1];
                const sceneId = raw ? readSceneId(parseYaml(raw) as Record<string, unknown>) : undefined;
                if (!sceneId) throw new Error('Promoted scene has no ID.');
                for (const path of options.sketchPlacement.followingSketches) {
                    const sketch = app.vault.getAbstractFileByPath(path);
                    if (!(sketch instanceof TFile)) throw new Error(`Sketch no longer exists: ${path}`);
                    await app.vault.process(sketch, content => replaceSketchAnchor(content, options.sketchPlacement!.anchorId, sceneId));
                }
            } catch (error) {
                result.failed.push({ file: only.file, message: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    return result;
}

/**
 * A promoted note's file name: the anchor's new number (else the number it
 * already had), then the title the author typed (else the name it had).
 */
export function promotedBasename(basename: string, prefix: string | null, title: string | null): string {
    const typed = title ? safeTitle(title) : '';
    if (!typed) return prefix ? `${prefix} ${basename}` : basename;
    const { lead } = splitNumberPrefix(basename);
    return prefix ? `${prefix} ${typed}` : `${lead}${typed}`;
}
