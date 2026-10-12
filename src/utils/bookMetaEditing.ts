import type { App, TFile } from 'obsidian';
import { t } from '../i18n';

export type EditableBookMetaFieldKey =
    | 'title'
    | 'subtitle'
    | 'author'
    | 'copyright-holder'
    | 'rights-year'
    | 'isbn'
    | 'publisher'
    | 'imprint'
    | 'edition'
    | 'title-page-note'
    | 'dedication'
    | 'epigraph-quote'
    | 'epigraph-attribution'
    | 'acknowledgments'
    | 'about-author'
    | 'author-note'
    | 'other-works';

interface EditableBookMetaFieldDefinition {
    path: [group: string, key: string];
    required: boolean;
    label: string;
}

const BOOK_META_FIELD_DEFINITIONS: Record<EditableBookMetaFieldKey, EditableBookMetaFieldDefinition> = {
    title: {
        path: ['Book', 'title'],
        required: true,
        get label() { return t('ui.bookMetaEditing.titleLabel'); },
    },
    subtitle: {
        path: ['Book', 'subtitle'],
        required: false,
        get label() { return t('ui.bookMetaEditing.subtitleLabel'); },
    },
    author: {
        path: ['Book', 'author'],
        required: true,
        get label() { return t('ui.bookMetaEditing.authorLabel'); },
    },
    'copyright-holder': {
        path: ['Rights', 'copyright_holder'],
        required: true,
        get label() { return t('ui.bookMetaEditing.copyrightHolderLabel'); },
    },
    'rights-year': {
        path: ['Rights', 'year'],
        required: true,
        get label() { return t('ui.bookMetaEditing.rightsYearLabel'); },
    },
    isbn: {
        path: ['Identifiers', 'isbn_paperback'],
        required: false,
        get label() { return t('ui.bookMetaEditing.isbnLabel'); },
    },
    publisher: {
        path: ['Publisher', 'name'],
        required: false,
        get label() { return t('ui.bookMetaEditing.publisherLabel'); },
    },
    imprint: {
        path: ['Publisher', 'imprint'],
        required: false,
        get label() { return t('ui.bookMetaEditing.imprintLabel'); },
    },
    edition: {
        path: ['Publisher', 'edition'],
        required: false,
        get label() { return t('ui.bookMetaEditing.editionLabel'); },
    },
    'title-page-note': {
        path: ['Frontmatter', 'title_page_note'],
        required: false,
        get label() { return t('ui.bookMetaEditing.titlePageNoteLabel'); },
    },
    dedication: {
        path: ['Frontmatter', 'dedication'],
        required: false,
        get label() { return t('ui.bookMetaEditing.dedicationLabel'); },
    },
    'epigraph-quote': {
        path: ['Frontmatter', 'epigraph_quote'],
        required: false,
        get label() { return t('ui.bookMetaEditing.epigraphQuoteLabel'); },
    },
    'epigraph-attribution': {
        path: ['Frontmatter', 'epigraph_attribution'],
        required: false,
        get label() { return t('ui.bookMetaEditing.epigraphAttributionLabel'); },
    },
    acknowledgments: {
        path: ['Backmatter', 'acknowledgments'],
        required: false,
        get label() { return t('ui.bookMetaEditing.acknowledgmentsLabel'); },
    },
    'about-author': {
        path: ['Backmatter', 'about_author'],
        required: false,
        get label() { return t('ui.bookMetaEditing.aboutAuthorLabel'); },
    },
    'author-note': {
        path: ['Backmatter', 'author_note'],
        required: false,
        get label() { return t('ui.bookMetaEditing.authorNoteLabel'); },
    },
    'other-works': {
        path: ['Backmatter', 'other_works'],
        required: false,
        get label() { return t('ui.bookMetaEditing.otherWorksLabel'); },
    },
};

export type BookMetaEditNormalizationResult =
    | { ok: true; normalizedValue: string | number | null }
    | { ok: false; normalizedValue: string | number | null; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlankRecord(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return Object.keys(value).every((key) => {
        const candidate = value[key];
        if (candidate === null || candidate === undefined) return true;
        if (typeof candidate === 'string') return candidate.trim().length === 0;
        return false;
    });
}

export function normalizeBookMetaEditValue(
    field: EditableBookMetaFieldKey,
    rawValue: string
): BookMetaEditNormalizationResult {
    const trimmed = rawValue.trim();
    const definition = BOOK_META_FIELD_DEFINITIONS[field];

    if (field === 'rights-year') {
        if (!trimmed) {
            return definition.required
                ? { ok: false, normalizedValue: null, error: t('ui.bookMetaEditing.fieldRequired', { field: definition.label }) }
                : { ok: true, normalizedValue: null };
        }
        if (!/^\d{4}$/.test(trimmed)) {
            return { ok: false, normalizedValue: null, error: t('ui.bookMetaEditing.enterFourDigitYear') };
        }
        return { ok: true, normalizedValue: Number(trimmed) };
    }

    if (!trimmed) {
        return definition.required
            ? { ok: false, normalizedValue: null, error: t('ui.bookMetaEditing.fieldRequired', { field: definition.label }) }
            : { ok: true, normalizedValue: null };
    }

    return { ok: true, normalizedValue: trimmed };
}

export function applyBookMetaFieldUpdate(
    frontmatter: Record<string, unknown>,
    field: EditableBookMetaFieldKey,
    normalizedValue: string | number | null
): void {
    const definition = BOOK_META_FIELD_DEFINITIONS[field];
    const [groupKey, fieldKey] = definition.path;
    const existingGroup = frontmatter[groupKey];
    const currentGroup = isRecord(existingGroup) ? existingGroup : {};

    if (normalizedValue === null) {
        delete currentGroup[fieldKey];
    } else {
        currentGroup[fieldKey] = normalizedValue;
    }

    if (isBlankRecord(currentGroup)) {
        delete frontmatter[groupKey];
    } else {
        frontmatter[groupKey] = currentGroup;
    }
}

export async function updateBookMetaField(
    app: App,
    file: TFile,
    field: EditableBookMetaFieldKey,
    rawValue: string
): Promise<BookMetaEditNormalizationResult> {
    const normalized = normalizeBookMetaEditValue(field, rawValue);
    if (!normalized.ok) return normalized;

    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        applyBookMetaFieldUpdate(frontmatter, field, normalized.normalizedValue);
    });

    return normalized;
}
