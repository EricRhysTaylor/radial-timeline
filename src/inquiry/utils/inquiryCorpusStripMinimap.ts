/**
 * Pure data-model helpers for the corpus-strip + minimap renderers,
 * extracted from InquiryView. DOM construction, SVG, classList
 * toggles, vault/file resolution, and the impure `corpusService` /
 * `app.vault` reads all stay in the view or the existing renderer
 * modules — this module is i18n-free and side-effect-free.
 */
import type { InquiryCorpusItem } from '../services/InquiryCorpusResolver';
import type { SceneInclusion } from '../../types/settings';
import { getCorpusClassShort } from './inquiryViewText';
import { SIGMA_CHAR } from '../constants/inquiryUi';

/**
 * File path for a corpus item, used by the minimap to look up
 * file-backed metadata. Resolves the scene's own `filePath`, falling
 * back to a book's `rootPath`, then the first entry of `filePaths`.
 * Returns undefined when nothing usable is on the item. Pure.
 */
export function getMinimapItemFilePath(item: InquiryCorpusItem): string | undefined {
    const scenePath = (item as { filePath?: string }).filePath;
    if (scenePath) return scenePath;
    const bookPath = (item as { rootPath?: string }).rootPath;
    if (bookPath) return bookPath;
    return item.filePaths?.[0];
}

/**
 * Display metadata for a corpus-strip header pill, keyed by the
 * scene-inclusion mode. `isActive` indicates whether the mode counts
 * a class as "live" for the strip's counters and styling.
 */
export function getCorpusCcModeMeta(mode: SceneInclusion): {
    label: string;
    short: string;
    icon: string;
    isActive: boolean;
} {
    if (mode === 'summary') {
        return { label: 'Summary', short: 'SUM', icon: 'circle-dot', isActive: true };
    }
    if (mode === 'full') {
        return { label: 'Full Scene', short: 'FULL', icon: 'disc', isActive: true };
    }
    return { label: 'Exclude', short: 'EXCL', icon: 'circle', isActive: false };
}

/**
 * Header label for a corpus-strip class group. An explicit
 * `overrideLabel` (when truthy after trim) wins; the saga-outline
 * class uses the SIGMA glyph; everything else uses the class shorthand
 * followed by the count.
 */
export function getCorpusCcHeaderLabel(
    className: string,
    count: number,
    overrideLabel?: string
): string {
    if (overrideLabel && overrideLabel.trim().length > 0) {
        return overrideLabel.trim();
    }
    if (className === 'outline-saga') {
        return `${SIGMA_CHAR}`;
    }
    return `${getCorpusClassShort(className)}${count}`;
}

/**
 * Human-readable display name for a corpus class — used by the
 * corpus-strip tooltip when no override label is supplied.
 */
export function getCorpusCcHeaderDisplayLabel(className: string): string {
    if (className === 'outline-saga') return 'Saga Outline';
    if (className === 'character') return 'Character';
    if (className === 'scene') return 'Scene';
    if (className === 'outline') return 'Outline';
    return 'Class';
}

/**
 * Tooltip text for a corpus-strip class header. Uses the mode-meta
 * label and falls back to the class display label when no override
 * is supplied; the count joins on `' · '` only when the class is
 * active or actually has items.
 */
export function getCorpusCcHeaderTooltip(
    className: string,
    mode: SceneInclusion,
    count: number,
    overrideLabel?: string
): string {
    const meta = getCorpusCcModeMeta(mode);
    const label = (overrideLabel && overrideLabel.trim().length > 0)
        ? overrideLabel.trim()
        : getCorpusCcHeaderDisplayLabel(className);
    const parts = [label, meta.label];
    if (meta.isActive || count > 0) {
        parts.push(String(count));
    }
    return parts.join(' · ');
}
