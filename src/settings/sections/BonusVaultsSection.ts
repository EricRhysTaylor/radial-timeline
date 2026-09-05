import { Notice, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { ERT_CLASSES } from '../../ui/classes';
import {
    BONUS_VAULTS,
    isBonusVaultInstalled,
    type BonusVaultDef
} from '../bonusVaults';

interface BonusVaultsSectionParams {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Incognito glyph (fedora + spectacles) used as the muted placeholder behind
 * coming-soon vaults, mirroring the marketing site's locked cards. Drawn inline
 * so no extra raster asset is bundled.
 */
function buildIncognitoGlyph(parent: HTMLElement): void {
    const doc = parent.ownerDocument;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttr('class', 'ert-bonus-card__glyph');
    svg.setAttr('viewBox', '0 0 24 24');
    svg.setAttr('aria-hidden', 'true');
    svg.setAttr('fill', 'none');
    svg.setAttr('stroke', 'currentColor');
    svg.setAttr('stroke-width', '1.6');
    svg.setAttr('stroke-linecap', 'round');
    svg.setAttr('stroke-linejoin', 'round');

    // Hat brim + crown
    const hat = doc.createElementNS(SVG_NS, 'path');
    hat.setAttr('d', 'M3 13h18M7 13c0-3.5 1.8-6 5-6s5 2.5 5 6');
    svg.append(hat);

    // Spectacle lenses
    const leftLens = doc.createElementNS(SVG_NS, 'circle');
    leftLens.setAttr('cx', '8');
    leftLens.setAttr('cy', '17');
    leftLens.setAttr('r', '2.6');
    const rightLens = doc.createElementNS(SVG_NS, 'circle');
    rightLens.setAttr('cx', '16');
    rightLens.setAttr('cy', '17');
    rightLens.setAttr('r', '2.6');
    const bridge = doc.createElementNS(SVG_NS, 'path');
    bridge.setAttr('d', 'M10.6 17h2.8');
    svg.append(leftLens, rightLens, bridge);

    parent.appendChild(svg);
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
    pill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: 'WEBSITE EXCLUSIVES' });
    header.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: 'Bonus vaults' });
    header.createEl('p', {
        cls: ERT_CLASSES.SECTION_DESC,
        text:
            'Sample novels built in Radial Timeline. Activate one to download it as a ' +
            'standalone vault you can open and explore — a complete worked example, ' +
            'separate from your own manuscript.'
    });

    // ── Card grid ────────────────────────────────────────────
    const grid = section.createDiv({ cls: 'ert-bonus-grid' });
    BONUS_VAULTS.forEach((vault) => renderCard(grid, plugin, vault));

    return section;
}

function renderCard(
    grid: HTMLElement,
    plugin: RadialTimelinePlugin,
    vault: BonusVaultDef
): void {
    const isComingSoon = vault.status === 'coming-soon';
    const isInstalled = !isComingSoon && isBonusVaultInstalled(plugin, vault.id);

    const card = grid.createDiv({ cls: 'ert-bonus-card' });
    card.toggleClass('is-available', vault.status === 'available' && !isInstalled);
    card.toggleClass('is-installed', isInstalled);
    card.toggleClass('is-coming-soon', isComingSoon);

    // Thumbnail / placeholder
    const thumbWrap = card.createDiv({ cls: 'ert-bonus-card__thumbWrap' });
    if (vault.thumb && !isComingSoon) {
        thumbWrap.createEl('img', {
            cls: 'ert-bonus-card__thumb',
            attr: { src: vault.thumb, alt: '', 'aria-hidden': 'true', loading: 'lazy' }
        });
    } else {
        const placeholder = thumbWrap.createDiv({ cls: 'ert-bonus-card__placeholder' });
        buildIncognitoGlyph(placeholder);
    }
    if (isInstalled) {
        const badge = thumbWrap.createSpan({ cls: 'ert-bonus-card__statusBadge' });
        const badgeIcon = badge.createSpan({ cls: 'ert-bonus-card__statusBadge-icon' });
        setIcon(badgeIcon, 'check');
        badge.createSpan({ text: 'Installed' });
    }

    // Title + meta
    card.createDiv({ cls: 'ert-bonus-card__title', text: vault.title });
    card.createDiv({
        cls: 'ert-bonus-card__meta',
        text: `${vault.author} · ${vault.countLabel}`
    });

    // Action row
    const action = card.createDiv({ cls: 'ert-bonus-card__action' });
    if (isComingSoon) {
        const btn = action.createEl('button', {
            cls: 'ert-bonus-card__btn',
            text: 'Coming soon',
            attr: { type: 'button', disabled: 'true' }
        });
        btn.disabled = true;
    } else if (isInstalled) {
        const openBtn = action.createEl('button', {
            cls: 'ert-bonus-card__btn ert-bonus-card__btn--primary',
            text: 'Open vault',
            attr: { type: 'button' }
        });
        plugin.registerDomEvent(openBtn, 'click', () => {
            // STUB: standalone-vault open is wired with the download pipeline.
            new Notice('Opening bonus vaults is coming soon.');
        });
        const removeBtn = action.createEl('button', {
            cls: 'ert-bonus-card__btn ert-bonus-card__btn--ghost',
            text: 'Remove',
            attr: { type: 'button' }
        });
        plugin.registerDomEvent(removeBtn, 'click', () => {
            new Notice('Removing bonus vaults is coming soon.');
        });
    } else {
        const btn = action.createEl('button', {
            cls: 'ert-bonus-card__btn ert-bonus-card__btn--primary',
            attr: { type: 'button' }
        });
        const btnIcon = btn.createSpan({ cls: 'ert-bonus-card__btn-icon' });
        setIcon(btnIcon, 'download');
        btn.createSpan({ text: 'Activate' });
        plugin.registerDomEvent(btn, 'click', () => {
            // STUB: download from Supabase Storage, unpack, and open as a
            // standalone vault. Pipeline not built yet (UI-first increment).
            new Notice(`“${vault.title}” download is coming soon.`);
        });
    }
}
