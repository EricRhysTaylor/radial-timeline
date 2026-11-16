import { Notice } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { AuthorProgressCampaign } from '../../types/settings';
import { uploadAprToCommunity } from '../../communityShare/communityShareClient';
import { findCommunityBookConflict, resolveCampaignBookId } from '../../authorProgress/campaignCommunityBinding';
import { AuthorProgressRenderService, type AuthorProgressReportBuildResult } from './AuthorProgressRenderService';
import { t, tCount } from '../../i18n';

/**
 * Publishes Author Progress reports: on request, on each report's schedule,
 * and to Community for the reports that share there. The Default report and
 * campaigns are the same kind of thing and take the same path.
 */
export class AuthorProgressCampaignService {
    constructor(
        private plugin: RadialTimelinePlugin,
        private renderService: AuthorProgressRenderService
    ) {}

    private getReports(): AuthorProgressCampaign[] {
        return this.plugin.settings.authorProgress?.campaigns ?? []; // SAFE: no Social settings yet means there is no report to publish
    }

    /** A manually published report is due a refresh once its reminder period has passed. */
    public campaignNeedsRefresh(campaign: AuthorProgressCampaign): boolean {
        if (!campaign.isActive) return false;
        if (campaign.updateFrequency !== 'manual') return false;
        if (!campaign.lastPublishedDate) return false;

        const last = new Date(campaign.lastPublishedDate).getTime();
        const diffDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
        return diffDays > campaign.refreshThresholdDays;
    }

    public getCampaignsNeedingRefresh(): AuthorProgressCampaign[] {
        return this.getReports().filter(c => this.campaignNeedsRefresh(c));
    }

    public needsAnyRefresh(): boolean {
        return this.getReports().some(c => this.campaignNeedsRefresh(c));
    }

    // A campaign's scheduled work is "regenerate, and upload when shared". Track
    // staleness from the most recent of either timestamp: a campaign pushed
    // straight to Community stamps lastCommunityUploadedAt but not
    // lastPublishedDate, and must not then read as never-run.
    private campaignLastRunAt(campaign: AuthorProgressCampaign): number {
        const published = campaign.lastPublishedDate ? new Date(campaign.lastPublishedDate).getTime() : 0;
        const uploaded = campaign.sendToCommunity && campaign.lastCommunityUploadedAt
            ? new Date(campaign.lastCommunityUploadedAt).getTime()
            : 0;
        return Math.max(published, uploaded);
    }

    /** Publish a report: write its image and, when it shares to Community, send it there. */
    public async generateCampaignReport(campaignId: string, options?: { silent?: boolean }): Promise<string | null> {
        const result = await this.renderService.buildReport(campaignId);
        if (!result) return null;

        const { svgString, report, width, height } = result;
        const path = this.renderService.getReportPath(report);
        await this.renderService.saveAprOutput(path, report.exportFormat, svgString, width, height);
        report.lastPublishedDate = new Date().toISOString();
        await this.plugin.saveSettings();

        if (!options?.silent) {
            new Notice(t('ui.authorProgressCampaignService.campaignPublished', {
                name: report.name,
                format: report.exportFormat.toUpperCase(),
                stage: result.revealLevel,
                percent: result.percent.toFixed(1)
            }));
        }

        // Community share surface: send the portable APR to the website.
        // It arrives private on My Share; activation is website-only.
        if (report.sendToCommunity) {
            try {
                await this.uploadCampaignReport(result, options);
            } catch (error) {
                const message = error instanceof Error ? error.message : t('ui.authorProgressCampaignService.unknownError');
                console.error(`Community APR upload failed for campaign ${report.name}:`, message);
                if (!options?.silent) {
                    new Notice(t('ui.authorProgressCampaignService.communitySendFailed', { message }));
                }
            }
        }
        return path;
    }

    public async sendCampaignToCommunity(campaignId: string, options?: { silent?: boolean }): Promise<'private' | 'active' | null> {
        const result = await this.renderService.buildReport(campaignId);
        if (!result) return null;
        return this.uploadCampaignReport(result, options);
    }

