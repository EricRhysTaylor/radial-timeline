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
 * uses), gives the note a scene ID and puts its properties in template order.
 * It never overwrites a value the author wrote and never touches the note text.
 *
 * See docs/engineering/plans/timeline-table-and-sketches-plan.md §1.
 */

import { type App, TFile, parseYaml } from 'obsidian';
import type { BookProfile, RadialTimelineSettings, TimelineItem } from '../types';
import { getBookIdForPath } from '../utils/books';
import { getTemplateParts } from '../utils/yamlTemplateNormalize';
import { generateSceneContent } from '../utils/sceneGenerator';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { extractPrefixToken } from '../utils/prefixOrder';
import { formatLocalDateKey } from '../utils/date';
import { safeTitle, splitNumberPrefix } from '../utils/noteTitle';
import { buildDecimalSceneInsertionPrefix } from './SceneInsertService';
import { ensureSceneIds, reorderSceneFields } from '../sceneProperties/sceneNormalizer';
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

/**
 * Template keys (other than Class) that the note does not have. A key counts as
 * present under any letter case and under any custom name the author mapped to
 * it, so promotion never adds a duplicate of a property the author renamed.
 */
export function findMissingTemplateKeys(
    templateKeys: string[],
    frontmatter: Record<string, unknown> | undefined,
    mappings: Record<string, string> | undefined
): string[] {
    const present = new Set<string>();
    if (frontmatter) {
        for (const key of Object.keys(frontmatter)) present.add(key.toLowerCase());
        // Built-in aliases apply even without custom mappings.
        for (const key of Object.keys(normalizeFrontmatterKeys(frontmatter, mappings))) present.add(key.toLowerCase());
    }
    return templateKeys.filter(key =>
        key.toLowerCase() !== CLASS_KEY.toLowerCase() && !present.has(key.toLowerCase()));
}

/** The keys a template defines, in template order. */
export function templateKeysOf(template: string): string[] {
    const keys: string[] = [];
    for (const line of template.split('\n')) {
        const match = line.match(/^([^\s#:][^:]*):/);
        if (match) keys.push(match[1].trim());
    }
    return keys;
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
    const coreKeys = templateKeysOf(templates.base);
    const allKeys = templateKeysOf(templates.merged);
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

/**
 * The values promotion would insert for the given template, using the note's
 * own Act and the anchor scene's Act and When where the note has none.
 */
export function buildTemplateValues(
    template: string,
    context: { act: number; when: string; due: string }
): Record<string, unknown> {
    const content = generateSceneContent(template, {
        act: context.act,
        when: context.when,
        due: context.due,
        sceneNumber: '',
        subplots: [],
        character: '',
        place: '',
        characterList: [],
        placeList: [],
    });
    const parsed: unknown = parseYaml(content);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
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
 * Promote every entry in the plan. Writes go through `processFrontMatter`,
 * one note at a time; a failure on one note is reported and the rest continue.
 */
export async function applyPromotion(
    app: App,
    settings: RadialTimelineSettings,
    plan: PromotionPlan,
    options: PromotionOptions
): Promise<PromotionResult> {
    const result: PromotionResult = { promoted: [], renamed: [], failed: [] };
    const templates = getTemplateParts('Scene', settings);
    const template = options.advanced ? templates.merged : templates.base;
    const mappings = getActiveFrontmatterMappings(settings);
    const due = formatLocalDateKey();
    const single = plan.entries.length === 1;

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
            const values = buildTemplateValues(template, { act, when: anchorWhen, due });
            const templateKeys = templateKeysOf(template);

            await app.fileManager.processFrontMatter(entry.file, (fm: Record<string, unknown>) => {
                const classKey = findKeyCaseInsensitive(fm, CLASS_KEY) ?? CLASS_KEY;
                fm[classKey] = 'Scene';
                // Recompute against the live frontmatter, not the cached plan.
                for (const key of findMissingTemplateKeys(templateKeys, fm, mappings)) {
                    // A blank template value stays blank (`When:`), as in a new
                    // scene; an empty string would be written as `When: ""`.
                    const value = values[key];
                    fm[key] = value === undefined || value === '' ? null : value;
                }
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
        await ensureSceneIds({ app, settings, files: result.promoted, includeSafetyScan: false });
        // The reorder decides from the metadata cache, so let it catch up first.
        await waitForSceneClass(app, result.promoted);
        await reorderSceneFields({ app, settings, files: result.promoted });
    }

    // A single note may be renamed: numbered after an anchor (when it has no
    // number yet), given the title the author typed, or both.
    const only = single ? plan.entries[0] : undefined;
    if (only && result.promoted.includes(only.file)) {
        const prefix = !only.prefix && options.anchorPath && options.sceneData
            ? buildDecimalSceneInsertionPrefix(options.sceneData, options.anchorPath, options.beatModel)
            : null;
        const basename = promotedBasename(only.file.basename, prefix, options.title ?? null);
        if (basename !== only.file.basename) {
            const from = only.file.path;
            const to = uniqueSiblingPath(app, only.file, basename);
            await app.fileManager.renameFile(only.file, to);
            result.renamed.push({ from, to });
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
