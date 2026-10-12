import type { InquirySession } from '../sessionTypes';
import { t } from '../../i18n';

export type InquiryBriefingSection = {
    label: string;
    sessions: InquirySession[];
};

export function buildInquiryBriefingSections(
    sessions: InquirySession[],
    now = new Date()
): InquiryBriefingSection[] {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86_400_000;
    const sections: InquiryBriefingSection[] = [
        { label: t('ui.inquiryBriefingGrouping.today'), sessions: [] },
        { label: t('ui.inquiryBriefingGrouping.yesterday'), sessions: [] },
        { label: t('ui.inquiryBriefingGrouping.earlier'), sessions: [] }
    ];

    sessions.forEach(session => {
        const timestamp = session.createdAt || session.lastAccessed;
        if (timestamp >= todayStart) {
            sections[0].sessions.push(session);
        } else if (timestamp >= yesterdayStart) {
            sections[1].sessions.push(session);
        } else {
            sections[2].sessions.push(session);
        }
    });

    return sections;
}
