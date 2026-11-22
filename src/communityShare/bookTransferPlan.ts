/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * A book made on the Community website, planned as scene notes: each note's
 * file name, frontmatter and body, and the folder they go in.
 *
 * Pure: no vault and no network. The plan is the whole text of every note, so
 * the writer (bookTransferWriter.ts) only creates files, and tests can read a
 * planned note the way the timeline reads a note on disk.
 *
 * A note carries exactly what a timeline carries (title, position, act,
 * subplots, status, stage, synopsis, cast, narration, story date, scene id),
 * under the keys the author's scene template and property mappings use. The
 * rest of the template is added empty by `completeImportedScene`, the same
 * step that finishes a scene from manuscript import.
 */

import { normalizePath } from 'obsidian';
import { dirname, sanitizeFileName } from '../onboarding/paths';
import { wallClockWhen } from '../services/export/timelineExportFormat';
import { completeImportedScene } from '../timetable/sceneIntakeTemplate';
import type { BookProfile, RadialTimelineSettings } from '../types/settings';
import { getConfiguredActCount } from '../utils/acts';
import { getOverlappingBook } from '../utils/books';
import { parseWhenField } from '../utils/date';
import { SCENE_NARRATION_KEY, authorKeyFromMappings, getActiveFrontmatterMappings } from '../utils/frontmatter';
import { formatYamlField, yamlKey } from '../utils/frontmatterText';
import { isPathInFolderScope } from '../utils/pathScope';
import { isNarrationValue } from '../utils/pov';
import { extractPrefixToken } from '../utils/prefixOrder';
import type { TransferDocument, TransferPublishStage, TransferReleasedText, TransferScene, TransferSceneStatus } from './bookTransferDocument';
import { sceneBlocksFromNote, sceneTextHash, sceneTextJson, type SceneBlock, type SceneRun } from './sceneReleaseText';

// ── File names ───────────────────────────────────────────────────────────────

/** The longest title kept in a file name, in characters: well inside every file system's limit with its number and `.md`. */
const MAX_TITLE_IN_FILE_NAME = 120;

/** Names Windows keeps for devices: a file or folder with one, with or without an extension, cannot be made there. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(\..*)?$/i;

/** Why a file or folder name would not be kept as written on every desktop, or null when it would. */
export function nameProblem(name: string): 'trailing' | 'reserved' | null {
    // Windows makes "Wait..." as "Wait", so a note or folder already named "Wait" would be taken for it.
    if (/[. ]$/.test(name)) return 'trailing';
    return WINDOWS_DEVICE_NAME.test(name) ? 'reserved' : null;
}

/** A sanitized name with the periods and spaces Windows would drop from its end removed. */
const withoutTrailingDots = (name: string): string => name.replace(/[. ]+$/, '');

/** The digits every scene number is padded to: two, or as many as the last scene's number has. */
export function sceneNumberWidth(scenes: readonly Pick<TransferScene, 'order'>[]): number {
    return Math.max(2, ...scenes.map(scene => String(scene.order).length));
}

/**
 * A scene note's name without `.md`: the scene's number, zero-padded, then its
 * title. The timeline reads a scene's position from the number that opens its
 * file name, so every note has one. A title that already opens with its own
 * number is kept as it is, with one number rather than two.
 */
export function transferNoteName(scene: Pick<TransferScene, 'order' | 'title'>, width: number): string {
    const title = withoutTrailingDots([...sanitizeFileName(scene.title)].slice(0, MAX_TITLE_IN_FILE_NAME).join('').trim());
    const ownNumber = extractPrefixToken(title);
    if (ownNumber !== null && Number(ownNumber) === scene.order) return title;
    return `${String(scene.order).padStart(width, '0')} ${title || 'Scene'}`; // SAFE: a file name needs words after its number; a title with no characters a file name can hold is named Scene, as manuscript import names one
}

/**
 * The vault path of a note in the new folder. Throws when the result would sit
 * anywhere but directly inside that folder: nothing is ever written elsewhere.
 */
