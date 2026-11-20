/*
 * What Radial Timeline shows about an imported template: in the import
 * dialog's Check and Save steps, and on the layout's row in Settings →
 * Publish. One builder for all three.
 *
 * Every row is something read from the template file (templateFacts.ts) or
 * measured from its test PDF (the layout's check record). Nothing is guessed.
 *
 * A row is kept to one short line. The longer explanation sits behind the
 * row's info icon, and where the author has something to do next, the row
 * ends with where to go: a settings location, the template file, or a guide.
 */
import { setIcon } from 'obsidian';
import type { ImportedTemplateCheckRecord } from '../../../publishing/importedTemplateCheck';
import type { TemplateFacts, TemplateFont } from '../../../publishing/templateFacts';
import { assertNever } from '../../../utils/assertNever';
import { docsUrl } from '../../../utils/docsUrl';
import { setTooltip } from '../../../utils/domTooltip';
import { t } from '../../../i18n';

/** Where the author goes next for a row. */
export type ImportedTemplateNextStep =
    /** A place in Settings, shown as a trail: Settings › Publish › Custom Pandoc metadata. */
    | { kind: 'setting'; trail: string[] }
    /** Radial Timeline's copy of the template: the file the author edits. */
    | { kind: 'file'; path: string }
    /** A page of the docs. */
    | { kind: 'guide'; label: string; wikiPage: string };

export interface ImportedTemplateFactRow {
    label: string;
    value: string;
    /** A second, quieter line of data. Explanation belongs in `info`. */
    detail?: string;
    /** The full explanation, shown from the row's info icon. */
    info?: string;
    next?: ImportedTemplateNextStep[];
}

/** What the next-step controls do. Without a handler, a step is shown but is not a control. */
export interface ImportedTemplateFactActions {
    /** Go to the settings location a row names. */
    openSetting?: () => void;
    /** Open the template file in the computer's editor for it. */
    openFile?: (path: string) => void;
    /** Show the template file in its folder. */
    showFile?: (path: string) => void;
}

/** The docs section on what an imported template is sent and how to add chapters and parts. */
export const IMPORTED_TEMPLATE_GUIDE_PAGE = 'Manuscript-Export#add-chapters-and-parts';

// Lists longer than this end in "and N more"; the file itself has the rest.
const LIST_LIMIT = 12;

function joinList(items: string[]): string {
    if (items.length <= LIST_LIMIT) return items.join(', ');
    return t('ui.importedLayoutSummary.listAndMore', { items: items.slice(0, LIST_LIMIT).join(', '), count: items.length - LIST_LIMIT });
}

function fontRoleLabel(role: TemplateFont['role']): string {
    switch (role) {
        case 'main': return t('ui.importedLayoutSummary.fontRoleMain');
        case 'sans': return t('ui.importedLayoutSummary.fontRoleSans');
        case 'mono': return t('ui.importedLayoutSummary.fontRoleMono');
        case 'math': return t('ui.importedLayoutSummary.fontRoleMath');
        case 'other': return t('ui.importedLayoutSummary.fontRoleOther');
        default: return assertNever(role);
    }
}

const STANDARD_PAGES: Array<{ name: string; widthPt: number; heightPt: number }> = [
    { name: 'US Letter', widthPt: 612, heightPt: 792 },
    { name: 'A4', widthPt: 595.28, heightPt: 841.89 },
    { name: 'A5', widthPt: 419.53, heightPt: 595.28 },
];

/** "6 × 9 in", or "8.27 × 11.69 in (A4)" for a named paper size. */
export function formatPageSize(widthPt: number, heightPt: number): string {
    const inches = (points: number) => String(Math.round((points / 72) * 100) / 100);
    const size = `${inches(widthPt)} × ${inches(heightPt)} in`;
    const standard = STANDARD_PAGES.find(page => Math.abs(page.widthPt - widthPt) < 1 && Math.abs(page.heightPt - heightPt) < 1);
    return standard ? `${size} (${standard.name})` : size;
}

