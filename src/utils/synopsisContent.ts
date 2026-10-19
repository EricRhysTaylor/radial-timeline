/** Content policy for AI-generated synopses; author-written/imported text is untouched. */
export const SYNOPSIS_CONTENT_RULE = 'Summarize the scene\'s actions, conflict, turning point, and outcome. Do not include days of the week, calendar dates, or clock times, even when they appear in the prose, source synopsis, or Summary. Scheduling belongs in the YAML When, End, and Duration fields, not in Synopsis. Do not infer or prepend scheduling labels.';

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const CLOCK_HOUR = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d{1,2})';
const SCHEDULING_PATTERNS = [
    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
    /\b(?:Mon|Tue(?:s)?|Wed|Thu(?:rs)?|Fri|Sat|Sun)\.(?=\s|$)/i,
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/,
    /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/,
    new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'i'),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, 'i'),
    /\b(?:in|during|year)\s+\d{4}\b/i,
    /^\s*\d{4}(?=\s*[:.,—–-])/,
    /\b\d{1,4}\s*(?:AD|BC|CE|BCE)\b/i,
    /\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/,
    new RegExp(`\\b${CLOCK_HOUR}\\s*[ap]\\.?m\\.?(?=\\W|$)`, 'i'),
    new RegExp(`\\b${CLOCK_HOUR}\\s+o['’]clock\\b`, 'i'),
    new RegExp(`\\b${CLOCK_HOUR}\\s+(?:in the (?:morning|afternoon|evening)|at night)\\b`, 'i'),
    /\b(?:noon|midnight)\b/i,
];

/** Reject recognizable scheduling text before a generated synopsis can overwrite author metadata. */
export function getSynopsisContentProblem(synopsis: string): string | null {
    const reference = SCHEDULING_PATTERNS.map(pattern => pattern.exec(synopsis)?.[0]).find(Boolean);
    return reference
        ? `The generated synopsis includes scheduling text ("${reference}"). Keep days of the week, dates, and clock times in YAML scheduling fields and regenerate the synopsis.`
        : null;
}
