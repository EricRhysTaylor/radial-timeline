import { systemFolderPath } from './systemFolder';

export type AprSize = 'small' | 'medium' | 'large';
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
 *   {quality}      = standard | ultra
 *   {-teaser}      = suffix only if teaser enabled
 *   {format}       = png | svg
 *
 * Examples:
 *   Core:     Radial Timeline/Social/my-novel/apr-default-manual-standard.png
 *   Campaign: Radial Timeline/Social/my-novel/campaigns/apr-kickstarter-auto-weekly-ultra-teaser.png
 *
 * Legacy format (still matched for migration):
 *   apr-{campaignSlug}-{mode}-{size}.{format}  (size = thumb|small|medium|large)
 */

export function slugify(value: string | undefined, fallback: string): string {
    const cleaned = (value ?? '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || fallback;
}

function formatAprMode(updateFrequency?: AprFrequency): string {
    if (!updateFrequency || updateFrequency === 'manual') return 'manual';
    return `auto-${updateFrequency}`;
}

function resolveQuality(quality?: AprExportQuality): AprExportQuality {
    return quality ?? 'standard';
}

const EXPORT_FORMATS: AprExportFormat[] = ['png', 'svg'];

export function normalizeAprExportFormat(value: unknown): AprExportFormat {
    if (typeof value !== 'string') return 'png';
    const normalized = value.toLowerCase();
    return EXPORT_FORMATS.includes(normalized as AprExportFormat) ? normalized as AprExportFormat : 'png';
}

/** APR artwork root — the Social subfolder of the canonical system folder. */
const SOCIAL_ROOT = systemFolderPath('Social');

/**
 * Builds the embed path for the default/core APR report.
 */
export function buildDefaultEmbedPath(options: {
    bookTitle?: string;
    updateFrequency?: AprFrequency;
    aprExportQuality?: AprExportQuality;
    /** @deprecated Use aprExportQuality instead. Accepted for backwards compat. */
    aprSize?: AprSize;
    exportFormat?: AprExportFormat;
}): string {
    const bookSlug = slugify(options.bookTitle, 'book');
    const mode = formatAprMode(options.updateFrequency);
    const quality = resolveQuality(options.aprExportQuality);
    const format = normalizeAprExportFormat(options.exportFormat);
    return `${SOCIAL_ROOT}/${bookSlug}/apr-default-${mode}-${quality}.${format}`;
}

/**
 * Builds the embed path for a campaign APR report.
 */
export function buildCampaignEmbedPath(options: {
    bookTitle?: string;
    campaignName: string;
    updateFrequency?: AprFrequency;
    aprExportQuality?: AprExportQuality;
    /** @deprecated Use aprExportQuality instead. Accepted for backwards compat. */
    aprSize?: AprSize;
    fallbackSize?: AprSize;
    teaserEnabled?: boolean;
    exportFormat?: AprExportFormat;
}): string {
    const bookSlug = slugify(options.bookTitle, 'book');
    const campaignSlug = slugify(options.campaignName, 'campaign');
    const mode = formatAprMode(options.updateFrequency);
    const quality = resolveQuality(options.aprExportQuality);
    const teaserSuffix = options.teaserEnabled ? '-teaser' : '';
    const format = normalizeAprExportFormat(options.exportFormat);
    return `${SOCIAL_ROOT}/${bookSlug}/campaigns/apr-${campaignSlug}-${mode}-${quality}${teaserSuffix}.${format}`;
}
