import { describe, it, expect } from 'vitest';
import { normalizeTimelineMode } from './timelineMode';
import { TimelineMode } from '../modes/ModeDefinition';

describe('normalizeTimelineMode', () => {
    it('normalizes subplot to progress', () => {
        const result = normalizeTimelineMode('subplot');
        expect(result.mode).toBe(TimelineMode.PROGRESS);
        expect(result.changed).toBe(true);
    });

    it('normalizes publication to progress', () => {
        const result = normalizeTimelineMode('publication');
        expect(result.mode).toBe(TimelineMode.PROGRESS);
        expect(result.changed).toBe(true);
    });
});
