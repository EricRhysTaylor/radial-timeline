import { setAccessibleLabel, setTooltip, withAccessibleLabel, withTooltip } from '../../../utils/domTooltip';
import { App, ButtonComponent, Modal, Notice, Setting as Settings, getIconIds, setIcon} from 'obsidian';
import type RadialTimelinePlugin from '../../../main';
import { t, tCount } from '../../../i18n';
import { DEFAULT_SETTINGS } from '../../defaults';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../../wikiLink';
import { IconSuggest } from '../../IconSuggest';
import type { HoverMetadataField } from '../../../types/settings';
import { getActiveMigrations, REFACTOR_ALERTS, areAlertMigrationsComplete, dismissAlert } from '../../refactorAlerts';
import { ERT_CLASSES, ERT_DATA } from '../../../ui/classes';
import { getBaseKeys, getTemplateParts, safeParseYaml } from '../../../utils/yamlTemplateNormalize';
import {
    buildScenePropertyDefinitions,
    isValidPropertyName,
    newAdvancedEntry,
    parseAdvancedEntries,
    serializeAdvancedEntries,
    withEntryKey,
    withEntryValue,
    type AdvancedTemplateEntry,
} from '../../../sceneProperties/scenePropertyAdapter';
import { SHARED_CHAPTER_FIELD_KEY } from '../../../utils/timelineChapters';

