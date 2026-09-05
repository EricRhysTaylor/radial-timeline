import { App, ButtonComponent, Modal, Notice, Setting as Settings, getIconIds, setIcon, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../../../main';
import { DEFAULT_SETTINGS } from '../../defaults';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../../wikiLink';
import { IconSuggest } from '../../IconSuggest';
import type { HoverMetadataField } from '../../../types/settings';
import { getActiveMigrations, REFACTOR_ALERTS, areAlertMigrationsComplete, dismissAlert } from '../../refactorAlerts';
import { ERT_CLASSES, ERT_DATA } from '../../../ui/classes';
import {
    extractKeysInOrder,
    safeParseYaml,
    type FieldEntryValue,
} from '../../../utils/yamlTemplateNormalize';
import { buildScenePropertyDefinitions } from '../../../sceneProperties/scenePropertyAdapter';
import { SHARED_CHAPTER_FIELD_KEY } from '../../../utils/timelineChapters';

type FieldEntry = { key: string; value: FieldEntryValue; required: boolean };

const DEFAULT_HOVER_ICON = 'align-vertical-space-around';

function ensureSharedChapterEntry(entries: FieldEntry[]): FieldEntry[] {
    if (entries.some((entry) => entry.key === SHARED_CHAPTER_FIELD_KEY)) {
        return entries;
    }
    return [{ key: SHARED_CHAPTER_FIELD_KEY, value: '', required: false }, ...entries];
}

function mergeOrders(primary: string[], secondary: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    [...primary, ...secondary].forEach(key => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    });
    return result;
}

function buildYamlFromEntries(entries: FieldEntry[], commentMap?: Record<string, string>): string {
    const lines: string[] = [];
    entries.forEach(entry => {
        const comment = commentMap?.[entry.key];
        if (Array.isArray(entry.value)) {
            lines.push(comment ? `${entry.key}: # ${comment}` : `${entry.key}:`);
            entry.value.forEach((value: string) => {
                lines.push(`  - ${value}`);
            });
        } else {
            const value = entry.value ?? '';
            lines.push(comment ? `${entry.key}: ${value} # ${comment}` : `${entry.key}: ${value}`);
        }
    });
    return lines.join('\n');
}

function entriesFromTemplate(template: string, requiredOrder: string[]): FieldEntry[] {
    const order = mergeOrders(extractKeysInOrder(template), requiredOrder);
    const obj = safeParseYaml(template);
    return order.map(key => ({
        key,
        value: obj[key] ?? '',
        required: requiredOrder.includes(key)
    }));
}

function createBadge(container: HTMLElement, text: string, variant: 'neutral' | 'success' = 'neutral'): HTMLElement {
    const badge = container.createSpan({
        cls: ['ert-badgePill', 'ert-badgePill--sm', variant === 'neutral' ? 'ert-badgePill--neutral' : 'ert-badgePill--pro']
    });
    badge.createSpan({ cls: 'ert-badgePill__text', text });
    return badge;
}

