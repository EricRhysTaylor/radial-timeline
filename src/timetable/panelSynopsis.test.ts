import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { updateSynopsis } from './panelSynopsis';

describe('panel synopsis edits', () => {
    it('updates the existing author property without changing other fields', () => {
        const fm: Record<string, unknown> = { synopsis: 'Before', Character: ['A'] };
        expect(updateSynopsis(fm, DEFAULT_SETTINGS, 'Before', 'After')).toBe(true);
        expect(fm).toEqual({ synopsis: 'After', Character: ['A'] });
    });

    it('refuses to overwrite a concurrent change', () => {
        const fm: Record<string, unknown> = { Synopsis: 'Someone else' };
        expect(updateSynopsis(fm, DEFAULT_SETTINGS, 'Before', 'After')).toBe(false);
        expect(fm.Synopsis).toBe('Someone else');
    });

    it('adds a missing synopsis when it is still missing', () => {
        const fm: Record<string, unknown> = {};
        expect(updateSynopsis(fm, DEFAULT_SETTINGS, undefined, 'New')).toBe(true);
        expect(fm.Synopsis).toBe('New');
    });
});
