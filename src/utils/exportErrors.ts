export type ExportFailureCategory =
    | 'missing_dependency'
    | 'invalid_template'
    | 'missing_metadata'
    | 'missing_files'
    | 'pandoc_compile_failure'
    | 'write_failure';

export interface ExportFailureDescriptor {
    category: ExportFailureCategory;
    message: string;
    detail?: string;
}

export class ExportFailure extends Error {
    category: ExportFailureCategory;
    detail?: string;

    constructor(descriptor: ExportFailureDescriptor) {
        super(descriptor.message);
        this.name = 'ExportFailure';
        this.category = descriptor.category;
        this.detail = descriptor.detail;
    }
}

function cleanErrorText(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
}

function looksLikeMissingDependency(message: string): boolean {
    return /pandoc\b.*(not found|enoent)|\b(xelatex|lualatex|pdflatex)\b.*(not found|enoent)|command not found|not supported in this environment/i.test(message);
}

function looksLikeInvalidTemplate(message: string): boolean {
    return /template.*(\$body\$|invalid|extension)|layout.*invalid|no pandoc layout selected|no template path configured/i.test(message);
}

function looksLikeMissingMetadata(message: string): boolean {
    return /bookmeta|missing "title"|missing "rights: year"|missing metadata|missing required metadata/i.test(message);
}

function looksLikeMissingFiles(message: string): boolean {
    return /file not found|folder not found|no layouts for|template file not found|enoent/i.test(message);
}

function looksLikeWriteFailure(message: string): boolean {
    return /eacces|eperm|readonly|read-only|permission denied|failed to write|unable to write|write failed/i.test(message);
}

/**
 * Pull the font name out of a fontspec "cannot be found" error.
 *
 * The engine states the cause precisely; the generic category message threw
 * it away and left the user with "Pandoc export failed during PDF
 * compilation." for a problem as specific and fixable as a deactivated font.
 * fontspec wraps its errors across lines with a `(fontspec)` gutter, so the
 * quoted name is matched directly rather than assuming it stays on one line.
 */
function extractMissingFontName(rawMessage: string): string | null {
    const match = rawMessage.match(/The font "([^"]+)" cannot be found/i);
    return match ? match[1].trim() || null : null;
}

function getCategoryMessage(category: ExportFailureCategory, rawMessage: string): string {
    switch (category) {
        case 'missing_dependency':
            return 'Missing export dependency. Check Pandoc and LaTeX configuration before exporting.';
        case 'invalid_template':
            return 'The selected PDF template is not valid for export.';
        case 'missing_metadata':
            return 'Publishing metadata is incomplete for this export.';
        case 'missing_files':
            return 'A required export file or folder could not be found.';
        case 'write_failure':
            return 'Export could not write the output files.';
        case 'pandoc_compile_failure':
        default: {
            const missingFont = extractMissingFontName(rawMessage);
            if (missingFont) {
                return `${missingFont} could not be loaded by XeLaTeX, so the PDF could not be compiled. `
                    + `If you installed it, check it is still active (macOS: Font Book — a deactivated font stays on disk `
                    + `but XeLaTeX cannot use it). Otherwise install it, or pick a different font.`;
            }
            if (/latex/i.test(rawMessage)) {
                return 'Pandoc could not compile the PDF with the current LaTeX template.';
            }
            return 'Pandoc export failed during PDF compilation.';
        }
    }
}

export function categorizeExportError(error: unknown): ExportFailure {
    if (error instanceof ExportFailure) {
        return error;
    }

    const rawMessage = cleanErrorText(
        typeof error === 'string'
            ? error
            : (error as { message?: string; stderr?: string; detail?: string } | null)?.message
                || (error as { stderr?: string } | null)?.stderr
                || String(error)
    );

    let category: ExportFailureCategory = 'pandoc_compile_failure';
    if (looksLikeMissingDependency(rawMessage)) category = 'missing_dependency';
    else if (looksLikeInvalidTemplate(rawMessage)) category = 'invalid_template';
    else if (looksLikeMissingMetadata(rawMessage)) category = 'missing_metadata';
    else if (looksLikeMissingFiles(rawMessage)) category = 'missing_files';
    else if (looksLikeWriteFailure(rawMessage)) category = 'write_failure';

    return new ExportFailure({
        category,
        message: getCategoryMessage(category, rawMessage),
        detail: rawMessage || undefined,
    });
}
