import { App, Setting as Settings, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { ERT_CLASSES } from '../../ui/classes';
import { getSupportedFrontmatterRemapTargets } from '../../utils/frontmatter';

const ALL_CANONICAL_KEYS = getSupportedFrontmatterRemapTargets();
const CANONICAL_KEY_LABELS: Record<string, string> = {
    'Publish Stage': 'Progress Stage',
};

export function renderMetadataSection(params: { app: App; plugin: RadialTimelinePlugin; containerEl: HTMLElement; }): void {
    const { plugin, containerEl } = params;
    const pendingMappings: { id: number; systemKey: string }[] = [];
    let nextPendingId = 1;
    const remapPanel = containerEl.createDiv({ cls: [ERT_CLASSES.PANEL, 'ert-frontmatter-remap-panel', ERT_CLASSES.STACK] });

    // Single toggle that both enables the feature and controls visibility
    const remapSetting = new Settings(remapPanel)
        .setName('Remap frontmatter field keys')
        .setDesc('Map custom frontmatter keys to Radial Timeline scene core fields.')
        .addToggle(toggle => {
            toggle
                .setValue(plugin.settings.enableCustomMetadataMapping ?? false)
                .onChange(async (value) => {
                    plugin.settings.enableCustomMetadataMapping = value;
                    await plugin.saveSettings();
                    renderMappings(); // Refresh visibility
                });
        });
    remapSetting.settingEl.addClass('ert-settingRow');

    const mappingContainer = remapPanel.createDiv({ cls: 'ert-mapping-body ert-frontmatter-remap-body ert-stack' });

    const mappingListContainer = mappingContainer.createDiv({ cls: 'ert-mapping-list ert-stack' });

    const renderMappings = () => {
        // Toggle visibility based on setting
        if (!plugin.settings.enableCustomMetadataMapping) {
            mappingContainer.addClass('ert-settings-hidden');
            mappingListContainer.addClass('ert-settings-hidden');
            mappingListContainer.empty();
            return;
        }

        mappingContainer.removeClass('ert-settings-hidden');
        mappingListContainer.removeClass('ert-settings-hidden');
        mappingListContainer.empty();
        
        const mappings = plugin.settings.frontmatterMappings || {};
        // Get set of currently used canonical keys to enforce uniqueness (persisted only)
        const usedCanonicalKeys = new Set(Object.values(mappings));

        // Render existing mappings
        for (const [userKey, systemKey] of Object.entries(mappings)) {
            const setting = new Settings(mappingListContainer);
            
            // Text input for User Key
            setting.addText(text => {
                text.inputEl.addClass('ert-input--lg');
                text.setPlaceholder('Your key (e.g. StoryLine)')
                    .setValue(userKey)
                    .onChange(async (_newValue) => {
                        // We defer saving until blur to avoid partial state
                    });
                
                // Handle rename on blur with validation feedback
                const handleBlur = async () => {
                    const newValue = text.getValue().trim();
                    text.inputEl.removeClass('ert-setting-input-success');
                    text.inputEl.removeClass('ert-setting-input-error');
                    
                    if (newValue && newValue !== userKey) {
                        if (!plugin.settings.frontmatterMappings) plugin.settings.frontmatterMappings = {};
                        
                        // Remove old key
                        delete plugin.settings.frontmatterMappings[userKey];
                        // Add new key
                        plugin.settings.frontmatterMappings[newValue] = systemKey;
                        
                        await plugin.saveSettings();
                        text.inputEl.addClass('ert-setting-input-success');
                        window.setTimeout(() => {
                            text.inputEl.removeClass('ert-setting-input-success');
                            renderMappings();
                        }, 600);
                    } else if (!newValue) {
                        // Revert if empty - show error briefly
                        text.inputEl.addClass('ert-setting-input-error');
                        window.setTimeout(() => {
                            text.inputEl.removeClass('ert-setting-input-error');
                            text.setValue(userKey);
                        }, 800);
                    }
                };
                
                // SAFE: addEventListener used for Settings (transient element, cleanup via DOM removal)
                text.inputEl.addEventListener('blur', () => { void handleBlur(); });
                
                // Treat Enter like blur so validation runs when user confirms
                plugin.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        text.inputEl.blur();
                    }
                });
            });

            // Dropdown for System Key
            setting.addDropdown(dropdown => {
                // Populate dropdown
                // Include:
                // 1. The current value (so it's selectable)
                // 2. Any key NOT in usedCanonicalKeys
                
                // Always add the current value first or ensure it's there
                dropdown.addOption(systemKey, CANONICAL_KEY_LABELS[systemKey] ?? systemKey);
                
                ALL_CANONICAL_KEYS.forEach(key => {
                    if (key !== systemKey && !usedCanonicalKeys.has(key)) {
                        dropdown.addOption(key, CANONICAL_KEY_LABELS[key] ?? key);
                    }
                });
                
                dropdown.setValue(systemKey);
                dropdown.onChange(async (newValue) => {
                    if (plugin.settings.frontmatterMappings) {
                        plugin.settings.frontmatterMappings[userKey] = newValue;
                        await plugin.saveSettings();
                        renderMappings(); // Re-render to update used keys list for others
                    }
                });
            });

            // Delete button
            setting.addButton(button => button
                .setIcon('trash')
                .setTooltip('Delete mapping')
                .onClick(async () => {
                    if (plugin.settings.frontmatterMappings) {
                        delete plugin.settings.frontmatterMappings[userKey];
                        await plugin.saveSettings();
                        renderMappings();
                    }
                }));
        }

        // Render pending draft mappings (not persisted until a user key is provided)
        for (const pending of pendingMappings) {
            const setting = new Settings(mappingListContainer);

            // Text input for User Key (starts empty; required to persist)
            setting.addText(text => {
                text.inputEl.addClass('ert-input--lg');
                text.setPlaceholder('Your key (required to save)');
                text.setValue('');
                
                const handleBlur = async () => {
                    const newValue = text.getValue().trim();
                    text.inputEl.removeClass('ert-setting-input-success');
                    text.inputEl.removeClass('ert-setting-input-error');
                    
                    if (!newValue) {
                        // Show brief error hint - key is required
                        text.inputEl.addClass('ert-setting-input-error');
                        window.setTimeout(() => {
                            text.inputEl.removeClass('ert-setting-input-error');
                        }, 800);
                        return; // Keep as draft and do not persist
                    }

                    if (!plugin.settings.frontmatterMappings) {
                        plugin.settings.frontmatterMappings = {};
                    }

                    plugin.settings.frontmatterMappings[newValue] = pending.systemKey;
                    const idx = pendingMappings.indexOf(pending);
                    if (idx >= 0) pendingMappings.splice(idx, 1);

                    await plugin.saveSettings();
                    text.inputEl.addClass('ert-setting-input-success');
                    window.setTimeout(() => {
                        text.inputEl.removeClass('ert-setting-input-success');
                        renderMappings();
                    }, 600);
                };
                
                plugin.registerDomEvent(text.inputEl, 'blur', handleBlur);
                
                // Treat Enter like blur so validation runs when user confirms
                plugin.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        text.inputEl.blur();
                    }
                });
            });

            // Dropdown for System Key (suggested, but not saved until user key is set)
            setting.addDropdown(dropdown => {
                const usedCanonicalKeysForDraft = new Set([
                    ...Object.values(mappings),
                    ...pendingMappings.filter(p => p !== pending).map(p => p.systemKey)
                ]);

                dropdown.addOption(pending.systemKey, CANONICAL_KEY_LABELS[pending.systemKey] ?? pending.systemKey);

                ALL_CANONICAL_KEYS.forEach(key => {
                    if (key !== pending.systemKey && !usedCanonicalKeysForDraft.has(key)) {
                        dropdown.addOption(key, CANONICAL_KEY_LABELS[key] ?? key);
                    }
                });

                dropdown.setValue(pending.systemKey);
                dropdown.onChange((newValue) => {
                    pending.systemKey = newValue;
                    renderMappings(); // Refresh availability for other rows
                });
            });

            // Delete draft button
            setting.addButton(button => button
                .setIcon('trash')
                .setTooltip('Discard draft')
                .onClick(() => {
                    const idx = pendingMappings.indexOf(pending);
                    if (idx >= 0) pendingMappings.splice(idx, 1);
                    renderMappings();
                }));
        }

        // Add New Mapping Button
        new Settings(mappingListContainer)
            .addButton(button => button
                .setButtonText('Add new mapping')
                .onClick(async () => {
                    // Find first available canonical key (includes drafts to avoid duplicate suggestions)
                    const currentUsed = new Set([
                        ...Object.values(plugin.settings.frontmatterMappings || {}),
                        ...pendingMappings.map(pending => pending.systemKey)
                    ]);
                    const firstAvailable = ALL_CANONICAL_KEYS.find(k => !currentUsed.has(k));

                    if (!firstAvailable) {
                        new Notice('All supported system keys are already mapped.');
                        return;
                    }

                    pendingMappings.push({ id: nextPendingId++, systemKey: firstAvailable });
                    renderMappings();
                }));
    };

    // Initial render
    renderMappings();
}