export function transferNotePath(folder: string, fileName: string): string {
    const path = `${folder}/${fileName}`;
    const inside = fileName.length > 0 && !fileName.includes('/') && !fileName.includes('\\') && !fileName.startsWith('.')
        && fileName.endsWith('.md') && isPathInFolderScope(path, folder) && path.split('/').every(segment => segment !== '..' && segment !== '.');
    if (!inside) throw new Error(`Refused to write a note outside the new book folder: ${fileName}`);
    if (nameProblem(fileName) || nameProblem(fileName.slice(0, -'.md'.length))) throw new Error(`Refused a note name Windows would not keep as written: ${fileName}`);
    return path;
}

// ── The folder ───────────────────────────────────────────────────────────────

/**
 * The folder offered for the new book: beside the active book's folder, or at
 * the vault root when there is no book, named for the book, with " 2", " 3"
 * when that name is taken or is one Windows keeps for a device.
 */
export function suggestTransferFolder(title: string, activeBookFolder: string | undefined, isTaken: (folder: string) => boolean): string {
    const parent = activeBookFolder?.trim() ? dirname(activeBookFolder) : '';
    const base = withoutTrailingDots(sanitizeFileName(title)) || 'Book'; // SAFE: a title with no characters a folder name can hold still needs a folder name
    // "CON 2" is a name Windows keeps as written; "nul.txt 2" is still the device NUL, so its number goes before the period.
    const numbered = (attempt: number): string => {
        const appended = `${base} ${attempt}`;
        if (!nameProblem(appended)) return appended;
        const dot = base.indexOf('.');
        return `${base.slice(0, dot).trimEnd()} ${attempt}${base.slice(dot)}`;
    };
    for (let attempt = 1; ; attempt += 1) {
        const name = attempt === 1 ? base : numbered(attempt);
        const folder = parent ? `${parent}/${name}` : name;
        if (!nameProblem(name) && !isTaken(folder)) return folder;
    }
}

export type TransferFolderProblem =
    | { kind: 'empty' }
    | { kind: 'invalid' }
    /** A folder name ending in a period or a space, which Windows drops. */
    | { kind: 'trailing'; name: string }
    /** A folder name Windows keeps for a device (CON, NUL, COM1…). */
    | { kind: 'reserved'; name: string }
    | { kind: 'exists' }
    | { kind: 'overlap'; book: string }
    | { kind: 'parent'; parent: string };

export interface TransferFolderCheck {
    /** The folder as it will be created: trimmed, with single forward slashes. */
    folder: string;
    problem: TransferFolderProblem | null;
}

/**
 * Whether the folder the author typed can be created for the new book: a new
 * folder, inside a folder that exists, clear of every registered book.
 */
export function checkTransferFolder(
    input: string,
    vault: { exists: (path: string) => boolean; isFolder: (path: string) => boolean },
    books: BookProfile[] | undefined
): TransferFolderCheck {
    if (!input.replace(/[\\/]/g, '').trim()) return { folder: '', problem: { kind: 'empty' } };
    const folder = normalizePath(input.trim());
    const segments = folder.split('/');
    // Each name must be kept as written on every desktop, so the folder checked is the folder made.
    for (const segment of segments) {
        const problem = segment.trim() ? nameProblem(segment) : null;
        if (problem) return { folder, problem: { kind: problem, name: segment } };
    }
    // Each name must be one a note's folder can have: no characters a path or a link reserves, no leading period.
    if (segments.some(segment => !segment.trim() || segment !== sanitizeFileName(segment))) return { folder, problem: { kind: 'invalid' } };
    if (vault.exists(folder)) return { folder, problem: { kind: 'exists' } };
    const overlap = getOverlappingBook(books, folder);
    if (overlap) return { folder, problem: { kind: 'overlap', book: overlap.title } };
    const parent = dirname(folder);
    if (parent && !vault.isFolder(parent)) return { folder, problem: { kind: 'parent', parent } };
    return { folder, problem: null };
}

// ── Acts ─────────────────────────────────────────────────────────────────────

export interface TransferActCounts {
    /** The book's act count on Community. */
    book: number;
    /** The vault's act count, which every book in the vault shares. */
    vault: number;
    /**
     * True when the vault has fewer acts than the book uses. The timeline reads
     * a scene in a higher act as being in the vault's last act, so the notes are
     * not written until the author raises the vault's act count.
     */
    blocked: boolean;
}