/** "6 pages, 5.5 × 8.5 in, built Nov 19, 2026": the last test PDF, as measured. */
export function formatTestPdfSummary(check: ImportedTemplateCheckRecord): string {
    const built = new Date(check.checkedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return t(check.pages === 1 ? 'ui.importedLayoutSummary.testPdfOnePage' : 'ui.importedLayoutSummary.testPdfPages', {
        pages: check.pages, size: formatPageSize(check.pageWidthPt, check.pageHeightPt), date: built,
    });
}

/** Settings › Publish › Custom Pandoc metadata: where fields a template reads are filled in. */
function customMetadataTrail(): string[] {
    return [t('ui.importedLayoutSummary.trailSettings'), t('ui.importedLayoutSummary.trailPublish'), t('ui.publishSection.customMetadataName')];
}

export function buildImportedTemplateFactRows(input: {
    facts: TemplateFacts;
    /** The last test PDF, when the template on disk is the one that built it. */
    check?: ImportedTemplateCheckRecord;
    /** Where Radial Timeline's copy is, or will be, saved. */
    copyPath?: string;
    /** Fields the author has already filled under Custom Pandoc metadata. */
    filledFields?: string[];
}): ImportedTemplateFactRow[] {
    const { facts, check } = input;
    const rows: ImportedTemplateFactRow[] = [];
    const whenSet = (text: string, conditional: boolean) => conditional ? t('ui.importedLayoutSummary.whenSet', { item: text }) : text;
    // The file to edit, for rows whose next step is a change to the template.
    const editFile: ImportedTemplateNextStep[] = input.copyPath ? [{ kind: 'file', path: input.copyPath }] : [];

    if (check) {
        rows.push({
            label: t('ui.importedLayoutSummary.labelTestPdf'),
            value: formatTestPdfSummary(check),
            info: t('ui.importedLayoutSummary.infoTestPdf'),
        });
    }

    if (facts.documentClass) {
        const documentClass = facts.documentClass;
        rows.push(documentClass.kind === 'variable'
            ? {
                label: t('ui.importedLayoutSummary.labelClass'),
                value: t('ui.importedLayoutSummary.classFromVariable', { variable: documentClass.variable }),
                info: t('ui.importedLayoutSummary.infoClassVariable', { variable: documentClass.variable }),
                next: [{ kind: 'setting', trail: customMetadataTrail() }],
            }
            : {
                label: t('ui.importedLayoutSummary.labelClass'),
                value: documentClass.options.length > 0 ? `${documentClass.name} (${documentClass.options.join(', ')})` : documentClass.name,
                info: t('ui.importedLayoutSummary.infoClass'),
            });
    }

    rows.push(facts.fonts.length > 0
        ? {
            label: t('ui.importedLayoutSummary.labelFonts'),
            value: joinList(facts.fonts.map(font => whenSet(`${font.name} (${fontRoleLabel(font.role)})`, font.conditional))),
            info: t('ui.importedLayoutSummary.infoFonts'),
        }
        : {
            label: t('ui.importedLayoutSummary.labelFonts'),
            value: t('ui.importedLayoutSummary.fontsNone'),
            info: t('ui.importedLayoutSummary.infoFontsNone'),
        });

    const always = facts.packages.filter(item => !item.conditional).map(item => item.name);
    const conditional = facts.packages.filter(item => item.conditional).map(item => item.name);
    rows.push({
        label: t('ui.importedLayoutSummary.labelPackages'),
        value: always.length > 0 ? joinList(always) : t('ui.importedLayoutSummary.packagesNone'),
        ...(conditional.length > 0 ? { detail: t('ui.importedLayoutSummary.packagesWhenSet', { items: joinList(conditional) }) } : {}),
        info: t('ui.importedLayoutSummary.infoPackages'),
    });

    const printsDetails = facts.bookDetails.length > 0;
    rows.push({
        label: t('ui.importedLayoutSummary.labelBookDetails'),
        value: facts.bookDetails.length === 2 ? t('ui.importedLayoutSummary.bookDetailsBoth')
            : facts.bookDetails[0] === 'title' ? t('ui.importedLayoutSummary.bookDetailsTitle')
            : facts.bookDetails[0] === 'author' ? t('ui.importedLayoutSummary.bookDetailsAuthor')
            : t('ui.importedLayoutSummary.bookDetailsNone'),
        info: printsDetails ? t('ui.importedLayoutSummary.infoBookDetails') : t('ui.importedLayoutSummary.infoBookDetailsNone'),
        ...(!printsDetails && editFile.length > 0 ? { next: editFile } : {}),
    });

    // Fields only the author can fill. The ones Pandoc fills itself are named in the explanation.
    if (facts.fieldsToFill.length > 0) {
        const filled = new Set(input.filledFields);
        const waiting = facts.fieldsToFill.filter(name => !filled.has(name));
        const done = facts.fieldsToFill.filter(name => filled.has(name));
        rows.push({
            label: t('ui.importedLayoutSummary.labelFields'),
            value: waiting.length > 0 ? joinList(waiting) : t('ui.importedLayoutSummary.fieldsAllFilled'),
            ...(done.length > 0 ? { detail: t('ui.importedLayoutSummary.fieldsFilled', { items: joinList(done) }) } : {}),
            info: facts.pandocFields.length > 0
                ? `${t('ui.importedLayoutSummary.infoFields')} ${t('ui.importedLayoutSummary.infoFieldsPandoc', { items: joinList(facts.pandocFields) })}`
                : t('ui.importedLayoutSummary.infoFields'),
            next: [{ kind: 'setting', trail: customMetadataTrail() }],
        });
    }

    rows.push(facts.structuralMacros
        ? {
            label: t('ui.importedLayoutSummary.labelStructure'),
            value: t('ui.importedLayoutSummary.structureMacros'),
            info: t('ui.importedLayoutSummary.infoStructureMacros'),
        }
        : {
            label: t('ui.importedLayoutSummary.labelStructure'),
            value: t('ui.importedLayoutSummary.structureHeadings'),
            info: t('ui.importedLayoutSummary.infoStructureHeadings'),
            next: [...editFile, { kind: 'guide', label: t('ui.importedLayoutSummary.guideStructure'), wikiPage: IMPORTED_TEMPLATE_GUIDE_PAGE }],
        });

    if (!facts.readsHeaderIncludes) {
        rows.push({
            label: t('ui.importedLayoutSummary.labelPdfSettings'),
            value: t('ui.importedLayoutSummary.pdfSettingsNotRead'),
            info: t('ui.importedLayoutSummary.infoPdfSettings'),
            ...(editFile.length > 0 ? { next: editFile } : {}),
        });
    }

    if (input.copyPath) {
        rows.push({
            label: t('ui.importedLayoutSummary.labelFile'),
            value: '',
            info: t('ui.importedLayoutSummary.infoFile'),
            next: editFile,
        });
    }
    return rows;
}

/**
 * A chip: a button when it does something, plain text when it only names a
 * place. The button keeps the chip's shape through the control sizes its
 * stylesheet rule sets.
 */
function createChip(parent: HTMLElement, cls: string, onActivate?: () => void): HTMLElement {
    if (!onActivate) return parent.createSpan({ cls });
    const chip = parent.createEl('button', { cls: `${cls} is-link`, attr: { type: 'button' } });
    chip.onClickEvent(() => onActivate());
    return chip;
}

function renderNextStep(parent: HTMLElement, step: ImportedTemplateNextStep, actions: ImportedTemplateFactActions, ownRow = false): void {
    switch (step.kind) {
        case 'setting': {
            // A trail of places; a button when it can take the author there.
            const open = actions.openSetting;
            const trail = createChip(parent, 'ert-layout-imported-trail', open);
            step.trail.forEach((place, index) => {
                if (index > 0) setIcon(trail.createSpan({ cls: 'ert-layout-imported-trail-sep', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
                trail.createSpan({ cls: index === step.trail.length - 1 ? 'ert-layout-imported-trail-place is-last' : 'ert-layout-imported-trail-place', text: place });
            });
            return;
        }
        case 'file': {
            // The file as folder and name. On a row whose next step is an edit
            // to it, the chip itself opens the file; the Template file row has
            // the buttons as well.
            const cut = step.path.lastIndexOf('/') + 1;
            const { openFile, showFile } = actions;
            const opensFromChip = openFile && !ownRow;
            const file = createChip(parent, 'ert-layout-imported-file', opensFromChip ? () => openFile(step.path) : undefined);
            setIcon(file.createSpan({ cls: 'ert-layout-imported-file-icon', attr: { 'aria-hidden': 'true' } }), 'file-code');
            file.createSpan({ cls: 'ert-layout-imported-file-folder', text: step.path.slice(0, cut) });
            file.createSpan({ cls: 'ert-layout-imported-file-name', text: step.path.slice(cut) });
            if (opensFromChip) return;
            if (openFile) {
                parent.createEl('button', { cls: 'ert-layout-imported-fileAction', text: t('ui.importedLayoutSummary.fileOpen'), attr: { type: 'button' } })
                    .onClickEvent(() => openFile(step.path));
            }
            if (showFile) {
                parent.createEl('button', { cls: 'ert-layout-imported-fileAction', text: t('ui.importedLayoutSummary.fileShow'), attr: { type: 'button' } })
                    .onClickEvent(() => showFile(step.path));
            }
            return;
        }
        case 'guide': {
            const link = parent.createEl('a', {
                cls: 'ert-layout-imported-guide', text: step.label,
                attr: { href: docsUrl(step.wikiPage), target: '_blank', rel: 'noopener' },
            });
            setIcon(link.createSpan({ cls: 'ert-layout-imported-guide-icon', attr: { 'aria-hidden': 'true' } }), 'external-link');
            return;
        }
        default: assertNever(step);
    }
}

/** Label / value rows, in the manner of a built-in layout's card. */
export function renderImportedTemplateFacts(container: HTMLElement, rows: ImportedTemplateFactRow[], actions: ImportedTemplateFactActions = {}): void {
    rows.forEach(row => {
        const rowEl = container.createDiv({ cls: 'ert-layout-imported-row' });
        rowEl.createDiv({ cls: 'ert-layout-imported-label', text: row.label });
        const valueEl = rowEl.createDiv({ cls: 'ert-layout-imported-value' });
        // The file row's value is the file itself.
        const inline = !row.value && row.next ? row.next : [];
        const line = valueEl.createDiv({ cls: inline.length > 0 ? 'ert-layout-imported-line is-steps' : 'ert-layout-imported-line' });
        // The info icon stays on the line with the value's last word: the two
        // share a span that does not wrap.
        let iconHost: HTMLElement = line;
        if (row.value && row.info) {
            const cut = row.value.lastIndexOf(' ') + 1;
            if (cut > 0) line.createSpan({ text: row.value.slice(0, cut) });
            iconHost = line.createSpan({ cls: 'ert-layout-imported-tail', text: `${row.value.slice(cut)}\u00A0` });
        } else if (row.value) {
            line.createSpan({ text: row.value });
        }
        inline.forEach(step => renderNextStep(line, step, actions, true));
        if (row.info) {
            const info = iconHost.createSpan({ cls: 'ert-layout-imported-info', attr: { tabindex: '0', role: 'note' } });
            setIcon(info, 'info');
            setTooltip(info, row.info, { placement: 'top' });
        }
        if (row.detail) valueEl.createDiv({ cls: 'ert-layout-imported-note', text: row.detail });
        if (row.value && row.next && row.next.length > 0) {
            const next = valueEl.createDiv({ cls: 'ert-layout-imported-next' });
            row.next.forEach(step => renderNextStep(next, step, actions));
        }
    });
}

/**
 * The body of an imported layout's row in Settings → Publish: the facts, the
 * author's description, and a page of the last test PDF when there is one.
 */
export function renderImportedLayoutSummary(container: HTMLElement, input: {
    rows: ImportedTemplateFactRow[];
    description: string;
    /** Resource URL of the saved page image and the page of the test PDF it shows, or null when there is none to show. */
    preview: { src: string; page: number } | null;
    actions?: ImportedTemplateFactActions;
}): void {
    const shell = container.createDiv({ cls: 'ert-layout-imported' });
    const copy = shell.createDiv({ cls: 'ert-layout-imported-copy' });
    renderImportedTemplateFacts(copy, input.rows, input.actions);
    if (input.description) copy.createDiv({ cls: 'ert-layout-imported-description', text: input.description });
    if (input.preview) {
        const preview = shell.createDiv({ cls: 'ert-layout-imported-preview' });
        const caption = t('ui.importedLayoutSummary.previewCaption', { page: input.preview.page });
        preview.createEl('img', { cls: 'ert-layout-imported-page', attr: { src: input.preview.src, alt: caption } });
        preview.createDiv({ cls: 'ert-layout-imported-pageCaption', text: caption });
    }
}
