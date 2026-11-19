/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * What the batch release shows of each scene before anything is sent: its
 * opening and closing lines, and any passage that reads like a note to the
 * author rather than prose. Pure: works on the cleaned text, the blocks that
 * would be sent, so it judges exactly what readers would see.
 *
 * The cleanup has already removed comments, links, callouts and block ids. What
 * it can't tell from prose is text the author typed in the body for themselves:
 * a placeholder, a bracketed reminder, a pasted web address. Those are what this
 * looks for. A false alarm costs a glance; a missed one is a note readers see.
 */

import { sceneBlockText, type SceneBlock } from '../communityShare/sceneReleaseText';

const EXCERPT_CHARS = 140;
const SNIPPET_CHARS = 80;

/** A line cut at a word near `max`, with an ellipsis when cut. */
function clip(text: string, max: number): string {
    const line = text.replace(/\s+/g, ' ').trim();
    if (line.length <= max) return line;
    const cut = line.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function paragraphs(blocks: readonly SceneBlock[]): string[] {
    return blocks.map(sceneBlockText).map(text => text.trim()).filter(Boolean);
}

/** The scene's first line and, when it has more than one paragraph, its last. */
export function sceneExcerpt(blocks: readonly SceneBlock[]): { first: string; last: string | null } | null {
    const lines = paragraphs(blocks);
    if (lines.length === 0) return null;
    return {
        first: clip(lines[0], EXCERPT_CHARS),
        last: lines.length > 1 ? clip(lines[lines.length - 1], EXCERPT_CHARS) : null,
    };
}

/**
 * Patterns that read as a note to the author. Placeholders are matched in
 * capitals only, as writers type them, so "tk" in a word or a character saying
 * "todo" is left alone.
 */
const NOTE_PATTERNS: readonly RegExp[] = [
    /\b(?:TODO|TBD|FIXME|XXX|TK)\b/,
    /\[[^\]\n]{1,200}\]/,
    /\{\{|\}\}/,
    /\bhttps?:\/\/\S+|\bwww\.\S+/i,
    /^(?:note|notes|todo|fixme|research|check|question|fix)\s*:/i,
];

/** The first match in a paragraph, with a little of the text around it. */
function noteIn(text: string): string | null {
    for (const pattern of NOTE_PATTERNS) {
        const match = pattern.exec(text);
        if (!match) continue;
        const start = Math.max(0, match.index - 20);
        const around = text.slice(start, match.index + match[0].length + 40);
        return `${start > 0 ? '…' : ''}${clip(around, SNIPPET_CHARS)}`;
    }
    return null;
}

/**
 * Passages that look like notes, not prose: the first one quoted, and how many
 * more paragraphs have one. Null when the scene reads as prose throughout.
 */
export function noteLikeText(blocks: readonly SceneBlock[]): { snippet: string; more: number } | null {
    const found = paragraphs(blocks).flatMap(text => {
        const snippet = noteIn(text);
        return snippet ? [snippet] : [];
    });
    if (found.length === 0) return null;
    return { snippet: found[0], more: found.length - 1 };
}
