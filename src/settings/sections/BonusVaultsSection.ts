import { setAccessibleLabel, withAccessibleLabel } from '../../utils/domTooltip';
import { setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { DemoLibraryModal } from '../../modals/DemoLibraryModal';
import { findNewerDemoEdition, renderNewerEditionLine } from '../../demoVaults/demoEdition';
import { readInquirySidecarVaultIdentity } from '../../inquiry/InquiryArtifactStore';
import { ERT_CLASSES } from '../../ui/classes';
import { t } from '../../i18n';
import {
    BONUS_VAULTS,
    type BonusVaultDef
} from '../bonusVaults';

interface BonusVaultsSectionParams {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

export function renderBonusVaultsSection({
    app: _app,
    plugin,
    containerEl
}: BonusVaultsSectionParams): HTMLElement {
    const section = containerEl.createDiv({ cls: `${ERT_CLASSES.STACK} ert-bonus-section` });

    // ── Heading ──────────────────────────────────────────────
    const header = section.createDiv({ cls: 'ert-bonus-header' });
    const pill = header.createSpan({
        cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_PRO} ert-bonus-pill`
    });
    const pillIcon = pill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
    setIcon(pillIcon, 'sparkles');
    pill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: t('ui.bonusVaultsSection.freeDemosBadge') });
    header.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: t('ui.bonusVaultsSection.heading') });
    header.createEl('p', {
        cls: ERT_CLASSES.SECTION_DESC,
        text: t('ui.bonusVaultsSection.description')
    });
    void appendNewerEditionNote(header, plugin);

    // ── Card grid ────────────────────────────────────────────
    const grid = section.createDiv({ cls: 'ert-bonus-grid' });
    BONUS_VAULTS.forEach((vault) => renderCard(grid, plugin, vault));

    return section;
}

/**
 * A demo opened as its own vault keeps its book identity in the Inquiry
 * sidecar, before and after the reader sets up the book. When the catalog
 * offers a newer edition of that demo, say so under the heading.
 */
async function appendNewerEditionNote(header: HTMLElement, plugin: RadialTimelinePlugin): Promise<void> {
    const bookFolder = (await readInquirySidecarVaultIdentity(plugin.app))?.bookFolder;
    if (!bookFolder || !plugin.app.vault.getFolderByPath(bookFolder)) return;
    const newerEdition = await findNewerDemoEdition(plugin.app, BONUS_VAULTS, bookFolder);
    if (newerEdition) renderNewerEditionLine(header, plugin, newerEdition, { line: ERT_CLASSES.SECTION_DESC });
}

function renderCard(
    grid: HTMLElement,
    plugin: RadialTimelinePlugin,
    vault: BonusVaultDef
): void {
    const isComingSoon = vault.status === 'coming-soon';

    const card = grid.createDiv({ cls: 'ert-bonus-card' });
    card.toggleClass('is-available', vault.status === 'available');
    card.toggleClass('is-coming-soon', isComingSoon);

    // Thumbnail / placeholder
    const thumbWrap = card.createDiv({ cls: 'ert-bonus-card__thumbWrap' });
    if (vault.thumb) {
        thumbWrap.createEl('img', {
            cls: 'ert-bonus-card__thumb',
            attr: { src: vault.thumb, alt: '', 'aria-hidden': 'true', loading: 'lazy' }
        });
    } else {
        const placeholder = thumbWrap.createDiv({ cls: 'ert-bonus-card__placeholder' });
        setIcon(placeholder, 'sparkles');
    }
    // Title + meta
    card.createDiv({ cls: 'ert-bonus-card__title', text: isComingSoon ? t('ui.bonusVaultsSection.secretVault') : vault.title });
    card.createDiv({
        cls: 'ert-bonus-card__meta',
        text: isComingSoon ? vault.countLabel : `${vault.author} · ${vault.countLabel}`
    });
    if (vault.description) {
        card.createEl('p', { cls: 'ert-bonus-card__description', text: vault.description });
    }

    // Action row
    const action = card.createDiv({ cls: 'ert-bonus-card__action' });
    if (isComingSoon) {
        const btn = action.createEl('button', {
            cls: 'ert-bonus-card__btn',
            text: t('ui.bonusVaultsSection.comingSoon'),
            attr: { type: 'button', disabled: 'true' }
        });
        btn.disabled = true;
    } else {
        const btn = action.createEl('button', {
            cls: 'ert-bonus-card__btn ert-bonus-card__btn--primary',
            attr: { type: 'button' }
        });
        const btnIcon = btn.createSpan({ cls: 'ert-bonus-card__btn-icon' });
        setIcon(btnIcon, 'folder-plus');
        btn.createSpan({ text: t('ui.bonusVaultsSection.exploreDemo') });
        setAccessibleLabel(btn, t('ui.bonusVaultsSection.exploreDemoAria', { title: vault.title }));
        plugin.registerDomEvent(btn, 'click', () => {
            new DemoLibraryModal(plugin.app, plugin, vault).open();
        });
        if (vault.pageUrl) {
            withAccessibleLabel(action.createEl('a', {
                cls: 'ert-bonus-card__link',
                text: t('ui.bonusVaultsSection.viewDemoPage'),
                href: vault.pageUrl,
                attr: { target: '_blank', rel: 'noopener noreferrer' }
            }), t('ui.bonusVaultsSection.viewDemoPageAria', { title: vault.title }));
        }
        if (vault.archive) {
            withAccessibleLabel(action.createEl('a', {
                cls: 'ert-bonus-card__link',
                text: t('ui.demoLibraryModal.downloadZip', { size: (vault.archive.bytes / 1048576).toFixed(1) }),
                href: vault.archive.downloadUrl,
                attr: { target: '_blank', rel: 'noopener noreferrer' }
            }), t('ui.demoLibraryModal.downloadAria', { title: vault.title }));
        }
    }
}
