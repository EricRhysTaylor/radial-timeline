import type { PandocLayoutTemplate } from '../../../types';
import { t } from '../../../i18n';

const getImportedLayoutTraits = (layout: PandocLayoutTemplate): string[] => {
    const traits = layout.importDetection?.traits
        ?.map(trait => trait.trim())
        .filter(trait => trait.length > 0)
        .slice(0, 4);
    if (traits && traits.length > 0) return traits;

    if (layout.importDetection?.styleHint === 'chaptered') return ['Chapter-based structure', 'Book-style typography'];
    if (layout.importDetection?.styleHint === 'literary') return ['Refined chapter styling', 'Book-style typography'];
    if (layout.importDetection?.styleHint === 'book') return ['Book-style page structure', 'Running headers detected'];
    if (layout.importDetection?.styleHint === 'manuscript') return ['Minimal manuscript formatting', 'Wide page spacing'];
    return ['Custom formatting'];
};

const getImportedLayoutTraitLabel = (trait: string): string => {
    const normalized = trait.toLowerCase();
    if (normalized.includes('header')) return t('ui.importedLayoutSummary.labelHeaders');
    if (normalized.includes('chapter') || normalized.includes('structure') || normalized.includes('part')) return t('ui.importedLayoutSummary.labelStructure');
    if (normalized.includes('typography') || normalized.includes('font')) return t('ui.importedLayoutSummary.labelFont');
    if (normalized.includes('metadata') || normalized.includes('front-page')) return t('ui.importedLayoutSummary.labelMetadata');
    if (normalized.includes('spacing')) return t('ui.importedLayoutSummary.labelSpacing');
    if (normalized.includes('dialogue') || normalized.includes('scene')) return t('ui.importedLayoutSummary.labelScenes');
    return t('ui.importedLayoutSummary.labelFormat');
};

const getImportedLayoutPreviewKind = (layout: PandocLayoutTemplate): 'manuscript' | 'book' | 'literary' | 'chaptered' | 'generic' => {
    return layout.importDetection?.mockPreviewKind || 'generic';
};

const renderImportedLayoutMockPreview = (
    container: HTMLElement,
    kind: 'manuscript' | 'book' | 'literary' | 'chaptered' | 'generic',
): void => {
    const page = container.createDiv({ cls: `ert-import-template-mock-page ert-import-template-mock-page--${kind}` });
    if (kind === 'book' || kind === 'chaptered') {
        page.createDiv({ cls: 'ert-import-template-mock-header-line' });
    }

    page.createDiv({
        cls: 'ert-import-template-mock-kicker',
        text: kind === 'chaptered'
            ? t('ui.importedLayoutSummary.kickerChaptered')
            : kind === 'literary'
                ? t('ui.importedLayoutSummary.kickerLiterary')
                : kind === 'manuscript'
                    ? t('ui.importedLayoutSummary.kickerManuscript')
                    : kind === 'book'
                        ? t('ui.importedLayoutSummary.kickerBook')
                        : t('ui.importedLayoutSummary.kickerCustom'),
    });

    page.createDiv({
        cls: `ert-import-template-mock-title ert-import-template-mock-title--${kind}`,
        text: kind === 'chaptered'
            ? t('ui.importedLayoutSummary.titleChaptered')
            : kind === 'literary'
                ? t('ui.importedLayoutSummary.titleLiterary')
                : kind === 'manuscript'
                    ? t('ui.importedLayoutSummary.titleManuscript')
                    : kind === 'book'
                        ? t('ui.importedLayoutSummary.titleBook')
                        : t('ui.importedLayoutSummary.titleGeneric'),
    });

    if (kind === 'literary') {
        page.createDiv({ cls: 'ert-import-template-mock-subtitle', text: t('ui.importedLayoutSummary.subtitleLiterary') });
    }

    const lines = page.createDiv({ cls: 'ert-import-template-mock-lines' });
    ['', ' is-mid', '', ' is-short', '', ''].forEach((suffix) => {
        lines.createDiv({ cls: `ert-import-template-mock-line${suffix}`.trim() });
    });
};

export const renderImportedLayoutSummary = (container: HTMLElement, layout: PandocLayoutTemplate, description: string): void => {
    const shell = container.createDiv({ cls: 'ert-layout-imported' });
    const copy = shell.createDiv({ cls: 'ert-layout-imported-copy' });

    getImportedLayoutTraits(layout).forEach((trait) => {
        const traitRow = copy.createDiv({ cls: 'ert-layout-imported-row' });
        traitRow.createDiv({ cls: 'ert-layout-imported-label', text: getImportedLayoutTraitLabel(trait) });
        traitRow.createDiv({
            cls: 'ert-layout-imported-value',
            text: trait,
        });
    });

    copy.createDiv({
        cls: 'ert-layout-imported-description',
        text: description,
    });

    const preview = shell.createDiv({ cls: 'ert-layout-imported-preview' });
    renderImportedLayoutMockPreview(preview, getImportedLayoutPreviewKind(layout));
};

