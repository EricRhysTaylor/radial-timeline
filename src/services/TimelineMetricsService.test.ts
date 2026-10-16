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

    it('keeps recorded progress after the pace window expires on a fresh service', () => {
        const { service, plugin } = makeService();
        const scenes = [
            ...Array.from({ length: 63 }, (_, index) => scene({
                title: `${index + 2} Finished`, path: `Book/finished-${index}.md`,
                status: 'Complete', due: '2026-03-01'
            })),
            scene({ title: '65 Drafting', 'Publish Stage': 'Zero', status: ['Working'] }),
            scene({ title: '66 Drafting', 'Publish Stage': 'Zero', status: ['Working'] }),
            scene({ title: '67 Planned', 'Publish Stage': 'Zero', status: ['Todo'] }),
            scene({ title: '68 Revising', status: 'Todo' }),
        ];

        const estimate = service.calculateCompletionEstimate(scenes);

        expect(estimate).toMatchObject({
            total: 67, remaining: 4, rate: 0, stage: 'Author',
            date: null, labelText: '?', staleness: 'stalled', stragglerCount: 3
        });
        expect(estimate?.lastProgressDate?.toISOString().slice(0, 10)).toBe('2026-03-01');
        expect(plugin.latestTotalScenes).toBe(67);
        expect(plugin.latestRemainingScenes).toBe(4);
    });

    it('uses current counts after an idle period instead of replaying an earlier estimate', () => {
        const { service } = makeService();
        const scenes = [
            scene({ title: '1', status: 'Complete', due: '2026-05-10' }),
            scene({ title: '2', status: 'Complete', due: '2026-05-17' }),
            scene({ title: '3', status: 'Todo' }),
            scene({ title: '4', status: 'Todo' }),
        ];
        expect(service.calculateCompletionEstimate(scenes)?.date).toBeInstanceOf(Date);

        vi.setSystemTime(new Date('2026-07-24T12:00:00Z'));
        scenes[2].status = 'Complete';
        scenes[2].due = '2026-06-01';
        const current = service.calculateCompletionEstimate(scenes);
        expect(current).toMatchObject({ total: 4, remaining: 1, rate: 0, date: null, labelText: '?' });

        const otherBook = [scene({ title: 'Other book', status: 'Working' })];
        expect(service.calculateCompletionEstimate(otherBook)).toMatchObject({ total: 1, remaining: 1, rate: 0, date: null });
    });

    it('shows current counts without inventing dates when completion dates are absent', () => {
        const { service } = makeService();
        expect(service.calculateCompletionEstimate([
            scene({ title: '1 Finished', status: 'Complete' }),
            scene({ title: '2 Revising', status: 'Working' })
        ])).toMatchObject({ total: 2, remaining: 1, rate: 0, date: null, lastProgressDate: null, labelText: '?' });
    });

    it('keeps the milestone path for a completed stage and excludes non-scene notes', () => {
        const { service } = makeService();
        expect(service.calculateCompletionEstimate([
            scene({ title: '1 Finished', status: 'Complete', due: '2026-03-01' }),
            scene({ title: '2 Finished', status: 'Complete', due: '2026-03-02' }),
            scene({ title: 'Beat', itemType: 'Beat', status: 'Todo' }),
        ])).toBeNull();
    });
});
