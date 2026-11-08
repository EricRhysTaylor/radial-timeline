/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/*
 * The Settings side of the POV → Narration refactor alert: the list of scenes
 * whose POV stays for the writer to review, and the apply flow (confirm, then
 * migrate the scenes and the scene templates). The rules live in
 * src/utils/narrationMigration.ts.
 */

import { Notice, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t, tCount } from '../i18n';
import { confirmAudit } from './sections/beats/confirmAudit';
import { dismissAlert } from './refactorAlerts';
import { getTemplateParts } from '../utils/yamlTemplateNormalize';
import { openOrRevealFile } from '../utils/fileUtils';
import { planPovToNarration, POV_TO_NARRATION_ALERT_ID, runPovToNarration, withoutPovTemplateField, type PovMigrationPlan } from '../utils/narrationMigration';

/** Scenes that keep a POV the migration does not move, each a link to the note. Nothing when there are none. */
export function renderPovReviewList(app: App, plugin: RadialTimelinePlugin, containerEl: HTMLElement, plan: PovMigrationPlan = planPovToNarration(app, plugin.settings)): void {
    if (plan.kept.length === 0) return;
    containerEl.createDiv({
        cls: 'ert-refactor-alert__reassurance',
        text: t('ui.refactorAlerts.povToNarrationReview', { scenes: tCount('scene', plan.kept.length) })
    });
    const list = containerEl.createEl('ul', { cls: 'ert-refactor-alert__review' });
    for (const { file, value } of plan.kept) {
        const item = list.createEl('li');
        const link = item.createEl('a', { text: file.basename, href: '#' });
        // SAFE: Settings alerts are re-rendered as a whole; the list is dropped with them
        link.addEventListener('click', event => {
            event.preventDefault();
            void openOrRevealFile(app, file);
        });
        item.appendText(` · POV: ${value}`);
    }
}

/**
 * Confirm, then migrate. The scene templates lose POV and the alert closes
 * only when every planned scene was written; after a failure the alert stays,
 * and applying it again finishes the rest. True when the alert is complete.
 */
export async function applyPovToNarration(app: App, plugin: RadialTimelinePlugin): Promise<boolean> {
    const plan = planPovToNarration(app, plugin.settings);
    const confirmed = await confirmAudit(app, {
        badge: t('ui.yamlAuditPanel.yamlManagerBadge'),
        title: t('ui.refactorAlerts.povToNarrationTitle'),
        subtitle: t('ui.refactorAlerts.povToNarrationConfirmSubtitle'),
        scope: t('ui.refactorAlerts.povToNarrationScope'),
        action: t('ui.refactorAlerts.povToNarrationAction'),
        renderBody: body => {
            if (plan.moves > 0) body.createDiv({ text: t('ui.refactorAlerts.povToNarrationMoveLine', { scenes: tCount('scene', plan.moves) }) });
            if (plan.removals > 0) body.createDiv({ text: t('ui.refactorAlerts.povToNarrationRemoveLine', { scenes: tCount('scene', plan.removals) }) });
            if (plan.moves === 0 && plan.removals === 0) body.createDiv({ text: t('ui.refactorAlerts.povToNarrationNothingLine') });
            body.createDiv({ text: t('ui.refactorAlerts.povToNarrationTemplateLine') });
            renderPovReviewList(app, plugin, body, plan);
        }
    });
    if (!confirmed) return false;

    const result = await runPovToNarration(app, plan.files, plugin.settings);
    if (result.failed > 0) {
        console.error('[Radial Timeline] POV → Narration: some scenes were not changed.', result.errors);
        new Notice(t('ui.refactorAlerts.povToNarrationFailedNotice', { scenes: tCount('scene', result.failed) }), 0);
        return false;
    }

    plugin.settings.sceneYamlTemplates = withoutPovTemplateField({
        base: getTemplateParts('Scene', plugin.settings).base,
        advanced: plugin.settings.sceneYamlTemplates?.advanced ?? '',
    });
    if (Array.isArray(plugin.settings.hoverMetadataFields)) {
        plugin.settings.hoverMetadataFields = plugin.settings.hoverMetadataFields.map(field => field.key !== 'POV' ? field : {
            ...field,
            key: 'Narration',
            label: field.label === field.key ? 'Narration' : field.label,
        });
    }
    dismissAlert(POV_TO_NARRATION_ALERT_ID, plugin.settings);
    await plugin.saveSettings();
    new Notice(t('ui.refactorAlerts.povToNarrationDoneNotice', {
        moved: tCount('scene', result.moved),
        removed: tCount('scene', result.removed),
        kept: tCount('scene', plan.kept.length),
    }), 12000);
    return true;
}
