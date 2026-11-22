/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import type { BookProfile } from '../types/settings';
import { createBookId, getOverlappingBook, normalizeBookProfile } from '../utils/books';

/**
 * Add a book for a folder and make it the timeline's book: how an import's new
 * folder, a folder that is already a Radial Timeline book, or a book made from
 * Community joins Book Manager. A caller that has already told Community the
 * book's id passes that `id`; every other book gets a new one.
 */
export async function addBookToManager(
    plugin: RadialTimelinePlugin,
    fields: Pick<BookProfile, 'title' | 'sourceFolder'> & Partial<Pick<BookProfile, 'id' | 'genre' | 'projectStage'>>
): Promise<BookProfile> {
    const inside = getOverlappingBook(plugin.settings.books, fields.sourceFolder);
    if (inside) throw new Error(t('ui.onboardingModal.containsRegisteredBook', { title: inside.title }));
    const newBook = normalizeBookProfile({ ...fields, id: fields.id ?? createBookId() }); // SAFE: only a book Community already knows by id brings its own
    plugin.settings.books = [...(plugin.settings.books ?? []), newBook]; // SAFE: the first book seeds an empty list
    await plugin.persistBookSettings();
    await plugin.setActiveBookId(newBook.id);
    return newBook;
}
