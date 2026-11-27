import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { t } from '../i18n';
import { modeAllowsSceneDrag, sortNoticeHelpKeys, timetableModeColumns, timetableModeState, timetableNarrativeOrder, timetableBeatDropIndex, timetableBeatKeepsOrder, sameTimetableBeatOrder } from './timetablePlacement';

describe('standalone timetable placement order', () => {
    it('uses the full book, deduplicates paths, and orders beats with scenes by act', () => {
        const item = (path: string, itemType: 'Scene' | 'Beat', actNumber: number): TimelineItem => ({ path, itemType, actNumber, date: '' });
        const scenes = [item('Book/03 C.md', 'Scene', 2), item('Book/02 B.md', 'Scene', 1),
            item('Book/01.01 Beat.md', 'Beat', 1), item('Book/01 A.md', 'Scene', 1), item('Book/01 A.md', 'Scene', 1)];
        expect(timetableNarrativeOrder(scenes).map(entry => [entry.path, entry.act])).toEqual([
            ['Book/01 A.md', 0], ['Book/01.01 Beat.md', 0], ['Book/02 B.md', 0], ['Book/03 C.md', 1],
        ]);
    });
});

describe('a Timetable pinned to a mode', () => {
    const timeline = (mode: string, toggles: Partial<{ shift: boolean; alt: boolean; runtime: boolean }> = {}) =>
        ({ mode, shift: false, alt: false, runtime: false, ...toggles });

    it('follows the timeline’s Shift when pinned to the mode the timeline is in: Gap shows, drag waits', () => {
        const state = timetableModeState('chronologue', timeline('chronologue', { shift: true }), 'narrative');
        expect(state).toEqual(timeline('chronologue', { shift: true }));
        expect(timetableModeColumns(state)).toEqual(['gap']);
        expect(modeAllowsSceneDrag(state)).toBe(false);
        // Pinned Narrative follows the runtime view too.
        const runtime = timetableModeState('narrative', timeline('narrative', { runtime: true }), 'narrative');
        expect(timetableModeColumns(runtime)).toEqual(['running']);
        expect(modeAllowsSceneDrag(runtime)).toBe(false);
    });

    it('allows drag when pinned to the timeline’s mode with no toggles on', () => {
        const state = timetableModeState('chronologue', timeline('chronologue'), 'narrative');
        expect(timetableModeColumns(state)).toEqual([]);
        expect(modeAllowsSceneDrag(state)).toBe(true);
    });

    it('draws a pin to a different mode plain', () => {
        const state = timetableModeState('narrative', timeline('chronologue', { shift: true, alt: true }), 'chronologue');
        expect(state).toEqual(timeline('narrative'));
        expect(timetableModeColumns(state)).toEqual([]);
        expect(modeAllowsSceneDrag(state)).toBe(true);
    });

    it('places with no timeline open, following the saved mode with no Shift', () => {
        expect(timetableModeState(null, null, 'chronologue')).toEqual(timeline('chronologue'));
        expect(timetableModeState('chronologue', null, 'chronologue')).toEqual(timeline('chronologue'));
        expect(timetableModeState(null, null, undefined)).toEqual(timeline('narrative'));
        expect(modeAllowsSceneDrag(timetableModeState('narrative', null, 'chronologue'))).toBe(true);
    });

    it('follows everything the timeline shows when unpinned', () => {
        expect(timetableModeState(null, timeline('chronologue', { alt: true }), 'narrative')).toEqual(timeline('chronologue', { alt: true }));
        expect(modeAllowsSceneDrag(timeline('progress'))).toBe(false);
    });
});

