import { sleep } from '../../utils/sleep';
import { Setting as Settings, TextComponent, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { computeCacheableValues } from '../../renderer/utils/Precompute';
import { DEFAULT_SETTINGS } from '../defaults';
import { colorSwatch, type ColorSwatchHandle } from '../../ui/ui';
import { ERT_DATA, ERT_CLASSES } from '../../ui/classes';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { HERO_PATTERNS, DEFAULT_WORKING_PATTERN_ID, CUSTOM_PATTERN_ID_PREFIX, getHeroPattern, type HeroPattern } from '../../renderer/components/HeroPatterns';
import { validateSvgPattern } from '../../renderer/components/heroPatternValidator';
import { hasProFeatureAccess } from '../featureGate';
import { IMPACT_FULL } from '../SettingImpact';

/**
 * Return the subplot name trimmed of surrounding whitespace.
 * No length truncation — the card is allowed to grow / wrap to fit the name.
 */
function normalizeSubplotLabel(value: string): string {
    return value.trim();
}

async function getTimelineSubplotOrder(plugin: RadialTimelinePlugin): Promise<string[]> {
    const scenes = Array.isArray(plugin.lastSceneData) ? plugin.lastSceneData : null;
    if (scenes && scenes.length > 0) {
        const { masterSubplotOrder } = computeCacheableValues(plugin as unknown as PluginRendererFacade, scenes);
        return masterSubplotOrder.filter(subplot =>
            subplot &&
            subplot.trim().length > 0 &&
            subplot !== 'Backdrop' &&
            subplot !== 'MicroBackdrop'
        );
    }

    await sleep(150);
    let fetched: unknown;
    try {
        fetched = await plugin.getSceneData();
    } catch {
        return [];
    }
    const hydrated = Array.isArray(fetched) ? fetched : null;
    if (!hydrated || hydrated.length === 0) return [];

    const { masterSubplotOrder } = computeCacheableValues(plugin as unknown as PluginRendererFacade, hydrated);
    return masterSubplotOrder.filter(subplot =>
        subplot &&
        subplot.trim().length > 0 &&
        subplot !== 'Backdrop' &&
        subplot !== 'MicroBackdrop'
    );
}

function renderWorkingPatternPreview(
    svgEl: SVGSVGElement,
    patternId: string,
    stageColor: string,
    customPatterns?: readonly HeroPattern[]
): void {
    const pattern = getHeroPattern(patternId, customPatterns);
    renderPatternIntoSvg(svgEl, pattern, stageColor);
}

function renderPatternIntoSvg(svgEl: SVGSVGElement, pattern: HeroPattern, stageColor: string): void {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    const NS = 'http://www.w3.org/2000/svg';
    const doc = svgEl.ownerDocument;
    const defs = doc.createElementNS(NS, 'defs');
    const pat = doc.createElementNS(NS, 'pattern');
    pat.setAttribute('id', `ert-pattern-preview-${pattern.id}`);
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    pat.setAttribute('width', String(pattern.tileW));
    pat.setAttribute('height', String(pattern.tileH));
    // Use status Working hex as the field; stage color as the motif tint — same as Defs.ts.
    const fieldRect = doc.createElementNS(NS, 'rect');
    fieldRect.setAttribute('width', String(pattern.tileW));
    fieldRect.setAttribute('height', String(pattern.tileH));
    fieldRect.setAttribute('fill', '#FFB1B1');
    fieldRect.setAttribute('opacity', '0.82');
    pat.appendChild(fieldRect);
    const tintG = doc.createElementNS(NS, 'g');
    tintG.setAttribute('fill', stageColor);
    tintG.setAttribute('fill-opacity', String(pattern.fillOpacity));
    if (pattern.fillRule) tintG.setAttribute('fill-rule', pattern.fillRule);
    for (const shape of pattern.shapes) {
        const node = doc.createElementNS(NS, shape.tag);
        for (const [k, v] of Object.entries(shape.attrs)) node.setAttribute(k, v);
        tintG.appendChild(node);
    }
    pat.appendChild(tintG);
    defs.appendChild(pat);
    svgEl.appendChild(defs);
    const rect = doc.createElementNS(NS, 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', `url(#ert-pattern-preview-${pattern.id})`);
    svgEl.appendChild(rect);
}

interface CustomPatternsCardHandle {
    show: () => void;
    hide: () => void;
}

function renderCustomPatternsCard(
    parent: HTMLElement,
    plugin: RadialTimelinePlugin,
    previewStageColor: string,
    onListChanged: () => void
): CustomPatternsCardHandle | null {
    // Non-Pro users never see this card. The Pro tier here covers the custom-
    // paste tooling (parsing, validation, structured re-render) — not the
    // patterns themselves. Hero Patterns artwork is and remains CC BY 4.0,
    // free for anyone to use; the four built-ins are available to all users.
    if (!hasProFeatureAccess(plugin)) return null;

    const card = parent.createDiv({ cls: 'ert-custom-patterns-card is-hidden' });

    const headerRow = card.createDiv({ cls: 'ert-custom-patterns-header' });
    const titleWrap = headerRow.createDiv({ cls: 'ert-custom-patterns-title' });
    const proPill = titleWrap.createSpan({ cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_PRO}` });
    setIcon(proPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON }), 'signature');
    proPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: 'PRO' });
    titleWrap.createSpan({ text: 'Custom patterns', cls: 'ert-custom-patterns-title-text' });

    const desc = card.createEl('p', { cls: 'ert-color-section-desc' });
    desc.appendText('Paste any pattern from ');
    const link = desc.createEl('a', { text: 'heropatterns.com', href: 'https://heropatterns.com' });
    link.setAttr('target', '_blank');
    link.setAttr('rel', 'noopener');
    desc.appendText(' and use it as your Working scene fill. Patterns from Hero Patterns are free under the Creative Commons 4.0 license.');

    // --- Existing custom patterns list ---
    const list = card.createDiv({ cls: 'ert-custom-patterns-list' });
    const renderList = () => {
        while (list.firstChild) list.removeChild(list.firstChild);
        const customs = plugin.settings.customWorkingPatterns ?? [];
        if (customs.length === 0) {
            list.createEl('p', { cls: 'ert-custom-patterns-empty', text: 'No custom patterns yet.' });
            return;
        }
        for (const p of customs) {
            const item = list.createDiv({ cls: 'ert-custom-patterns-item' });
            const swatch = item.createSvg('svg', { attr: { viewBox: '0 0 60 24', width: '60', height: '24', preserveAspectRatio: 'none' } });
            swatch.addClass('ert-working-pattern-preview');
            renderPatternIntoSvg(swatch, p, previewStageColor);
            item.createSpan({ cls: 'ert-custom-patterns-item-name', text: p.name });
            const removeBtn = item.createEl('button', { cls: 'clickable-icon ert-custom-patterns-remove' });
            setIcon(removeBtn, 'trash-2');
            removeBtn.setAttr('aria-label', `Remove ${p.name}`);
            plugin.registerDomEvent(removeBtn, 'click', async () => {
                const next = (plugin.settings.customWorkingPatterns ?? []).filter(x => x.id !== p.id);
                plugin.settings.customWorkingPatterns = next;
                // If the removed pattern was selected, fall back to default.
                if (plugin.settings.workingPatternId === p.id) {
                    plugin.settings.workingPatternId = DEFAULT_WORKING_PATTERN_ID;
                }
                await plugin.saveSettings();
                renderList();
                onListChanged();
                plugin.onSettingChanged(IMPACT_FULL);
            });
        }
    };
    renderList();

    // --- Paste / validate / save ---
    const form = card.createDiv({ cls: 'ert-custom-patterns-form' });
    const nameInputWrap = form.createDiv({ cls: 'ert-custom-patterns-field' });
    nameInputWrap.createEl('label', { text: 'Name', cls: 'ert-custom-patterns-label' });
    const nameInput = nameInputWrap.createEl('input', { cls: 'ert-input', attr: { type: 'text', placeholder: 'My pattern' } });

    const svgInputWrap = form.createDiv({ cls: 'ert-custom-patterns-field' });
    svgInputWrap.createEl('label', { text: 'SVG markup', cls: 'ert-custom-patterns-label' });
    const svgInput = svgInputWrap.createEl('textarea', {
        cls: 'ert-input ert-custom-patterns-textarea',
        attr: { rows: '6', placeholder: '<svg viewBox="0 0 20 20" ...>...</svg>', spellcheck: 'false' }
    });

    const feedback = form.createDiv({ cls: 'ert-custom-patterns-feedback' });
    const previewWrap = form.createDiv({ cls: 'ert-custom-patterns-preview-wrap' });
    const previewSvg = previewWrap.createSvg('svg', { attr: { viewBox: '0 0 120 30', width: '120', height: '30', preserveAspectRatio: 'none' } });
    previewSvg.addClass('ert-working-pattern-preview');

    let validated: ReturnType<typeof validateSvgPattern> | null = null;
    const buttonRow = form.createDiv({ cls: 'ert-custom-patterns-buttons' });
    const validateBtn = buttonRow.createEl('button', { cls: 'ert-mod-cta', text: 'Validate' });
    const saveBtn = buttonRow.createEl('button', { text: 'Save pattern' });
    saveBtn.setAttribute('disabled', 'true');

    const setFeedback = (msg: string, ok: boolean) => {
        feedback.empty();
        feedback.toggleClass('is-error', !ok);
        feedback.toggleClass('is-ok', ok);
        feedback.setText(msg);
    };

    plugin.registerDomEvent(validateBtn, 'click', () => {
        const result = validateSvgPattern(svgInput.value);
        validated = result;
        if (!result.ok) {
            saveBtn.setAttribute('disabled', 'true');
            while (previewSvg.firstChild) previewSvg.removeChild(previewSvg.firstChild);
            setFeedback(result.error, false);
            return;
        }
        // Render the validated pattern into the preview using the same path
        // the dropdown swatches use — proves the structured data round-trips.
        const tentativeName = (nameInput.value || '').trim() || 'Untitled';
        const tentative: HeroPattern = {
            id: 'tentative-preview',
            name: tentativeName,
            ...result.pattern,
        };
        renderPatternIntoSvg(previewSvg, tentative, previewStageColor);
        saveBtn.removeAttribute('disabled');
        setFeedback('Valid. Preview rendered.', true);
    });

    plugin.registerDomEvent(saveBtn, 'click', async () => {
        if (!validated || !validated.ok) return;
        const name = (nameInput.value || '').trim();
        if (!name) {
            setFeedback('Name required.', false);
            return;
        }
        const id = `${CUSTOM_PATTERN_ID_PREFIX}${Date.now().toString(36)}`;
        const newPattern: HeroPattern = { id, name, ...validated.pattern };
        const next = [...(plugin.settings.customWorkingPatterns ?? []), newPattern];
        plugin.settings.customWorkingPatterns = next;
        await plugin.saveSettings();
        nameInput.value = '';
        svgInput.value = '';
        while (previewSvg.firstChild) previewSvg.removeChild(previewSvg.firstChild);
        validated = null;
        saveBtn.setAttribute('disabled', 'true');
        setFeedback(`Saved "${name}".`, true);
        renderList();
        onListChanged();
        // No timeline refresh needed yet — only the dropdown gains an option.
        // The user must explicitly select the new pattern for the timeline
        // to re-render.
    });

    return {
        show: () => card.removeClass('is-hidden'),
        hide: () => card.addClass('is-hidden'),
    };
}

const CUSTOM_EDITOR_SENTINEL_ID = '__hero_custom_editor__';

export function renderColorsSection(containerEl: HTMLElement, plugin: RadialTimelinePlugin): void {
    // --- Working Patterns (Hero Patterns motif for Working-status scenes) ---
    const patternSection = containerEl.createDiv({ attr: { [ERT_DATA.SECTION]: 'colors-working-pattern' } });
    const patternHeading = new Settings(patternSection)
        .setName('Working patterns')
        .setHeading();
    addHeadingIcon(patternHeading, 'paintbrush-vertical');
    // Populate descEl BEFORE applyErtHeaderLayout: that helper detaches the
    // descEl entirely when it's empty at layout time (see applyErtHeaderLayout
    // in wikiLink.ts), which would drop our pill + link.
    const patternDesc = patternHeading.descEl;
    if (patternDesc) {
        patternDesc.addClass('ert-color-section-desc');
        patternDesc.setText('Patterns are used for ');
        const pill = patternDesc.createSpan({ cls: 'ert-yaml-pill', text: '"Working"' });
        pill.setAttr('aria-label', 'Working status');
        patternDesc.appendText(' scenes. Thanks to ');
        const link = patternDesc.createEl('a', { text: 'heropatterns.com', href: 'https://heropatterns.com' });
        link.setAttr('target', '_blank');
        link.setAttr('rel', 'noopener');
        patternDesc.appendText('.');
    }
    applyErtHeaderLayout(patternHeading);

    const currentPatternId = plugin.settings.workingPatternId ?? DEFAULT_WORKING_PATTERN_ID;
    const previewStageColor = plugin.settings.publishStageColors?.Author
        || DEFAULT_SETTINGS.publishStageColors.Author;

    // Standard Obsidian setting-item row — same look as Toolbar's
    // "Check backdrop properties" row (background card, name on left,
    // controls on right). The preview swatch sits inside `controlEl`
    // alongside the dropdown + reset so they cluster on the right.
    const innerRow = new Settings(patternSection)
        .setName('Working pattern')
        .setDesc('Choose the motif used for "Working" scenes. Changes apply live.');
    innerRow.settingEl.addClass('ert-working-pattern-row');

    const previewSvg = innerRow.controlEl.createSvg('svg', { attr: { viewBox: '0 0 120 30', width: '120', height: '30', preserveAspectRatio: 'none' } });
    previewSvg.addClass('ert-working-pattern-preview');
    renderWorkingPatternPreview(previewSvg, currentPatternId, previewStageColor, plugin.settings.customWorkingPatterns);

    const getCustoms = (): readonly HeroPattern[] => (plugin.settings.customWorkingPatterns ?? []);

    let dropdownRef: import('obsidian').DropdownComponent | undefined;
    const isPro = hasProFeatureAccess(plugin);

    const populateDropdown = (dd: import('obsidian').DropdownComponent, selectedId: string) => {
        // Clear existing options before repopulating after add/remove.
        const select = dd.selectEl;
        while (select.firstChild) select.removeChild(select.firstChild);
        HERO_PATTERNS.forEach(p => { dd.addOption(p.id, p.name); });
        const customs = getCustoms();
        if (customs.length > 0) {
            customs.forEach(p => { dd.addOption(p.id, `★ ${p.name}`); });
        }
        // Pro-only: special sentinel option opens the custom-pattern editor.
        // Picking it does not change the saved pattern — it just reveals the
        // paste/validate card below.
        if (isPro) dd.addOption(CUSTOM_EDITOR_SENTINEL_ID, 'Custom…');
        // Falls back to the first option when the saved id no longer exists.
        const known = HERO_PATTERNS.some(p => p.id === selectedId) || customs.some(p => p.id === selectedId);
        dd.setValue(known ? selectedId : DEFAULT_WORKING_PATTERN_ID);
    };

    // Forward declaration — the card handle is created after the dropdown so
    // its callback can repopulate. The dropdown's onChange uses it to toggle
    // visibility, so we declare the variable here and assign below.
    let customCardHandle: CustomPatternsCardHandle | null = null;

    innerRow.addDropdown(dropdown => {
        dropdownRef = dropdown;
        populateDropdown(dropdown, currentPatternId);
        dropdown.onChange(async (value) => {
            if (value === CUSTOM_EDITOR_SENTINEL_ID) {
                // Sentinel: open editor, revert dropdown to the actually-applied pattern.
                customCardHandle?.show();
                const applied = plugin.settings.workingPatternId ?? DEFAULT_WORKING_PATTERN_ID;
                dropdown.setValue(applied);
                return;
            }
            customCardHandle?.hide();
            plugin.settings.workingPatternId = value;
            await plugin.saveSettings();
            renderWorkingPatternPreview(previewSvg, value, previewStageColor, getCustoms());
            plugin.onSettingChanged(IMPACT_FULL);
        });
    });
    innerRow.addExtraButton(button => {
        button.setIcon('reset')
            .setTooltip('Reset to default')
            .onClick(async () => {
                plugin.settings.workingPatternId = DEFAULT_WORKING_PATTERN_ID;
                await plugin.saveSettings();
                renderWorkingPatternPreview(previewSvg, DEFAULT_WORKING_PATTERN_ID, previewStageColor, getCustoms());
                dropdownRef?.setValue(DEFAULT_WORKING_PATTERN_ID);
                customCardHandle?.hide();
                plugin.onSettingChanged(IMPACT_FULL);
            });
    });

    // --- Custom Working Patterns (Pro feature) — hidden until the user picks
    //     "Custom…" from the dropdown above. Returns null for non-Pro users.
    customCardHandle = renderCustomPatternsCard(patternSection, plugin, previewStageColor, () => {
        if (dropdownRef) populateDropdown(dropdownRef, plugin.settings.workingPatternId ?? DEFAULT_WORKING_PATTERN_ID);
        renderWorkingPatternPreview(previewSvg, plugin.settings.workingPatternId ?? DEFAULT_WORKING_PATTERN_ID, previewStageColor, getCustoms());
    });

    // --- Publishing Stage Colors ---
    const pubSection = containerEl.createDiv({ attr: { [ERT_DATA.SECTION]: 'colors-publish' } });
    const pubHeading = new Settings(pubSection)
        .setName('Publishing stage colors')
        .setDesc('Used for completed scenes, stage matrix, act labels and more.')
        .setHeading();
    addHeadingIcon(pubHeading, 'paintbrush-vertical');
    addWikiLink(pubHeading, 'Settings-Core#progress-stage-colors');
    pubHeading.descEl?.addClass('ert-color-section-desc');
    applyErtHeaderLayout(pubHeading);
    const stageGrid = pubSection.createDiv({ cls: 'ert-color-grid' });
    const stages = Object.entries(plugin.settings.publishStageColors);
    stages.forEach(([stage, color]) => {
        const cell = stageGrid.createDiv({ cls: 'ert-color-grid-item' });
        const label = cell.createDiv({ cls: 'ert-color-grid-label' });
        label.setText(stage);

        let textInputRef: TextComponent | undefined;
        const control = cell.createDiv({ cls: 'ert-color-grid-controls' });

        const swatchHandle: ColorSwatchHandle = colorSwatch(control, {
            value: color,
            ariaLabel: `${stage} stage color`,
            swatchClass: `ert-stage-${stage}`,
            plugin,
            onChange: (value) => { void (async () => {
                if (/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value)) {
                    (plugin.settings.publishStageColors as Record<string, string>)[stage] = value;
                    await plugin.saveSettings();
                    plugin.setCSSColorVariables();
                    plugin.onSettingChanged(IMPACT_FULL);
                    textInputRef?.setValue(value);
                }
            })(); }
        });

        new Settings(control)
            .addText(textInput => {
                textInputRef = textInput;
                textInput.inputEl.classList.add('ert-hex-input');
                textInput.setValue(color)
                    .onChange(async (value) => {
                        if (/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value)) {
                            (plugin.settings.publishStageColors as Record<string, string>)[stage] = value;
                            await plugin.saveSettings();
                            plugin.setCSSColorVariables();
                            plugin.onSettingChanged(IMPACT_FULL);
                            swatchHandle.setValue(value);
                        }
                    });
            })
            .addExtraButton(button => {
                button.setIcon('reset')
                    .setTooltip('Reset to default')
                    .onClick(async () => {
                        const defaultColor = DEFAULT_SETTINGS.publishStageColors[stage as keyof typeof DEFAULT_SETTINGS.publishStageColors];
                        (plugin.settings.publishStageColors as Record<string, string>)[stage] = defaultColor;
                        await plugin.saveSettings();
                        plugin.setCSSColorVariables();
                        plugin.onSettingChanged(IMPACT_FULL);
                        textInputRef?.setValue(defaultColor);
                        swatchHandle.setValue(defaultColor);
                    });
            });
    });

    // --- Subplot palette (16 colors) ---
    const subplotSection = containerEl.createDiv({ attr: { [ERT_DATA.SECTION]: 'colors-subplot' } });
    const subplotHeading = new Settings(subplotSection)
        .setName('Subplot ring colors')
        .setDesc('Subplot ring colors used for rings 1 through 16 moving inward.')
        .setHeading();
    addHeadingIcon(subplotHeading, 'paintbrush-vertical');
    addWikiLink(subplotHeading, 'Settings-Core#subplot-ring-colors');
    subplotHeading.descEl?.addClass('ert-color-section-desc');
    applyErtHeaderLayout(subplotHeading);
    const subplotGrid = subplotSection.createDiv({ cls: 'ert-color-grid' });
    const ensureArray = (arr: unknown): string[] => Array.isArray(arr) ? arr as string[] : [];
    const subplotColors = ensureArray(plugin.settings.subplotColors);
    const subplotLabels: HTMLDivElement[] = [];
    for (let i = 0; i < 16; i++) {
        const labelText = i === 0 ? 'MAIN PLOT' : `Ring ${i + 1}`;
        const current = subplotColors[i] || DEFAULT_SETTINGS.subplotColors[i];
        const cell = subplotGrid.createDiv({ cls: 'ert-color-grid-item' });
        const label = cell.createDiv({ cls: 'ert-color-grid-label' });
        label.setText(labelText);
        subplotLabels.push(label);

        const control = cell.createDiv({ cls: 'ert-color-grid-controls' });
        let inputRef: TextComponent | undefined;

        const swatchHandle: ColorSwatchHandle = colorSwatch(control, {
            value: current,
            ariaLabel: `Subplot ring ${i + 1} color`,
            swatchClass: `ert-subplot-${i}`,
            plugin,
            onChange: (value) => { void (async () => {
                if (/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value)) {
                    const next = [...(plugin.settings.subplotColors || DEFAULT_SETTINGS.subplotColors)];
                    next[i] = value;
                    plugin.settings.subplotColors = next;
                    await plugin.saveSettings();
                    plugin.setCSSColorVariables();
                    plugin.onSettingChanged(IMPACT_FULL);
                    inputRef?.setValue(value);
                }
            })(); }
        });

        new Settings(control)
            .addText(text => {
                inputRef = text;
                text.inputEl.classList.add('ert-hex-input');
                text.setValue(current)
                    .onChange(async (value) => {
                        if (/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value)) {
                            const next = [...(plugin.settings.subplotColors || DEFAULT_SETTINGS.subplotColors)];
                            next[i] = value;
                            plugin.settings.subplotColors = next;
                            await plugin.saveSettings();
                            plugin.setCSSColorVariables();
                            plugin.onSettingChanged(IMPACT_FULL);
                            swatchHandle.setValue(value);
                        }
                    });
            })
            .addExtraButton(button => {
                button.setIcon('reset')
                    .setTooltip('Reset to default')
                    .onClick(async () => {
                        const value = DEFAULT_SETTINGS.subplotColors[i];
                        const next = [...(plugin.settings.subplotColors || DEFAULT_SETTINGS.subplotColors)];
                        next[i] = value;
                        plugin.settings.subplotColors = next;
                        await plugin.saveSettings();
                        plugin.setCSSColorVariables();
                        plugin.onSettingChanged(IMPACT_FULL);
                        inputRef?.setValue(value);
                        swatchHandle.setValue(value);
                    });
            });
    }

    void (async () => {
        const subplotOrder = await getTimelineSubplotOrder(plugin);
        if (subplotOrder.length === 0) return;
        for (let i = 1; i < subplotLabels.length; i++) {
            const subplotName = subplotOrder[i];
            if (!subplotName || subplotName.toLowerCase() === 'main plot') continue;
            subplotLabels[i].setText(normalizeSubplotLabel(subplotName));
        }
    })();
}
