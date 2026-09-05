import type { App, TFile } from 'obsidian';

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
        label: 'Title',
    },
    subtitle: {
        path: ['Book', 'subtitle'],
        required: false,
        label: 'Subtitle',
    },
    author: {
        path: ['Book', 'author'],
        required: true,
        label: 'Author',
    },
    'copyright-holder': {
        path: ['Rights', 'copyright_holder'],
        required: true,
        label: 'Copyright holder',
    },
    'rights-year': {
        path: ['Rights', 'year'],
        required: true,
        label: 'Rights year',
    },
    isbn: {
        path: ['Identifiers', 'isbn_paperback'],
        required: false,
        label: 'ISBN',
    },
    publisher: {
        path: ['Publisher', 'name'],
        required: false,
        label: 'Publisher',
    },
    imprint: {
        path: ['Publisher', 'imprint'],
        required: false,
        label: 'Imprint',
    },
    edition: {
        path: ['Publisher', 'edition'],
        required: false,
        label: 'Edition',
    },
    'title-page-note': {
        path: ['Frontmatter', 'title_page_note'],
        required: false,
        label: 'Title page note',
    },
    dedication: {
        path: ['Frontmatter', 'dedication'],
        required: false,
        label: 'Dedication',
    },
    'epigraph-quote': {
        path: ['Frontmatter', 'epigraph_quote'],
        required: false,
        label: 'Epigraph quote',
    },
    'epigraph-attribution': {
        path: ['Frontmatter', 'epigraph_attribution'],
        required: false,
        label: 'Epigraph attribution',
    },
    acknowledgments: {
        path: ['Backmatter', 'acknowledgments'],
        required: false,
        label: 'Acknowledgments',
    },
    'about-author': {
        path: ['Backmatter', 'about_author'],
        required: false,
        label: 'About the author',
    },
    'author-note': {
        path: ['Backmatter', 'author_note'],
        required: false,
        label: 'Author note',
    },
    'other-works': {
        path: ['Backmatter', 'other_works'],
        required: false,
        label: 'Other works',
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
                ? { ok: false, normalizedValue: null, error: 'Rights year is required.' }
                : { ok: true, normalizedValue: null };
        }
        if (!/^\d{4}$/.test(trimmed)) {
            return { ok: false, normalizedValue: null, error: 'Enter a 4-digit year.' };
        }
        return { ok: true, normalizedValue: Number(trimmed) };
    }

    if (!trimmed) {
        return definition.required
            ? { ok: false, normalizedValue: null, error: `${definition.label} is required.` }
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
