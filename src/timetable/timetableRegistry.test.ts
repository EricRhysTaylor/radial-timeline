import { describe, expect, it } from 'vitest';
import { currentTimelineMode, publishTimelineMode } from './timetableRegistry';

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