export function transferActCounts(document: TransferDocument, settings: Pick<RadialTimelineSettings, 'actCount'>): TransferActCounts {
    const vault = getConfiguredActCount(settings);
    const used = Math.max(document.book.actCount, ...document.scenes.map(scene => scene.act));
    return { book: document.book.actCount, vault, blocked: used > vault };
}

// ── Frontmatter values ───────────────────────────────────────────────────────

const STATUS_TEXT: Record<TransferSceneStatus, string> = { todo: 'Todo', working: 'Working', complete: 'Complete', due: 'Due' };
const STAGE_TEXT: Record<TransferPublishStage, string> = { zero: 'Zero', author: 'Author', house: 'House', press: 'Press' };

/** A stored story date: `2085-04-01`, `2085-04-01T19:00:00`, or a signed six-digit year for a year outside 0–9999. */
const STORED_WHEN = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/;

/**
 * A stored story date in the form `When` takes (`2085-04-01 19:00`,
 * `1184-06-14 BCE`), or null when `When` has no form that reads back as the
 * same date and time.
 */
export function whenFrontmatterText(when: string): string | null {
    const match = STORED_WHEN.exec(when);
    if (!match) return null;
    const [, yearText, month, day, hour, minute, second] = match;
    const astronomical = Number(yearText);
    const bce = astronomical <= 0;
    const year = bce ? 1 - astronomical : astronomical;
    if (year > 9999) return null;
    const clock = hour === undefined ? '' : ` ${hour}:${minute}${second === '00' ? '' : `:${second}`}`;
    const text = `${String(year).padStart(4, '0')}-${month}-${day}${clock}${bce ? ' BCE' : ''}`;
    // Asked of the timeline's own reader and sender, so a date they would change is never claimed to carry.
    const parsed = parseWhenField(text);
    return parsed && wallClockWhen({ when: parsed, rawFrontmatter: { When: text } }) === when ? text : null;
}

const flowList = (values: readonly string[]): string => `[${values.map(value => JSON.stringify(value)).join(', ')}]`;

/** A scene's frontmatter lines, before the template's remaining fields are added. */
function sceneFrontmatterLines(scene: TransferScene, settings: RadialTimelineSettings): { lines: string[]; detailKept: boolean } {
    const mappings = getActiveFrontmatterMappings(settings);
    const key = (canonical: string): string => authorKeyFromMappings(canonical, mappings);
    const when = scene.when === undefined ? undefined : whenFrontmatterText(scene.when);
    const narrationRead = scene.povMode === undefined || (scene.povMode === scene.povMode.trim() && isNarrationValue(scene.povMode));
    const lines = [
        formatYamlField('ID', scene.id),
        formatYamlField(key('Class'), 'Scene'),
        `${yamlKey(key('Act'))}: ${scene.act}`,
        // A story date or narration the timeline does not read is kept as Community holds it, for the author to see.
        ...(scene.when === undefined ? [] : [formatYamlField(key('When'), when ?? scene.when)]),
        ...(scene.synopsis === undefined ? [] : [formatYamlField(key('Synopsis'), scene.synopsis)]),
        // The scene template's own forms: one subplot as plain text, several as a list, the cast always a list.
        scene.subplots.length === 1
            ? formatYamlField(key('Subplot'), scene.subplots[0])
            : `${yamlKey(key('Subplot'))}: ${flowList(scene.subplots)}`,
        ...(scene.characters.length === 0 ? [] : [`${yamlKey(key('Character'))}: ${flowList(scene.characters)}`]),
        ...(scene.povMode === undefined ? [] : [formatYamlField(key(SCENE_NARRATION_KEY), scene.povMode)]),
        formatYamlField(key('Publish Stage'), STAGE_TEXT[scene.publishStage]),
        formatYamlField(key('Status'), STATUS_TEXT[scene.status]),
    ];
    return { lines, detailKept: when === null || !narrationRead };
}

// ── Released text as a note body ─────────────────────────────────────────────

/** The scene break written into a note: a Markdown rule, which the release reads as a break. */
const SCENE_BREAK = '***';
/** Frontmatter stood in front of a body to read it exactly as a note is read. */
const NOTE_FRONTMATTER = '---\nClass: Scene\n---\n\n';

