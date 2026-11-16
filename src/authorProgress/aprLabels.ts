/**
 * Display names for the report and the style every vault has. Their saved
 * names are fixed English ("Default"); the interface shows the translated one.
 */
import { t } from '../i18n';
import { DEFAULT_REPORT_ID } from '../utils/aprPaths';
import { DEFAULT_STYLE_ID } from './authorProgressConfig';
import type { AprStyleProfile, AuthorProgressCampaign } from '../types/settings';

export function aprReportLabel(report: Pick<AuthorProgressCampaign, 'id' | 'name'>): string {
    return report.id === DEFAULT_REPORT_ID ? t('ui.aprReports.defaultReportName') : report.name;
}

export function aprStyleLabel(profile: Pick<AprStyleProfile, 'id' | 'name'>): string {
    return profile.id === DEFAULT_STYLE_ID ? t('ui.aprReports.defaultStyleName') : profile.name;
}
