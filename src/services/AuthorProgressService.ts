import { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { AuthorProgressCampaign, TeaserRevealLevel } from '../types/settings';
import type { TimelineItem } from '../types/timeline';
import { AprProgressService, type AprResolvedProgressState } from './apr/AprProgressService';
import { AuthorProgressRenderService, type AuthorProgressReportBuildResult } from './authorProgress/AuthorProgressRenderService';
import { AuthorProgressCampaignService } from './authorProgress/AuthorProgressCampaignService';

export class AuthorProgressService {
    private readonly aprProgressService: AprProgressService;
    private readonly renderService: AuthorProgressRenderService;
    private readonly campaignService: AuthorProgressCampaignService;

    constructor(plugin: RadialTimelinePlugin, app: App) {
        this.aprProgressService = new AprProgressService(plugin);
        this.renderService = new AuthorProgressRenderService(plugin, app);
        this.campaignService = new AuthorProgressCampaignService(plugin, this.renderService);
    }

    public campaignNeedsRefresh(campaign: AuthorProgressCampaign): boolean {
        return this.campaignService.campaignNeedsRefresh(campaign);
    }

    public getCampaignsNeedingRefresh(): AuthorProgressCampaign[] {
        return this.campaignService.getCampaignsNeedingRefresh();
    }

    public needsAnyRefresh(): boolean {
        return this.campaignService.needsAnyRefresh();
    }

    public resolveProgressState(scenes: TimelineItem[]): AprResolvedProgressState {
        return this.aprProgressService.resolveProgress(scenes);
    }

    /** Vault path the report publishes to. */
    public getReportPath(report: AuthorProgressCampaign): string {
        return this.renderService.getReportPath(report);
    }

    /** How much of the timeline the report shows at this progress. */
    public resolveRevealLevel(report: AuthorProgressCampaign, percent: number): TeaserRevealLevel {
        return this.renderService.resolveRevealLevel(report, percent);
    }

    /** Draw the report exactly as publishing would, for the settings preview. */
    public buildReportPreview(reportId: string): Promise<AuthorProgressReportBuildResult | null> {
        return this.renderService.buildReport(reportId);
    }

    public checkAutoUpdate(): Promise<void> {
        return this.campaignService.checkAutoUpdate();
    }

    public generateCampaignReport(campaignId: string, options?: { silent?: boolean }): Promise<string | null> {
        return this.campaignService.generateCampaignReport(campaignId, options);
    }

    public sendCampaignToCommunity(campaignId: string, options?: { silent?: boolean }): Promise<'private' | 'active' | null> {
        return this.campaignService.sendCampaignToCommunity(campaignId, options);
    }
}
