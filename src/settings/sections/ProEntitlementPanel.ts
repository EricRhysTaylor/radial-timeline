import { Notice, Setting, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { ERT_CLASSES } from '../../ui/classes';
import { getProEntitlement } from '../proEntitlement';
import { RT_LOGO_PATHS } from '../../branding/rtLogo';

interface ProEntitlementPanelParams {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    onEntitlementChanged?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildProHeroLogo(parent: HTMLElement): () => void {
    const doc = parent.ownerDocument;
    const wrap = parent.createDiv({ cls: 'ert-pro-hero-logoRow' });
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttr('class', 'ert-pro-hero-logo');
    svg.setAttr('viewBox', '0 0 2048 2048');
    svg.setAttr('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttr('aria-hidden', 'true');

    const defs = doc.createElementNS(SVG_NS, 'defs');
    const gradient = doc.createElementNS(SVG_NS, 'linearGradient');
    gradient.setAttr('id', 'ert-pro-hero-logo-gradient');
    gradient.setAttr('x1', '0%');
    gradient.setAttr('y1', '0%');
    gradient.setAttr('x2', '100%');
    gradient.setAttr('y2', '100%');

    const start = doc.createElementNS(SVG_NS, 'stop');
    start.setAttr('offset', '0%');
    start.setAttr('stop-color', '#d946ef');
    const end = doc.createElementNS(SVG_NS, 'stop');
    end.setAttr('offset', '100%');
    end.setAttr('stop-color', '#8b5cf6');
    gradient.append(start, end);
    defs.append(gradient);
    svg.append(defs);

    RT_LOGO_PATHS.forEach((pathData) => {
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttr('d', pathData);
        path.setAttr('fill', 'url(#ert-pro-hero-logo-gradient)');
        svg.append(path);
    });

    wrap.appendChild(svg);

    const fitLogoToBounds = (): void => {
        try {
            const box = svg.getBBox();
            if (!box.width || !box.height) return;
            const pad = Math.min(box.width, box.height) * 0.02;
            svg.setAttr('viewBox', `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
        } catch {
            // Ignore sizing failures; falls back to default viewBox.
        }
    };

    window.requestAnimationFrame(fitLogoToBounds);
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => fitLogoToBounds());
        observer.observe(svg);
    }
    return fitLogoToBounds;
}

export function renderProEntitlementPanel({
    app: _app,
    plugin,
    containerEl,
    onEntitlementChanged
}: ProEntitlementPanelParams): HTMLElement {
    const entitlement = getProEntitlement(plugin);
    const panel = containerEl.createDiv({ cls: 'ert-pro-mode' });
    const toggleInputs: HTMLInputElement[] = [];

    const createToggle = (parent: HTMLElement, ariaLabel: string): HTMLInputElement => {
        const toggleWrap = parent.createDiv({ cls: `${ERT_CLASSES.TOGGLE_ITEM} ert-pro-mode__toggle` });
        const toggleInput = toggleWrap.createEl('input', {
            cls: 'ert-toggle-input',
            attr: { type: 'checkbox', 'aria-label': ariaLabel }
        });
        toggleInputs.push(toggleInput);
        plugin.registerDomEvent(toggleInput, 'click', (evt) => evt.stopPropagation());
        plugin.registerDomEvent(toggleWrap, 'click', (evt) => evt.stopPropagation());
        return toggleInput;
    };

    const applyProState = (enabled: boolean): void => {
        toggleInputs.forEach((input) => {
            input.checked = enabled;
        });
        panel.toggleClass('is-pro-enabled', enabled);
        panel.toggleClass('is-pro-disabled', !enabled);
    };

    const setProEnabled = async (enabled: boolean): Promise<void> => {
        applyProState(enabled);
        plugin.settings.proAccessEnabled = enabled;
        await plugin.saveSettings();
        if (!enabled) {
            new Notice('Pro workflows hidden — Core surface only.');
        }
        onEntitlementChanged?.();
    };

    const collapsed = panel.createDiv({
        cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.CARD_HERO} ert-pro-hero-card ert-pro-hero-card--collapsed ert-pro-mode__collapsed`
    });
    const collapsedWatermark = collapsed.createSpan({ cls: 'ert-pro-hero-watermark', attr: { 'aria-hidden': 'true' } });
    setIcon(collapsedWatermark, 'signature');
    const collapsedButton = collapsed.createDiv({
        cls: 'ert-pro-mode__collapsed-button'
    });
    const collapsedRow = collapsedButton.createDiv({ cls: 'ert-pro-mode__collapsed-row' });
    const collapsedLeft = collapsedRow.createDiv({ cls: 'ert-pro-mode__collapsed-left' });
    const collapsedPill = collapsedLeft.createSpan({
        cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_PRO} ert-pro-pill`
    });
    const collapsedPillIcon = collapsedPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
    setIcon(collapsedPillIcon, 'signature');
    collapsedPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: 'PRO' });
    // No title text: the PRO pill already names the surface, and with the toggle
    // hidden there is no mode for "Pro mode" to describe.
    const collapsedToggle = createToggle(collapsedRow, 'Toggle Pro workflows');
    // Toggle hidden for now: Pro mode stays on for every install, so there is no
    // state for the reader to manage. The control and its wiring are left intact —
    // unhide this line to bring the switch back.
    collapsedToggle.parentElement?.hide();

    // ── Pro access key (inactive field, retained for settings compatibility) ─
    const keyContainer = collapsed.createDiv({ cls: 'ert-pro-key-container' });
    // Hidden alongside the toggle: there is no key to enter, and a key field on
    // this tab reads as a prompt to buy something. Unhide to restore.
    keyContainer.hide();
    const keySetting = new Setting(keyContainer)
        .setName('Pro access key')
        .setDesc(
            'Nothing to enter. Pro is on for every install and needs no key \u2014 this field is inactive.'
        )
        .addText(text => {
            text.setPlaceholder('XXXX-XXXX-XXXX-XXXX');
            text.inputEl.addClass('ert-input--lg');
            text.inputEl.type = 'password';
        })
        .addButton(button => {
            button
                .setButtonText('Validate')
                .setTooltip('Nothing to validate — Pro needs no key')
                .setDisabled(true);
        });

    keySetting.nameEl.createEl('a', {
        text: ' Learn more \u2192',
        href: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Pro',
        cls: 'ert-link-accent',
        attr: { target: '_blank', rel: 'noopener' }
    });

    const heroContent = collapsed.createDiv({ cls: `${ERT_CLASSES.STACK} ert-pro-hero-content` });
    buildProHeroLogo(heroContent);
    const proNote = heroContent.createDiv({ cls: 'ert-pro-hero-notePill' });
    proNote.createSpan({ text: 'Pro workflows appear throughout RT in magenta.' });
    const heroCopy = heroContent.createEl('p', { cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle ert-pro-hero-body` });
    heroCopy.appendText('Pro is a collection of ');
    heroCopy.createEl('strong', { text: 'Pro workflows' });
    heroCopy.appendText(' — the deeper end of Radial Timeline. Evaluate your story with deeper INQUIRY+ questions, track structure and momentum across scenes, and generate polished manuscripts with PANDOC PDF EXPORTS and custom LaTeX templates. Share progress through APR CAMPAIGNS, and explore WEBSITE EXCLUSIVES including template vaults such as ');
    heroCopy.createSpan({ cls: 'ert-mono-inline', text: 'Pride & Prejudice' });
    heroCopy.appendText(' and ');
    heroCopy.createSpan({ cls: 'ert-mono-inline', text: 'Sherlock Holmes' });
    heroCopy.appendText(', Omnibus Inquiry briefings, and guided workflow demonstrations.');

    const featureStrip = heroContent.createDiv({ cls: 'ert-pro-hero-pillStrip' });
    const featureItems = [
        { icon: 'file-text', label: 'Publishing' },
        { icon: 'share-2', label: 'APR Campaigns' },
        { icon: 'waves', label: 'Inquiry+' },
        { icon: 'waypoints', label: 'Structure' },
        { icon: 'sparkles', label: 'Website Exclusives' }
    ];
    featureItems.forEach(({ icon, label }) => {
        const item = featureStrip.createDiv({ cls: 'ert-pro-hero-pill' });
        const iconEl = item.createSpan({ cls: 'ert-pro-hero-pill-icon' });
        setIcon(iconEl, icon);
        item.createSpan({ cls: 'ert-pro-hero-pill-label', text: label });
    });


    const handleToggleChange = async (value: boolean): Promise<void> => {
        await setProEnabled(value);
    };

    plugin.registerDomEvent(collapsedToggle, 'change', async () => {
        await handleToggleChange(collapsedToggle.checked);
    });
    applyProState(entitlement.isProEnabled);

    return panel;
}