const DEFAULT_HOVER_ICON = 'align-vertical-space-around';

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
        .setName(t('ui.scenePropertiesSection.heading'))
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
        .setName(t('ui.scenePropertiesSection.coreName'))
        .setDesc(t('ui.scenePropertiesSection.coreDesc'));
    coreSetting.settingEl.addClass('ert-scene-properties-row', 'ert-scene-properties-row--locked');
    coreSetting.descEl.createDiv({
        cls: 'ert-scene-properties-inline-list',
        text: buildScenePropertyDefinitions(plugin.settings).core.map((definition) => definition.key).join(', ')
    });
    createBadge(coreSetting.controlEl, t('ui.scenePropertiesSection.alwaysOnBadge'));

    const advancedSetting = new Settings(sectionStack)
        .setName(t('ui.scenePropertiesSection.advancedName'))
        .setDesc(t('ui.scenePropertiesSection.advancedDesc'));
    advancedSetting.settingEl.addClass('ert-scene-properties-row', 'ert-scene-properties-row--advanced');
    const advancedStatusEl = advancedSetting.nameEl.createSpan({ cls: 'ert-scene-properties-status' });
    advancedSetting.nameEl.prepend(advancedStatusEl);
    const advancedStateEl = advancedSetting.controlEl.createSpan({ cls: 'ert-scene-properties-state' });
    advancedSetting.addToggle((toggle) => {
        withTooltip(toggle, t('ui.scenePropertiesSection.maintainToggleTooltip'))
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

    const advancedToggleButton = withAccessibleLabel(advancedSetting.controlEl.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: { type: 'button' }
    }), t('ui.scenePropertiesSection.showEditor'));
    const advancedPanel = sectionStack.createDiv({ cls: ['ert-panel', 'ert-advanced-template-card', 'ert-scene-properties-panel', 'ert-scene-properties-subordinate'] });
    const hoverPreviewContainer = sectionStack.createDiv({
        cls: ['ert-previewFrame', 'ert-previewFrame--center', 'ert-previewFrame--flush', 'ert-scene-properties-subordinate'],
        attr: { 'data-preview': 'metadata' }
    });
    const hoverPreviewHeading = hoverPreviewContainer.createDiv({ cls: 'ert-planetary-preview-heading', text: t('ui.scenePropertiesSection.hoverPreviewHeading') });
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
        const tooltip = maintained ? t('ui.scenePropertiesSection.advancedEnabledTooltip') : t('ui.scenePropertiesSection.advancedDisabledTooltip');
        setTooltip(advancedStatusEl, tooltip);
    };

    const refreshAdvancedToggle = () => {
        const expanded = plugin.settings.enableAdvancedYamlEditor ?? false;
        setIcon(advancedToggleButton, expanded ? 'chevron-down' : 'chevron-right');
        setAccessibleLabel(advancedToggleButton, expanded ? t('ui.scenePropertiesSection.hideEditor') : t('ui.scenePropertiesSection.showEditor'));
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
            hoverPreviewHeading.setText(t('ui.scenePropertiesSection.hoverPreviewNoneEnabled'));
            hoverPreviewBody.createDiv({
                text: t('ui.scenePropertiesSection.hoverPreviewEnableHint'),
                cls: 'ert-hover-preview-empty'
            });
            return;
        }

        hoverPreviewHeading.setText(t('ui.scenePropertiesSection.hoverPreviewHeadingCount', { fields: tCount('field', enabledFields.length) }));
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
        const coreKeys = getBaseKeys('Scene', plugin.settings).map((key) => key.toLowerCase());
        const isCoreKey = (key: string) => coreKeys.includes(key.toLowerCase());
        const entries = parseAdvancedEntries(currentTemplate).filter((entry) => !isCoreKey(entry.key));

        let workingEntries = entries;
        let dragIndex: number | null = null;

        const saveEntries = (nextEntries: AdvancedTemplateEntry[]) => {
            workingEntries = nextEntries;
            plugin.settings.sceneYamlTemplates = {
                base: getTemplateParts('Scene', plugin.settings).base,
                advanced: serializeAdvancedEntries(nextEntries),
            };
            void plugin.saveSettings();
        };

        const canUseKey = (key: string, others: AdvancedTemplateEntry[]): boolean => {
            if (!isValidPropertyName(key)) {
                new Notice(t('ui.scenePropertiesSection.invalidPropertyNameNotice', { key }));
                return false;
            }
            if (isCoreKey(key)) {
                new Notice(t('ui.scenePropertiesSection.corePropertyNameNotice', { key }));
                return false;
            }
            if (others.some((item) => item.key.toLowerCase() === key.toLowerCase())) {
                new Notice(t('ui.scenePropertiesSection.propertyExistsNotice', { key }));
                return false;
            }
            return true;
        };

        const rerender = (next?: AdvancedTemplateEntry[]) => {
            const data = next ?? workingEntries;
            workingEntries = data;
            advancedPanel.empty();
            advancedPanel.toggleClass('ert-settings-hidden', !expanded);
            if (!expanded) return;

            const listEl = advancedPanel.createDiv({ cls: ['ert-template-entries', 'ert-template-indent'] });

            // Chapter is a Core property. This row only chooses whether hover reveals it.
            const renderChapterRow = () => {
                const row = listEl.createDiv({ cls: ['ert-yaml-row', 'ert-yaml-row--hover-meta'] });
                const hoverMeta = getHoverMetadata(SHARED_CHAPTER_FIELD_KEY);
                row.createDiv({ cls: ['ert-drag-handle', 'ert-drag-placeholder'] });
                row.createDiv({ cls: 'ert-grid-spacer' });
                const iconWrapper = row.createDiv({ cls: 'ert-hover-icon-wrapper' });
                const iconPreview = iconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
                setIcon(iconPreview, hoverMeta?.icon ?? DEFAULT_HOVER_ICON);
                const iconInput = iconWrapper.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--md ert-icon-input',
                    attr: { placeholder: t('ui.scenePropertiesSection.iconPlaceholder') }
                });
                iconInput.value = hoverMeta?.icon ?? DEFAULT_HOVER_ICON;
                setTooltip(iconInput, t('ui.scenePropertiesSection.iconTooltip'));
                const checkbox = row.createDiv({ cls: 'ert-hover-checkbox-wrapper' }).createEl('input', {
                    type: 'checkbox',
                    cls: 'ert-hover-checkbox'
                });
                checkbox.checked = hoverMeta?.enabled ?? false; // SAFE: a field without hover settings is not shown on hover
                setTooltip(checkbox, t('ui.scenePropertiesSection.revealTooltip'));
                const applyIcon = (iconName: string) => {
                    iconPreview.empty();
                    setIcon(iconPreview, iconName);
                    setHoverMetadata(SHARED_CHAPTER_FIELD_KEY, iconName, checkbox.checked);
                    renderHoverPreview();
                };
                new IconSuggest(app, iconInput, (selectedIcon) => {
                    iconInput.value = selectedIcon;
                    applyIcon(selectedIcon);
                });
                iconInput.oninput = () => {
                    const iconName = iconInput.value.trim();
                    if (iconName && getIconIds().includes(iconName)) applyIcon(iconName);
                };
                checkbox.onchange = () => {
                    setHoverMetadata(SHARED_CHAPTER_FIELD_KEY, iconInput.value.trim() || DEFAULT_HOVER_ICON, checkbox.checked);
                    renderHoverPreview();
                };
                const keyInput = row.createEl('input', { type: 'text', cls: 'ert-input ert-input--md' });
                keyInput.value = SHARED_CHAPTER_FIELD_KEY;
                keyInput.disabled = true;
                const scopeInput = row.createEl('input', { type: 'text', cls: 'ert-input ert-input--md' });
                scopeInput.value = t('ui.scenePropertiesSection.coreName');
                scopeInput.disabled = true;
                const lock = row.createEl('button', { cls: 'ert-iconBtn' });
                lock.disabled = true;
                setIcon(lock, 'lock');
                setAccessibleLabel(lock, t('ui.scenePropertiesSection.alwaysOnBadge'));
            };

            // Editing a value does not rebuild the rows, so handlers read the live
            // list. A list captured at render time would undo that edit on the next action.
            const renderEntryRow = (entry: AdvancedTemplateEntry, idx: number) => {
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
                setTooltip(dragHandle, t('ui.scenePropertiesSection.dragTooltip'));

                row.createDiv({ cls: 'ert-grid-spacer' });

                const iconWrapper = row.createDiv({ cls: 'ert-hover-icon-wrapper' });
                const iconPreview = iconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
                setIcon(iconPreview, currentIcon);
                const iconInput = iconWrapper.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--md ert-icon-input',
                    attr: { placeholder: t('ui.scenePropertiesSection.iconPlaceholder') }
                });
                iconInput.value = currentIcon;
                setTooltip(iconInput, t('ui.scenePropertiesSection.iconTooltip'));

                const checkboxWrapper = row.createDiv({ cls: 'ert-hover-checkbox-wrapper' });
                const checkbox = checkboxWrapper.createEl('input', {
                    type: 'checkbox',
                    cls: 'ert-hover-checkbox'
                });
                checkbox.checked = currentEnabled;
                setTooltip(checkbox, t('ui.scenePropertiesSection.revealTooltip'));

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
                keyInput.placeholder = t('ui.scenePropertiesSection.propertyPlaceholder');
                keyInput.onchange = () => {
                    const current = workingEntries[idx];
                    const newKey = keyInput.value.trim();
                    if (!newKey) {
                        keyInput.value = current.key;
                        return;
                    }
                    if (newKey === current.key) return;
                    if (!canUseKey(newKey, workingEntries.filter((_, itemIdx) => itemIdx !== idx))) {
                        keyInput.value = current.key;
                        return;
                    }
                    renameHoverMetadataKey(current.key, newKey);
                    const nextList = [...workingEntries];
                    nextList[idx] = withEntryKey(current, newKey);
                    saveEntries(nextList);
                    rerender(nextList);
                    renderHoverPreview();
                };

                const valueInput = row.createEl('input', { type: 'text', cls: 'ert-input ert-input--md' });
                if (Array.isArray(entry.value)) {
                    valueInput.value = entry.value.join(', ');
                    valueInput.placeholder = t('ui.scenePropertiesSection.commaSeparatedPlaceholder');
                    valueInput.onchange = () => {
                        const nextList = [...workingEntries];
                        nextList[idx] = withEntryValue(nextList[idx], valueInput.value.split(',').map((value) => value.trim()).filter(Boolean));
                        saveEntries(nextList);
                        renderHoverPreview();
                    };
                } else {
                    valueInput.value = entry.value ?? '';
                    valueInput.placeholder = t('ui.scenePropertiesSection.valuePlaceholder');
                    valueInput.onchange = () => {
                        const nextList = [...workingEntries];
                        nextList[idx] = withEntryValue(nextList[idx], valueInput.value);
                        saveEntries(nextList);
                        renderHoverPreview();
                    };
                }

                if (migration && alert) {
                    const migrateBtn = withAccessibleLabel(row.createEl('button', {
                        cls: ['ert-iconBtn', 'ert-migrate-btn', `ert-migrate-btn--${alert.severity}`],
                    }), migration.tooltip);
                    setIcon(migrateBtn, 'arrow-right-circle');
                    setTooltip(migrateBtn, migration.tooltip);
                    migrateBtn.onclick = async () => {
                        const nextList = [...workingEntries];
                        renameHoverMetadataKey(nextList[idx].key, migration.newKey);
                        nextList[idx] = withEntryKey(nextList[idx], migration.newKey);
                        saveEntries(nextList);
                        const template = plugin.settings.sceneYamlTemplates?.advanced ?? '';
                        const alertObj = REFACTOR_ALERTS.find((item) => item.id === migration.alertId);
                        if (alertObj && areAlertMigrationsComplete(alertObj, template)) {
                            dismissAlert(migration.alertId, plugin.settings);
                            await plugin.saveSettings();
                            const alertEl = migrateBtn.ownerDocument.querySelector(`[data-alert-id="${migration.alertId}"]`);
                            if (alertEl) alertEl.remove();
                            new Notice(t('ui.scenePropertiesSection.migrationCompleteNotice'));
                        }
                        rerender(nextList);
                        renderHoverPreview();
                    };
                } else {
                    const deleteBtn = row.createEl('button', { cls: 'ert-iconBtn' });
                    setIcon(deleteBtn, 'trash');
                    setAccessibleLabel(deleteBtn, t('ui.scenePropertiesSection.removeTooltip'));
                    deleteBtn.onclick = () => {
                        removeHoverMetadata(workingEntries[idx].key);
                        const nextList = workingEntries.filter((_, itemIdx) => itemIdx !== idx);
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
                    if (Number.isNaN(from) || from < 0 || from >= workingEntries.length || from === idx) {
                        dragIndex = null;
                        return;
                    }
                    const nextList = [...workingEntries];
                    const [moved] = nextList.splice(from, 1);
                    nextList.splice(idx, 0, moved);
                    dragIndex = null;
                    saveEntries(nextList);
                    reorderHoverMetadataToMatchYaml(nextList.map((item) => item.key));
                    rerender(nextList);
                    renderHoverPreview();
                });
            };

            renderChapterRow();
            data.forEach((entry, idx) => renderEntryRow(entry, idx));

            const addRow = listEl.createDiv({ cls: ['ert-yaml-row', 'ert-yaml-row--add', 'ert-yaml-row--hover-meta'] });
            addRow.createDiv({ cls: ['ert-drag-handle', 'ert-drag-placeholder'] });
            addRow.createDiv({ cls: 'ert-grid-spacer' });

            const addIconWrapper = addRow.createDiv({ cls: 'ert-hover-icon-wrapper' });
            const addIconPreview = addIconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
            setIcon(addIconPreview, DEFAULT_HOVER_ICON);
            const addIconInput = addIconWrapper.createEl('input', {
                type: 'text',
                cls: 'ert-input ert-input--md ert-icon-input',
                attr: { placeholder: t('ui.scenePropertiesSection.iconPlaceholder') }
            });
            addIconInput.value = DEFAULT_HOVER_ICON;
            setTooltip(addIconInput, t('ui.scenePropertiesSection.iconTooltip'));
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
            setTooltip(addCheckbox, t('ui.scenePropertiesSection.revealTooltip'));

            const keyInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: t('ui.scenePropertiesSection.newPropertyPlaceholder') } });
            const valueInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: t('ui.scenePropertiesSection.valuePlaceholder') } });
            const buttonWrap = addRow.createDiv({ cls: ['ert-iconBtnGroup', 'ert-template-actions'] });

            const addBtn = buttonWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-mod-cta'] });
            setIcon(addBtn, 'plus');
            setAccessibleLabel(addBtn, t('ui.scenePropertiesSection.addTooltip'));
            addBtn.onclick = () => {
                const key = keyInput.value.trim();
                if (!key) return;
                if (!canUseKey(key, workingEntries)) return;
                const iconName = addIconInput.value.trim() || DEFAULT_HOVER_ICON;
                if (addCheckbox.checked || iconName !== DEFAULT_HOVER_ICON) {
                    setHoverMetadata(key, iconName, addCheckbox.checked);
                }
                const nextList = [...workingEntries, newAdvancedEntry(key, valueInput.value)];
                saveEntries(nextList);
                rerender(nextList);
                renderHoverPreview();
            };

            const resetBtn = buttonWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-template-reset-btn'] });
            setIcon(resetBtn, 'rotate-ccw');
            setTooltip(resetBtn, t('ui.scenePropertiesSection.resetTooltip'));
            resetBtn.onclick = async () => {
                const confirmed = await new Promise<boolean>((resolve) => {
                    const modal = new Modal(app);
                    modal.titleEl.setText('');
                    modal.contentEl.empty();
                    modal.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
                    modal.contentEl.addClass('ert-modal-container', 'ert-stack');

                    const header = modal.contentEl.createDiv({ cls: 'ert-modal-header' });
                    header.createSpan({ text: t('ui.scenePropertiesSection.resetModalBadge'), cls: 'ert-modal-badge' });
                    header.createDiv({ text: t('ui.scenePropertiesSection.resetModalTitle'), cls: 'ert-modal-title' });
                    header.createDiv({
                        text: t('ui.scenePropertiesSection.resetModalSubtitle'),
                        cls: 'ert-modal-subtitle'
                    });

                    const body = modal.contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
                    body.createDiv({ text: t('ui.scenePropertiesSection.resetModalWarning'), cls: 'ert-purge-warning' });

                    const footer = modal.contentEl.createDiv({ cls: ['ert-modal-actions', 'ert-inline-actions'] });
                    new ButtonComponent(footer).setButtonText(t('ui.scenePropertiesSection.resetButton')).setDestructive().onClick(() => {
                        modal.close();
                        resolve(true);
                    });
                    new ButtonComponent(footer).setButtonText(t('common.cancel')).onClick(() => {
                        modal.close();
                        resolve(false);
                    });

                    modal.open();
                });

                if (!confirmed) return;

                plugin.settings.sceneYamlTemplates = {
                    base: getTemplateParts('Scene', plugin.settings).base,
                    advanced: defaultTemplate,
                };
                plugin.settings.hoverMetadataFields = [];
                await plugin.saveSettings();
                rerender(parseAdvancedEntries(defaultTemplate).filter((entry) => !isCoreKey(entry.key)));
                renderHoverPreview();
            };
        };

        rerender(entries);
    };

    renderAdvancedEditor();
    renderHoverPreview();
}
