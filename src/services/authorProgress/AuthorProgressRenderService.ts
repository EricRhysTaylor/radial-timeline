import { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { createAprSVG } from '../../renderer/apr/AprRenderer';
import { getExportPreset } from '../../renderer/apr/aprPresets';
import type { AuthorProgressCampaign, AuthorProgressDefaults, AprExportQuality } from '../../types/settings';
import { AprProgressService } from '../apr/AprProgressService';
import { AprStyleService } from '../apr/AprStyleService';
import { getTeaserThresholds, getTeaserRevealLevel, teaserLevelToRevealOptions } from '../../renderer/apr/AprConstants';
import { hasProFeatureAccess } from '../../settings/featureGate';
import { isSceneItem } from '../../utils/sceneHelpers';
import { buildDefaultEmbedPath, normalizeAprExportFormat, type AprExportFormat } from '../../utils/aprPaths';
import { resolveBookTitle, resolveProjectPath } from '../../renderer/apr/aprHelpers';
import type { TimelineItem } from '../../types/timeline';
import { writeManagedOutput } from '../../utils/logVaultOps';
import {
    buildFontFaceCss,
    collectSelfContainedFontFaces,
    parseFontFamilyList,
    selectFontFacesForFamilies,
} from '../export/exportFonts';

export interface AuthorProgressReportBuildResult {
    settings: AuthorProgressDefaults;
    svgString: string;
    width: number;
    height: number;
    exportPath: string;
    exportFormat: AprExportFormat;
}

export interface AuthorProgressCampaignBuildResult {
    settings: AuthorProgressDefaults;
    campaign: AuthorProgressCampaign;
    svgString: string;
    width: number;
    height: number;
    meta: {
        format: AprExportFormat;
        size: string;
        stage: string;
        percent: number;
    };
}

export class AuthorProgressRenderService {
    private readonly aprProgressService: AprProgressService;
    private readonly aprStyleService: AprStyleService;

    constructor(private plugin: RadialTimelinePlugin, private app: App) {
        this.aprProgressService = new AprProgressService(plugin);
        this.aprStyleService = new AprStyleService(plugin);
    }

    public calculateProgress(scenes: TimelineItem[]): number {
        return this.aprProgressService.getPercent(scenes);
    }

    public getDefaultExportFormat(settings: AuthorProgressDefaults): AprExportFormat {
        if (typeof settings.exportFormat === 'string' && settings.exportFormat.trim()) {
            return normalizeAprExportFormat(settings.exportFormat);
        }
        return this.pathFormat(settings.exportPath ?? '', 'png');
    }

    public getDefaultExportPath(settings: AuthorProgressDefaults): string {
        return settings.exportPath || buildDefaultEmbedPath({
            bookTitle: this.plugin.getActiveBookTitle(),
            updateFrequency: settings.updateFrequency,
            aprExportQuality: settings.aprExportQuality,
            exportFormat: this.getDefaultExportFormat(settings)
        });
    }

    public getCampaignExportFormat(campaign?: AuthorProgressCampaign): AprExportFormat {
        if (!campaign) return 'png';
        if (typeof campaign.exportFormat === 'string' && campaign.exportFormat.trim()) {
            return normalizeAprExportFormat(campaign.exportFormat);
        }
        return this.pathFormat(campaign.exportPath ?? '', 'png');
    }

    public async saveAprOutput(path: string, format: AprExportFormat, svgString: string, width: number, height: number): Promise<void> {
        await this.ensureFolder(path);
        const embedded = this.embedUsedFontFaces(svgString);
        if (format === 'svg') {
            const result = await writeManagedOutput(this.app, path, embedded, {
                operation: 'author-progress-svg',
                managedMarker: '<!-- Radial Timeline Managed Output: author-progress-svg -->',
                unmanagedOverwritePrompt: (file) => `Overwrite existing author progress SVG "${file.path}"? RT will archive the current SVG to a log snapshot first. Manual edits may be replaced.`
            });
            if (result.skipped) {
                throw new Error('Author progress SVG overwrite cancelled.');
            }
            return;
        }

        const png = await this.svgToPngBuffer(embedded, width, height);
        await this.app.vault.adapter.writeBinary(path, png);
    }

    /**
     * Embed the @font-face data-URI rules for every custom family the APR SVG
     * references, so glyphs render identically in external viewers and during
     * PNG rasterization. The APR renderer emits font-family both as
     * presentation attributes and inside style attributes; families without a
     * self-contained rule in the live CSSOM (system and interface fonts)
     * resolve from the viewer's fallback stack.
     */
    private embedUsedFontFaces(svgString: string): string {
        if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
            return svgString;
        }
        const parsed = new DOMParser().parseFromString(svgString, 'image/svg+xml');
        const root = parsed.documentElement;
        if (!root || root.localName !== 'svg') return svgString;

        const usedFontFamilies = new Set<string>();
        for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
            const attrValue = el.getAttribute('font-family');
            if (attrValue) {
                for (const family of parseFontFamilyList(attrValue)) {
                    usedFontFamilies.add(family);
                }
            }
            const styleMatch = (el.getAttribute('style') ?? '').match(/font-family\s*:\s*([^;]+)/i); // SAFE: an element with no style attribute declares no font-family, and the regex finds none in the empty string
            if (styleMatch) {
                for (const family of parseFontFamilyList(styleMatch[1])) {
                    usedFontFamilies.add(family);
                }
            }
        }

        const fontFaces = selectFontFacesForFamilies(collectSelfContainedFontFaces(activeDocument), usedFontFamilies);
        if (fontFaces.length === 0) return svgString;

        const styleEl = parsed.createElementNS('http://www.w3.org/2000/svg', 'style');
        styleEl.textContent = buildFontFaceCss(fontFaces);
        root.insertBefore(styleEl, root.firstChild);
        return new XMLSerializer().serializeToString(root);
    }

    public buildSnapshotPath(exportPath: string, fallbackBase = 'apr'): string {
        const trimmed = exportPath.trim();
        const lastSlash = trimmed.lastIndexOf('/');
        const folder = lastSlash >= 0 ? trimmed.slice(0, lastSlash) : '';
        const file = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
        const extMatch = file.match(/\.([a-z0-9]+)$/i);
        const ext = (extMatch?.[1] ?? 'png').toLowerCase();
        const base = extMatch ? file.slice(0, -(ext.length + 1)) : file;
        const safeBase = base.trim() || fallbackBase;
        const fileName = `${safeBase}-snapshot-${Date.now()}.${ext}`;
        return folder ? `${folder}/${fileName}` : fileName;
    }

    public async buildDefaultReport(): Promise<AuthorProgressReportBuildResult | null> {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        if (!authorProgress || !settings) return null;

        const projectPath = resolveProjectPath(null, this.plugin.settings.books, this.plugin.settings.sourcePath);
        const scenes = await this.plugin.getSceneData({ sourcePath: projectPath });
        const scenesFiltered = scenes.filter(isSceneItem);
        const progressState = this.aprProgressService.resolveProgress(scenesFiltered, settings);
        // Use the designer style (same source the settings preview reads from) so the published
        // Default Report visually matches what the user sees in the social settings preview.
        const style = this.aprStyleService.resolveDesignerStyle();
        const renderStyle = this.aprStyleService.buildRenderStyle(style);
        const showRtAttribution = hasProFeatureAccess(this.plugin)
            ? renderStyle.showRtAttribution !== false
            : true;

        const designSize = settings.aprSize || 'medium';
        const exportQuality: AprExportQuality = settings.aprExportQuality || 'standard';
        const bookTitle = resolveBookTitle(null, this.plugin.settings.books, this.plugin.getActiveBookTitle());

        // Honor the persisted view mode from social settings (teaser preview dropdown).
        // 'auto' / undefined → full reveal. 'ring'/'scenes'/'colors'/'full' → apply that level.
        const baseReveal = this.resolveBaseRevealOptions(settings.aprDefaultViewMode, settings);
        const ringOnly = settings.aprDefaultViewMode === 'ring';

        const { svgString, width, height } = createAprSVG(scenesFiltered, {
            size: designSize,
            exportPreset: getExportPreset(designSize, exportQuality),
            progressPercent: progressState.percent,
            bookTitle,
            authorName: settings.authorName || '',
            showScenes: ringOnly ? false : baseReveal.showScenes,
            showSubplots: baseReveal.showSubplots,
            showActs: baseReveal.showActs,
            showStatusColors: baseReveal.showStatusColors,
            showStageColors: baseReveal.showStageColors,
            grayCompletedScenes: baseReveal.grayCompletedScenes,
            grayscaleScenes: baseReveal.grayscaleScenes,
            showProgressPercent: ringOnly ? false : baseReveal.showProgressPercent,
            showBranding: !ringOnly,
            centerMark: 'none',
            stageColors: this.plugin.settings.publishStageColors,
            workingPatternId: this.plugin.settings.workingPatternId,
            customWorkingPatterns: this.plugin.settings.customWorkingPatterns,
            actCount: this.plugin.settings.actCount || undefined,
            ...renderStyle,
            publishStageLabel: progressState.displayStage,
            showRtAttribution,
            teaserRevealEnabled: false,
            portableSvg: true
        });

        return {
            settings,
            svgString,
            width,
            height,
            exportPath: this.getDefaultExportPath(settings),
            exportFormat: this.pathFormat(this.getDefaultExportPath(settings), this.getDefaultExportFormat(settings))
        };
    }

    public async buildCampaignReport(campaignId: string): Promise<AuthorProgressCampaignBuildResult | null> {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        if (!authorProgress || !settings) return null;

        const campaign = authorProgress.campaigns?.find(c => c.id === campaignId);
        if (!campaign) return null;

        const books = this.plugin.settings.books;
        const projectPath = resolveProjectPath(campaign, books, this.plugin.settings.sourcePath);
        const scenes = await this.plugin.getSceneData({ sourcePath: projectPath });
        const scenesFiltered = scenes.filter(isSceneItem);
        const progressState = this.aprProgressService.resolveProgress(scenesFiltered, settings);
        const style = this.aprStyleService.resolveStyle(campaign);
        const renderStyle = this.aprStyleService.buildRenderStyle(style);
        const showRtAttribution = hasProFeatureAccess(this.plugin)
            ? renderStyle.showRtAttribution !== false
            : true;

        let showScenes: boolean;
        let showSubplots: boolean;
        let showActs: boolean;
        let showStatusColors: boolean;
        let showStageColors: boolean;
        let grayCompletedScenes: boolean;
        let grayscaleScenes: boolean;
        let showProgressPercent: boolean;
        let isRingLevel = false;
        let debugStage = 'Standard';

        if (campaign.teaserReveal?.enabled) {
            // Teaser ON → progressive reveal based on current progress percent.
            const preset = campaign.teaserReveal.preset ?? 'standard';
            const thresholds = getTeaserThresholds(preset, campaign.teaserReveal.customThresholds);
            const revealLevel = getTeaserRevealLevel(
                progressState.percent,
                thresholds,
                campaign.teaserReveal.disabledStages
            );
            debugStage = revealLevel;
            const revealOptions = teaserLevelToRevealOptions(revealLevel);
            isRingLevel = revealLevel === 'ring';

            showScenes = revealOptions.showScenes;
            showSubplots = revealOptions.showSubplots;
            showActs = revealOptions.showActs;
            showStatusColors = revealOptions.showStatusColors;
            showStageColors = revealOptions.showStageColors;
            grayCompletedScenes = revealOptions.grayCompletedScenes;
            grayscaleScenes = revealOptions.grayscaleScenes;
            showProgressPercent = settings.showProgressPercent ?? true;
        } else {
            // Teaser OFF → inherit Default Report's view mode (mirrors social preview).
            const base = this.resolveBaseRevealOptions(settings.aprDefaultViewMode, settings);
            isRingLevel = settings.aprDefaultViewMode === 'ring';
            showScenes = base.showScenes;
            showSubplots = base.showSubplots;
            showActs = base.showActs;
            showStatusColors = base.showStatusColors;
            showStageColors = base.showStageColors;
            grayCompletedScenes = base.grayCompletedScenes;
            grayscaleScenes = base.grayscaleScenes;
            showProgressPercent = base.showProgressPercent;
            debugStage = settings.aprDefaultViewMode ?? 'default';
        }

        const designSize = campaign.aprSize || settings.aprSize || 'medium';
        const exportQuality: AprExportQuality = campaign.aprExportQuality || settings.aprExportQuality || 'standard';
        const ringOnly = isRingLevel;
        const bookTitle = resolveBookTitle(campaign, books, this.plugin.getActiveBookTitle());

        const { svgString, width, height } = createAprSVG(scenesFiltered, {
            size: designSize,
            exportPreset: getExportPreset(designSize, exportQuality),
            progressPercent: progressState.percent,
            bookTitle,
            authorName: settings.authorName || '',
            showScenes: ringOnly ? false : showScenes,
            showSubplots,
            showActs,
            showStatusColors,
            showStageColors,
            grayCompletedScenes,
            grayscaleScenes,
            showProgressPercent: ringOnly ? false : showProgressPercent,
            showBranding: !ringOnly,
            centerMark: 'none',
            stageColors: this.plugin.settings.publishStageColors,
            workingPatternId: this.plugin.settings.workingPatternId,
            customWorkingPatterns: this.plugin.settings.customWorkingPatterns,
            actCount: this.plugin.settings.actCount || undefined,
            ...renderStyle,
            publishStageLabel: progressState.displayStage,
            showRtAttribution,
            teaserRevealEnabled: campaign.teaserReveal?.enabled ?? false,
            portableSvg: true
        });

        return {
            settings,
            campaign,
            svgString,
            width,
            height,
            meta: {
                format: this.getCampaignExportFormat(campaign),
                size: designSize,
                stage: debugStage,
                percent: progressState.percent
            }
        };
    }

    /**
     * Resolve the visual flags for a non-teaser render (Default Report, or campaign with teaser OFF).
     * Returns the reveal options for the explicit view mode, or 'full' equivalents when 'auto'/undefined.
     */
    private resolveBaseRevealOptions(
        mode: AuthorProgressDefaults['aprDefaultViewMode'],
        settings: AuthorProgressDefaults
    ): {
        showScenes: boolean;
        showSubplots: boolean;
        showActs: boolean;
        showStatusColors: boolean;
        showStageColors: boolean;
        grayCompletedScenes: boolean;
        grayscaleScenes: boolean;
        showProgressPercent: boolean;
    } {
        const showProgressPercent = settings.showProgressPercent ?? true;
        if (mode && mode !== 'auto') {
            const opts = teaserLevelToRevealOptions(mode);
            return {
                showScenes: opts.showScenes,
                showSubplots: opts.showSubplots && (settings.showSubplots ?? true),
                showActs: opts.showActs && (settings.showActs ?? true),
                showStatusColors: opts.showStatusColors && (settings.showStatus ?? true),
                showStageColors: opts.showStageColors,
                grayCompletedScenes: opts.grayCompletedScenes,
                grayscaleScenes: opts.grayscaleScenes,
                showProgressPercent
            };
        }
        // 'auto' / undefined → full reveal, gated by user's show* toggles
        return {
            showScenes: true,
            showSubplots: settings.showSubplots ?? true,
            showActs: settings.showActs ?? true,
            showStatusColors: settings.showStatus ?? true,
            showStageColors: true,
            grayCompletedScenes: false,
            grayscaleScenes: false,
            showProgressPercent
        };
    }

    private pathFormat(path: string, fallback: AprExportFormat): AprExportFormat {
        const normalized = path.trim().toLowerCase();
        if (normalized.endsWith('.svg')) return 'svg';
        if (normalized.endsWith('.png')) return 'png';
        return fallback;
    }

    private writeUint32BE(target: Uint8Array, offset: number, value: number): void {
        target[offset] = (value >>> 24) & 0xff;
        target[offset + 1] = (value >>> 16) & 0xff;
        target[offset + 2] = (value >>> 8) & 0xff;
        target[offset + 3] = value & 0xff;
    }

    private readUint32BE(source: Uint8Array, offset: number): number {
        return (
            (source[offset] << 24) |
            (source[offset + 1] << 16) |
            (source[offset + 2] << 8) |
            source[offset + 3]
        ) >>> 0;
    }

    private crc32(bytes: Uint8Array): number {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
            crc ^= bytes[i];
            for (let bit = 0; bit < 8; bit++) {
                if ((crc & 1) === 1) {
                    crc = (crc >>> 1) ^ 0xedb88320;
                } else {
                    crc = crc >>> 1;
                }
            }
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    private createPngPhysChunk(dpi: number): Uint8Array {
        const pixelsPerMeter = Math.max(1, Math.round(dpi * 39.37007874));
        const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]);
        const data = new Uint8Array(9);
        this.writeUint32BE(data, 0, pixelsPerMeter);
        this.writeUint32BE(data, 4, pixelsPerMeter);
        data[8] = 1;

        const crcInput = new Uint8Array(type.length + data.length);
        crcInput.set(type, 0);
        crcInput.set(data, type.length);
        const crc = this.crc32(crcInput);

        const chunk = new Uint8Array(4 + type.length + data.length + 4);
        this.writeUint32BE(chunk, 0, data.length);
        chunk.set(type, 4);
        chunk.set(data, 8);
        this.writeUint32BE(chunk, 8 + data.length, crc);
        return chunk;
    }

    private applyPngDensity(pngBuffer: ArrayBuffer, dpi: number): ArrayBuffer {
        const bytes = new Uint8Array(pngBuffer);
        const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        for (let i = 0; i < signature.length; i++) {
            if (bytes[i] !== signature[i]) return pngBuffer;
        }

        const parts: Uint8Array[] = [bytes.slice(0, 8)];
        const densityChunk = this.createPngPhysChunk(dpi);
        let offset = 8;
        let insertedDensity = false;

        while (offset + 12 <= bytes.length) {
            const length = this.readUint32BE(bytes, offset);
            const total = 12 + length;
            if (offset + total > bytes.length) return pngBuffer;

            const typeStart = offset + 4;
            const type = String.fromCharCode(
                bytes[typeStart],
                bytes[typeStart + 1],
                bytes[typeStart + 2],
                bytes[typeStart + 3]
            );
            const rawChunk = bytes.slice(offset, offset + total);

            if (type === 'IHDR') {
                parts.push(rawChunk);
                if (!insertedDensity) {
                    parts.push(densityChunk);
                    insertedDensity = true;
                }
            } else if (type === 'pHYs') {
                if (!insertedDensity) {
                    parts.push(densityChunk);
                    insertedDensity = true;
                }
            } else {
                parts.push(rawChunk);
            }

            offset += total;
            if (type === 'IEND') break;
        }

        if (offset < bytes.length) {
            parts.push(bytes.slice(offset));
        }

        const finalLength = parts.reduce((sum, part) => sum + part.length, 0);
        const output = new Uint8Array(finalLength);
        let cursor = 0;
        for (const part of parts) {
            output.set(part, cursor);
            cursor += part.length;
        }
        return output.buffer;
    }

    private async svgToPngBuffer(svgString: string, width: number, height: number): Promise<ArrayBuffer> {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            throw new Error('PNG export is unavailable in this environment.');
        }

        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);
        try {
            const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Failed to load SVG for PNG rendering.'));
                img.src = objectUrl;
            });
            // decode() blocks until the SVG image document is fully ready to
            // paint — including its embedded @font-face data-URI fonts, which
            // load inside the isolated image context and are not observable
            // via this document's FontFaceSet. Without it, drawImage can race
            // the font load and rasterize fallback glyphs.
            await image.decode();

            const targetWidth = Math.max(1, Math.round(width));
            const targetHeight = Math.max(1, Math.round(height));
            const canvas = activeDocument.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not initialize canvas context.');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

            const pngBlob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob((result) => resolve(result), 'image/png');
            });
            if (!pngBlob) {
                throw new Error('Canvas failed to produce PNG data.');
            }
            const rawPng = await pngBlob.arrayBuffer();
            return this.applyPngDensity(rawPng, 144);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    private async ensureFolder(filePath: string): Promise<void> {
        const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (folderPath) {
            const existing = this.app.vault.getAbstractFileByPath(folderPath);
            if (!existing) {
                await this.app.vault.createFolder(folderPath);
            }
        }
    }
}
