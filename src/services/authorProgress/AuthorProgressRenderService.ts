import { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { createAprSVG } from '../../renderer/apr/AprRenderer';
import { getExportPreset } from '../../renderer/apr/aprPresets';
import type { AuthorProgressCampaign, TeaserRevealLevel } from '../../types/settings';
import type { TimelineItem } from '../../types/timeline';
import { AprProgressService } from '../apr/AprProgressService';
import { AprStyleService } from '../apr/AprStyleService';
import { getTeaserThresholds, getTeaserRevealLevel, teaserLevelToRevealOptions } from '../../renderer/apr/AprConstants';
import { hasProFeatureAccess } from '../../settings/featureGate';
import { isSceneItem } from '../../utils/sceneHelpers';
import { buildReportEmbedPath, type AprExportFormat } from '../../utils/aprPaths';
import { resolveBookTitle, resolveProjectPath } from '../../renderer/apr/aprHelpers';
import { writeManagedOutput } from '../../utils/logVaultOps';
import { rasterizeSvgToPng } from '../export/svgToPng';
import {
    buildFontFaceCss,
    collectSelfContainedFontFaces,
    parseFontFamilyList,
    selectFontFacesForFamilies,
} from '../export/exportFonts';

export interface AuthorProgressReportBuildResult {
    report: AuthorProgressCampaign;
    svgString: string;
    width: number;
    height: number;
    /** How many scenes the report's book has; zero means there is nothing to draw yet. */
    sceneCount: number;
    /** How much of the timeline this render shows. */
    revealLevel: TeaserRevealLevel;
    percent: number;
}

/**
 * Draws Author Progress reports. `buildReport` is the only path from a report's
 * settings to an image, so the settings preview and the published file agree.
 */
export class AuthorProgressRenderService {
    private readonly aprProgressService: AprProgressService;
    private readonly aprStyleService: AprStyleService;

    constructor(private plugin: RadialTimelinePlugin, private app: App) {
        this.aprProgressService = new AprProgressService(plugin);
        this.aprStyleService = new AprStyleService(plugin);
    }

    public getReport(reportId: string): AuthorProgressCampaign | undefined {
        return this.plugin.settings.authorProgress?.campaigns.find(report => report.id === reportId);
    }

    /** The vault path this report publishes to, following its settings and its book. */
    public getReportPath(report: AuthorProgressCampaign): string {
        const bookTitle = resolveBookTitle(report, this.plugin.settings.books, this.plugin.getActiveBookTitle());
        return buildReportEmbedPath(report, bookTitle);
    }

    /** Teaser reveal follows progress; with it off the report always shows its chosen view. */
    public resolveRevealLevel(report: AuthorProgressCampaign, percent: number): TeaserRevealLevel {
        const teaser = report.teaserReveal;
        if (!teaser.enabled) return report.viewMode;
        return getTeaserRevealLevel(
            percent,
            getTeaserThresholds(teaser.preset, teaser.customThresholds),
            teaser.disabledStages
        );
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

        const png = this.applyPngDensity(await rasterizeSvgToPng(embedded, width, height), 144);
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

        // The parsed document carries no Obsidian window; the main-window
        // element is adopted by `root` on insert and serializes identically.
        const styleEl = createSvg('style');
        styleEl.textContent = buildFontFaceCss(fontFaces);
        root.insertBefore(styleEl, root.firstChild);
        return new XMLSerializer().serializeToString(root);
    }

    /** The scenes of the book a report tracks. */
    public async loadReportScenes(report: AuthorProgressCampaign): Promise<TimelineItem[]> {
        const projectPath = resolveProjectPath(report, this.plugin.settings.books, this.plugin.settings.sourcePath);
        return (await this.plugin.getSceneData({ sourcePath: projectPath })).filter(isSceneItem);
    }

    /** Load a report's book and draw it, as publishing does. */
    public async buildReport(reportId: string): Promise<AuthorProgressReportBuildResult | null> {
        const report = this.getReport(reportId);
        if (!report) return null;
        return this.drawReport(report, await this.loadReportScenes(report));
    }

    /**
     * Draw a report at its export quality from its book's scenes. The settings
     * preview shows this same drawing scaled down, so what is on screen is what
     * gets published.
     */
    public drawReport(report: AuthorProgressCampaign, scenes: TimelineItem[]): AuthorProgressReportBuildResult {
        const settings = this.plugin.settings.authorProgress?.defaults;
        if (!settings) throw new Error('Author Progress settings are not loaded.');
        const books = this.plugin.settings.books;
        const progressState = this.aprProgressService.resolveProgress(scenes, settings);
        const renderStyle = this.aprStyleService.buildRenderStyle(this.aprStyleService.resolveStyle(report));
        // Hiding the Radial Timeline mark is the one Pro choice left in Social.
        const showRtAttribution = hasProFeatureAccess(this.plugin)
            ? renderStyle.showRtAttribution !== false
            : true;

        const revealLevel = this.resolveRevealLevel(report, progressState.percent);
        const reveal = teaserLevelToRevealOptions(revealLevel);
        const ringOnly = revealLevel === 'ring';

        const { svgString, width, height } = createAprSVG(scenes, {
            size: 'medium',
            exportPreset: getExportPreset('medium', report.aprExportQuality),
            progressPercent: progressState.percent,
            bookTitle: resolveBookTitle(report, books, this.plugin.getActiveBookTitle()),
            authorName: settings.authorName || '', // SAFE: no author name draws the ring without one
            showScenes: ringOnly ? false : reveal.showScenes,
            showSubplots: reveal.showSubplots,
            showActs: reveal.showActs,
            showStatusColors: reveal.showStatusColors,
            showStageColors: reveal.showStageColors,
            grayCompletedScenes: reveal.grayCompletedScenes,
            grayscaleScenes: reveal.grayscaleScenes,
            showProgressPercent: !ringOnly,
            showBranding: !ringOnly,
            centerMark: 'none',
            stageColors: this.plugin.settings.publishStageColors,
            workingPatternId: this.plugin.settings.workingPatternId,
            customWorkingPatterns: this.plugin.settings.customWorkingPatterns,
            actCount: this.plugin.settings.actCount || undefined,
            ...renderStyle,
            publishStageLabel: progressState.displayStage,
            showRtAttribution,
            portableSvg: true
        });

        return {
            report,
            svgString,
            width,
            height,
            sceneCount: scenes.length,
            revealLevel,
            percent: progressState.percent
        };
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
