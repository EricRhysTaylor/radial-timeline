import { describe, expect, it } from 'vitest';
import { buildPublishingProgressStages } from './publishingProgress';

describe('publishingProgress', () => {
    it('treats Book Details and Book Pages as optional, never blocking export', () => {
        const stages = buildPublishingProgressStages({
            hasBookMeta: false,
            bookMetaSummary: { state: 'blocked' },
            matterSummary: { state: 'ready' },
            matterCount: 0,
            layoutSummary: { state: 'ready', validCount: 0, totalCount: 0 },
            pandocPathValid: false,
        });

        expect(stages.map(stage => stage.id)).toEqual([
            'book-details',
            'book-pages',
            'pdf-style',
            'export-check',
        ]);
        // The two optional stages read 'Optional', not an alarming setup state.
        expect(stages[0].statusLabel).toBe('Optional');
        expect(stages[0].statusKey).toBe('optional');
        expect(stages[1].statusLabel).toBe('Optional');
        expect(stages[1].statusKey).toBe('optional');
        // Missing tools/styles is a calm 'Setup', never a red 'Blocked'.
        expect(stages[2].statusLabel).toBe('Setup');
        expect(stages[3].statusLabel).toBe('Setup');
        expect(stages[3].statusKey).toBe('setup');
        // PDF Style is the quick-start anchor.
        expect(stages[2].quickStart).toBe(true);
    });

    it('is export-ready from a cold start once tools + a Core style exist, with no book meta or pages', () => {
        const stages = buildPublishingProgressStages({
            hasBookMeta: false,
            bookMetaSummary: { state: 'ready' },
            matterSummary: { state: 'ready' },
            matterCount: 0,
            layoutSummary: { state: 'ready', validCount: 2, totalCount: 2 },
            pandocPathValid: true,
        });

        // Book Details / Book Pages untouched → Optional.
        expect(stages[0].statusKey).toBe('optional');
        expect(stages[1].statusKey).toBe('optional');
        // Core styles present + tools valid → PDF Style and Export both green.
        expect(stages[2].statusKey).toBe('ready');
        expect(stages[3].statusKey).toBe('ready');
        expect(stages[3].detail).toBe('Ready to export. Generate your PDF.');
    });

    it('marks the setup row ready when publishing inputs are complete', () => {
        const stages = buildPublishingProgressStages({
            hasBookMeta: true,
            bookMetaSummary: { state: 'ready', topMessage: 'Book Details found' },
            matterSummary: { state: 'ready', topMessage: 'Matter pages are ready' },
            matterCount: 4,
            layoutSummary: { state: 'ready', validCount: 2, totalCount: 2, topMessage: 'Layouts are ready' },
            pandocPathValid: true,
        });

        expect(stages.every(stage => stage.statusLabel === 'Ready')).toBe(true);
        expect(stages.every(stage => stage.statusKey === 'ready')).toBe(true);
        expect(stages[0].actionLabel).toBe('Open details');
        expect(stages[1].actionLabel).toBe('Review pages');
        expect(stages[2].actionLabel).toBe('Review styles');
        expect(stages[3].actionLabel).toBe('Review export');
        expect(stages[3].detail).toBe('Ready to export. Generate your PDF.');
    });
});
