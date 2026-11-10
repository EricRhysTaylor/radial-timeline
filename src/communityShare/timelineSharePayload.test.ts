import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { buildTimelineSharePayload, sceneIdHolders, timelinePayloadFingerprint } from './timelineSharePayload';

const SCENE_TEXT = 'The rain came in under the door and she did not look up.';

function scene(overrides: Partial<TimelineItem> & Record<string, unknown> = {}): TimelineItem {
    return {
        title: '1 The Ball',
        date: '',
        path: 'Private Folder/Book/1 The Ball.md',
        sceneId: 'scn_a1b2c3d4',
        subplot: 'Main Plot',
        actNumber: 1,
        synopsis: 'They dance.',
        status: 'Complete',
        'Publish Stage': 'Zero',
        itemType: 'Scene',
        Character: ['Mira'],
        pov: 'first',
        when: new Date(1811, 8, 25, 19, 0, 0),
        ...overrides,
    } as TimelineItem;
}

function build(items: TimelineItem[], overrides: Partial<Parameters<typeof buildTimelineSharePayload>[0]> = {}) {
    return buildTimelineSharePayload({
        items,
        bookMeta: null,
        book: { title: 'Private Working Title' },
        actCount: 3,
        pluginVersion: '7.4.0',
        exportId: 'export-1',
        now: new Date('2026-11-06T00:00:00.000Z'),
        ...overrides,
    });
}

