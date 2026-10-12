import { t } from '../../../i18n';

/** Built-in beat system copy, keyed by system name; built per call so text follows the current locale. */
export const getBeatSystemCopy = (): Record<string, {
    title: string;
    description: string;
    examples?: string;
    sourceLink?: { label: string; href: string };
}> => ({
    'Save The Cat': {
        title: t('ui.beatSystemCopy.saveTheCatTitle'),
        description: t('ui.beatSystemCopy.saveTheCatDesc'),
        examples: t('ui.beatSystemCopy.saveTheCatExamples'),
        sourceLink: {
            label: t('ui.beatSystemCopy.saveTheCatSourceLabel'),
            href: 'https://www.jessicabrody.com/save-the-cat-for-novels/'
        }
    },
    'Hero\'s Journey': {
        title: t('ui.beatSystemCopy.herosJourneyTitle'),
        description: t('ui.beatSystemCopy.herosJourneyDesc'),
        examples: t('ui.beatSystemCopy.herosJourneyExamples'),
        sourceLink: {
            label: t('ui.beatSystemCopy.herosJourneySourceLabel'),
            href: 'https://en.wikipedia.org/wiki/The_Writer%27s_Journey:_Mythic_Structure_for_Writers'
        }
    },
    'Classic Dramatic Structure': {
        title: t('ui.beatSystemCopy.classicDramaticTitle'),
        description: t('ui.beatSystemCopy.classicDramaticDesc'),
        examples: t('ui.beatSystemCopy.classicDramaticExamples'),
    },
    'Podcast Narrative Arc': {
        title: t('ui.beatSystemCopy.podcastArcTitle'),
        description: t('ui.beatSystemCopy.podcastArcDesc'),
        examples: t('ui.beatSystemCopy.podcastArcExamples'),
    },
    'YouTube Explainer Arc': {
        title: t('ui.beatSystemCopy.youtubeExplainerTitle'),
        description: t('ui.beatSystemCopy.youtubeExplainerDesc'),
        examples: t('ui.beatSystemCopy.youtubeExplainerExamples'),
    },
    'Documentary Narrative Arc': {
        title: t('ui.beatSystemCopy.documentaryArcTitle'),
        description: t('ui.beatSystemCopy.documentaryArcDesc'),
        examples: t('ui.beatSystemCopy.documentaryArcExamples'),
    },
    'Romance Tropes Ladder': {
        title: t('ui.beatSystemCopy.romanceLadderTitle'),
        description: t('ui.beatSystemCopy.romanceLadderDesc'),
        examples: t('ui.beatSystemCopy.romanceLadderExamples'),
    },
    'Thriller Escalation Ladder': {
        title: t('ui.beatSystemCopy.thrillerLadderTitle'),
        description: t('ui.beatSystemCopy.thrillerLadderDesc'),
        examples: t('ui.beatSystemCopy.thrillerLadderExamples'),
    },
    'Custom': {
        title: t('ui.beatSystemCopy.customTitle'),
        description: t('ui.beatSystemCopy.customDesc'),
        examples: t('ui.beatSystemCopy.customExamples'),
    },
    'Blank custom': {
        title: t('ui.beatSystemCopy.blankCustomTitle'),
        description: t('ui.beatSystemCopy.blankCustomDesc'),
        examples: t('ui.beatSystemCopy.blankCustomExamples'),
    }
});
