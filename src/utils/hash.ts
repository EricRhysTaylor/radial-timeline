/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Non-cryptographic 32-bit FNV-1a. One algorithm; two hex spellings, because
 * both are persisted and compared across runs:
 *
 * - `fnv1a32Hex` zero-pads to 8 digits. Scene and book anchor ids
 *   (`scn_…`, `book_…`) and Anthropic dispatch fingerprints use it.
 * - `fnv1a32HexUnpadded` does not pad. Provider cache keys and the
 *   cacheable-prefix fingerprint in Inquiry logs were written this way;
 *   padding them would invalidate stored keys for roughly one text in
 *   sixteen and make existing logs read as "prefix changed".
 *
 * Do not add a third spelling.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(text: string): number {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
    }
    return hash >>> 0;
}

export function fnv1a32Hex(text: string): string {
    return fnv1a32(text).toString(16).padStart(8, '0');
}

export function fnv1a32HexUnpadded(text: string): string {
    return fnv1a32(text).toString(16);
}
