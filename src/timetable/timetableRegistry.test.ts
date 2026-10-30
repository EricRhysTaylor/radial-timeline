import { describe, expect, it, vi } from 'vitest';
import { currentTimelineMode, dropTimetableScene, publishTimelineMode, registerSceneDrop } from './timetableRegistry';

describe('publishTimelineMode', () => {
    it('carries the runtime view in Narrative', () => {
        publishTimelineMode({ mode: 'narrative', shift: false, alt: false, runtime: true });
        expect(currentTimelineMode()).toEqual({ mode: 'narrative', shift: false, alt: false, runtime: true });
    });

    it('carries Shift and Alt in Chronologue, and the runtime view only in Narrative', () => {
        publishTimelineMode({ mode: 'chronologue', shift: true, alt: true, runtime: true });
        expect(currentTimelineMode()).toEqual({ mode: 'chronologue', shift: true, alt: true, runtime: false });
    });

    it('clears every micro-mode in the other modes', () => {
        publishTimelineMode({ mode: 'gossamer', shift: true, alt: true, runtime: true });
        expect(currentTimelineMode()).toEqual({ mode: 'gossamer', shift: false, alt: false, runtime: false });
    });
});

describe('Timetable scene placement registration', () => {
    it('routes only the matching mode and does not let stale cleanup remove a newer handler', async () => {
        const first = vi.fn().mockResolvedValue(true);
        const second = vi.fn().mockResolvedValue(true);
        const disposeFirst = registerSceneDrop('narrative', first);
        const disposeSecond = registerSceneDrop('chronologue', second);
        disposeFirst();
        expect(await dropTimetableScene('narrative', 'A', 'B')).toBe(false);
        expect(await dropTimetableScene('chronologue', 'A', 'B')).toBe(true);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith('A', 'B');
        disposeSecond();
        expect(await dropTimetableScene('chronologue', 'A', 'B')).toBe(false);
    });
});