export function renderScenePropertiesSection(params: {
    app: App;
    plugin: RadialTimelinePlugin;
    parentEl: HTMLElement;
}): void {
    const { app, plugin, parentEl } = params;
    parentEl.setAttr(ERT_DATA.SECTION, 'scene-properties');

    const sectionHeading = new Settings(parentEl)
        .setName('Scene properties')
        .setHeading();
    addHeadingIcon(sectionHeading, 'form');
    addWikiLink(sectionHeading, 'Settings-Core#scene-properties');
    applyErtHeaderLayout(sectionHeading);

    const sectionStack = parentEl.createDiv({ cls: ['ert-scene-template-editor', 'ert-stack', 'ert-scene-settings-stack'] });
    const dispatchAdvancedMaintenanceChange = () => {
        parentEl.dispatchEvent(new CustomEvent('ert:scene-advanced-maintenance-changed', {
            bubbles: false,
            detail: { enabled: plugin.settings.sceneAdvancedPropertiesEnabled ?? true }
        }));
    };

    const coreSetting = new Settings(sectionStack)
        .setName('Core properties')
        .setDesc('Always included in scene notes. Required by Radial Timeline and maintained automatically.');
    coreSetting.settingEl.addClass('ert-scene-properties-row', 'ert-scene-properties-row--locked');
    coreSetting.descEl.createDiv({
        cls: 'ert-scene-properties-inline-list',
        text: buildScenePropertyDefinitions(plugin.settings).core.map((definition) => definition.key).join(', ')
    });
    createBadge(coreSetting.controlEl, 'Always on');

    const advancedSetting = new Settings(sectionStack)
        .setName('Advanced properties')
        .setDesc('Optional scene metadata. Edit these fields here, reveal them in hover, and choose whether Radial Timeline maintains them in scenes.');
    advancedSetting.settingEl.addClass('ert-scene-properties-row', 'ert-scene-properties-row--advanced');
    const advancedStatusEl = advancedSetting.nameEl.createSpan({ cls: 'ert-scene-properties-status' });
    advancedSetting.nameEl.prepend(advancedStatusEl);
    const advancedStateEl = advancedSetting.controlEl.createSpan({ cls: 'ert-scene-properties-state' });
    advancedSetting.addToggle((toggle) => {
        toggle
            .setTooltip('Maintain advanced properties in scene notes')
            .setValue(plugin.settings.sceneAdvancedPropertiesEnabled ?? true)
            .onChange(async (value) => {
                plugin.settings.sceneAdvancedPropertiesEnabled = value;
                if (value) {
                    plugin.settings.enableAdvancedYamlEditor = true;
                } else {
                    plugin.settings.enableAdvancedYamlEditor = false;
                }
                refreshAdvancedRowState();
                refreshAdvancedToggle();
                await plugin.saveSettings();
                renderAdvancedEditor();
                renderHoverPreview();
                dispatchAdvancedMaintenanceChange();
            });
    });
    const advancedDivider = advancedSetting.controlEl.createSpan({ cls: 'ert-scene-properties-divider' });
    advancedDivider.setAttribute('aria-hidden', 'true');

    const advancedToggleButton = advancedSetting.controlEl.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: {
            type: 'button',
            'aria-label': 'Show advanced properties editor'
        }
    });
    const advancedPanel = sectionStack.createDiv({ cls: ['ert-panel', 'ert-advanced-template-card', 'ert-scene-properties-panel', 'ert-scene-properties-subordinate'] });
    const hoverPreviewContainer = sectionStack.createDiv({
        cls: ['ert-previewFrame', 'ert-previewFrame--center', 'ert-previewFrame--flush', 'ert-scene-properties-subordinate'],
        attr: { 'data-preview': 'metadata' }
    });
    const hoverPreviewHeading = hoverPreviewContainer.createDiv({ cls: 'ert-planetary-preview-heading', text: 'Scene Hover Preview' });
    const hoverPreviewBody = hoverPreviewContainer.createDiv({ cls: ['ert-hover-preview-body', 'ert-stack'] });

    const getHoverMetadata = (key: string): HoverMetadataField | undefined => {
        return plugin.settings.hoverMetadataFields?.find(field => field.key === key);
    };

    const setHoverMetadata = (key: string, icon: string, enabled: boolean) => {
        if (!plugin.settings.hoverMetadataFields) {
            plugin.settings.hoverMetadataFields = [];
        }
        const existing = plugin.settings.hoverMetadataFields.find(field => field.key === key);
        if (existing) {
            existing.icon = icon;
            existing.enabled = enabled;
        } else {
            plugin.settings.hoverMetadataFields.push({ key, label: key, icon, enabled });
        }
        void plugin.saveSettings();
    };

    const removeHoverMetadata = (key: string) => {
        if (!plugin.settings.hoverMetadataFields) return;
        plugin.settings.hoverMetadataFields = plugin.settings.hoverMetadataFields.filter(field => field.key !== key);
        void plugin.saveSettings();
    };

    const renameHoverMetadataKey = (oldKey: string, newKey: string) => {
        const existing = plugin.settings.hoverMetadataFields?.find(field => field.key === oldKey);
        if (existing) {
            existing.key = newKey;
            existing.label = newKey;
            void plugin.saveSettings();
        }
    };

    const reorderHoverMetadataToMatchYaml = (yamlKeys: string[]) => {
        if (!plugin.settings.hoverMetadataFields) return;
        const keyOrder = new Map(yamlKeys.map((key, idx) => [key, idx]));
        plugin.settings.hoverMetadataFields.sort((left, right) => {
            const leftIdx = keyOrder.get(left.key) ?? Infinity;
            const rightIdx = keyOrder.get(right.key) ?? Infinity;
            return leftIdx - rightIdx;
        });
        void plugin.saveSettings();
    };

    const refreshAdvancedRowState = () => {
        const maintained = plugin.settings.sceneAdvancedPropertiesEnabled ?? true;
        advancedSetting.settingEl.toggleClass('is-active', maintained);
        advancedStatusEl.toggleClass('ert-scene-properties-status--active', maintained);
        setIcon(advancedStatusEl, maintained ? 'check-circle-2' : 'circle');
        advancedStateEl.setText('');
        const tooltip = maintained ? 'Advanced properties are enabled' : 'Advanced properties are disabled';
        setTooltip(advancedSetting.settingEl, tooltip);
        setTooltip(advancedStatusEl, tooltip);
    };

    const refreshAdvancedToggle = () => {
        const expanded = plugin.settings.enableAdvancedYamlEditor ?? false;
        setIcon(advancedToggleButton, expanded ? 'chevron-down' : 'chevron-right');
        setTooltip(advancedToggleButton, expanded ? 'Hide advanced properties editor' : 'Show advanced properties editor');
        advancedToggleButton.setAttribute('aria-label', expanded ? 'Hide advanced properties editor' : 'Show advanced properties editor');
    };
    refreshAdvancedRowState();
    refreshAdvancedToggle();

    advancedToggleButton.addEventListener('click', () => { void (async () => {
        plugin.settings.enableAdvancedYamlEditor = !(plugin.settings.enableAdvancedYamlEditor ?? false);
        refreshAdvancedToggle();
        await plugin.saveSettings();
        renderAdvancedEditor();
    })(); });

    const renderHoverPreview = () => {
        hoverPreviewBody.empty();
        const advancedEnabled = plugin.settings.sceneAdvancedPropertiesEnabled ?? true;
        hoverPreviewContainer.toggleClass('ert-settings-hidden', !advancedEnabled);
        if (!advancedEnabled) {
            return;
        }
        const enabledFields = (plugin.settings.hoverMetadataFields || []).filter(field => field.enabled);
        const currentTemplate = plugin.settings.sceneYamlTemplates?.advanced ?? '';
        const templateObj = safeParseYaml(currentTemplate);

        if (enabledFields.length === 0) {
            hoverPreviewHeading.setText('Scene hover preview (none enabled)');
            hoverPreviewBody.createDiv({
                text: 'Enable fields in advanced properties to preview what scene hover reveals will look like.',
                cls: 'ert-hover-preview-empty'
            });
            return;
        }

        hoverPreviewHeading.setText(`Scene Hover Preview (${enabledFields.length} field${enabledFields.length !== 1 ? 's' : ''})`);
        enabledFields.forEach((field) => {
            const lineEl = hoverPreviewBody.createDiv({ cls: 'ert-hover-preview-line' });
            const iconEl = lineEl.createSpan({ cls: 'ert-hover-preview-icon' });
            setIcon(iconEl, field.icon || DEFAULT_HOVER_ICON);
            const value = templateObj[field.key];
            const valueText = Array.isArray(value) ? value.join(', ') : (value ?? '');
            lineEl.createSpan({
                text: valueText ? `${field.key}: ${valueText}` : field.key,
                cls: 'ert-hover-preview-text'
            });
        });
    };

    const renderAdvancedEditor = () => {
        advancedPanel.empty();

        const currentTemplate = plugin.settings.sceneYamlTemplates?.advanced ?? '';
        const activeMigrations = getActiveMigrations(plugin.settings);
        const hasPendingMigrations = activeMigrations.some((migration) => currentTemplate.includes(`${migration.oldKey}:`));
        let expanded = plugin.settings.enableAdvancedYamlEditor ?? false;
        if (hasPendingMigrations && !expanded) {
            expanded = true;
            plugin.settings.enableAdvancedYamlEditor = true;
            void plugin.saveSettings();
            refreshAdvancedToggle();
        }

        advancedPanel.toggleClass('ert-settings-hidden', !expanded);
        if (!expanded) return;

        const defaultTemplate = DEFAULT_SETTINGS.sceneYamlTemplates!.advanced;
        const baseTemplate = DEFAULT_SETTINGS.sceneYamlTemplates!.base;
        const requiredOrder = extractKeysInOrder(baseTemplate);
        const defaultObj = safeParseYaml(defaultTemplate);
        const currentObj = safeParseYaml(currentTemplate);
        const optionalOrder = mergeOrders(
            extractKeysInOrder(currentTemplate).filter((key) => !requiredOrder.includes(key)),
            extractKeysInOrder(defaultTemplate).filter((key) => !requiredOrder.includes(key))
        );

        const entries = ensureSharedChapterEntry(optionalOrder.map((key) => ({
            key,
            value: currentObj[key] ?? defaultObj[key] ?? '',
            required: false,
        })));

        let workingEntries = entries;
        let dragIndex: number | null = null;

        const advancedComments: Record<string, string> = {
            Duration: 'Free text duration (e.g., "45 minutes", "2 hours", "PT45M")',
            'Reader Emotion': 'Describe the intended reader emotion',
        };

        const saveEntries = (nextEntries: FieldEntry[]) => {
            workingEntries = nextEntries;
            const yaml = buildYamlFromEntries(nextEntries, advancedComments);
            if (!plugin.settings.sceneYamlTemplates) {
                plugin.settings.sceneYamlTemplates = {
                    base: DEFAULT_SETTINGS.sceneYamlTemplates!.base,
                    advanced: '',
                };
            }
            plugin.settings.sceneYamlTemplates.advanced = yaml;
            void plugin.saveSettings();
        };

        const rerender = (next?: FieldEntry[]) => {
            const data = next ?? workingEntries;
            workingEntries = data;
            advancedPanel.empty();
            advancedPanel.toggleClass('ert-settings-hidden', !expanded);
            if (!expanded) return;

            const listEl = advancedPanel.createDiv({ cls: ['ert-template-entries', 'ert-template-indent'] });

            const renderEntryRow = (entry: FieldEntry, idx: number, list: FieldEntry[]) => {
                const migration = activeMigrations.find((item) => item.oldKey === entry.key);
                const alert = migration ? REFACTOR_ALERTS.find((item) => item.id === migration.alertId) : undefined;
                const rowClasses = ['ert-yaml-row', 'ert-yaml-row--hover-meta'];
                if (migration) {
                    rowClasses.push('ert-yaml-row--needs-migration');
                    if (alert) rowClasses.push(`ert-yaml-row--${alert.severity}`);
                }
                const row = listEl.createDiv({ cls: rowClasses });

                const hoverMeta = getHoverMetadata(entry.key);
                const currentIcon = hoverMeta?.icon ?? DEFAULT_HOVER_ICON;
                const currentEnabled = hoverMeta?.enabled ?? false;

                const dragHandle = row.createDiv({ cls: 'ert-drag-handle' });
                dragHandle.draggable = true;
                setIcon(dragHandle, 'grip-vertical');
                setTooltip(dragHandle, 'Drag to reorder property');

                row.createDiv({ cls: 'ert-grid-spacer' });

                const iconWrapper = row.createDiv({ cls: 'ert-hover-icon-wrapper' });
                const iconPreview = iconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
                setIcon(iconPreview, currentIcon);
                const iconInput = iconWrapper.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--md ert-icon-input',
                    attr: { placeholder: 'Icon name...' }
                });
                iconInput.value = currentIcon;
                setTooltip(iconInput, 'Lucide icon name for scene hover');

                const checkboxWrapper = row.createDiv({ cls: 'ert-hover-checkbox-wrapper' });
                const checkbox = checkboxWrapper.createEl('input', {
                    type: 'checkbox',
                    cls: 'ert-hover-checkbox'
                });
                checkbox.checked = currentEnabled;
                setTooltip(checkbox, 'Reveal in scene hover');

                new IconSuggest(app, iconInput, (selectedIcon) => {
                    iconInput.value = selectedIcon;
                    iconPreview.empty();
                    setIcon(iconPreview, selectedIcon);
                    setHoverMetadata(entry.key, selectedIcon, checkbox.checked);
                    renderHoverPreview();
                });

                iconInput.oninput = () => {
                    const iconName = iconInput.value.trim();
                    if (iconName && getIconIds().includes(iconName)) {
                        iconPreview.empty();
                        setIcon(iconPreview, iconName);
                        setHoverMetadata(entry.key, iconName, checkbox.checked);
                        renderHoverPreview();
                    }
                };

                checkbox.onchange = () => {
                    const iconName = iconInput.value.trim() || DEFAULT_HOVER_ICON;
                    setHoverMetadata(entry.key, iconName, checkbox.checked);
                    renderHoverPreview();
                };

                const keyInput = row.createEl('input', { type: 'text', cls: 'ert-input ert-input--md' });
                keyInput.value = entry.key;
                keyInput.placeholder = 'Property';
                keyInput.onchange = () => {
                    const newKey = keyInput.value.trim();
                    if (!newKey) {
                        keyInput.value = entry.key;
                        return;
                    }
                    if (requiredOrder.includes(newKey)) {
                        new Notice(`"${newKey}" is already part of Core Properties. Choose another name.`);
                        keyInput.value = entry.key;
                        return;
                    }
                    if (list.some((item, itemIdx) => itemIdx !== idx && item.key === newKey)) {
                        new Notice(`Property "${newKey}" already exists.`);
                        keyInput.value = entry.key;
                        return;
                    }
                    renameHoverMetadataKey(entry.key, newKey);
                    const nextList = [...list];
                    nextList[idx] = { ...entry, key: newKey };
                    saveEntries(nextList);
                    rerender(nextList);
                    renderHoverPreview();
                };

                const valueInput = row.createEl('input', { type: 'text', cls: 'ert-input ert-input--md' });
                if (Array.isArray(entry.value)) {
                    valueInput.value = entry.value.join(', ');
                    valueInput.placeholder = 'Comma-separated values';
                    valueInput.onchange = () => {
                        const nextList = [...list];
                        nextList[idx] = {
                            ...entry,
                            value: valueInput.value.split(',').map((value) => value.trim()).filter(Boolean)
                        };
                        saveEntries(nextList);
                        renderHoverPreview();
                    };
                } else {
                    valueInput.value = entry.value ?? '';
                    valueInput.placeholder = 'Value';
                    valueInput.onchange = () => {
                        const nextList = [...list];
                        nextList[idx] = { ...entry, value: valueInput.value };
                        saveEntries(nextList);
                        renderHoverPreview();
                    };
                }

                if (migration && alert) {
                    const migrateBtn = row.createEl('button', {
                        cls: ['ert-iconBtn', 'ert-migrate-btn', `ert-migrate-btn--${alert.severity}`],
                        attr: { 'aria-label': migration.tooltip }
                    });
                    setIcon(migrateBtn, 'arrow-right-circle');
                    setTooltip(migrateBtn, migration.tooltip);
                    migrateBtn.onclick = async () => {
                        const oldKey = entry.key;
                        entry.key = migration.newKey;
                        renameHoverMetadataKey(oldKey, migration.newKey);
                        saveEntries(list);
                        const template = plugin.settings.sceneYamlTemplates?.advanced ?? '';
                        const alertObj = REFACTOR_ALERTS.find((item) => item.id === migration.alertId);
                        if (alertObj && areAlertMigrationsComplete(alertObj, template)) {
                            dismissAlert(migration.alertId, plugin.settings);
                            await plugin.saveSettings();
                            const alertEl = migrateBtn.ownerDocument.querySelector(`[data-alert-id="${migration.alertId}"]`);
                            if (alertEl) alertEl.remove();
                            new Notice('Migration complete. Alert dismissed.');
                        }
                        rerender(list);
                        renderHoverPreview();
                    };
                } else {
                    const deleteBtn = row.createEl('button', { cls: 'ert-iconBtn' });
                    setIcon(deleteBtn, 'trash');
                    setTooltip(deleteBtn, 'Remove property');
                    deleteBtn.onclick = () => {
                        removeHoverMetadata(entry.key);
                        const nextList = list.filter((_, itemIdx) => itemIdx !== idx);
                        saveEntries(nextList);
                        rerender(nextList);
                        renderHoverPreview();
                    };
                }

                dragHandle.addEventListener('dragstart', (event) => {
                    dragIndex = idx;
                    row.classList.add('is-dragging');
                    event.dataTransfer?.setData('text/plain', idx.toString());
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                });
                dragHandle.addEventListener('dragend', () => {
                    row.classList.remove('is-dragging');
                    row.classList.remove('ert-template-dragover');
                    dragIndex = null;
                });
                row.addEventListener('dragover', (event) => {
                    event.preventDefault();
                    row.classList.add('ert-template-dragover');
                });
                row.addEventListener('dragleave', () => {
                    row.classList.remove('ert-template-dragover');
                });
                row.addEventListener('drop', (event) => {
                    event.preventDefault();
                    row.classList.remove('ert-template-dragover');
                    const from = dragIndex ?? parseInt(event.dataTransfer?.getData('text/plain') || '-1', 10);
                    if (Number.isNaN(from) || from < 0 || from >= list.length || from === idx) {
                        dragIndex = null;
                        return;
                    }
                    const nextList = [...list];
                    const [moved] = nextList.splice(from, 1);
                    nextList.splice(idx, 0, moved);
                    dragIndex = null;
                    saveEntries(nextList);
                    reorderHoverMetadataToMatchYaml(nextList.map((item) => item.key));
                    rerender(nextList);
                    renderHoverPreview();
                });
            };

            data.forEach((entry, idx, arr) => renderEntryRow(entry, idx, arr));

            const addRow = listEl.createDiv({ cls: ['ert-yaml-row', 'ert-yaml-row--add', 'ert-yaml-row--hover-meta'] });
            addRow.createDiv({ cls: ['ert-drag-handle', 'ert-drag-placeholder'] });
            addRow.createDiv({ cls: 'ert-grid-spacer' });

            const addIconWrapper = addRow.createDiv({ cls: 'ert-hover-icon-wrapper' });
            const addIconPreview = addIconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
            setIcon(addIconPreview, DEFAULT_HOVER_ICON);
            const addIconInput = addIconWrapper.createEl('input', {
                type: 'text',
                cls: 'ert-input ert-input--md ert-icon-input',
                attr: { placeholder: 'Icon name...' }
            });
            addIconInput.value = DEFAULT_HOVER_ICON;
            setTooltip(addIconInput, 'Lucide icon name for scene hover');
            new IconSuggest(app, addIconInput, (selectedIcon) => {
                addIconInput.value = selectedIcon;
                addIconPreview.empty();
                setIcon(addIconPreview, selectedIcon);
            });
            addIconInput.oninput = () => {
                const iconName = addIconInput.value.trim();
                if (iconName && getIconIds().includes(iconName)) {
                    addIconPreview.empty();
                    setIcon(addIconPreview, iconName);
                }
            };

            const addCheckboxWrapper = addRow.createDiv({ cls: 'ert-hover-checkbox-wrapper' });
            const addCheckbox = addCheckboxWrapper.createEl('input', {
                type: 'checkbox',
                cls: 'ert-hover-checkbox'
            });
            addCheckbox.checked = false;
            setTooltip(addCheckbox, 'Reveal in scene hover');

            const keyInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: 'New property' } });
            const valueInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: 'Value' } });
            const buttonWrap = addRow.createDiv({ cls: ['ert-iconBtnGroup', 'ert-template-actions'] });

            const addBtn = buttonWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-mod-cta'] });
            setIcon(addBtn, 'plus');
            setTooltip(addBtn, 'Add property');
            addBtn.onclick = () => {
                const key = keyInput.value.trim();
                if (!key) return;
                if (requiredOrder.includes(key)) {
                    new Notice(`"${key}" already exists in Core Properties.`);
                    return;
                }
                if (data.some((item) => item.key === key)) {
                    new Notice(`Property "${key}" already exists.`);
                    return;
                }
                const iconName = addIconInput.value.trim() || DEFAULT_HOVER_ICON;
                if (addCheckbox.checked || iconName !== DEFAULT_HOVER_ICON) {
                    setHoverMetadata(key, iconName, addCheckbox.checked);
                }
                const nextList = [...data, { key, value: valueInput.value || '', required: false }];
                saveEntries(nextList);
                rerender(nextList);
                renderHoverPreview();
            };

            const resetBtn = buttonWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-template-reset-btn'] });
            setIcon(resetBtn, 'rotate-ccw');
            setTooltip(resetBtn, 'Reset advanced properties to the default built-in set');
            resetBtn.onclick = async () => {
                const confirmed = await new Promise<boolean>((resolve) => {
                    const modal = new Modal(app);
                    modal.titleEl.setText('');
                    modal.contentEl.empty();
                    modal.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
                    modal.contentEl.addClass('ert-modal-container', 'ert-stack');

                    const header = modal.contentEl.createDiv({ cls: 'ert-modal-header' });
                    header.createSpan({ text: 'SCENE PROPERTIES', cls: 'ert-modal-badge' });
                    header.createDiv({ text: 'Reset advanced properties', cls: 'ert-modal-title' });
                    header.createDiv({
                        text: 'Resetting will remove renamed and custom advanced properties, clear hover icons, and restore the built-in advanced properties.',
                        cls: 'ert-modal-subtitle'
                    });

                    const body = modal.contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
                    body.createDiv({ text: 'This cannot be undone.', cls: 'ert-purge-warning' });

                    const footer = modal.contentEl.createDiv({ cls: ['ert-modal-actions', 'ert-inline-actions'] });
                    new ButtonComponent(footer).setButtonText('Reset to default').setDestructive().onClick(() => {
                        modal.close();
                        resolve(true);
                    });
                    new ButtonComponent(footer).setButtonText('Cancel').onClick(() => {
                        modal.close();
                        resolve(false);
                    });

                    modal.open();
                });

                if (!confirmed) return;

                if (!plugin.settings.sceneYamlTemplates) {
                    plugin.settings.sceneYamlTemplates = {
                        base: DEFAULT_SETTINGS.sceneYamlTemplates!.base,
                        advanced: '',
                    };
                }
                plugin.settings.sceneYamlTemplates.advanced = defaultTemplate;
                plugin.settings.hoverMetadataFields = [];
                await plugin.saveSettings();
                const resetEntries = entriesFromTemplate(defaultTemplate, requiredOrder).filter((entry) => !entry.required);
                rerender(resetEntries);
                renderHoverPreview();
            };
        };

        rerender(entries);
    };

    renderAdvancedEditor();
    renderHoverPreview();
}
