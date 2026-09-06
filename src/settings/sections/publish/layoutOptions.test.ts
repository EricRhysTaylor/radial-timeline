import { describe, expect, it } from 'vitest';
import { compactLayoutOptions, readLayoutOptions } from './layoutOptions';
describe('Publishing layout overrides', () => {
    it('preserves interior part slots and independently trims attribution slots', () => {
        const source = { partEpigraphs: [' First ', '', ' Third ', ' '], partEpigraphAttributions: ['', ' Author ', ''] };
        const before = JSON.stringify(source);
        expect(compactLayoutOptions(source)).toEqual({ partEpigraphs: ['First', '', 'Third'], partEpigraphAttributions: ['', 'Author'] });
        expect(JSON.stringify(source)).toBe(before);
    });
    it('removes default-only overrides without dropping explicit scene-heading modes', () => {
        expect(compactLayoutOptions({ partEpigraphs: [''], sceneHeadingMode: 'scene-number-title' })).toBeNull();
        expect(compactLayoutOptions({ sceneHeadingMode: 'title-only' })).toEqual({ sceneHeadingMode: 'title-only' });
        expect(readLayoutOptions()).toEqual({});
    });
    it('keeps an attribution even without an epigraph', () => {
        expect(compactLayoutOptions({ partEpigraphAttributions: ['', 'Author'] })).toEqual({ partEpigraphAttributions: ['', 'Author'] });
    });
});
