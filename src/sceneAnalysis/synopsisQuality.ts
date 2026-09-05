/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Synopsis Quality Classification
 */

export type SynopsisQuality = 'missing' | 'weak' | 'ok';

// Common placeholder patterns users might leave
const PLACEHOLDER_PATTERNS = [
    /^add a synopsis/i,
    /^todo/i,
    /^tbd/i,
    /^synopsis/i,
    /^scene synopsis/i,
    /^insert summary/i
];

/**
 * Classify the quality of a synopsis string.
 * @param synopsis The raw synopsis text from frontmatter
 * @param weakThreshold Word count below which synopsis is considered weak (default: 75)
 * @returns 'missing' | 'weak' | 'ok'
 */
export function classifySynopsis(synopsis: unknown, weakThreshold: number = 75): SynopsisQuality {
    if (synopsis === null || synopsis === undefined) {
        return 'missing';
    }

    let text: string;
    if (typeof synopsis === 'string') {
        text = synopsis.trim();
    } else if (typeof synopsis === 'number' || typeof synopsis === 'boolean' || typeof synopsis === 'bigint') {
        text = String(synopsis).trim();
    } else {
        try {
            text = JSON.stringify(synopsis).trim();
        } catch {
            text = '';
        }
    }
    if (text === '') {
        return 'missing';
    }

    // Check for placeholder text
    for (const pattern of PLACEHOLDER_PATTERNS) {
        if (pattern.test(text)) {
            return 'weak';
        }
    }

    // Check word count against threshold
    const wordCount = text.split(/\s+/).length;
    if (wordCount < weakThreshold) {
        return 'weak';
    }

    return 'ok';
}