function readsBackAs(body: string, blocks: readonly SceneBlock[]): boolean {
    return sceneTextJson(sceneBlocksFromNote(NOTE_FRONTMATTER + body)) === sceneTextJson(blocks);
}

/**
 * One paragraph as a Markdown line that reads back as the same runs. Italics
 * are written `*so*`. Markdown has no escape the release reads, so where that
 * line would read differently the same words are tried with `_so_` italics,
 * then as a heading line, whose `# ` the release drops: that keeps a paragraph
 * that opens with `# ` or is nothing but a rule (`---`) a paragraph.
 */
function paragraphMarkdown(runs: readonly SceneRun[]): string {
    const written = (mark: string): string => runs.map(run => (typeof run === 'string' ? run : `${mark}${run.em}${mark}`)).join('');
    const star = written('*');
    const underscore = written('_');
    const block: SceneBlock[] = [{ kind: 'p', runs: [...runs] }];
    return [star, underscore, `# ${star}`, `# ${underscore}`].find(line => readsBackAs(line, block)) ?? star; // SAFE: with no form that reads back, the plain form is written and the scene is reported as reading differently (planBookTransfer)
}

/**
 * Released text as a note body: Markdown paragraphs, a rule for a scene break.
 * `sceneBlocksFromNote` reads the result back as the same blocks wherever
 * Markdown can say them; `planBookTransfer` checks each scene and reports the
 * ones it cannot.
 */
export function sceneBlocksToMarkdown(blocks: readonly SceneBlock[]): string {
    return blocks.map(block => (block.kind === 'break' ? SCENE_BREAK : paragraphMarkdown(block.runs))).join('\n\n');
}

// ── The plan ─────────────────────────────────────────────────────────────────

export interface PlannedSceneNote {
    sceneId: string;
    /** The note's file name, with `.md`. */
    fileName: string;
    /** The whole note: frontmatter, then the body. */
    content: string;
    /**
     * `none`: no released text. `exact`: the note reads back as the released
     * text, with the hash Community reports. `differs`: the released text
     * holds something a note reads differently (a link, a comment mark), so
     * the scene will show as changed since release.
     */
    text: 'none' | 'exact' | 'differs';
}

export interface BookTransferPlan {
    title: string;
    /** One note per scene, in manuscript order. */
    notes: PlannedSceneNote[];
    releasedTextCount: number;
    textDiffersCount: number;
    /** Scenes whose story date or narration is kept as text the timeline does not read. */
    detailsKeptCount: number;
}

/** Plan every note of a book. Reads the settings for the scene template and property mappings only. */
export async function planBookTransfer(input: {
    document: TransferDocument;
    releasedText: readonly TransferReleasedText[];
    settings: RadialTimelineSettings;
}): Promise<BookTransferPlan> {
    const { document, settings } = input;
    const released = new Map(input.releasedText.map(text => [text.sceneId, text]));
    const width = sceneNumberWidth(document.scenes);
    const notes: PlannedSceneNote[] = [];
    let detailsKeptCount = 0;

    for (const scene of document.scenes) {
        const { lines, detailKept } = sceneFrontmatterLines(scene, settings);
        if (detailKept) detailsKeptCount += 1;
        const text = released.get(scene.id);
        const body = text ? sceneBlocksToMarkdown(text.blocks) : '';
        const content = completeImportedScene(`---\n${lines.join('\n')}\n---\n\n${body ? `${body}\n` : ''}`, settings);
        let state: PlannedSceneNote['text'] = 'none';
        if (text) {
            const readBack = sceneBlocksFromNote(content);
            const exact = sceneTextJson(readBack) === sceneTextJson(text.blocks) && await sceneTextHash(readBack) === text.textHash;
            state = exact ? 'exact' : 'differs';
        }
        notes.push({ sceneId: scene.id, fileName: `${transferNoteName(scene, width)}.md`, content, text: state });
    }

    return {
        title: document.book.title,
        notes,
        releasedTextCount: notes.filter(note => note.text !== 'none').length,
        textDiffersCount: notes.filter(note => note.text === 'differs').length,
        detailsKeptCount,
    };
}
