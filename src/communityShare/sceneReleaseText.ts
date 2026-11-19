/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The text of a scene as it leaves the vault for a private release
 * (Settings → Community → Private scenes): the only shapes the website stores,
 * the parse that makes them, the limits the website enforces and the hash it
 * reports back.
 *
 * Pure: no vault, no network, no settings. A note's text goes in and blocks
 * come out, so the preview dialog can show the very blocks that are sent.
 *
 * `parsePastedScene` and the helpers above it mirror the Community website's
 * `parsePastedScene` (`lib/scene-text.ts`), so a scene reads the same whether
 * it was pasted on the website or released from here. The platform's
 * `_shared/scene-text.ts` holds the same block shapes and checks them; it has
 * no parse. Change them together.
 */

import type { ManuscriptExportCleanupOptions } from '../types';
import { stripFrontmatter } from '../utils/frontmatterDocument';
import { sanitizeCompiledManuscript } from '../utils/manuscriptSanitize';

export type SceneRun = string | { em: string };
export type SceneBlock = { kind: 'p'; runs: SceneRun[] } | { kind: 'break' };

/** The website's limits (`scene-release-sync`). Checked here before Release is offered. */
export const SCENE_MAX_WORDS = 10_000;
export const SCENE_MAX_BLOCKS = 4_000;
export const SCENE_MAX_RUNS = 400;
export const SCENE_MAX_PARAGRAPH_CHARS = 20_000;
export const SCENE_MAX_BYTES = 393_216;

/**
 * Each C0 control, DEL and Unicode line or paragraph separator becomes a space:
 * none belongs on a reader's page. Checked by character, not with a regular
 * expression, because a control-character class is flagged by Obsidian's
 * community review.
 */
function spaceControls(text: string): string {
    let out = '';
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        out += code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029 ? ' ' : ch;
    }
    return out;
}
const BYTE_ORDER_MARK = new RegExp('^\\uFEFF');
const NO_BREAK_SPACE = new RegExp('\\u00A0', 'g');
const BREAK_LINE = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|#|\*|⁂|~{3,})$/;
// *italic* anywhere, _italic_ only at word edges (so snake_case survives).
const ITALIC = /\*([^*\s](?:[^*]*[^*\s])?)\*|(?<![\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}])/gu;

export function sceneBlockText(block: SceneBlock): string {
    return block.kind === 'break' ? '' : block.runs.map(run => (typeof run === 'string' ? run : run.em)).join('');
}

export function sceneWordCount(blocks: readonly SceneBlock[]): number {
    let words = 0;
    for (const block of blocks) {
        const text = sceneBlockText(block).trim();
        if (text) words += text.split(/\s+/).length;
    }
    return words;
}

function paragraphRuns(line: string): SceneRun[] {
    // Bold has no place in the two run shapes: its markers go, its words stay.
    const text = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    const runs: SceneRun[] = [];
    let last = 0;
    for (const match of text.matchAll(ITALIC)) {
        const index = match.index ?? 0; // SAFE: matchAll always sets index; the type allows undefined
        if (index > last) runs.push(text.slice(last, index));
        runs.push({ em: match[1] ?? match[2] }); // SAFE: the pattern's two alternatives; exactly one group matched
        last = index + match[0].length;
    }
    if (last < text.length) runs.push(text.slice(last));
    return runs;
}

export function parsePastedScene(input: string): SceneBlock[] {
    let text = input.replace(BYTE_ORDER_MARK, '').replace(/\r\n?/g, '\n');
    text = text.replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');
    // A comment the author never closed runs to the end of the text, as
    // Obsidian shows it, and an HTML comment also ends at `--!>`. Repeat until
    // nothing changes: removing one comment can join the pieces around it into
    // a new one, such as `<!<!-- -->-- PRIVATE -->`.
    let previous: string;
    do {
        previous = text;
        text = text.replace(/%%[\s\S]*?(?:%%|$)/g, '').replace(/<!--[\s\S]*?(?:--!?>|$)/g, '');
    } while (text !== previous);
    const blocks: SceneBlock[] = [];
    for (const raw of text.split('\n')) {
        const line = spaceControls(raw).replace(NO_BREAK_SPACE, ' ').trim();
        if (!line) continue;
        if (BREAK_LINE.test(line)) {
            if (blocks.length && blocks[blocks.length - 1].kind !== 'break') blocks.push({ kind: 'break' });
            continue;
        }
        const runs = paragraphRuns(line.replace(/^#{1,6}\s+/, ''));
        if (runs.length) blocks.push({ kind: 'p', runs });
    }
    if (blocks.length && blocks[blocks.length - 1].kind === 'break') blocks.pop();
    return blocks;
}

// Nothing but the scene's prose is released, so every cleanup is on, as it is
// for the runtime estimate: comments, author queries, links, callouts, block ids.
const RELEASE_CLEANUP: ManuscriptExportCleanupOptions = {
    stripComments: true,
    stripAiComments: true,
    stripLinks: true,
    stripCallouts: true,
    stripBlockIds: true,
};

/**
 * One scene note, as the blocks a release sends: YAML removed, then the
 * manuscript sanitizer with every cleanup on, then the website's own parse.
 *
 * The note's YAML is gone before the parse, so a `---` that opens the cleaned
 * text is the author's scene break. The leading line break keeps the parse from
 * reading it as the start of a YAML block and dropping the text down to the
 * next `---`.
 */
export function sceneBlocksFromNote(noteContent: string): SceneBlock[] {
    const body = stripFrontmatter(noteContent.replace(BYTE_ORDER_MARK, ''));
    return parsePastedScene(`\n${sanitizeCompiledManuscript(body, RELEASE_CLEANUP)}`);
}

/** The text exactly as it is sent and as the website hashes it: `kind` before `runs`, an italic run as `{ em }`. */
export function sceneTextJson(blocks: readonly SceneBlock[]): string {
    return JSON.stringify(blocks);
}

/**
 * The hash the website reports for a release: SHA-256, lowercase hex, of the
 * UTF-8 bytes of the sent JSON. Computed in the vault from the vault's own
 * text, so "changed since release" needs nothing sent.
 */
export async function sceneTextHash(blocks: readonly SceneBlock[]): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sceneTextJson(blocks)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export type SceneTextProblem = 'empty' | 'too_many_words' | 'too_large';

/**
 * Why the website would refuse this text, or null when it fits: no words left
 * after cleaning, more than SCENE_MAX_WORDS words, or past one of the size
 * limits (blocks, runs in a paragraph, characters in a paragraph, bytes).
 */
export function sceneTextProblem(blocks: readonly SceneBlock[]): SceneTextProblem | null {
    const words = sceneWordCount(blocks);
    if (words === 0) return 'empty';
    if (words > SCENE_MAX_WORDS) return 'too_many_words';
    if (blocks.length > SCENE_MAX_BLOCKS) return 'too_large';
    for (const block of blocks) {
        if (block.kind !== 'p') continue;
        if (block.runs.length > SCENE_MAX_RUNS || sceneBlockText(block).length > SCENE_MAX_PARAGRAPH_CHARS) return 'too_large';
    }
    return new TextEncoder().encode(sceneTextJson(blocks)).length > SCENE_MAX_BYTES ? 'too_large' : null;
}
