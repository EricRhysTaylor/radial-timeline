import { describe, expect, it } from 'vitest';
import { shouldShowWelcomeScreen } from './welcomeScreenState';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { hasSceneNotes } from '../utils/sceneHelpers';

const base = { requested: false, hasScenes: false, closed: false, hasSourceFolder: false };

describe('shouldShowWelcomeScreen', () => {
    it('a new vault starts with the welcome closed-flag off', () => {
        expect(DEFAULT_SETTINGS.welcomeScreenClosed).toBe(false);
    });

    it('shows on first open of a vault with no scenes', () => {
        expect(shouldShowWelcomeScreen(base)).toBe(true);
    });

    it('stays closed once closed in this vault, so the empty timeline shows', () => {
        expect(shouldShowWelcomeScreen({ ...base, closed: true })).toBe(false);
    });

    it('does not show by itself once the book has scenes or a folder', () => {
        expect(shouldShowWelcomeScreen({ ...base, hasScenes: true })).toBe(false);
        expect(shouldShowWelcomeScreen({ ...base, hasSourceFolder: true })).toBe(false);
    });

    it('a book of beats or sketches alone has no scene notes yet (zero state)', () => {
        expect(hasSceneNotes([])).toBe(false);
        expect(hasSceneNotes([{ title: 'Catalyst', date: '', itemType: 'Beat' }])).toBe(false);
        expect(hasSceneNotes([{ title: '1 Opening', date: '', itemType: 'Scene' }])).toBe(true);
    });

    it('shows whenever asked for (Welcome link or the Welcome screen command), scenes or not', () => {
        expect(shouldShowWelcomeScreen({ ...base, requested: true, closed: true })).toBe(true);
        expect(shouldShowWelcomeScreen({ requested: true, hasScenes: true, closed: true, hasSourceFolder: true })).toBe(true);
    });
});
