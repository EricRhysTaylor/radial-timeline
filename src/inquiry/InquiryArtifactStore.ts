import { App, DataAdapter, normalizePath } from 'obsidian';
import type { InquirySession } from './sessionTypes';
import type { InquiryVaultIdentity } from './sessionArtifact';
import { parseSessionArtifact, parseSessionArtifactVault, serializeSessionsToArtifact } from './sessionArtifact';
import { systemFolderPath } from '../utils/systemFolder';

/**
 * Vault-resident persistence for inquiry sessions — the single source of truth
 * for brief content. Lives in a NORMAL VISIBLE folder next to the briefs
 * (`Radial Timeline/Inquiry/`) so authors can see it in Finder and the Obsidian
 * explorer and verify what a (demo) vault actually ships.
 *
 * IO still goes through the low-level data adapter (`vaultIo()`), not the TFile
 * API: this is a frequently-rewritten machine artifact (.json), and the adapter
 * sidesteps metadata-cache/index timing races on rapid writes. Same single
 * chokepoint as before. Pre-2026-06 vaults kept this file in the hidden
 * `.radial-timeline/` dotfolder; see LEGACY_* + migrateInquirySidecarToVisible.
 */
export const INQUIRY_SIDECAR_DIR = systemFolderPath('Inquiry', 'Sessions');
export const INQUIRY_SIDECAR_PATH = `${INQUIRY_SIDECAR_DIR}/sessions.json`;

// Pre-2026-06 hidden location. Read as a fallback and one-time migrated to the
// visible path on load so existing vaults never lose their sessions.
export const LEGACY_INQUIRY_SIDECAR_DIR = '.radial-timeline/inquiry';
export const LEGACY_INQUIRY_SIDECAR_PATH = `${LEGACY_INQUIRY_SIDECAR_DIR}/sessions.json`;
const LEGACY_INQUIRY_SIDECAR_ROOT = '.radial-timeline';

function vaultIo(app: App): DataAdapter {
    return app.vault.adapter; // SAFE: frequently-rewritten .json artifact; adapter avoids index races
}

export async function readInquirySessionsFromVault(app: App): Promise<InquirySession[]> {
    const io = vaultIo(app);
    const newPath = normalizePath(INQUIRY_SIDECAR_PATH);
    const legacyPath = normalizePath(LEGACY_INQUIRY_SIDECAR_PATH);
    // Prefer the visible file; fall back to the hidden legacy path so reads work
    // before migration runs. SAFE: optional external input — absent on a fresh or
    // never-run vault, which is a meaningful empty default, not a failure.
    const path = (await io.exists(newPath))
        ? newPath
        : (await io.exists(legacyPath)) ? legacyPath : null;
    if (!path) return [];
    const raw = await io.read(path);
    const sessions = parseSessionArtifact(raw);
    if (sessions === null) {
        console.error(
            `[RadialTimeline] Inquiry sidecar at ${path} is corrupt or an unknown schema version; ignoring it.`
        );
        return [];
    }
    return sessions;
}

export async function hasInquirySessionSidecarInVault(app: App): Promise<boolean> {
    const io = vaultIo(app);
    return (await io.exists(normalizePath(INQUIRY_SIDECAR_PATH)))
        || io.exists(normalizePath(LEGACY_INQUIRY_SIDECAR_PATH));
}

export async function writeInquirySessionsToVault(
    app: App,
    sessions: InquirySession[],
    vault?: InquiryVaultIdentity
): Promise<void> {
    const io = vaultIo(app);
    const dir = normalizePath(INQUIRY_SIDECAR_DIR);
    if (!(await io.exists(dir))) {
        await io.mkdir(dir);
    }
    const artifact = serializeSessionsToArtifact(sessions, Date.now(), vault);
    await io.write(normalizePath(INQUIRY_SIDECAR_PATH), JSON.stringify(artifact, null, 2));
}

/**
 * Read just the stamped Book-Profile identity from the sidecar (visible path,
 * legacy fallback). Lets the Welcome screen name a detected demo vault from the
 * file the author already produced via Save Session State — no manifest needed.
 * Returns null when there's no sidecar or it carries no identity.
 */
export async function readInquirySidecarVaultIdentity(app: App): Promise<InquiryVaultIdentity | null> {
    const io = vaultIo(app);
    const newPath = normalizePath(INQUIRY_SIDECAR_PATH);
    const legacyPath = normalizePath(LEGACY_INQUIRY_SIDECAR_PATH);
    const path = (await io.exists(newPath))
        ? newPath
        : (await io.exists(legacyPath)) ? legacyPath : null;
    if (!path) return null;
    try {
        return parseSessionArtifactVault(await io.read(path));
    } catch {
        return null;
    }
}

/**
 * One-time move of the sessions sidecar out of the hidden `.radial-timeline/`
 * dotfolder into the visible `Radial Timeline/Inquiry/Sessions/` folder. Runs on
 * load. No-op once migrated, when there's nothing to move, or if the visible
 * file already exists (never overwrites it). Validates before moving so a
 * corrupt legacy file is left in place, not promoted. Copy-then-delete so the
 * hidden original is actually gone afterward (best-effort cleanup of the now
 * empty parent dotfolders).
 */
export async function migrateInquirySidecarToVisible(app: App): Promise<void> {
    const io = vaultIo(app);
    const newPath = normalizePath(INQUIRY_SIDECAR_PATH);
    const legacyPath = normalizePath(LEGACY_INQUIRY_SIDECAR_PATH);
    if (await io.exists(newPath)) return;
    if (!(await io.exists(legacyPath))) return;

    let raw: string;
    try {
        raw = await io.read(legacyPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[RadialTimeline] Could not read legacy inquiry sidecar for migration: ${message}`);
        return;
    }
    if (parseSessionArtifact(raw) === null) {
        console.error('[RadialTimeline] Legacy inquiry sidecar is corrupt; leaving it in place, not migrating.');
        return;
    }

    const dir = normalizePath(INQUIRY_SIDECAR_DIR);
    if (!(await io.exists(dir))) {
        await io.mkdir(dir);
    }
    await io.write(newPath, raw);

    // The visible copy is now authoritative — remove the hidden original and its
    // now-empty parent dotfolders. Best-effort: rmdir fails (and is ignored) if
    // the dotfolder still holds other files.
    try {
        await io.remove(legacyPath);
        await io.rmdir(normalizePath(LEGACY_INQUIRY_SIDECAR_DIR), false);
        await io.rmdir(normalizePath(LEGACY_INQUIRY_SIDECAR_ROOT), false);
    } catch {
        /* hidden leftovers are harmless; the visible file is the source of truth */
    }
}
