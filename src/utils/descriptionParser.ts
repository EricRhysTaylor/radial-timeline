/**
 * Parses a structured system description into semantic parts.
 * Used by the shared description renderer to produce consistent
 * formatted layouts across loaded and library views.
 */

export const KNOWN_LABELS = ['Best for', 'Momentum profile', 'Momentum', 'Start with'];

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
            const labelMatch = KNOWN_LABELS.find((label) => line.startsWith(`${label}:`));
            if (labelMatch) {
                fieldLines.push({ label: labelMatch, value: line.slice(labelMatch.length + 1).trim() });
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
