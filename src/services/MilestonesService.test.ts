import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { MilestonesService } from './MilestonesService';

function scene(path: string, stage: string, status: string): TimelineItem {
    return {
        path,
        itemType: 'Scene',
        date: '',
        'Publish Stage': stage,
        status,
    };
}

function service(): MilestonesService {
    return new MilestonesService({
        calculateCompletionEstimate: () => null,
    } as any);
}

describe('MilestonesService', () => {
    it('does not celebrate when lower-stage work remains incomplete despite a Press scene', () => {
        const milestone = service().detectMilestone([
            scene('1.md', 'Zero', 'Todo'),
            scene('2.md', 'Author', 'Complete'),
            scene('3.md', 'Press', 'Complete'),
        ]);

        expect(milestone).toBeNull();
    });

    it('celebrates the highest row all scenes have cleared', () => {
        const milestone = service().detectMilestone([
            scene('1.md', 'Zero', 'Complete'),
            scene('2.md', 'Author', 'Todo'),
        ]);

        expect(milestone).toEqual({ type: 'stage-zero-complete', stage: 'Zero' });
    });

    it('celebrates book complete only when every scene is Press complete', () => {
        const milestone = service().detectMilestone([
            scene('1.md', 'Press', 'Complete'),
            scene('2.md', 'Press', 'Complete'),
        ]);

        expect(milestone).toEqual({ type: 'book-complete', stage: 'Press' });
    });
});
