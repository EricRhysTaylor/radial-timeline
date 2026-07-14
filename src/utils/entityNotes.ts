/*
 * Entity notes — Character and Place note construction.
 *
 * Formalizes `Class: Character` and `Class: Place` as first-class RT note types
 * (previously an author-side convention only). This module is the single source
 * of truth for their YAML templates, body scaffolds, and folder placement —
 * consumed by both the Create-RT-note flow and manuscript onboarding.
 *
 * Templates are distilled from the author-convention originals (description,
 * characteristics, motivations, summary) with series-specific fields removed.
 * Sections are intentionally left blank for the author: a hallucinated
 * character description is worse than an empty one.
 *
 * Folder convention: entity folders sit PARALLEL to the book folder
 * (`Character/`, `Place/` as siblings), mirroring the author-vault layout —
 * not nested inside the book's scene folder.
 */

import { normalizePath } from 'obsidian';

export type EntityKind = 'character' | 'place';

const CHARACTER_YAML = `Class: Character
Book: {{Book}}
Scene Count: {{SceneCount}}
Place:
Support Files:`;

const PLACE_YAML = `Class: Place
Book: {{Book}}
Scene Count: {{SceneCount}}`;

const CHARACTER_BODY = `NAME — role or position
*"A line that carries the voice."*

# Description


##### Habits & Mannerisms


##### Status


## Motivations

##### External (Wants)


##### Internal (Needs)


## Obstacles & Contradictions


# Change

### Begins As


### Ends As


# Summary
`;

const PLACE_BODY = `*"A line that gives the place its voice."*

## Description


##### Layout


##### Unique Features


##### Role in Story


# History

##### Timeline


# Summary
`;

export interface EntityNoteContext {
    /** Book title written into the `Book:` field ('' leaves it blank). */
    book: string;
    /** Number of scenes linking this entity (0 for a hand-created note). */
    sceneCount: number;
}

/** Full note content (frontmatter + body scaffold) for a new entity note. */
export function buildEntityNoteContent(kind: EntityKind, context: EntityNoteContext): string {
    const yaml = (kind === 'character' ? CHARACTER_YAML : PLACE_YAML)
        .replace(/{{Book}}/g, context.book.trim())
        .replace(/{{SceneCount}}/g, String(Math.max(0, Math.floor(context.sceneCount))));
    const body = kind === 'character' ? CHARACTER_BODY : PLACE_BODY;
    return `---\n${yaml}\n---\n\n${body}`;
}

/**
 * Folder for entity notes: a sibling of the book folder named `Character` or
 * `Place` (singular, matching the author-vault convention).
 */
export function entityFolderFor(bookFolder: string, kind: EntityKind): string {
    const normalized = normalizePath((bookFolder || '').trim());
    const idx = normalized.lastIndexOf('/');
    const parent = idx === -1 ? '' : normalized.slice(0, idx);
    const name = kind === 'character' ? 'Character' : 'Place';
    return parent ? `${parent}/${name}` : name;
}
