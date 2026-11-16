import { kebabSlug } from '../../utils/slug';
import type RadialTimelinePlugin from '../../main';
import { DEFAULT_STYLE_ID, buildDefaultAuthorProgressSettings } from '../../authorProgress/authorProgressConfig';
import type {
    AuthorProgressCampaign,
    AuthorProgressSettings,
    AprStyleProfile,
    AprStyleSettings,
} from '../../types/settings';
import type { AprRenderOptions } from '../../renderer/apr/AprRenderer';

type AprRenderStyleOptions = Pick<
    AprRenderOptions,
    | 'backgroundColor'
    | 'transparentCenter'
    | 'bookAuthorColor'
    | 'authorColor'
    | 'engineColor'
    | 'percentNumberColor'
    | 'theme'
    | 'spokeColor'
    | 'showRtAttribution'
    | 'bookTitleFontFamily'
    | 'bookTitleFontWeight'
    | 'bookTitleFontItalic'
    | 'bookTitleFontSize'
    | 'authorNameFontFamily'
    | 'authorNameFontWeight'
    | 'authorNameFontItalic'
    | 'authorNameFontSize'
    | 'percentNumberFontSize1Digit'
    | 'percentNumberFontSize2Digit'
    | 'percentNumberFontSize3Digit'
    | 'rtBadgeFontFamily'
    | 'rtBadgeFontWeight'
    | 'rtBadgeFontItalic'
    | 'rtBadgeFontSize'
>;

/**
 * Saved Author Progress styles. Every report names one, and edits go straight
 * to the saved style: there is no draft and no style that belongs to nobody.
 */
export class AprStyleService {
    constructor(private plugin: RadialTimelinePlugin) {}

    public ensureAuthorProgressSettings(): AuthorProgressSettings {
        if (!this.plugin.settings.authorProgress) {
            this.plugin.settings.authorProgress = buildDefaultAuthorProgressSettings();
        }
        return this.plugin.settings.authorProgress;
    }

    public getProfiles(): AprStyleProfile[] {
        return this.ensureAuthorProgressSettings().styleProfiles;
    }

    public findProfileByName(name: string): AprStyleProfile | undefined {
        const normalized = name.trim().toLowerCase();
        if (!normalized) return undefined;
        return this.getProfiles().find(profile => profile.name.trim().toLowerCase() === normalized);
    }

    /** The saved style a report is drawn with. Loading settings guarantees it exists. */
    public getReportStyle(report: Pick<AuthorProgressCampaign, 'name' | 'styleProfileId'>): AprStyleProfile {
        const profile = this.getProfiles().find(entry => entry.id === report.styleProfileId);
        if (!profile) {
            throw new Error(`Author Progress report "${report.name}" names a style that no longer exists.`);
        }
        return profile;
    }

    public resolveStyle(report: Pick<AuthorProgressCampaign, 'name' | 'styleProfileId'>): AprStyleSettings {
        return { ...this.getReportStyle(report).style };
    }

    /** Reports drawn with this style: an edit to the style changes all of them. */
    public getStyleUsers(profileId: string): AuthorProgressCampaign[] {
        return this.ensureAuthorProgressSettings().campaigns.filter(report => report.styleProfileId === profileId);
    }

    public updateStyle(profileId: string, updates: Partial<AprStyleSettings>): void {
        const profile = this.getProfiles().find(entry => entry.id === profileId);
        if (!profile) return;
        profile.style = { ...profile.style, ...updates };
    }

    /** Save a copy of a style under a new name. The caller checks the name is free. */
    public duplicateStyle(sourceId: string, name: string): AprStyleProfile | undefined {
        const source = this.getProfiles().find(entry => entry.id === sourceId);
        if (!source) return undefined;
        const timestamp = Date.now();
        const copy: AprStyleProfile = {
            id: `apr-style-${kebabSlug(name, 'style')}-${timestamp}`,
            name: name.trim(),
            createdAt: new Date(timestamp).toISOString(),
            style: { ...source.style }
        };
        this.getProfiles().push(copy);
        return copy;
    }

    /** Delete a style; reports that used it go back to Default. Default itself stays. */
    public deleteStyle(profileId: string): AprStyleProfile | undefined {
        if (profileId === DEFAULT_STYLE_ID) return undefined;
        const authorProgress = this.ensureAuthorProgressSettings();
        const index = authorProgress.styleProfiles.findIndex(profile => profile.id === profileId);
        if (index === -1) return undefined;
        const [deleted] = authorProgress.styleProfiles.splice(index, 1);
        for (const report of authorProgress.campaigns) {
            if (report.styleProfileId === profileId) report.styleProfileId = DEFAULT_STYLE_ID;
        }
        return deleted;
    }

    public buildRenderStyle(style: AprStyleSettings): AprRenderStyleOptions {
        const fallbackColor = this.plugin.settings.publishStageColors?.Press;
        const backgroundColor = style.aprBackgroundColor;
        return {
            backgroundColor,
            transparentCenter: style.aprCenterTransparent,
            bookAuthorColor: style.aprBookAuthorColor ?? fallbackColor,
            authorColor: style.aprAuthorColor ?? style.aprBookAuthorColor ?? fallbackColor,
            engineColor: style.aprEngineColor,
            percentNumberColor: style.aprPercentNumberColor ?? style.aprBookAuthorColor ?? fallbackColor,
            theme: style.aprTheme ?? 'dark',
            spokeColor: style.aprSpokeColorMode === 'custom'
                ? style.aprSpokeColor
                : style.aprSpokeColorMode === 'sync'
                    ? backgroundColor
                    : undefined,
            showRtAttribution: style.aprShowRtAttribution,
            bookTitleFontFamily: style.aprBookTitleFontFamily,
            bookTitleFontWeight: style.aprBookTitleFontWeight,
            bookTitleFontItalic: style.aprBookTitleFontItalic,
            bookTitleFontSize: style.aprBookTitleFontSize,
            authorNameFontFamily: style.aprAuthorNameFontFamily,
            authorNameFontWeight: style.aprAuthorNameFontWeight,
            authorNameFontItalic: style.aprAuthorNameFontItalic,
            authorNameFontSize: style.aprAuthorNameFontSize,
            percentNumberFontSize1Digit: style.aprPercentNumberFontSize1Digit,
            percentNumberFontSize2Digit: style.aprPercentNumberFontSize2Digit,
            percentNumberFontSize3Digit: style.aprPercentNumberFontSize3Digit,
            rtBadgeFontFamily: style.aprRtBadgeFontFamily,
            rtBadgeFontWeight: style.aprRtBadgeFontWeight,
            rtBadgeFontItalic: style.aprRtBadgeFontItalic,
            rtBadgeFontSize: style.aprRtBadgeFontSize,
        };
    }
}
