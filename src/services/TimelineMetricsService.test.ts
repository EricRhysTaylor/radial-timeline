import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../types';
import { TimelineMetricsService } from './TimelineMetricsService';

describe('TimelineMetricsService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const makeService = () => {
        const plugin = {
            latestStatusCounts: {},
            latestTotalScenes: 0,
            latestRemainingScenes: 0,
            latestScenesPerWeek: 0
        };
        return {
            plugin,
            service: new TimelineMetricsService(plugin as never)
        };
    };

    const scene = (overrides: Partial<TimelineItem>): TimelineItem => ({
        title: overrides.title ?? 'Scene',
        path: overrides.path ?? `${overrides.title ?? 'Scene'}.md`,
        date: '',
        status: overrides.status ?? 'Todo',
        due: overrides.due,
        'Publish Stage': overrides['Publish Stage'] ?? 'Author',
        itemType: 'Scene',
        ...overrides
    });

    it('uses Due as the completion date only for complete scenes when calculating pace', () => {
        const { service, plugin } = makeService();
        const scenes: TimelineItem[] = [
            scene({ title: '1 Complete', path: 'Book/1.md', status: 'Complete', due: '2026-05-10' }),
            scene({ title: '2 Complete', path: 'Book/2.md', status: 'Complete', due: '2026-05-17' }),
            scene({ title: '3 Overdue', path: 'Book/3.md', status: 'Todo', due: '2026-05-01' }),
            scene({ title: '4 Overdue', path: 'Book/4.md', status: 'Working', due: '2026-05-03' }),
            scene({ title: '5 Remaining', path: 'Book/5.md', status: 'Todo' }),
        ];

        const estimate = service.calculateCompletionEstimate(scenes);

        expect(estimate?.rate).toBe(0.5);
        expect(estimate?.lastProgressDate?.toISOString().slice(0, 10)).toBe('2026-05-17');
        expect(estimate?.remaining).toBe(3);
        expect(plugin.latestStatusCounts.Due).toBe(2);
    });
});
