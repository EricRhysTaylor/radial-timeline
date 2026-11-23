import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../tests/mocks/obsidian', async (original) => ({
    ...await original<typeof import('../../tests/mocks/obsidian')>(),
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import { TFile } from 'obsidian';
import type { TimelineItem } from '../types';
import type { SceneReleaseSummary } from './communityShareClient';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import { parsePastedScene, sceneTextHash } from './sceneReleaseText';
import { buildSceneReleaseRows, loadSceneReleaseList, readSceneReleaseDraft } from './sceneReleaseVault';
import { timelineSceneNotes, type TimelineSceneNote } from './timelineSharePayload';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

const release = (id: string, sceneId: string | null, extra: Partial<SceneReleaseSummary> = {}): SceneReleaseSummary => ({
    id,
    scene_id: sceneId,
    scene_title: `Website title ${id}`,
    version: 1,
    rating: 'general',
    words: 3,
    text_hash: 'a'.repeat(64),
    hidden: false,
    hold: null,
    released_at: '2026-11-15T10:00:00Z',
    updated_at: '2026-11-15T10:00:00Z',
    readers: 0,
    ...extra
});

const note = (title: string, sceneId?: string, idProblem?: 'missing' | 'duplicate'): TimelineSceneNote => ({
    path: `Book/${title}.md`,
    title,
    ...(sceneId ? { sceneId } : {}),
    ...(idProblem ? { idProblem } : {})
});

describe('buildSceneReleaseRows', () => {
    const scenes = [
        note('1 Opening', 'scn_00000001'),
        note('2 Storm', 'scn_00000002'),
        note('3 Letter', 'scn_00000003'),
        note('4 Trial', 'scn_00000004'),
        note('5 No id', undefined, 'missing'),
    ];
    const releases = [
        release('r2', 'scn_00000002', { text_hash: 'b'.repeat(64) }),
        release('r3', 'scn_00000003', { text_hash: 'c'.repeat(64) }),
        release('r4', 'scn_00000004', { hidden: true, hold: 'privacy' }),
        release('r-detached', null),
        release('r-gone', 'scn_0000dead'),
    ];
    const hashes = new Map([
        ['scn_00000002', 'b'.repeat(64)],
        ['scn_00000003', 'd'.repeat(64)],
        ['scn_00000004', 'e'.repeat(64)],
    ]);
    const rows = buildSceneReleaseRows(scenes, releases, hashes);

    it('gives each scene one state, in manuscript order, then the releases with no scene here', () => {
        expect(rows.map(row => [row.title, row.state])).toEqual([
            ['1 Opening', 'not_released'],
            ['2 Storm', 'released'],
            ['3 Letter', 'changed'],
            ['4 Trial', 'hidden'],
            ['5 No id', 'unavailable'],
            ['Website title r-detached', 'website'],
            ['Website title r-gone', 'website'],
        ]);
    });

    it('calls a scene changed only when the vault\'s own hash differs from the website\'s', () => {
        expect(rows[1].release?.id).toBe('r2');
        expect(rows[2].release?.id).toBe('r3');
        // No local hash at all reads as changed, never as up to date.
        expect(buildSceneReleaseRows(scenes, releases, new Map())[1].state).toBe('changed');
    });

    it('never matches a release to a scene without an id', () => {
        expect(rows[4].release).toBeUndefined();
        expect(rows[5].scene).toBeUndefined();
    });
});

describe('timelineSceneNotes (which note a release may name)', () => {
    const item = (title: string, sceneId: string | undefined, subplot = 'Main Plot'): TimelineItem => ({
        itemType: 'Scene', title, date: '', path: `Book/${title}.md`, subplot, ...(sceneId ? { sceneId } : {})
    });

    it('lists each scene note once, in order, with its generated id', () => {
        const notes = timelineSceneNotes([
            item('1 One', 'scn_00000001'),
            item('1 One', 'scn_00000001', 'Romance'),
            item('2 Two', 'scn_00000002'),
        ]);
        expect(notes).toEqual([
            { path: 'Book/1 One.md', title: '1 One', sceneId: 'scn_00000001' },
            { path: 'Book/2 Two.md', title: '2 Two', sceneId: 'scn_00000002' },
        ]);
    });

    it('offers no id the author typed, and none for a scene without one', () => {
        const notes = timelineSceneNotes([item('1 One', 'The Storm'), item('2 Two', undefined)]);
        expect(notes.map(entry => [entry.sceneId, entry.idProblem])).toEqual([[undefined, 'missing'], [undefined, 'missing']]);
    });

    it('keeps a duplicated id on the note the timeline sent it from', () => {
        const items = [item('0 Copy', 'scn_00000001'), item('1 One', 'scn_00000001')];
        const notes = timelineSceneNotes(items, { scn_00000001: 'Book/1 One.md' });
        expect(notes.map(entry => [entry.title, entry.sceneId, entry.idProblem])).toEqual([
            ['0 Copy', undefined, 'duplicate'],
            ['1 One', 'scn_00000001', undefined],
        ]);
    });

    it('lists the notes in manuscript order whatever order the vault hands them over', () => {
        // The vault's file order, here the reverse of the book (seen in the 18 November test vault).
        const notes = timelineSceneNotes([
            item('06 Light on the Water', 'scn_00000006'),
            item('10 Coda', 'scn_00000010'),
            item('02 A Borrowed Key', 'scn_00000002'),
            item('01 The Empty Hook', 'scn_00000001'),
        ]);
        expect(notes.map(entry => [entry.title, entry.sceneId])).toEqual([
            ['01 The Empty Hook', 'scn_00000001'],
            ['02 A Borrowed Key', 'scn_00000002'],
            ['06 Light on the Water', 'scn_00000006'],
            ['10 Coda', 'scn_00000010'],
        ]);
    });

    it('settles a duplicated id in the timeline\'s own order, then sorts the list', () => {
        // No last carrier is known and the ids clash, so neither note may send it; the list still sorts.
        const notes = timelineSceneNotes([item('2 Copy', 'scn_00000001'), item('1 One', 'scn_00000001')]);
        expect(notes.map(entry => [entry.title, entry.idProblem])).toEqual([['1 One', 'duplicate'], ['2 Copy', 'duplicate']]);
    });

    it('does not guess the owner of a duplicated id', () => {
        const notes = timelineSceneNotes([item('0 Copy', 'scn_00000001'), item('1 One', 'scn_00000001')]);
        expect(notes.map(entry => [entry.sceneId, entry.idProblem])).toEqual([[undefined, 'duplicate'], [undefined, 'duplicate']]);
    });
});

