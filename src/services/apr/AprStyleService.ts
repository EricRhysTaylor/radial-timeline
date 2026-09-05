import { kebabSlug } from '../../utils/slug';
import type RadialTimelinePlugin from '../../main';
import {
    buildDefaultAuthorProgressDefaults,
    buildDefaultAuthorProgressSettings,
} from '../../authorProgress/authorProgressConfig';
import type {
    AuthorProgressCampaign,
    AuthorProgressDefaults,
    AprExportQuality,
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
    | 'percentSymbolColor'
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


export class AprStyleService {
    constructor(private plugin: RadialTimelinePlugin) {}

    private readonly styleKeys: Array<keyof AprStyleSettings> = [
        'aprBackgroundColor',
        'aprCenterTransparent',
        'aprBookAuthorColor',
        'aprAuthorColor',
        'aprEngineColor',
        'aprPercentNumberColor',
        'aprPercentSymbolColor',
        'aprTheme',
        'aprSpokeColorMode',
        'aprSpokeColor',
        'aprBookTitleFontFamily',
        'aprBookTitleFontWeight',
        'aprBookTitleFontItalic',
        'aprBookTitleFontSize',
        'aprAuthorNameFontFamily',
        'aprAuthorNameFontWeight',
        'aprAuthorNameFontItalic',
        'aprAuthorNameFontSize',
        'aprPercentNumberFontSize1Digit',
        'aprPercentNumberFontSize2Digit',
        'aprPercentNumberFontSize3Digit',
        'aprRtBadgeFontFamily',
        'aprRtBadgeFontWeight',
        'aprRtBadgeFontItalic',
        'aprRtBadgeFontSize',
        'aprShowRtAttribution',
    ];

    public getDefaults(): AuthorProgressDefaults {
        return this.plugin.settings.authorProgress?.defaults ?? buildDefaultAuthorProgressDefaults();
    }

    public getProfiles(): AprStyleProfile[] {
        return this.plugin.settings.authorProgress?.styleProfiles ?? [];
    }

    public findProfileByName(name: string): AprStyleProfile | undefined {
        const normalized = name.trim().toLowerCase();
        if (!normalized) return undefined;
        return this.getProfiles().find(profile => profile.name.trim().toLowerCase() === normalized);
    }

    public getDesignerCampaignId(): string | undefined {
        return this.plugin.settings.authorProgress?.designerCampaignId;
    }

    public getDesignerCampaign(): AuthorProgressCampaign | undefined {
        const campaignId = this.getDesignerCampaignId();
        if (!campaignId) return undefined;
        return this.plugin.settings.authorProgress?.campaigns?.find(campaign => campaign.id === campaignId);
    }

    public resolveDesignerStyle(): AprStyleSettings {
        const draft = this.plugin.settings.authorProgress?.designerDraftStyle;
        return draft ? { ...draft } : this.captureCurrentStyle(this.getDefaults());
    }

    public isDesignerCampaignActive(campaignId: string): boolean {
        return this.getDesignerCampaignId() === campaignId;
    }

    public captureCurrentStyle(defaults: AuthorProgressDefaults = this.getDefaults()): AprStyleSettings {
        return {
            aprBackgroundColor: defaults.aprBackgroundColor,
            aprCenterTransparent: defaults.aprCenterTransparent,
            aprBookAuthorColor: defaults.aprBookAuthorColor,
            aprAuthorColor: defaults.aprAuthorColor,
            aprEngineColor: defaults.aprEngineColor,
            aprPercentNumberColor: defaults.aprPercentNumberColor,
            aprPercentSymbolColor: defaults.aprPercentSymbolColor,
            aprTheme: defaults.aprTheme,
            aprSpokeColorMode: defaults.aprSpokeColorMode,
            aprSpokeColor: defaults.aprSpokeColor,
            aprBookTitleFontFamily: defaults.aprBookTitleFontFamily,
            aprBookTitleFontWeight: defaults.aprBookTitleFontWeight,
            aprBookTitleFontItalic: defaults.aprBookTitleFontItalic,
            aprBookTitleFontSize: defaults.aprBookTitleFontSize,
            aprAuthorNameFontFamily: defaults.aprAuthorNameFontFamily,
            aprAuthorNameFontWeight: defaults.aprAuthorNameFontWeight,
            aprAuthorNameFontItalic: defaults.aprAuthorNameFontItalic,
            aprAuthorNameFontSize: defaults.aprAuthorNameFontSize,
            aprPercentNumberFontSize1Digit: defaults.aprPercentNumberFontSize1Digit,
            aprPercentNumberFontSize2Digit: defaults.aprPercentNumberFontSize2Digit,
            aprPercentNumberFontSize3Digit: defaults.aprPercentNumberFontSize3Digit,
            aprRtBadgeFontFamily: defaults.aprRtBadgeFontFamily,
            aprRtBadgeFontWeight: defaults.aprRtBadgeFontWeight,
            aprRtBadgeFontItalic: defaults.aprRtBadgeFontItalic,
            aprRtBadgeFontSize: defaults.aprRtBadgeFontSize,
            aprShowRtAttribution: defaults.aprShowRtAttribution,
        };
    }

    public resolveStyle(campaign?: AuthorProgressCampaign): AprStyleSettings {
        const defaults = this.getDefaults();
        if (campaign?.styleSource === 'profile' && campaign.styleProfileId) {
            const profile = this.getProfiles().find(entry => entry.id === campaign.styleProfileId);
            if (profile) return { ...profile.style };
        }
        return this.captureCurrentStyle(defaults);
    }

    public loadCampaignIntoDesigner(campaignId: string): boolean {
        const authorProgress = this.ensureAuthorProgressSettings();
        const campaign = authorProgress.campaigns?.find(entry => entry.id === campaignId);
        if (!campaign) {
            return this.clearDesignerContext();
        }
        authorProgress.designerCampaignId = campaignId;
        authorProgress.designerDraftStyle = this.resolveStyle(campaign);
        return true;
    }

    public clearDesignerContext(): boolean {
        const authorProgress = this.ensureAuthorProgressSettings();
        const hadContext = !!authorProgress.designerCampaignId || !!authorProgress.designerDraftStyle;
        authorProgress.designerCampaignId = undefined;
        authorProgress.designerDraftStyle = undefined;
        return hadContext;
    }

    public updateDesignerStyle(updates: Partial<AprStyleSettings>): void {
        const authorProgress = this.ensureAuthorProgressSettings();
        if (authorProgress.designerCampaignId) {
            authorProgress.designerDraftStyle = {
                ...(authorProgress.designerDraftStyle ?? this.resolveDesignerStyle()),
                ...updates
            };
            return;
        }
        Object.entries(updates).forEach(([key, value]) => {
            if (!this.styleKeys.includes(key as keyof AprStyleSettings)) return;
            (authorProgress.defaults as unknown as Record<string, unknown>)[key] = value;
        });
    }

    public stylesMatch(a?: AprStyleSettings, b?: AprStyleSettings): boolean {
        const left = a ?? {};
        const right = b ?? {};
        return this.styleKeys.every((key) => left[key] === right[key]);
    }

    public resolveStyleProfile(campaign?: AuthorProgressCampaign): AprStyleProfile | undefined {
        if (campaign?.styleSource !== 'profile' || !campaign.styleProfileId) return undefined;
        return this.getProfiles().find(entry => entry.id === campaign.styleProfileId);
    }

    public resolveCurrentExportQuality(): AprExportQuality {
        const defaults = this.getDefaults();
        const campaign = this.getDesignerCampaign();
        return campaign?.aprExportQuality ?? defaults.aprExportQuality ?? 'standard';
    }

    public createStyleProfile(name: string, defaults: AuthorProgressDefaults = this.getDefaults()): AprStyleProfile {
        const timestamp = Date.now();
        return {
            id: `apr-style-${kebabSlug(name, 'style')}-${timestamp}`,
            name: name.trim(),
            createdAt: new Date(timestamp).toISOString(),
            style: this.captureCurrentStyle(defaults),
            aprExportQuality: this.resolveCurrentExportQuality()
        };
    }

    public ensureAuthorProgressSettings(): NonNullable<RadialTimelinePlugin['settings']['authorProgress']> {
        if (!this.plugin.settings.authorProgress) {
            this.plugin.settings.authorProgress = buildDefaultAuthorProgressSettings();
        }
        if (!this.plugin.settings.authorProgress.styleProfiles) {
            this.plugin.settings.authorProgress.styleProfiles = [];
        }
        return this.plugin.settings.authorProgress;
    }

    public saveCurrentStyleAsProfile(
        name: string,
        options?: { overwrite?: boolean }
    ): { profile: AprStyleProfile; overwritten: boolean } {
        const authorProgress = this.ensureAuthorProgressSettings();
        const nextName = name.trim();
        const existingProfile = this.findProfileByName(nextName);
        const sourceStyle = this.resolveDesignerStyle();
        if (existingProfile) {
            if (!options?.overwrite) {
                return { profile: existingProfile, overwritten: false };
            }
            existingProfile.name = nextName;
            existingProfile.style = { ...sourceStyle };
            existingProfile.aprExportQuality = this.resolveCurrentExportQuality();
            return { profile: existingProfile, overwritten: true };
        }

        const profile = this.createStyleProfile(nextName, authorProgress.defaults);
        profile.style = { ...sourceStyle };
        profile.aprExportQuality = this.resolveCurrentExportQuality();
        authorProgress.styleProfiles?.push(profile);
        return { profile, overwritten: false };
    }

    public deleteProfile(profileId: string): AprStyleProfile | undefined {
        const authorProgress = this.ensureAuthorProgressSettings();
        const profiles = authorProgress.styleProfiles ?? [];
        const index = profiles.findIndex(profile => profile.id === profileId);
        if (index === -1) return undefined;

        const [deletedProfile] = profiles.splice(index, 1);
        for (const campaign of authorProgress.campaigns ?? []) {
            if (campaign.styleProfileId === profileId) {
                campaign.styleSource = 'global';
                campaign.styleProfileId = undefined;
            }
        }
        return deletedProfile;
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
            percentSymbolColor: style.aprPercentSymbolColor ?? style.aprBookAuthorColor ?? fallbackColor,
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
