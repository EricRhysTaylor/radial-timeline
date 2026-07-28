/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
/**
 * Typed access to the binary assets embedded in `main.js`.
 *
 * Obsidian's plugin installer downloads only `manifest.json`, `main.js` and
 * `styles.css` from a release. Anything else — fonts, the Word reference
 * document, images — never reaches a user who installed through the Community
 * Plugins browser, no matter what the build copies into `./release/`.
 *
 * So the plugin carries those bytes itself. `scripts/embed-plugin-assets.mjs`
 * base64-encodes each file at build time into `src/generated/embeddedAssets.ts`;
 * this module is the only place that decodes them.
 *
 * Consumers get bytes (to write into the vault) or a data URI (to hand to an
 * `<img src>` / SVG `href`). Nothing reads a loose file from the plugin folder.
 */
import { EMBEDDED_ASSETS, type EmbeddedAssetKey } from '../generated/embeddedAssets';

export type { EmbeddedAssetKey };

/**
 * Decoded bytes for an embedded asset.
 *
 * Throws when the key is absent. That can only happen if the generated module
 * drifted from its callers, which is a build defect, not a runtime condition —
 * failing loudly here beats writing a zero-byte font into a user's vault.
 */
export function getEmbeddedAssetBytes(key: EmbeddedAssetKey): Buffer {
    const asset = EMBEDDED_ASSETS[key];
    if (!asset) {
        throw new Error(`Embedded asset not found: ${key}. The plugin build is incomplete.`);
    }
    const bytes = Buffer.from(asset.base64, 'base64');
    if (bytes.length !== asset.bytes) {
        throw new Error(
            `Embedded asset ${key} decoded to ${bytes.length} bytes, expected ${asset.bytes}. ` +
            `The plugin build is corrupt.`
        );
    }
    return bytes;
}

/** Expected decoded size, for verifying a file after it is written to disk. */
export function getEmbeddedAssetByteLength(key: EmbeddedAssetKey): number {
    const asset = EMBEDDED_ASSETS[key];
    if (!asset) {
        throw new Error(`Embedded asset not found: ${key}. The plugin build is incomplete.`);
    }
    return asset.bytes;
}

/**
 * `data:` URI for an embedded asset, for image consumers that previously
 * resolved a plugin-folder path via `vault.adapter.getResourcePath`.
 */
export function getEmbeddedAssetDataUri(key: EmbeddedAssetKey): string {
    const asset = EMBEDDED_ASSETS[key];
    if (!asset) {
        throw new Error(`Embedded asset not found: ${key}. The plugin build is incomplete.`);
    }
    return `data:${asset.mime};base64,${asset.base64}`;
}

/** Whether a key is present in this build. Used by diagnostics, not by hot paths. */
export function hasEmbeddedAsset(key: string): key is EmbeddedAssetKey {
    return Object.prototype.hasOwnProperty.call(EMBEDDED_ASSETS, key);
}
