import { describe, expect, it } from 'vitest';
import { fnv1a32Hex, fnv1a32HexUnpadded } from './hash';

// Both spellings are persisted (scene/book ids, cache keys, log fingerprints),
// so these pin the exact algorithm and formatting, not just determinism.
describe('fnv1a32Hex', () => {
    it('matches the reference FNV-1a 32-bit vectors', () => {
        expect(fnv1a32Hex('')).toBe('811c9dc5');
        expect(fnv1a32Hex('a')).toBe('e40c292c');
        expect(fnv1a32Hex('foobar')).toBe('bf9cf968');
    });
    it('is always 8 hex digits', () => {
        for (const s of ['', 'x', 'Books/Scene 1.md', 'zzzzzzzz']) expect(fnv1a32Hex(s)).toMatch(/^[0-9a-f]{8}$/);
    });
});

describe('fnv1a32HexUnpadded', () => {
    it('reproduces the shift-add loop the previous inline copies used (it is the same arithmetic)', () => {
        const legacy = (text: string): string => {
            let hash = 2166136261;
            for (let i = 0; i < text.length; i += 1) {
                hash ^= text.charCodeAt(i);
                hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
            }
            return (hash >>> 0).toString(16);
        };
        for (const s of ['', 'a', 'foobar', 'anthropic|claude-opus-5|12000|4000', '{"provider":"openai"}', 'Books/Scene 1.md']) {
            expect(fnv1a32HexUnpadded(s)).toBe(legacy(s));
        }
    });
    it('is the padded form without its leading zeros', () => {
        for (const s of ['', 'a', 'foobar', 'x'.repeat(40)]) expect(fnv1a32Hex(s)).toBe(fnv1a32HexUnpadded(s).padStart(8, '0'));
    });
});
