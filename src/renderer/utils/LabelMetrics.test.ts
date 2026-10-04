import { describe, expect, it } from 'vitest';
import { BEAT_IN_BOOK_LABEL_MAX_CHARS } from '../layout/LayoutConstants';
import { toBeatRingLabel } from './LabelMetrics';

describe('toBeatRingLabel', () => {
    it('shows a short In This Book name whole', () => {
        expect(toBeatRingLabel('The Flight from Detection')).toBe('The Flight from Detection');
    });

    it('cuts a sentence at a word boundary and marks the cut', () => {
        const label = toBeatRingLabel('Shail starts the intercontinental tourney; Trisan is coming apart over exam prep.');
        expect(label).toBe('Shail starts the…');
        expect(label.length).toBeLessThanOrEqual(BEAT_IN_BOOK_LABEL_MAX_CHARS + 1);
    });

    it('keeps a word that ends exactly at the limit and drops trailing punctuation', () => {
        expect(toBeatRingLabel('Trisan cracks before exam; then everything burns')).toBe('Trisan cracks before exam…');
        expect(toBeatRingLabel('Twenty-eight characters ok!! and then more')).toBe('Twenty-eight characters ok!!…');
    });

    it('hard-cuts a single overlong word', () => {
        expect(toBeatRingLabel('Supercalifragilisticexpialidocious')).toBe('Supercalifragilisticexpiali…');
    });
});
