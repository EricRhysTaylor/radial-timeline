import { describe, expect, it } from 'vitest';
import { beatNamePeekAction } from './BeatNameKeyController';

const key = (k: string, mods: Partial<{ repeat: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
    ({ key: k, repeat: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('beatNamePeekAction', () => {
    it('shows In This Book names while Shift alone is held', () => {
        expect(beatNamePeekAction(key('Shift'), 'down')).toBe('show');
        expect(beatNamePeekAction(key('Shift'), 'up')).toBe('hide');
    });

    it('ignores key repeat while Shift stays down', () => {
        expect(beatNamePeekAction(key('Shift', { repeat: true }), 'down')).toBe('none');
    });

    it('never peeks during a chord, and a chord landing mid-peek clears it', () => {
        // Cmd/Ctrl/Alt already down: Shift is part of a shortcut.
        expect(beatNamePeekAction(key('Shift', { metaKey: true }), 'down')).toBe('none');
        expect(beatNamePeekAction(key('Shift', { ctrlKey: true }), 'down')).toBe('none');
        expect(beatNamePeekAction(key('Shift', { altKey: true }), 'down')).toBe('none');
        // Shift first, then P (Shift+P / Cmd+Shift+P): names go away.
        expect(beatNamePeekAction(key('P', { metaKey: true }), 'down')).toBe('hide');
        expect(beatNamePeekAction(key('P'), 'up')).toBe('none');
    });
});