function harness(notes: Record<string, string>) {
    const read = vi.fn(async (file: TFile) => notes[file.path]);
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 4;
    settings.audience = 'public';
    settings.sceneTextLevel = true;
    settings.connection = {
        status: 'connected', connectionId: 'conn-1', profileId: 'profile-1', projectId: PROJECT_ID,
        secretId: 'rt.community-share.connection-secret'
    };
    const items: TimelineItem[] = Object.keys(notes).map((path, index) => ({
        itemType: 'Scene', title: path.split('/').pop()!.replace(/\.md$/, ''), date: '', path, subplot: 'Main Plot',
        sceneId: `scn_0000000${index + 1}`
    }));
    const plugin = {
        manifest: { version: '8.0.4' },
        app: {
            secretStorage: { getSecret: () => 'rtcs_current-secret' },
            vault: {
                getAbstractFileByPath: (path: string) => (path in notes ? new TFile(path) : null),
                read
            }
        },
        settings: { communityShare: settings },
        getSceneDataService: () => ({ getSceneDataWithBookMeta: async () => ({ items, bookMeta: null }) }),
        saveSettings: vi.fn(async () => undefined)
    };
    return { plugin, read };
}

describe('loadSceneReleaseList', () => {
    beforeEach(() => vi.clearAllMocks());

    const NOTES = {
        'Book/1 Opening.md': '---\nClass: Scene\n---\nUNRELEASED_TEXT_ONE',
        'Book/2 Storm.md': '---\nClass: Scene\n---\nThe storm came.',
        'Book/3 Letter.md': '---\nClass: Scene\n---\nUNRELEASED_TEXT_THREE',
    };

    it('reads only the notes of released scenes, and sends no text to find what changed', async () => {
        const h = harness(NOTES);
        const stormHash = await sceneTextHash(parsePastedScene('The storm came.'));
        const request = vi.spyOn(obsidian, 'requestUrl').mockImplementation((async () => ({
            status: 200,
            text: JSON.stringify({
                project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 3,
                releases: [release('r2', 'scn_00000002', { text_hash: stormHash })]
            })
        })) as never);

        const list = await loadSceneReleaseList(h.plugin as never, { id: 'book-1', sourceFolder: 'Book' });

        expect(list.rows.map(row => row.state)).toEqual(['not_released', 'released', 'not_released']);
        expect(h.read.mock.calls.map(([file]) => file.path)).toEqual(['Book/2 Storm.md']);
        expect(request).toHaveBeenCalledTimes(1);
        const body = (request.mock.calls[0][0] as unknown as { body: string }).body;
        expect(Object.keys(JSON.parse(body) as object).sort()).toEqual(['action', 'connection_id', 'current_secret', 'plugin_book_key']);
        expect(body).not.toContain('storm');
        // Neither text nor hash is kept.
        expect(JSON.stringify(h.plugin.settings)).not.toContain(stormHash);
    });

    it('marks a released scene changed after its note is edited', async () => {
        const h = harness({ ...NOTES, 'Book/2 Storm.md': '---\nClass: Scene\n---\nThe storm came. Then it left.' });
        const releasedHash = await sceneTextHash(parsePastedScene('The storm came.'));
        vi.spyOn(obsidian, 'requestUrl').mockImplementation((async () => ({
            status: 200,
            text: JSON.stringify({
                project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 3,
                releases: [release('r2', 'scn_00000002', { text_hash: releasedHash })]
            })
        })) as never);
        const list = await loadSceneReleaseList(h.plugin as never, { id: 'book-1', sourceFolder: 'Book' });
        expect(list.rows[1].state).toBe('changed');
    });
});

describe('readSceneReleaseDraft', () => {
    it('cleans the note and reports its words, hash and fit', async () => {
        const h = harness({ 'Book/1 Opening.md': '---\nClass: Scene\nSynopsis: PRIVATE\n---\nShe *ran*. %% PRIVATE %%' });
        const draft = await readSceneReleaseDraft(h.plugin.app as never, 'Book/1 Opening.md');
        expect(draft.blocks).toEqual([{ kind: 'p', runs: ['She ', { em: 'ran' }, '.'] }]);
        expect(draft.words).toBe(2);
        expect(draft.problem).toBeNull();
        expect(draft.hash).toBe(await sceneTextHash(draft.blocks));
    });

    it('says so when the scene has no text left', async () => {
        const h = harness({ 'Book/1 Opening.md': '---\nClass: Scene\n---\n%% notes only %%' });
        expect((await readSceneReleaseDraft(h.plugin.app as never, 'Book/1 Opening.md')).problem).toBe('empty');
    });

    it('fails clearly when the note is gone', async () => {
        const h = harness({});
        await expect(readSceneReleaseDraft(h.plugin.app as never, 'Book/Missing.md'))
            .rejects.toMatchObject({ code: 'scene_note_missing' });
    });
});