describe('buildTimelineSharePayload', () => {
    it('sends the fields the website reads', () => {
        const [item] = build([scene()]).items;
        expect(item).toEqual({
            itemType: 'Scene',
            title: '1 The Ball',
            sceneId: 'scn_a1b2c3d4',
            subplot: ['Main Plot'],
            when: '1811-09-25T19:00:00',
            actNumber: 1,
            pov: 'first',
            Character: ['Mira'],
            synopsis: 'They dance.',
            status: 'Complete',
            'Publish Stage': 'Zero',
        });
    });

    it('never sends scene text, paths or anything else on the item', () => {
        const json = JSON.stringify(build([scene({
            body: SCENE_TEXT,
            content: SCENE_TEXT,
            pendingEdits: SCENE_TEXT,
            previousSceneAnalysis: SCENE_TEXT,
            rawFrontmatter: { Notes: SCENE_TEXT, Subplot: 'Main Plot', Words: 1200 },
        })]));
        expect(json).not.toContain('rain came in');
        expect(json).not.toContain('Private Folder');
        expect(json).not.toContain('.md');
        expect(json).not.toContain('rawFrontmatter');
    });

    it('sends linked cast and subplots by name, never by link target', () => {
        const { items } = build([scene({
            rawFrontmatter: {
                Character: ['[[Private Folder/People/Mira|Mira]]', '[[Private Folder/People/Tomas]]', '[[Ana.md#Bio]]', '[[ ]]'],
                Subplot: ['[[Private Folder/Arcs/Romance]]'],
            },
        })]);
        expect(items[0].Character).toEqual(['Mira', 'Tomas', 'Ana']);
        expect(items[0].subplot).toEqual(['Romance']);
        expect(JSON.stringify(items)).not.toContain('Private Folder');
    });

    it('sends no vault settings', () => {
        const payload = build([scene()]);
        expect(Object.keys(payload.renderConfig)).toEqual(['actCount']);
        expect(JSON.stringify(payload)).not.toContain('sourceFolder');
    });

    it('drops an id an author typed, which can carry a title', () => {
        for (const sceneId of ['the-secret-wedding', 'Book/1 The Ball.md', 'scn_1']) {
            expect(build([scene({ sceneId })]).items[0]).not.toHaveProperty('sceneId');
        }
    });

    it('sends an id two scenes share on one scene only, so neither merges into the other', () => {
        const { items } = build([
            scene({ path: 'Book/1 The Ball.md', title: '1 The Ball' }),
            scene({ path: 'Book/1 The Ball 1.md', title: '1 The Ball' }),
            scene({ path: 'Book/2 The Letter.md', title: '2 The Letter', sceneId: 'scn_e5f6a7b8' }),
        ]);
        expect(items).toHaveLength(3);
        expect(items[0].sceneId).toBe('scn_a1b2c3d4');
        expect(items[1]).not.toHaveProperty('sceneId');
        expect(items[2].sceneId).toBe('scn_e5f6a7b8');
    });

    it('keeps the id on the scene that sent it last when a note is duplicated', () => {
        const original = scene({ path: 'Book/3 The Duel.md', title: '3 The Duel' });
        const firstSend = sceneIdHolders([original]);
        expect(firstSend).toEqual({ scn_a1b2c3d4: 'Book/3 The Duel.md' });

        // The copy sorts ahead of the original, and has a different title.
        const items = [scene({ path: 'Book/1 The Ball.md', title: '1 The Ball' }), original];
        const holders = sceneIdHolders(items, firstSend);
        const sent = build(items, { sceneIdHolders: holders }).items;
        expect(sent.map(item => item.title)).toEqual(['1 The Ball', '3 The Duel']);
        expect(sent[0]).not.toHaveProperty('sceneId');
        expect(sent[1].sceneId).toBe('scn_a1b2c3d4');
        expect(holders).toEqual(firstSend);
    });

    it('gives the id to the first scene in order when the note that sent it is gone', () => {
        const items = [scene({ path: 'Book/1 The Ball.md' }), scene({ path: 'Book/1 The Ball 1.md' })];
        expect(sceneIdHolders(items, { scn_a1b2c3d4: 'Book/Renamed.md' })).toEqual({ scn_a1b2c3d4: 'Book/1 The Ball.md' });
    });

    it('sends each scene its own id once the copy has a new one', () => {
        const items = [scene({ path: 'Book/1 The Ball.md' }), scene({ path: 'Book/1 The Ball 1.md', sceneId: 'scn_0f0f0f0f' })];
        const sent = build(items, { sceneIdHolders: sceneIdHolders(items, { scn_a1b2c3d4: 'Book/1 The Ball.md' }) }).items;
        expect(sent.map(item => item.sceneId)).toEqual(['scn_a1b2c3d4', 'scn_0f0f0f0f']);
    });

    it('sends the synopsis, title and act with links reduced to their shown text', () => {
        const [item] = build([scene({
            title: '[[Private Folder/Book/1 The Ball|1 The Ball]]',
            act: '[[Private Folder/Acts/Act One]]',
            synopsis: 'She meets [[Private Folder/People/Mira|Mira]] and [[Private Folder/People/Tomas]], reads ![[Private Folder/Letters/Note.md]], sees [the map](Private%20Folder/Places/Map.md) and [the archive](https://example.org/archive).',
        })]).items;
        expect(item.title).toBe('1 The Ball');
        expect(item.act).toBe('Act One');
        expect(item.synopsis).toBe('She meets Mira and Tomas, reads Note, sees the map and [the archive](https://example.org/archive).');
        expect(JSON.stringify(item)).not.toContain('Private');
    });

    it('sends markdown links in cast and subplots by their shown text', () => {
        const { items } = build([scene({
            rawFrontmatter: { Character: ['[Mira](Private Folder/People/Mira.md)'], Subplot: ['[Romance](<Private Folder/Arcs/Romance.md>)'] },
        })]);
        expect(items[0].Character).toEqual(['Mira']);
        expect(items[0].subplot).toEqual(['Romance']);
    });

    it('keeps the id of a scene repeated once per subplot', () => {
        const { items } = build([scene({ subplot: 'Main Plot' }), scene({ subplot: 'Romance' })]);
        expect(items[0].sceneId).toBe('scn_a1b2c3d4');
    });

    it('sends one row per scene, with every subplot', () => {
        const { items } = build([scene({ subplot: 'Main Plot' }), scene({ subplot: 'Romance' })]);
        expect(items).toHaveLength(1);
        expect(items[0].subplot).toEqual(['Main Plot', 'Romance']);
    });

    it('keeps the author\'s subplot order from the frontmatter', () => {
        const { items } = build([scene({ subplot: 'Romance', rawFrontmatter: { Subplot: ['Main Plot', 'Romance'] } })]);
        expect(items[0].subplot).toEqual(['Main Plot', 'Romance']);
    });

    it('leaves out beats and matter', () => {
        const { items, context } = build([
            scene(),
            scene({ itemType: 'Beat', path: 'b.md' }),
            scene({ itemType: 'Frontmatter', path: 'f.md' }),
            scene({ itemType: 'BookMeta', path: 'm.md' }),
        ]);
        expect(items).toHaveLength(1);
        expect(context.itemCount).toBe(1);
    });

    it('uses the public label over the private title', () => {
        const payload = build([scene()], { book: { title: 'Private Working Title', publicLabel: 'Public Name' } });
        expect(payload.bookMeta.title).toBe('Public Name');
        expect(JSON.stringify(payload)).not.toContain('Private Working Title');
    });

    it('sends only the title, subtitle and author of the book metadata', () => {
        const payload = build([scene()], {
            bookMeta: { title: 'Book', author: 'A. Writer', rights: { copyright_holder: 'Holder' } } as never,
        });
        expect(payload.bookMeta).toEqual({ title: 'Book', author: 'A. Writer' });
    });
});

describe('timelinePayloadFingerprint', () => {
    it('ignores the moment and id of the export', () => {
        const a = build([scene()], { exportId: 'one', now: new Date('2026-11-06T00:00:00.000Z') });
        const b = build([scene()], { exportId: 'two', now: new Date('2026-11-07T00:00:00.000Z') });
        expect(timelinePayloadFingerprint(a)).toBe(timelinePayloadFingerprint(b));
    });

    it('changes when a scene changes', () => {
        expect(timelinePayloadFingerprint(build([scene()])))
            .not.toBe(timelinePayloadFingerprint(build([scene({ synopsis: 'They argue.' })])));
    });
});
