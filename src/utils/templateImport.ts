/*
 * "Import template…": bringing an author's own LaTeX template into Publishing.
 *
 * The rules this file keeps:
 *
 *   - The author's file is read and never written. Radial Timeline works from
 *     its own copy in the Pandoc folder (`imported/<name>.tex`).
 *   - A template is registered only after it has built a test PDF
 *     (publishing/importedTemplateCheck.ts). The text that passed is recorded
 *     by hash on the layout.
 *   - Registration is file first, settings second, and the file is taken back
 *     if the settings save fails. After a reload a layout is either fully
 *     there or absent.
 *   - If the copy later changes or disappears, the layout is no longer
 *     "ready" and exports with it are refused until it has been checked again
 *     (publishing/importedTemplateState.ts).
 */
import { slugifyToFileStem } from './slug';
import { normalizePath, TFile } from 'obsidian';
import { readFile } from 'fs/promises';
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate, UsageContext, ValidationIssue } from '../types';
import { getPandocFolder } from './exportFormats';
import { readTemplateFacts, type TemplateFacts } from '../publishing/templateFacts';
import { getImportedTemplatePreviewPath } from '../publishing/importedTemplatePreview';
import { recordTemplateCheckedHere } from '../publishing/importedTemplateState';
import { describeRtPartArityIssue } from '../publishing/rttsValidation';
import { hashTemplateText, type ImportedTemplateCheckRecord } from '../publishing/importedTemplateCheck';
import { basename } from './paths';
import { t } from '../i18n';

export interface ImportedTemplateCandidate {
    layout: PandocLayoutTemplate;
    /** What the template says about itself, read from the file. */
    facts: TemplateFacts;
    issues: ValidationIssue[];
    /** The template text as read from the author's file. Empty when it could not be read. */
    sourceText: string;
    /** No blocking issue in the file itself. The test PDF is a separate, later step. */
    canActivate: boolean;
}

export interface TemplateImportInput {
    sourcePath: string;
    sourceContent?: string;
    name?: string;
    preset?: UsageContext;
    description?: string;
}

const TEMPLATE_EXTENSION = /\.(tex|ltx|latex)$/i;