    /** Publish every report whose schedule is due, and retry Community sends that failed. */
    public async checkAutoUpdate(): Promise<void> {
        const cooldown = 5 * 60 * 1000;
        const now = Date.now();
        let updatedCount = 0;

        for (const campaign of this.getReports()) {
            if (!campaign.isActive) continue;
            const frequency = campaign.updateFrequency;
            const diffMs = now - this.campaignLastRunAt(campaign);

            let thresholdMs = 0;
            switch (frequency) {
                case 'daily': thresholdMs = 24 * 60 * 60 * 1000; break;
                case 'weekly': thresholdMs = 7 * 24 * 60 * 60 * 1000; break;
                case 'monthly': thresholdMs = 30 * 24 * 60 * 60 * 1000; break;
            }

            const localUpdateDue = frequency !== 'manual' && diffMs > thresholdMs && diffMs > cooldown;
            const communityRetryDue = campaign.sendToCommunity
                && Boolean(campaign.lastCommunityUploadError)
                && now - (campaign.lastCommunityUploadAttemptAt ? new Date(campaign.lastCommunityUploadAttemptAt).getTime() : 0) > cooldown;

            if (localUpdateDue) {
                try {
                    await this.generateCampaignReport(campaign.id, { silent: true });
                    updatedCount++;
                } catch {
                    // Silent failure; user can publish manually.
                }
            } else if (communityRetryDue) {
                try {
                    await this.sendCampaignToCommunity(campaign.id, { silent: true });
                    updatedCount++;
                } catch {
                    // Error state is persisted by uploadCampaignReport.
                }
            }
        }

        if (updatedCount > 0) {
            new Notice(t('ui.authorProgressCampaignService.updatedCampaignsAutomatically', { campaigns: tCount('campaign', updatedCount) }));
        }
    }

    private async uploadCampaignReport(
        result: AuthorProgressReportBuildResult,
        options?: { silent?: boolean }
    ): Promise<'private' | 'active'> {
        const campaign = this.renderService.getReport(result.report.id);
        if (!campaign) {
            throw new Error(t('ui.authorProgressCampaignService.campaignNotFound'));
        }
        const bookKey = resolveCampaignBookId(this.plugin.settings, campaign);
        if (!bookKey) {
            throw new Error(t('ui.authorProgressCampaignService.chooseCampaignBook'));
        }
        // My Share keeps one APR per book, so a second campaign on the same
        // book would overwrite the first instead of publishing alongside it.
        // Settings written before the Send-to-Community guard can still hold
        // that pair, so refuse here rather than let the newer upload win.
        const conflict = findCommunityBookConflict(this.plugin.settings, campaign);
        if (conflict) {
            throw new Error(t('ui.authorProgressCampaignService.communityBookConflict', { name: conflict.name }));
        }

        const attemptedAt = new Date().toISOString();
        campaign.lastCommunityUploadAttemptAt = attemptedAt;
        campaign.lastCommunityUploadError = undefined;
        await this.plugin.saveSettings();

        try {
            const uploaded = await uploadAprToCommunity(this.plugin, {
                svg: result.svgString,
                width: result.width,
                height: result.height,
                // Community reads a level below full as a teaser in progress.
                teaserLevel: campaign.teaserReveal.enabled ? result.revealLevel : 'full',
                updateFrequency: campaign.updateFrequency,
                bookKey,
                campaignLabel: campaign.name
            });
            campaign.lastCommunityUploadedAt = uploaded.updated_at;
            campaign.lastCommunityUploadStatus = uploaded.status;
            campaign.lastCommunityUploadError = undefined;
            await this.plugin.saveSettings();
            if (!options?.silent) {
                new Notice(uploaded.status === 'active'
                    ? t('ui.authorProgressCampaignService.reportRefreshedOnCard')
                    : t('ui.authorProgressCampaignService.reportSentToCommunity'));
            }
            return uploaded.status;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not send the progress report to Community.';
            campaign.lastCommunityUploadError = message;
            await this.plugin.saveSettings();
            throw error;
        }
    }
}
