/*
 * Where a saved imported layout stands, and how it gets back to "ready".
 *
 * An imported layout is usable only while the template file is the one that
 * last built a test PDF. Settings → Publish, the export dialog and the export
 * runner all ask the same question here, so an edited or deleted template is
 * reported the same way everywhere and never reaches Pandoc unchecked.
 */
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate } from '../types';
import { readResolvedTemplateText, resolveTemplatePath, validatePandocLayout } from '../utils/exportFormats';
import { hashTemplateText, runImportedTemplateCheck, type ImportedTemplateCheckResult } from './importedTemplateCheck';
import { t } from '../i18n';

/**
 *   ready      the template on disk is the one that built a test PDF
 *   changed    the file has been edited since
 *   unchecked  no test PDF on record (a layout imported before the check existed)
 *   missing    the file is gone or cannot be read
 */
export type ImportedTemplateState = 'ready' | 'changed' | 'unchecked' | 'missing';

function readImportedTemplateText(plugin: RadialTimelinePlugin, layout: PandocLayoutTemplate): string | null {
    if (!validatePandocLayout(plugin, layout).valid) return null;
    const read = readResolvedTemplateText(resolveTemplatePath(plugin, layout.path));
    return read.error ? null : read.text;
}

/** The layout's state together with the template text it was judged on (null when the file is gone). */
export function inspectImportedTemplate(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate
): { state: ImportedTemplateState; text: string | null } {
    const text = readImportedTemplateText(plugin, layout);
    if (text === null) return { state: 'missing', text };
    if (!layout.importCheck) return { state: 'unchecked', text };
    return { state: layout.importCheck.sha256 === hashTemplateText(text) ? 'ready' : 'changed', text };
}

export function getImportedTemplateState(plugin: RadialTimelinePlugin, layout: PandocLayoutTemplate): ImportedTemplateState {
    return inspectImportedTemplate(plugin, layout).state;
}

/** What an author is told when an imported layout cannot be used yet, or null when it is ready. */
export function describeImportedTemplateBlock(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate
): { state: Exclude<ImportedTemplateState, 'ready'>; message: string } | null {
    const state = getImportedTemplateState(plugin, layout);
    if (state === 'ready') return null;
    const message = state === 'missing'
        ? t('ui.templateImport.blockMissing', { name: layout.name })
        : state === 'changed'
            ? t('ui.templateImport.blockChanged', { name: layout.name })
            : t('ui.templateImport.blockUnchecked', { name: layout.name });
    return { state, message };
}

/**
 * Build a new test PDF from the template as it is on disk now and, if it
 * builds, record it. A failed check changes nothing: the layout keeps its old
 * record and stays unusable until a check passes.
 */
export async function recheckImportedTemplate(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate
): Promise<ImportedTemplateCheckResult> {
    const text = readImportedTemplateText(plugin, layout);
    if (text === null) {
        return { ok: false, reason: 'missing', message: t('ui.templateImport.blockMissing', { name: layout.name }), latexLines: [] };
    }
    const result = await runImportedTemplateCheck({ layout, templateText: text, pandocPath: plugin.settings.pandocPath });
    if (!result.ok) return result;
    if (plugin.isSettingsPersistenceBlocked()) throw new Error(t('ui.main.settingsSaveBlocked'));
    const previous = layout.importCheck;
    layout.importCheck = result.record;
    try { await plugin.saveSettings(); }
    catch (error) { layout.importCheck = previous; throw error; }
    return result;
}
