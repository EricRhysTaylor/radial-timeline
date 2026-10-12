/**
 * Parses a structured system description into semantic parts.
 * Used by the shared description renderer to produce consistent
 * formatted layouts across loaded and library views.
 */

/**
 * A field line is a short label, a colon (ASCII or full-width, for Japanese and
 * Chinese) and a value: "Best for: …", "Ideal für: …", "最適な用途：…". Matched by
 * shape rather than by English label words, so translated descriptions keep
 * their label/value rows. Labels are at most 40 characters with no sentence
 * punctuation, and a URL's "https://" is never read as a label.
 */
const FIELD_LINE = /^([^:：.!?。！？]{1,40})[:：](?!\/\/)\s*(\S.*)$/;

export interface DescriptionParts {
    summary: string;
    body: string[];
    fields: Array<{ label: string; value: string }>;
}

export function splitOverviewParagraphs(value: string): string[] {
    return value
        .split(/\n\s*\n/g)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0);
}

export function parseDescriptionParts(description: string): DescriptionParts {
    const paragraphs = splitOverviewParagraphs(description);
    const summary = paragraphs[0] ?? '';
    const body: string[] = [];
    const fields: Array<{ label: string; value: string }> = [];

    for (let i = 1; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        const lines = paragraph.split('\n').map((l) => l.trim()).filter(Boolean);

        // First pass: check if this paragraph contains any labeled fields
        const fieldLines: Array<{ label: string; value: string }> = [];
        const plainLines: string[] = [];
        let sawField = false;
        for (const line of lines) {
            const fieldMatch = FIELD_LINE.exec(line);
            if (fieldMatch) {
                fieldLines.push({ label: fieldMatch[1].trim(), value: fieldMatch[2].trim() });
                sawField = true;
            } else if (sawField) {
                // Continuation line after a field
                fieldLines.push({ label: '', value: line });
            } else {
                plainLines.push(line);
            }
        }

        if (sawField) {
            // Any plain lines before the first field become body entries
            for (const line of plainLines) {
                body.push(line);
            }
            for (const field of fieldLines) {
                fields.push(field);
            }
        } else {
            // No labels found – treat whole paragraph as body text
            body.push(paragraph);
        }
    }

    return { summary, body, fields };
}