export function isAbsolutePath(value: string): boolean {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

export function compactTemplatePathForStorage(plugin: RadialTimelinePlugin, rawPath: string): string {
    const trimmed = rawPath.trim();
    if (!trimmed) return '';
    if (isAbsolutePath(trimmed)) {
        return trimmed;
    }

    const normalized = normalizePath(trimmed.replace(/^\/+/, ''));
    if (!normalized) return '';

    const prefix = `${getPandocFolder(plugin)}/`;
    if (normalized.startsWith(prefix)) {
        return normalized.slice(prefix.length);
    }
    return normalized;
}

export function buildImportedTemplateId(name: string, preset: UsageContext, existingIds: Iterable<string>): string {
    const base = `imported-${slugifyToFileStem(name, 'template').toLowerCase()}-${preset}`;
    let candidate = base;
    let index = 2;
    const used = new Set(existingIds);
    while (used.has(candidate)) {
        candidate = `${base}-${index}`;
        index += 1;
    }
    return candidate;
}

function registeredLayouts(plugin: RadialTimelinePlugin): PandocLayoutTemplate[] {
    return plugin.settings.pandocLayouts ?? []; // SAFE: the setting is optional in the type; no entry means no layouts are registered
}

function registeredLayoutIds(plugin: RadialTimelinePlugin): string[] {
    return registeredLayouts(plugin).map(layout => layout.id);
}

/** The folder, inside the Pandoc folder, that holds Radial Timeline's copies of imported templates. */
export function getImportedTemplateFolder(plugin: RadialTimelinePlugin): string {
    return `${getPandocFolder(plugin)}/imported`;
}

/**
 * Where the plugin's copy of a template named `name` will go.
 *
 * A name already taken by a file is skipped, whether or not a layout still
 * points at it: files can outlive their settings entry or be put there by the
 * author, and an import must never replace one.
 */
export function planImportedTemplatePath(plugin: RadialTimelinePlugin, name: string): string {
    const folder = getImportedTemplateFolder(plugin);
    const stem = slugifyToFileStem(name, 'template').toLowerCase();
    // The template and its first-page image share a name; both must be free.
    const taken = (stemName: string) => ['tex', 'png'].some(extension => plugin.app.vault.getAbstractFileByPath(`${folder}/${stemName}.${extension}`));
    let candidate = stem;
    for (let index = 2; taken(candidate); index += 1) candidate = `${stem}-${index}`;
    return `${folder}/${candidate}.tex`;
}

type TemplateSourceRead = { text: string } | { failure: 'missing' | 'unreadable' };

async function readTemplateSource(plugin: RadialTimelinePlugin, sourcePath: string): Promise<TemplateSourceRead> {
    if (isAbsolutePath(sourcePath)) {
        try { return { text: await readFile(sourcePath, 'utf8') }; }
        catch (error) { return { failure: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' }; }
    }
    const file = plugin.app.vault.getAbstractFileByPath(normalizePath(sourcePath));
    if (!(file instanceof TFile)) return { failure: 'missing' };
    try { return { text: await plugin.app.vault.read(file) }; }
    catch { return { failure: 'unreadable' }; }
}

/**
 * Read the chosen file and report what is wrong with it as a file: missing,
 * unreadable, empty, no `$body$`. Whether it builds a PDF is decided
 * afterwards by the test PDF, not here.
 */
export async function buildImportedTemplateCandidate(
    plugin: RadialTimelinePlugin,
    input: TemplateImportInput
): Promise<ImportedTemplateCandidate> {
    const issues: ValidationIssue[] = [];
    const blocked = (code: string, message: string) => {
        issues.push({ code, level: 'error', message, scope: 'asset', actionable: true, field: 'path' });
    };
    const rawPath = input.sourcePath.trim();
    const fileName = basename(rawPath);
    const inferredName = input.name?.trim() || stripTemplateExtension(fileName) || 'Imported Template'; // SAFE: placeholder name until a file is chosen; the dialog shows it in an editable field
    const preset = input.preset || 'novel'; // SAFE: novel is the usage unless the author picks another; it is never guessed from the file

    let sourceText = '';
    if (!rawPath) {
        blocked('import_missing_path', t('ui.templateImport.chooseTexFile'));
    } else if (!TEMPLATE_EXTENSION.test(rawPath)) {
        blocked('import_not_tex', t('ui.templateImport.notTexFile'));
    } else {
        const read: TemplateSourceRead = input.sourceContent !== undefined
            ? { text: input.sourceContent }
            : await readTemplateSource(plugin, rawPath);
        if ('failure' in read) {
            blocked(
                read.failure === 'missing' ? 'import_source_missing' : 'import_source_unreadable',
                read.failure === 'missing' ? t('ui.templateImport.sourceMissing') : t('ui.templateImport.sourceUnreadable')
            );
        } else if (!read.text.trim()) {
            blocked('import_empty', t('ui.templateImport.sourceEmpty'));
        } else {
            sourceText = read.text;
        }
    }

    // Reject a legacy \rtPart on the way in, rather than accepting the template
    // and blocking every later export with the same message.
    const partArityIssue = sourceText ? describeRtPartArityIssue(sourceText) : null;
    if (partArityIssue) blocked('import_part_arity_mismatch', partArityIssue.message);

    const facts = readTemplateFacts(sourceText);
    if (sourceText && !facts.hasBody) blocked('import_missing_body', t('ui.templateImport.missingBodyPlaceholder'));
    const structural = facts.structuralMacros;
    const layout: PandocLayoutTemplate = {
        id: buildImportedTemplateId(inferredName, preset, registeredLayoutIds(plugin)),
        name: inferredName,
        preset,
        // Where the plugin's copy will be written. The author's file is not referenced after import.
        path: planImportedTemplatePath(plugin, inferredName),
        description: input.description?.trim() || t('ui.templateImport.defaultDescription', { file: fileName }),
        bundled: false,
        origin: 'imported',
        tier: 'pro',
        templateKind: 'custom',
        draft: false,
        usesModernClassicStructure: structural,
        hasEpigraphs: structural,
        // Imported templates print the heading Markdown gives them; there is
        // no per-book heading choice to offer.
        hasSceneOpenerHeadingOptions: false,
    };

    return {
        layout,
        facts,
        issues,
        sourceText,
        canActivate: !issues.some(issue => issue.level === 'error'),
    };
}

/** The layout record an import will save, with a free id and a free file name for its copy. */
export function finalizeImportedLayout(
    plugin: RadialTimelinePlugin,
    candidate: ImportedTemplateCandidate,
    edits: { name: string; preset: UsageContext; description: string }
): PandocLayoutTemplate {
    const name = edits.name.trim() || candidate.layout.name;
    return {
        ...candidate.layout,
        id: buildImportedTemplateId(name, edits.preset, registeredLayoutIds(plugin)),
        name,
        preset: edits.preset,
        description: edits.description.trim() || candidate.layout.description,
        path: planImportedTemplatePath(plugin, name),
        draft: false,
        origin: 'imported',
    };
}

async function ensureVaultFolder(plugin: RadialTimelinePlugin, folderPath: string): Promise<void> {
    const vault = plugin.app.vault;
    let current = '';
    for (const part of normalizePath(folderPath).split('/').filter(Boolean)) {
        current = current ? `${current}/${part}` : part;
        if (vault.getAbstractFileByPath(current)) continue;
        try { await vault.createFolder(current); }
        catch (error) {
            // Another writer made it between the check and the create.
            if (!vault.getAbstractFileByPath(current)) throw error;
        }
    }
}

/**
 * Write the plugin's copy of the template, then register the layout.
 *
 * `record` is the proof that `templateText` built a test PDF; a layout is
 * never registered without one. `firstPagePng` is the sample page of that PDF, kept
 * beside the copy for the layout's row in Settings. Both files are created
 * exclusively (an existing file is never replaced) and removed again if the
 * settings save fails, so a failed import leaves nothing registered.
 */
export async function registerImportedTemplate(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate,
    templateText: string,
    record: ImportedTemplateCheckRecord,
    firstPagePng?: ArrayBuffer
): Promise<PandocLayoutTemplate> {
    if (plugin.isSettingsPersistenceBlocked()) throw new Error(t('ui.main.settingsSaveBlocked'));
    if (record.sha256 !== hashTemplateText(templateText)) throw new Error(t('ui.templateImport.checkOutOfDate'));

    const registered: PandocLayoutTemplate = { ...layout, origin: 'imported', draft: false, importCheck: record };
    await ensureVaultFolder(plugin, getImportedTemplateFolder(plugin));
    const created: TFile[] = [];
    const previous = plugin.settings.pandocLayouts;
    try {
        created.push(await plugin.app.vault.create(registered.path, templateText));
        const previewPath = firstPagePng ? getImportedTemplatePreviewPath(registered) : null;
        if (firstPagePng && previewPath) created.push(await plugin.app.vault.createBinary(previewPath, firstPagePng));
        plugin.settings.pandocLayouts = [...registeredLayouts(plugin).filter(item => item.id !== registered.id), registered];
        await plugin.saveSettings();
        // The test PDF was built here; a second computer builds its own.
        recordTemplateCheckedHere(plugin, registered.id, record.sha256);
    } catch (error) {
        plugin.settings.pandocLayouts = previous;
        // Take back only what this call created.
        const cleanupErrors: unknown[] = [];
        for (const file of created) {
            try { await plugin.app.fileManager.trashFile(file); }
            catch (cleanupError) { cleanupErrors.push(cleanupError); }
        }
        if (cleanupErrors.length > 0) throw new Error([error, ...cleanupErrors].map(String).join('\n'));
        throw error;
    }
    return registered;
}

function stripTemplateExtension(name: string): string {
    return name.replace(TEMPLATE_EXTENSION, '').trim();
}
