import { estimateBeatLabelWidth } from './FontMetricsCache';
import { BEAT_IN_BOOK_LABEL_MAX_CHARS } from '../layout/LayoutConstants';

/**
 * Estimate pixel width for a beat label title.
 * Uses cached font metrics for accurate measurement.
 * Cache is lazily initialized on first call.
 */
export function estimatePixelsFromTitle(title: string, fontPx: number, _fudge: number, paddingPx: number): number {
    // Use the font metrics cache for accurate measurement
    // The fudge factor is no longer needed since we measure actual character widths
    return estimateBeatLabelWidth(title, fontPx, paddingPx);
}

/**
 * The ring-label form of a beat's In This Book line. A short name ("The
 * Flight from Detection") shows whole; a sentence is cut at a word boundary
 * so the swapped ring still fits once around.
 */
export function toBeatRingLabel(inThisBook: string): string {
    if (inThisBook.length <= BEAT_IN_BOOK_LABEL_MAX_CHARS) return inThisBook;
    const head = inThisBook.slice(0, BEAT_IN_BOOK_LABEL_MAX_CHARS);
    const endsOnWord = inThisBook[BEAT_IN_BOOK_LABEL_MAX_CHARS] === ' ';
    const lastSpace = head.lastIndexOf(' ');
    const cut = endsOnWord
        ? head
        : lastSpace > 0 ? head.slice(0, lastSpace) : head.slice(0, BEAT_IN_BOOK_LABEL_MAX_CHARS - 1);
    return `${cut.replace(/[\s;:,.—-]+$/, '')}…`;
}
