import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import {
    extractPositionToken,
    isBeatNote,
    isMatterNote,
    isNonSceneItem,
    isRenderedOnTimeline,
    isSceneItem,
    isStoryBeat,
    normalizeBooleanValue,
    sceneKey,
    shouldDisplayMissingWhenWarning,
    sortByManuscriptOrder,
    sortScenesChronologically
} from './sceneHelpers';

const item = (overrides: Partial<TimelineItem>): TimelineItem => ({ title: '', ...overrides } as TimelineItem);

describe('normalizeBooleanValue', () => {
    it('accepts booleans, yes/true/1 strings, and the number 1', () => {
        expect(normalizeBooleanValue(true)).toBe(true);
        expect(normalizeBooleanValue(' YES ')).toBe(true);
        expect(normalizeBooleanValue('1')).toBe(true);
        expect(normalizeBooleanValue(1)).toBe(true);
        expect(normalizeBooleanValue('no')).toBe(false);
        expect(normalizeBooleanValue('')).toBe(false);
        expect(normalizeBooleanValue(2)).toBe(false);
        expect(normalizeBooleanValue(null)).toBe(false);
    });
});

describe('item type predicates', () => {
    it('classify by itemType with scenes as the default', () => {
        expect(isStoryBeat(' Plot ')).toBe(true);
        expect(isStoryBeat('Scene')).toBe(false);
        expect(isBeatNote({ itemType: 'Beat' })).toBe(true);
        expect(isSceneItem({})).toBe(true);
        expect(isSceneItem({ itemType: 'Backdrop' })).toBe(false);
        expect(isMatterNote({ itemType: 'Frontmatter' })).toBe(true);
        expect(isNonSceneItem({ itemType: 'Backdrop' })).toBe(true);
        expect(isNonSceneItem({ itemType: 'Scene' })).toBe(false);
        expect(isRenderedOnTimeline({ itemType: 'BookMeta' })).toBe(false);
        expect(isRenderedOnTimeline({ itemType: 'Backdrop' })).toBe(true);
    });
});

describe('sceneKey', () => {
    it('uses the path when present and a title/number/when composite otherwise', () => {
        expect(sceneKey({ path: 'a.md', title: 'x' })).toBe('a.md');
        expect(sceneKey({ title: 'x', number: 2, when: undefined })).toBe('x::2::');
    });
});

describe('shouldDisplayMissingWhenWarning', () => {
    it('warns only for statuses that require a date', () => {
        expect(shouldDisplayMissingWhenWarning(item({ missingWhen: true, status: 'Working' }))).toBe(true);
        expect(shouldDisplayMissingWhenWarning(item({ missingWhen: true, status: 'Todo' }))).toBe(false);
        expect(shouldDisplayMissingWhenWarning(item({ missingWhen: false, status: 'Working' }))).toBe(false);
        expect(shouldDisplayMissingWhenWarning(undefined)).toBe(false);
    });
});

describe('manuscript and chronological order', () => {
    it('orders by the numeric prefix token, then by title', () => {
        const a = item({ title: '2 Beta' }); const b = item({ title: '10 Alpha' }); const c = item({ title: 'Zeta' });
        expect(extractPositionToken(b)).toBe('10');
        expect([c, b, a].sort(sortByManuscriptOrder).map(s => s.title)).toEqual(['2 Beta', '10 Alpha', 'Zeta']);
    });

    it('sorts by When and carries an undated scene with its predecessor', () => {
        const scenes = [
            item({ title: '1 First', when: new Date('2024-03-01') }),
            item({ title: '2 Undated' }),
            item({ title: '3 Earlier', when: new Date('2024-01-01') })
        ];
        expect(sortScenesChronologically(scenes).map(s => s.title)).toEqual(['3 Earlier', '1 First', '2 Undated']);
    });
});
