import { kebabSlug } from './slug';
import { systemFolderPath } from './systemFolder';

export type AprFrequency = 'manual' | 'daily' | 'weekly' | 'monthly';
export type AprExportFormat = 'png' | 'svg';
export type AprExportQuality = 'standard' | 'ultra' | 'print';

/**
 * APR Path Schema v2
 * ═══════════════════════════════════════════════════════════════
 * Book scoping is handled ONLY in the folder path, never in the filename.
 *
 * Folder structure:
 *   Default/Core:  Radial Timeline/Social/{bookSlug}/
 *   Campaigns:     Radial Timeline/Social/{bookSlug}/campaigns/
 *
 * Filename schema:
 *   apr-{campaignSlug}-{mode}-{quality}{-teaser}.{format}
 *
 * Where:
 *   {campaignSlug} = slugified campaign name (use "default" for core report)
 *   {mode}         = manual | auto-daily | auto-weekly | auto-monthly
 *   {quality}      = standard | ultra | print
 *   {-teaser}      = suffix only if teaser enabled (campaigns only)
 *   {format}       = png | svg
 *
 * Examples:
 *   Core:     Radial Timeline/Social/my-novel/apr-default-manual-standard.png
 *   Campaign: Radial Timeline/Social/my-novel/campaigns/apr-kickstarter-auto-weekly-ultra-teaser.png
 */

function formatAprMode(updateFrequency: AprFrequency): string {
    if (updateFrequency === 'manual') return 'manual';
    return `auto-${updateFrequency}`;
}

const EXPORT_FORMATS: AprExportFormat[] = ['png', 'svg'];

export function normalizeAprExportFormat(value: unknown): AprExportFormat {
    if (typeof value !== 'string') return 'png';
    const normalized = value.toLowerCase();
    return EXPORT_FORMATS.includes(normalized as AprExportFormat) ? normalized as AprExportFormat : 'png';
}

/** APR artwork root — the Social subfolder of the canonical system folder. */
const SOCIAL_ROOT = systemFolderPath('Social');

/** Id of the Default report, the one report every vault has. */
export const DEFAULT_REPORT_ID = 'default';

/** The fields of a report that decide its file name. */
export interface AprReportPathFields {
    id: string;
    name: string;
    updateFrequency: AprFrequency;
    aprExportQuality: AprExportQuality;
    exportFormat: AprExportFormat;
    teaserReveal: { enabled: boolean };
}

/**
 * The vault path a report publishes to. This is the only place the path is
 * decided: it follows the report's own settings and its book, so it is derived
 * each time and never stored.
 */
export function buildReportEmbedPath(report: AprReportPathFields, bookTitle: string): string {
    const bookSlug = kebabSlug(bookTitle, 'book');
    const mode = formatAprMode(report.updateFrequency);
    const format = normalizeAprExportFormat(report.exportFormat);
    if (report.id === DEFAULT_REPORT_ID) {
        return `${SOCIAL_ROOT}/${bookSlug}/apr-default-${mode}-${report.aprExportQuality}.${format}`;
    }
    const campaignSlug = kebabSlug(report.name, 'campaign');
    const teaserSuffix = report.teaserReveal.enabled ? '-teaser' : '';
    return `${SOCIAL_ROOT}/${bookSlug}/campaigns/apr-${campaignSlug}-${mode}-${report.aprExportQuality}${teaserSuffix}.${format}`;
}
