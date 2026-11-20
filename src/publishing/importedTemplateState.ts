/*
 * Where a saved imported layout stands, and how it gets back to "ready".
 *
 * An imported layout is usable only while the template file is the one that
 * last built a test PDF **on this computer**. Settings → Publish, the export
 * dialog and the export runner all ask the same question here, so an edited
 * or deleted template is reported the same way everywhere and never reaches
 * Pandoc unchecked.
 *
 * Two records make up "it built a test PDF here":
 *
 *   - `layout.importCheck`, in settings: what the last test PDF measured
 *     (pages, page size). Settings sync with the vault.
 *   - a note in Obsidian's own storage for this vault on this computer, which
 *     does not sync: the hash of the template text that built a test PDF here.
 *
 * A vault opened on a second computer therefore reads "not checked on this
 * computer" until the template has built a test PDF there. That is where a
 * font or package the second computer lacks is found: at the check, not in
 * the middle of an export.
 */
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate } from '../types';
import { readResolvedTemplateText, resolveTemplatePath, validatePandocLayout } from '../utils/exportFormats';
import { hashTemplateText, runImportedTemplateCheck, type ImportedTemplateCheckResult } from './importedTemplateCheck';
import { t } from '../i18n';

/**
 *   ready      the template on disk built a test PDF on this computer
 *   changed    the file has been edited since its last test PDF
 *   unchecked  no test PDF built on this computer (a vault synced from another
 *              computer, or a layout imported before the check existed)
 *   missing    the file is gone or cannot be read
 */
export type ImportedTemplateState = 'ready' | 'changed' | 'unchecked' | 'missing';

const LOCAL_CHECKS_KEY = 'radial-timeline-imported-template-checks';
const LOCAL_CHECKS_SCHEMA_VERSION = 1;

interface LocalTemplateChecks {
    schemaVersion: typeof LOCAL_CHECKS_SCHEMA_VERSION;
    /** Layout id → SHA-256 of the template text that built a test PDF on this computer. */
    passed: Record<string, string>;
}

function readLocalChecks(plugin: RadialTimelinePlugin): LocalTemplateChecks {
    const stored = plugin.app.loadLocalStorage(LOCAL_CHECKS_KEY) as Partial<LocalTemplateChecks> | null; // SAFE: Obsidian returns untyped JSON; the shape is checked on the next line
    if (stored?.schemaVersion === LOCAL_CHECKS_SCHEMA_VERSION && stored.passed && typeof stored.passed === 'object') {
        return { schemaVersion: LOCAL_CHECKS_SCHEMA_VERSION, passed: { ...stored.passed } };
    }
    return { schemaVersion: LOCAL_CHECKS_SCHEMA_VERSION, passed: {} };
}

/** Note that this template text built a test PDF on this computer. */
export function recordTemplateCheckedHere(plugin: RadialTimelinePlugin, layoutId: string, sha256: string): void {
    const checks = readLocalChecks(plugin);
    checks.passed[layoutId] = sha256;
    plugin.app.saveLocalStorage(LOCAL_CHECKS_KEY, checks);
}

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
    const hash = hashTemplateText(text);
    const builtHere = readLocalChecks(plugin).passed[layout.id];
    if (!layout.importCheck) return { state: 'unchecked', text };
    // Edited since its last test PDF, wherever that was built.
    if (layout.importCheck.sha256 !== hash) return { state: 'changed', text };
    return { state: builtHere === hash ? 'ready' : 'unchecked', text };
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
        return { ok: false, reason: 'missing', message: t('ui.templateImport.blockMissing', { name: layout.name }), latexLines: [], cause: null };
    }
    const result = await runImportedTemplateCheck({ layout, templateText: text, pandocPath: plugin.settings.pandocPath });
    if (!result.ok) return result;
    if (plugin.isSettingsPersistenceBlocked()) throw new Error(t('ui.main.settingsSaveBlocked'));
    const previous = layout.importCheck;
    layout.importCheck = result.record;
    try { await plugin.saveSettings(); }
    catch (error) { layout.importCheck = previous; throw error; }
    recordTemplateCheckedHere(plugin, layout.id, result.record.sha256);
    return result;
}
