/*
 * What Radial Timeline shows about an imported template: in the import
 * dialog's Check and Save steps, and on the layout's row in Settings →
 * Publish. One builder for all three.
 *
 * Every row is something read from the template file (templateFacts.ts) or
 * measured from its test PDF (the layout's check record). Nothing is guessed.
 */
import type { ImportedTemplateCheckRecord } from '../../../publishing/importedTemplateCheck';
import type { TemplateFacts, TemplateFont } from '../../../publishing/templateFacts';
import { assertNever } from '../../../utils/assertNever';
import { t } from '../../../i18n';

export interface ImportedTemplateFactRow {
    label: string;
    value: string;
    /** A second line: where the value came from, or the author's next step. */
    note?: string;
}

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

export function buildImportedTemplateFactRows(input: {
    facts: TemplateFacts;
    /** The last test PDF, when the template on disk is the one that built it. */
    check?: ImportedTemplateCheckRecord;
    /** Where Radial Timeline's copy is, or will be, saved. */
    copyPath?: string;
}): ImportedTemplateFactRow[] {
    const { facts, check } = input;
    const rows: ImportedTemplateFactRow[] = [];
    const whenSet = (text: string, conditional: boolean) => conditional ? t('ui.importedLayoutSummary.whenSet', { item: text }) : text;

    if (check) {
        rows.push({
            label: t('ui.importedLayoutSummary.labelTestPdf'),
            value: formatTestPdfSummary(check),
            note: t('ui.importedLayoutSummary.testPdfNote'),
        });
    }

    if (facts.documentClass) {
        const documentClass = facts.documentClass;
        rows.push({
            label: t('ui.importedLayoutSummary.labelClass'),
            value: documentClass.kind === 'variable'
                ? t('ui.importedLayoutSummary.classFromVariable', { variable: documentClass.variable })
                : documentClass.options.length > 0 ? `${documentClass.name} (${documentClass.options.join(', ')})` : documentClass.name,
        });
    }

    rows.push({
        label: t('ui.importedLayoutSummary.labelFonts'),
        value: facts.fonts.length > 0
            ? joinList(facts.fonts.map(font => whenSet(`${font.name} (${fontRoleLabel(font.role)})`, font.conditional)))
            : t('ui.importedLayoutSummary.fontsNone'),
    });

    const always = facts.packages.filter(item => !item.conditional).map(item => item.name);
    const conditional = facts.packages.filter(item => item.conditional).map(item => item.name);
    rows.push({
        label: t('ui.importedLayoutSummary.labelPackages'),
        value: always.length > 0 ? joinList(always) : t('ui.importedLayoutSummary.packagesNone'),
        ...(conditional.length > 0 ? { note: t('ui.importedLayoutSummary.packagesWhenSet', { items: joinList(conditional) }) } : {}),
    });

    rows.push({
        label: t('ui.importedLayoutSummary.labelBookDetails'),
        value: facts.bookDetails.length === 2 ? t('ui.importedLayoutSummary.bookDetailsBoth')
            : facts.bookDetails[0] === 'title' ? t('ui.importedLayoutSummary.bookDetailsTitle')
            : facts.bookDetails[0] === 'author' ? t('ui.importedLayoutSummary.bookDetailsAuthor')
            : t('ui.importedLayoutSummary.bookDetailsNone'),
    });

    if (facts.otherVariables.length > 0) {
        rows.push({
            label: t('ui.importedLayoutSummary.labelOtherVariables'),
            value: joinList(facts.otherVariables),
            note: t('ui.importedLayoutSummary.otherVariablesNote'),
        });
    }

    rows.push({
        label: t('ui.importedLayoutSummary.labelStructure'),
        value: facts.structuralMacros ? t('ui.importedLayoutSummary.structureMacros') : t('ui.importedLayoutSummary.structureHeadings'),
    });

    if (!facts.readsHeaderIncludes) {
        rows.push({
            label: t('ui.importedLayoutSummary.labelPdfSettings'),
            value: t('ui.importedLayoutSummary.pdfSettingsNotRead'),
        });
    }

    if (input.copyPath) {
        rows.push({
            label: t('ui.importedLayoutSummary.labelSavedAs'),
            value: input.copyPath,
            note: t('ui.importedLayoutSummary.savedAsNote'),
        });
    }
    return rows;
}

/** Label / value rows, in the manner of a built-in layout's card. */
export function renderImportedTemplateFacts(container: HTMLElement, rows: ImportedTemplateFactRow[]): void {
    rows.forEach(row => {
        const rowEl = container.createDiv({ cls: 'ert-layout-imported-row' });
        rowEl.createDiv({ cls: 'ert-layout-imported-label', text: row.label });
        const valueEl = rowEl.createDiv({ cls: 'ert-layout-imported-value' });
        valueEl.createDiv({ text: row.value });
        if (row.note) valueEl.createDiv({ cls: 'ert-layout-imported-note', text: row.note });
    });
}

/**
 * The body of an imported layout's row in Settings → Publish: the facts, the
 * author's description, and the first page of the last test PDF when there
 * is one.
 */
export function renderImportedLayoutSummary(container: HTMLElement, input: {
    rows: ImportedTemplateFactRow[];
    description: string;
    /** Resource URL of the saved page image and the page of the test PDF it shows, or null when there is none to show. */
    preview: { src: string; page: number } | null;
}): void {
    const shell = container.createDiv({ cls: 'ert-layout-imported' });
    const copy = shell.createDiv({ cls: 'ert-layout-imported-copy' });
    renderImportedTemplateFacts(copy, input.rows);
    if (input.description) copy.createDiv({ cls: 'ert-layout-imported-description', text: input.description });
    if (input.preview) {
        const preview = shell.createDiv({ cls: 'ert-layout-imported-preview' });
        const caption = t('ui.importedLayoutSummary.previewCaption', { page: input.preview.page });
        preview.createEl('img', { cls: 'ert-layout-imported-page', attr: { src: input.preview.src, alt: caption } });
        preview.createDiv({ cls: 'ert-layout-imported-pageCaption', text: caption });
    }
}
