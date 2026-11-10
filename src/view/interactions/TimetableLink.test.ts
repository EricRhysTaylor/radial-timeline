import { describe, expect, it, vi } from 'vitest';
import { linkSceneHoverToTimetable, litScenes, queryMarkFor } from './TimetableLink';
import { onLinkedScene, trackTimetable } from '../../timetable/timetableRegistry';

describe('timeline to Canvas', () => {
    it('pins the hovered scene on Shift and keeps normal hover events distinct', () => {
        class SceneElement {
            ownerDocument = { defaultView: {} };
            closest() { return this; }
            getAttribute() { return 'Story%2FScene.md'; }
            querySelector() { return null; }
        }
        vi.stubGlobal('Element', SceneElement);
        const handlers = new Map<string, (event: Event) => void>();
        const svg = { ownerDocument: { defaultView: {} } } as unknown as SVGSVGElement;
        const view = { renderScope: { registerDomEvent: (_el: HTMLElement, name: string, handler: (event: Event) => void) => { handlers.set(name, handler); } } };
        const listener = vi.fn();
        const dispose = onLinkedScene(listener);
        try {
            linkSceneHoverToTimetable(view, svg);
            handlers.get('pointerover')!({ target: new SceneElement(), shiftKey: false } as unknown as Event);
            handlers.get('keydown')!({ key: 'Shift', repeat: false } as unknown as Event);
            handlers.get('pointerout')!({ relatedTarget: null } as unknown as Event);
            expect(listener.mock.calls.map(call => call[2])).toEqual(['timeline', 'timeline-pin', 'timeline']);
            expect(listener.mock.calls[1][0]).toBe('Story/Scene.md');
        } finally { dispose(); vi.unstubAllGlobals(); }
    });

    it('lights a Timetable row on hover but scrolls to it only with Shift', () => {
        class SceneElement {
            ownerDocument = { defaultView: {} };
            closest() { return this; }
            getAttribute() { return 'Story%2FScene.md'; }
            querySelector() { return null; }
        }
        vi.stubGlobal('Element', SceneElement);
        const handlers = new Map<string, (event: Event) => void>();
        const svg = { ownerDocument: { defaultView: {} } } as unknown as SVGSVGElement;
        const view = { renderScope: { registerDomEvent: (_el: HTMLElement, name: string, handler: (event: Event) => void) => { handlers.set(name, handler); } } };
        const markLinkedRow = vi.fn();
        const untrack = trackTimetable({ markLinkedRow } as never);
        try {
            linkSceneHoverToTimetable(view, svg);
            // A pointer crossing the timeline, or a file dragged over it, only lights the row.
            handlers.get('pointerover')!({ target: new SceneElement(), shiftKey: false } as unknown as Event);
            handlers.get('pointerout')!({ relatedTarget: null } as unknown as Event);
            handlers.get('pointerover')!({ target: new SceneElement(), shiftKey: true } as unknown as Event);
            expect(markLinkedRow.mock.calls).toEqual([
                ['Story/Scene.md', null, false], [null, null, false],
                ['Story/Scene.md', null, false], ['Story/Scene.md', null, true],
            ]);
        } finally { untrack(); vi.unstubAllGlobals(); }
    });
});

describe('queryMarkFor', () => {
    it('draws the full-size icon in a roomy cell', () => {
        expect(queryMarkFor(140, 200)).toEqual({ kind: 'icon', size: expect.closeTo(22.4) });
    });

    it('shrinks the icon to fit a thin ring or a narrow cell', () => {
        expect(queryMarkFor(40, 200)).toEqual({ kind: 'icon', size: 14.4 });
        expect(queryMarkFor(140, 30)).toEqual({ kind: 'icon', size: 14.4 });
    });

    it('falls back to a dot when the icon would be too small to read', () => {
        const narrow = queryMarkFor(140, 12);
        expect(narrow?.kind).toBe('dot');
        expect(narrow?.kind === 'dot' && narrow.radius).toBeCloseTo(3.6);
        expect(queryMarkFor(20, 200)).toEqual({ kind: 'dot', radius: 5 });
    });

    it('draws nothing in a sliver', () => {
        expect(queryMarkFor(140, 3)).toBeNull();
    });
});

describe('litScenes', () => {
    const scenes = [
        { path: 'B/1 Bingley Arrives.md', itemType: 'Scene' },
        { path: 'B/2 Mr Bennet Visits.md', itemType: 'Scene' },
        { path: 'B/1.01 Opening Image.md', itemType: 'Beat' },
        { path: null, itemType: 'Scene' },
    ];
    const coloring = {
        values: new Map([['B/1 Bingley Arrives.md', 'Earth'], ['B/1.01 Opening Image.md', 'Earth']]),
        legend: [{ value: 'Earth', colorIndex: 5 }],
    };

    it('lights the lens rows, beats included', () => {
        const lens = { paths: new Set(['B/2 Mr Bennet Visits.md', 'B/1.01 Opening Image.md']) };
        expect(litScenes(scenes, lens, null).map(entry => entry.lit)).toEqual([false, true, true, false]);
    });

    it('lights only scenes with a value under a coloring, in that value’s color', () => {
        expect(litScenes(scenes, null, coloring)).toEqual([{ lit: true, slot: 5 }, { lit: false }, { lit: false }, { lit: false }]);
    });

    it('needs both when a lens and a coloring are on together', () => {
        const lens = { paths: new Set(['B/2 Mr Bennet Visits.md']) };
        expect(litScenes(scenes, lens, coloring).map(entry => entry.lit)).toEqual([false, false, false, false]);
    });
});
