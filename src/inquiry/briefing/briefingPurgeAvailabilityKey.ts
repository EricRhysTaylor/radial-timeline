/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { InquiryScope } from '../state';

/**
 * Structural subset of an inquiry corpus scene that the key builder needs.
 * Kept narrow so the pure helper does not couple to the full
 * `InquiryCorpusScene` shape and remains trivially testable.
 */
export interface BriefingPurgeKeyScene {
    readonly filePath?: string;
    readonly displayLabel?: string;
}

export interface BriefingPurgeKeyInput {
    readonly scenes: ReadonlyArray<BriefingPurgeKeyScene>;
    readonly scope: InquiryScope;
    readonly activeBookId?: string;
    /** Label of the YAML field where action notes get written. */
    readonly actionNotesFieldLabel: string;
}

/**
 * Build a stable cache key that identifies the current "is there anything to
 * purge?" scan target. The key changes whenever the corpus scene set, scope,
 * active book, or action-notes field changes — i.e. whenever a prior cached
 * availability decision could be stale.
 *
 * Returns `''` for an empty corpus, which the caller treats as "nothing to
 * scan, nothing to purge."
 *
 * Format: `<scope>::<activeBookId>::<fieldLabel>::<scene1scene2…>`.
 * The unit-separator (U+001F) between scene identifiers avoids accidental
 * collisions with paths or labels containing the outer delimiter.
 */
export function buildBriefingPurgeAvailabilityKey(input: BriefingPurgeKeyInput): string {
    if (!input.scenes.length) return '';
    const sceneKey = input.scenes
        .map(scene => scene.filePath || scene.displayLabel || '')
        .join('');
    return [
        input.scope,
        input.activeBookId ?? '',
        input.actionNotesFieldLabel,
        sceneKey
    ].join('::');
}