describe('the sort notice beside Mode', () => {
    const state = (mode: string, toggles: Partial<{ shift: boolean; alt: boolean; runtime: boolean }> = {}) =>
        ({ mode, shift: false, alt: false, runtime: false, ...toggles });

    it('says a sort has replaced story order and the day dividers in Chronologue, and that scenes wait to be dragged', () => {
        expect(sortNoticeHelpKeys(state('chronologue'), 'book')).toEqual(['ui.timetable.sortReplacesStoryOrder', 'ui.timetable.sortPausesDrag']);
    });

    it('says a sort has replaced manuscript order in the other modes', () => {
        expect(sortNoticeHelpKeys(state('narrative'), 'book')).toEqual(['ui.timetable.sortReplacesManuscriptOrder', 'ui.timetable.sortPausesDrag']);
        expect(sortNoticeHelpKeys(state('progress'), 'book')).toEqual(['ui.timetable.sortReplacesManuscriptOrder']);
        expect(sortNoticeHelpKeys(state('gossamer'), 'book')).toEqual(['ui.timetable.sortReplacesManuscriptOrder']);
    });

    it('leaves the drag out where an overlay already pauses it', () => {
        expect(sortNoticeHelpKeys(state('chronologue', { shift: true }), 'book')).toEqual(['ui.timetable.sortReplacesStoryOrder']);
        expect(sortNoticeHelpKeys(state('narrative', { runtime: true }), 'book')).toEqual(['ui.timetable.sortReplacesManuscriptOrder']);
    });

    it('leaves the drag out in Saga scope, where the Timetable never drags scenes', () => {
        expect(sortNoticeHelpKeys(state('chronologue'), 'saga')).toEqual(['ui.timetable.sortReplacesStoryOrder']);
        expect(sortNoticeHelpKeys(state('narrative'), 'saga')).toEqual(['ui.timetable.sortReplacesManuscriptOrder']);
    });

    it('has English text for every line', () => {
        for (const mode of ['narrative', 'chronologue', 'progress', 'gossamer']) {
            for (const key of sortNoticeHelpKeys(state(mode), 'book')) expect(t(key)).not.toMatch(/^\[missing:/);
        }
    });
});

describe('Timetable beat placement', () => {
    const item = (path: string, itemType: 'Scene' | 'Beat', actNumber = 1, model?: string): TimelineItem => ({
        path, itemType, actNumber, date: '', 'Beat Model': model
    });
    const a = item('1 Opening.md', 'Scene');
    const previous = item('1.01 Previous beat.md', 'Beat', 1, 'Save The Cat');
    const b = item('2 Next scene.md', 'Scene');
    const source = item('2.01 Moved beat.md', 'Beat', 1, 'Save The Cat');
    const c = item('3 Later scene.md', 'Scene');
    const hidden = item('3.01 Other beat model.md', 'Beat', 1, "Hero's Journey");
    const d = item('4 Last scene.md', 'Scene');
    const e = item('5 Next act.md', 'Scene', 2);
    const items = [a, previous, b, source, c, hidden, d, e];
    const all = timetableNarrativeOrder(items);
    const active = timetableNarrativeOrder(items, 'Save The Cat');

    it('places a beat on either side of a scene while preserving its two neighboring beats', () => {
        expect(timetableBeatDropIndex(all, source.path!, b.path!, false)).toBe(2);
        expect(timetableBeatDropIndex(all, source.path!, c.path!, true)).toBe(4);
        expect(timetableBeatDropIndex(all, source.path!, b.path!, true)).toBeNull();
        expect(timetableBeatDropIndex(all, source.path!, c.path!, false)).toBeNull();
    });

    it('blocks other acts, beat rows, and intervening classified beats even when filtered out', () => {
        expect(timetableBeatDropIndex(all, source.path!, e.path!, false)).toBeNull();
        expect(timetableBeatDropIndex(all, source.path!, previous.path!, true)).toBeNull();
        expect(timetableBeatDropIndex(all, source.path!, a.path!, true)).toBeNull();
        expect(timetableBeatDropIndex(active, source.path!, d.path!, false)).not.toBeNull();
        expect(timetableBeatDropIndex(all, source.path!, d.path!, false)).toBeNull();
    });

    it('checks the final prefix against other beat systems and recognizes a stale preview', () => {
        expect(timetableBeatKeepsOrder(all, source.path!, new Map([[source.path!, '3.01']]))).toBe(false);
        expect(timetableBeatKeepsOrder(all, source.path!, new Map([[source.path!, '3.01'], [hidden.path!, '3.02']]))).toBe(true);
        expect(sameTimetableBeatOrder({ all, active }, { all: [...all], active: [...active] })).toBe(true);
        expect(sameTimetableBeatOrder({ all, active }, { all: active, active })).toBe(false);
        expect(sameTimetableBeatOrder({ all, active }, { all, active: all })).toBe(false);
    });
});
