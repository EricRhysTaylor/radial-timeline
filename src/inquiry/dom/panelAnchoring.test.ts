import { describe, it, expect } from 'vitest';
import { computePanelAnchorStyle } from './panelAnchoring';

describe('computePanelAnchorStyle', () => {
    it('right-aligns the panel against the trigger and clears left', () => {
        // container right = 1000, trigger right = 800 → 200px from right edge.
        const style = computePanelAnchorStyle(
            { left: 0, right: 1000 },
            { left: 700, right: 800 },
            'right'
        );
        expect(style).toEqual({ left: '', right: '200px' });
    });

    it('left-aligns the panel against the trigger and clears right', () => {
        // container left = 0, trigger left = 120 → 120px from left edge.
        const style = computePanelAnchorStyle(
            { left: 0, right: 1000 },
            { left: 120, right: 220 },
            'left'
        );
        expect(style).toEqual({ left: '120px', right: '' });
    });

    it('clamps a negative right offset to 0 (trigger past container right)', () => {
        // trigger.right > container.right → negative; must clamp to 0.
        const style = computePanelAnchorStyle(
            { left: 0, right: 1000 },
            { left: 700, right: 1100 },
            'right'
        );
        expect(style).toEqual({ left: '', right: '0px' });
    });

    it('clamps a negative left offset to 0 (trigger past container left)', () => {
        const style = computePanelAnchorStyle(
            { left: 100, right: 1000 },
            { left: 50, right: 150 },
            'left'
        );
        expect(style).toEqual({ left: '0px', right: '' });
    });

    it('handles a trigger exactly at the right edge', () => {
        const style = computePanelAnchorStyle(
            { left: 0, right: 1000 },
            { left: 800, right: 1000 },
            'right'
        );
        expect(style).toEqual({ left: '', right: '0px' });
    });

    it('handles a container offset from the viewport origin', () => {
        // container shifted by 200px → offsets are relative, not absolute.
        const style = computePanelAnchorStyle(
            { left: 200, right: 1200 },
            { left: 250, right: 350 },
            'left'
        );
        expect(style).toEqual({ left: '50px', right: '' });
    });
});
