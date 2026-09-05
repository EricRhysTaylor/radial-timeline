import { Component, Setting as Settings, Notice, setIcon, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { t } from '../../i18n';
import { getSynopsisGenerationWordLimit } from '../../utils/synopsisLimits';
import { executeCommandById } from '../../utils/obsidianInternals';

/** Configuration controls share the owning AI section lifetime. */
export function renderAiConfiguration(aiConfigBody: HTMLElement, plugin: RadialTimelinePlugin, scope: Component): void {
    // ── AI Configuration settings (moved from Core) ───────────────────────
    const aiConfigCreateRow = (
        parent: HTMLElement,
        options: {
            title: string;
            description: string;
            control: (setting: Settings) => void;
        }
    ): Settings => {
        const row = new Settings(parent)
            .setName(options.title)
            .setDesc(options.description);
        row.settingEl.addClass('ert-settingRow');
        options.control(row);
        return row;
    };
    const aiConfigCreateNumberInput = (
        setting: Settings,
        options: {
            value: number;
            min: number;
            max: number;
            step: number;
            invalidNotice: string;
            onSave: (value: number) => Promise<void> | void;
        }
    ): void => {
        setting.addText(text => {
            let savedValue = options.value;
            text.setValue(String(options.value));
            text.inputEl.type = 'number';
            text.inputEl.min = String(options.min);
            text.inputEl.max = String(options.max);
            text.inputEl.step = String(options.step);
            text.inputEl.addClass('ert-input--xs');

            scope.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    text.inputEl.blur();
                }
            });

            const handleBlur = async () => {
                const parsed = parseInt(text.getValue().trim(), 10);
                if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max) {
                    new Notice(options.invalidNotice);
                    text.setValue(String(savedValue));
                    return;
                }
                await options.onSave(Math.round(parsed));
                savedValue = Math.round(parsed);
                text.setValue(String(Math.round(parsed)));
            };

            scope.registerDomEvent(text.inputEl, 'blur', () => { void handleBlur(); });
        });
    };

    const inquiryGroup = aiConfigBody.createDiv({ cls: 'ert-config-group' });
    inquiryGroup.createDiv({ cls: 'ert-config-group-title', text: t('settings.ai.config.inquiryTitle') });

    const citationsRow = aiConfigCreateRow(inquiryGroup, {
        title: t('settings.ai.config.citationsName'),
        description: t('settings.ai.config.citationsDesc'),
        control: (setting) => {
            // Provider-level inline citations are temporarily disabled across all
            // providers — they're structurally incompatible with strict-JSON output.
            // Toggle stays present so the persisted setting remains visible, but
            // it's locked off; per-finding evidence_quote field still surfaces a
            // verbatim quote per finding in the Sources block.
            setting.addToggle(toggle => {
                toggle.setValue(false).setDisabled(true);
                toggle.toggleEl.setAttr(
                    'title',
                    'Temporarily disabled — provider citations conflict with strict-JSON output across all providers. Findings still surface verbatim quotes via the per-finding evidence_quote field.'
                );
            });
        }
    });
    // Visually mute the entire row (title, description, toggle) so it reads
    // as "feature paused" at a glance, not "active setting you might want
    // to flip". Removed alongside the resolver flip when citations are restored.
    citationsRow.settingEl.addClass('ert-settingRow--disabled-feature');

    const aiDisplayGroup = aiConfigBody.createDiv({ cls: 'ert-config-group' });
    aiDisplayGroup.createDiv({ cls: 'ert-config-group-title', text: t('settings.ai.config.timelineDisplayTitle') });

    aiConfigCreateRow(aiDisplayGroup, {
        title: t('settings.ai.config.pulseContextName'),
        description: t('settings.ai.config.pulseContextDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.showFullTripletAnalysis ?? true)
                .onChange(async (value) => {
                    plugin.settings.showFullTripletAnalysis = value;
                    await plugin.saveSettings();
                }));
        }
    });

    const summaryRefreshGroup = aiConfigBody.createDiv({ cls: 'ert-config-group' });
    const summaryRefreshHeading = summaryRefreshGroup.createDiv({ cls: 'ert-config-group-heading' });
    summaryRefreshHeading.createSpan({ cls: 'ert-config-group-title', text: t('settings.ai.config.summaryRefreshTitle') });
    const summaryRefreshOpenButton = summaryRefreshHeading.createEl('button', {
        cls: 'ert-config-group-modal-link',
        attr: {
            type: 'button',
            'aria-label': 'Open summary refresh modal'
        }
    });
    setIcon(summaryRefreshOpenButton, 'panel-top-open');
    setTooltip(summaryRefreshOpenButton, 'Open summary refresh modal');
    scope.registerDomEvent(summaryRefreshOpenButton, 'click', (evt: MouseEvent) => {
        evt.preventDefault();
        if (!executeCommandById(plugin.app, 'radial-timeline:refresh-scene-synopses-ai')) {
            new Notice('Summary refresh command is not available.');
        }
    });

    const numberFields = [
        { parent: aiDisplayGroup, key: 'synopsisGenerationMaxWords', label: 'synopsisMaxWords',
            value: getSynopsisGenerationWordLimit(plugin.settings), min: 10, max: 300, step: 5 },
        { parent: summaryRefreshGroup, key: 'synopsisTargetWords', label: 'targetSummary',
            value: plugin.settings.synopsisTargetWords ?? 200, min: 75, max: 500, step: 25 },
        { parent: summaryRefreshGroup, key: 'synopsisWeakThreshold', label: 'weakThreshold',
            value: plugin.settings.synopsisWeakThreshold ?? 75, min: 10, max: 300, step: 5 }
    ] as const;
    for (const field of numberFields) {
        aiConfigCreateRow(field.parent, {
            title: t(`settings.ai.config.${field.label}Name`),
            description: t(`settings.ai.config.${field.label}Desc`),
            control: setting => aiConfigCreateNumberInput(setting, {
                ...field,
                invalidNotice: t(`settings.ai.config.${field.label}Invalid`),
                onSave: async value => {
                    plugin.settings[field.key] = value;
                    await plugin.saveSettings();
                }
            })
        });
    }

    aiConfigCreateRow(summaryRefreshGroup, {
        title: t('settings.ai.config.alsoUpdateSynopsisName'),
        description: t('settings.ai.config.alsoUpdateSynopsisDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.alsoUpdateSynopsis ?? false)
                .onChange(async (value) => {
                    plugin.settings.alsoUpdateSynopsis = value;
                    await plugin.saveSettings();
                }));
        }
    });

}
