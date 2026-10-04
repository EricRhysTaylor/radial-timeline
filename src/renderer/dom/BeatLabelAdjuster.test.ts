import { describe, expect, it } from 'vitest';
import { cascadeOrder } from './BeatLabelAdjuster';

const at = (pathId: string, fractionOfRing: number) => ({
    pathId,
    // Same convention as the renderer: 0 at 12 o'clock, clockwise, folded by atan2.
    originalStartAngle: Math.atan2(
        Math.sin(-Math.PI / 2 + 2 * Math.PI * fractionOfRing),
        Math.cos(-Math.PI / 2 + 2 * Math.PI * fractionOfRing)
    )
});

describe('cascadeOrder', () => {
    it('starts after the widest empty stretch of ring, so 9 o\'clock neighbours cascade', () => {
        // All Is Lost (75%) and Dark Night (77%) straddle 9 o'clock, where a
        // fixed seam split them; the widest gap is Midpoint (50%) to All Is Lost.
        const order = cascadeOrder([
            at('opening', 0), at('catalyst', 0.10), at('fun', 0.30), at('midpoint', 0.50),
            at('all-is-lost', 0.75), at('dark-night', 0.77), at('final', 0.98)
        ]).map((label) => label.pathId);
        expect(order).toEqual(['all-is-lost', 'dark-night', 'final', 'opening', 'catalyst', 'fun', 'midpoint']);
    });

    it('keeps every label exactly once', () => {
        expect(cascadeOrder([at('only', 0.4)]).map((label) => label.pathId)).toEqual(['only']);
        expect(cascadeOrder([])).toEqual([]);
    });
});
