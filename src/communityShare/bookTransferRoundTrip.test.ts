/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * A book from Community, round trip (spec section 10, contract "Round trip"):
 * the stored timeline → the planned notes → read the way the timeline reads a
 * note on disk (SceneDataService) → the payload the plugin's first send carries
 * (buildTimelineSharePayload) → the engine's conversion → equal to the scene
 * Community stored. One test per row, then the released text, the file names
 * and the folder.
 */

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { SceneDataService } from '../services/SceneDataService';
import type { BookProfile, RadialTimelineSettings } from '../types/settings';
import { buildTimelineSharePayload, type TimelineSharePayload } from './timelineSharePayload';
import {
    checkTransferFolder,
    nameProblem,
    planBookTransfer,
    sceneBlocksToMarkdown,
    suggestTransferFolder,
    transferActCounts,
    transferNoteName,
    transferSubplotCount,
    transferNotePath,
} from './bookTransferPlan';
import type { TransferDocument, TransferReleasedText, TransferScene } from './bookTransferDocument';
import { sceneBlocksFromNote, sceneTextHash, sceneTextJson, type SceneBlock, type SceneRun } from './sceneReleaseText';

// ── The engine's conversion, for scenes ─────────────────────────────────────
//
// A faithful copy of the scene part of the engine's `fromPluginExport`
// (packages/timeline-schema/src/from-plugin-export.ts and manuscript-order.ts;
// the platform's `_shared/timeline-schema.bundle.mjs`), which the server runs
// on every timeline send. A repository never imports another's code and the
// engine is not vendored here, so the part the round trip depends on is copied.
// Change it with the engine.

const STATUS_MAP: Record<string, TransferScene['status']> = {
    todo: 'todo', 'to do': 'todo', tbd: 'todo',
    working: 'working', 'in progress': 'working', progress: 'working',
    complete: 'complete', completed: 'complete', done: 'complete',
    due: 'due',
};
const STAGE_MAP: Record<string, TransferScene['publishStage']> = { zero: 'zero', author: 'author', house: 'house', press: 'press' };
const PREFIX_TOKEN = /^\s*(\d+(?:\.\d+)?)\s+/;

const unwrapWikilinks = (text: string): string =>
    text.replace(/\[\[([^\][|]*)(?:\|([^\][]*))?\]\]/g, (_match, target: string, alias?: string) => alias?.trim() || target.trim());

function firstToken(value: unknown): string | undefined {
    if (typeof value === 'string') return value.trim() || undefined;
    if (Array.isArray(value)) for (const entry of value) if (typeof entry === 'string' && entry.trim()) return entry.trim();
    return undefined;
}

function listOf(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return values.filter((value): value is string => typeof value === 'string');
}

function manuscriptPrefix(name: string | undefined): number | undefined {
    const match = name ? PREFIX_TOKEN.exec(name) : null;
    if (!match) return undefined;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : undefined;
}

function compareNatural(a: string, b: string): number {
    const left = a.toLowerCase().match(/\d+|\D+/g) ?? [];
    const right = b.toLowerCase().match(/\d+|\D+/g) ?? [];
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        const l = left[index];
        const r = right[index];
        if (/^\d/.test(l) && /^\d/.test(r)) {
            const difference = Number.parseInt(l, 10) - Number.parseInt(r, 10);
            if (difference !== 0) return difference;
            continue;
        }
        if (l !== r) return l < r ? -1 : 1;
    }
    return left.length - right.length;
}

function compareManuscriptOrder(a: { name: string; index: number }, b: { name: string; index: number }): number {
    const prefixA = manuscriptPrefix(a.name);
    const prefixB = manuscriptPrefix(b.name);
    if (prefixA !== undefined && prefixB !== undefined) {
        if (prefixA !== prefixB) return prefixA - prefixB;
    } else if (prefixA !== undefined) {
        return -1;
    } else if (prefixB !== undefined) {
        return 1;
    }
    return compareNatural(a.name, b.name) || a.index - b.index;
}

type EngineItem = TimelineSharePayload['items'][number] & { path?: string; Summary?: string; rawFrontmatter?: { Subplot?: unknown; Character?: unknown } };

function engineConvert(payload: TimelineSharePayload): TransferDocument {
    const scenes: TransferScene[] = [];
    const orderKeys: Array<{ name: string; index: number }> = [];
    const sceneNumbers: Array<number | undefined> = [];
    const byStableKey = new Map<string, number>();
    (payload.items as EngineItem[]).forEach((item, index) => {
        const statusToken = firstToken(item.status);
        const status = statusToken === undefined ? 'todo' : STATUS_MAP[statusToken.toLowerCase()];
        const stageToken = firstToken(item['Publish Stage']);
        const publishStage = stageToken ? STAGE_MAP[stageToken.toLowerCase()] : 'zero';
        if (!status || !publishStage) throw new Error(`unmappable status or stage on item ${index}`);
        const actDigits = firstToken(item.act)?.match(/\d+/);
        const act = typeof item.actNumber === 'number' && Number.isInteger(item.actNumber) && item.actNumber >= 1
            ? item.actNumber
            : actDigits && Number.parseInt(actDigits[0], 10) >= 1 ? Number.parseInt(actDigits[0], 10) : 1;
        const subplotValues = listOf(item.rawFrontmatter?.Subplot ?? item.subplot).map(value => unwrapWikilinks(value).trim()).filter(Boolean);
        const subplots = subplotValues.length > 0 ? [...new Set(subplotValues)] : ['Main Plot'];
        const stableKey = item.sceneId ?? item.path;
        const existing = stableKey === undefined ? undefined : byStableKey.get(stableKey);
        if (existing !== undefined) {
            scenes[existing].subplots = [...new Set([...scenes[existing].subplots, ...subplots])];
            return;
        }
        const characters = [...new Set(listOf(item.rawFrontmatter?.Character ?? item.Character).map(value => unwrapWikilinks(value).trim()).filter(Boolean))];
        const pov = firstToken(item.pov);
        const povMode = pov ? unwrapWikilinks(pov).trim() : '';
        const when = item.when ?? item.date;
        const synopsis = item.synopsis ?? item.Summary;
        scenes.push({
            id: item.sceneId ?? item.path ?? `scene-${scenes.length + 1}`,
            order: scenes.length + 1,
            title: unwrapWikilinks(item.title ?? ''),
            act,
            subplots,
            status,
            publishStage,
            characters,
            ...(povMode ? { povMode } : {}),
            ...(when ? { when } : {}),
            ...(synopsis ? { synopsis: unwrapWikilinks(synopsis) } : {}),
        });
        const name = item.title?.trim() || (item.path?.split('/').at(-1) ?? '').replace(/\.md$/i, ''); // SAFE: the engine's orderingName
        orderKeys.push({ name, index });
        const stated = typeof item.number === 'number' && Number.isInteger(item.number) && item.number >= 1 ? item.number : manuscriptPrefix(name);
        sceneNumbers.push(stated !== undefined && Number.isInteger(stated) && stated >= 1 ? stated : undefined);
        if (stableKey !== undefined) byStableKey.set(stableKey, scenes.length - 1);
    });
    const positions = scenes.map((_, index) => index).sort((a, b) => compareManuscriptOrder(orderKeys[a], orderKeys[b]));
    const stated = positions.map(index => sceneNumbers[index]);
    const useStated = stated.every(value => value !== undefined) && new Set(stated).size === stated.length;
    positions.forEach((sceneIndex, position) => {
        scenes[sceneIndex].order = useStated ? sceneNumbers[sceneIndex] as number : position + 1; // SAFE: useStated means every stated number is defined
    });
    const actCount = payload.renderConfig.actCount;
    return {
        book: { title: payload.bookMeta.title, actCount: typeof actCount === 'number' && Number.isInteger(actCount) && actCount >= 1 ? actCount : 3 },
        scenes: positions.map(index => scenes[index]),
    };
}

// ── The vault side ──────────────────────────────────────────────────────────

const FOLDER = 'Books/The Lighthouse';

function frontmatterOf(content: string): Record<string, unknown> {
    const match = /^---\n([\s\S]*?)\n---/.exec(content);
    if (!match) throw new Error('planned note has no frontmatter');
    return (parse(match[1]) ?? {}) as Record<string, unknown>; // SAFE: an empty block parses to null
}

/** Plan the notes, read them as the timeline reads notes on disk, build the first send, and convert it as the server does. */
async function roundTrip(
    document: TransferDocument,
    settings: RadialTimelineSettings = DEFAULT_SETTINGS,
    releasedText: TransferReleasedText[] = []
): Promise<{ document: TransferDocument; payload: TimelineSharePayload; plan: Awaited<ReturnType<typeof planBookTransfer>> }> {
    const plan = await planBookTransfer({ document, releasedText, settings });
    const files = plan.notes.map(note => ({ file: new TFile(transferNotePath(FOLDER, note.fileName)), frontmatter: frontmatterOf(note.content) }));
    const app = {
        vault: { getMarkdownFiles: () => files.map(entry => entry.file) },
        metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: files.find(entry => entry.file === file)?.frontmatter }) },
    } as unknown as App; // SAFE: SceneDataService reads only these two calls of the app
    const { items, bookMeta } = await new SceneDataService(app, settings).getSceneDataWithBookMeta({ sourcePath: FOLDER, filterBeatsBySystem: false });
    // The book as the writer registers it: the stored title, the new folder.
    const book: Pick<BookProfile, 'title' | 'publicLabel'> = { title: plan.title };
    const payload = buildTimelineSharePayload({
        items,
        bookMeta,
        book,
        actCount: settings.actCount,
        pluginVersion: '0.0.0-test',
        exportId: 'export-test',
        now: new Date('2026-11-21T12:00:00Z'),
    });
    return { document: engineConvert(payload), payload, plan };
}

function scene(fields: Partial<TransferScene> & Pick<TransferScene, 'id' | 'order'>): TransferScene {
    return {
        title: `${String(fields.order).padStart(2, '0')} Scene`,
        act: 1,
        subplots: ['Main Plot'],
        status: 'todo',
        publishStage: 'zero',
        characters: [],
        ...fields,
    };
}

function book(scenes: TransferScene[], actCount = 3): TransferDocument {
    return { book: { title: 'The Lighthouse', actCount }, scenes };
}

async function expectRoundTrip(document: TransferDocument, settings?: RadialTimelineSettings): Promise<void> {
    const back = await roundTrip(document, settings);
    expect(back.document).toEqual(document);
}

describe('a book from Community round-trips through the vault, row by row (spec section 10)', () => {
    it('title: a title that opens with its own scene number', async () => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 The Docks' }), scene({ id: 'scn_0a1b2c3e', order: 2, title: '2 Night Watch' })]));
    });

    // OPEN, reported to Eric (Stage B report). A scene's title in the vault is
    // its note's file name, and the timeline reads a scene's position from the
    // number that opens that name, so the contract's file-name rule gives a
    // numberless website title its number: "The Docks" comes back as
    // "01 The Docks". Characters a file name cannot hold come back as spaces,
    // and a title past 120 characters comes back cut. These assert the
    // contract's row as written; they fail today, and will pass once the row
    // has a decided handling.
    it.fails('title: a title made on the website, with no number of its own', async () => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: 'The Docks' })]));
    });

    it.fails('title: characters a file name cannot hold', async () => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 What? A "lighthouse": #3' })]));
    });

    it('position: scene numbers, including a gap and three digits', async () => {
        await expectRoundTrip(book([
            scene({ id: 'scn_0a1b2c3d', order: 1, title: '001 Arrival' }),
            scene({ id: 'scn_0a1b2c3e', order: 2, title: '002 Storm' }),
            scene({ id: 'scn_0a1b2c3f', order: 100, title: '100 Landfall' }),
        ]));
    });

    it('act and act count', async () => {
        await expectRoundTrip(book([
            scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', act: 1 }),
            scene({ id: 'scn_0a1b2c3e', order: 2, title: '02 Two', act: 2 }),
            scene({ id: 'scn_0a1b2c3f', order: 3, title: '03 Three', act: 3 }),
        ], 3));
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', act: 5 })], 5), { ...DEFAULT_SETTINGS, actCount: 5 });
    });

    it('several subplots, and a single one', async () => {
        await expectRoundTrip(book([
            scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', subplots: ['Main Plot', 'The Keeper', 'Letters'] }),
            scene({ id: 'scn_0a1b2c3e', order: 2, title: '02 Two', subplots: ['The Keeper'] }),
        ]));
    });

    it.each(['todo', 'working', 'complete', 'due'] as const)('status %s', async status => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', status })]));
    });

    it.each(['zero', 'author', 'house', 'press'] as const)('publish stage %s', async publishStage => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', publishStage })]));
    });

    it('synopsis, including quotes, a colon and a line break', async () => {
        await expectRoundTrip(book([
            scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', synopsis: 'Mira finds the "keeper\'s" log: it ends mid-sentence.' }),
            scene({ id: 'scn_0a1b2c3e', order: 2, title: '02 Two', synopsis: 'First line.\nSecond line.' }),
        ]));
    });

    it('cast, with the first name as the point-of-view character', async () => {
        const document = book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', characters: ['Mira', 'Tomas Reyes', 'The Keeper'] })]);
        const back = await roundTrip(document);
        expect(back.document).toEqual(document);
        expect(back.document.scenes[0].characters[0]).toBe('Mira');
    });

    it.each(['first', 'third', 'omni', 'second'])('point-of-view mode %s', async povMode => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', characters: ['Mira'], povMode })]));
    });

    it.each(['2085-04-01', '2085-04-01T19:00:00', '1888-12-31T23:59:30', '-000043-03-15'])('story date %s', async when => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', when })]));
    });

    it('a point-of-view mode or story date the timeline does not read is kept in the note as Community holds it, and counted for the author', async () => {
        const document = book([
            scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', povMode: 'through Mira\'s eyes' }),
            scene({ id: 'scn_0a1b2c3e', order: 2, title: '02 Two', when: 'the third winter' }),
            scene({ id: 'scn_0a1b2c3f', order: 3, title: '03 Three', povMode: 'third', when: '2085-04-01' }),
        ]);
        const { plan, document: back } = await roundTrip(document);
        expect(plan.detailsKeptCount).toBe(2);
        expect(frontmatterOf(plan.notes[0].content).Narration).toBe('through Mira\'s eyes');
        expect(frontmatterOf(plan.notes[1].content).When).toBe('the third winter');
        expect(back.scenes[0]).not.toHaveProperty('povMode');
        expect(back.scenes[1]).not.toHaveProperty('when');
        expect(back.scenes[2]).toEqual(document.scenes[2]);
    });

    it('scene id, of eight and of ten digits', async () => {
        await expectRoundTrip(book([scene({ id: 'scn_0a1b2c3d4e', order: 1, title: '01 One' }), scene({ id: 'scn_99887766', order: 2, title: '02 Two' })]));
    });

    it('every row at once, under the author\'s own property names', async () => {
        const settings: RadialTimelineSettings = {
            ...DEFAULT_SETTINGS,
            enableCustomMetadataMapping: true,
            frontmatterMappings: { Storyline: 'Subplot', Cast: 'Character', 'Scene Blurb': 'Synopsis', Draft: 'Status' },
        };
        const document = book([
            scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 The Docks', act: 1, subplots: ['Main Plot', 'Letters'], status: 'complete', publishStage: 'house', characters: ['Mira', 'Tomas'], povMode: 'first', when: '2085-04-01T19:00:00', synopsis: 'Mira arrives.' }),
            scene({ id: 'scn_0a1b2c3e', order: 2, title: '02 Night Watch', act: 2, subplots: ['Letters'], status: 'working', publishStage: 'author', characters: ['Tomas'], synopsis: 'Tomas keeps the light.' }),
            scene({ id: 'scn_0a1b2c3f', order: 3, title: '03 Landfall', act: 3, status: 'due', publishStage: 'press', characters: [], when: '2085-04-03' }),
        ]);
        const back = await roundTrip(document, settings);
        expect(back.document).toEqual(document);
        const first = frontmatterOf(back.plan.notes[0].content);
        expect(first).toMatchObject({ Storyline: ['Main Plot', 'Letters'], Cast: ['Mira', 'Tomas'], 'Scene Blurb': 'Mira arrives.', Draft: 'Complete' });
        expect(first).not.toHaveProperty('Subplot');
        expect(first).not.toHaveProperty('Character');
    });

    it('the first send carries exactly the timeline that was written, and nothing else', async () => {
        const document = book([
            scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 The Docks', characters: ['Mira'], povMode: 'first', when: '2085-04-01', synopsis: 'Mira arrives.' }),
            scene({ id: 'scn_0a1b2c3e', order: 2, title: '02 Night Watch', subplots: ['Main Plot', 'Letters'] }),
        ]);
        const { payload } = await roundTrip(document);
        const allowed = new Set(['itemType', 'title', 'sceneId', 'when', 'date', 'subplot', 'act', 'actNumber', 'number', 'pov', 'Character', 'synopsis', 'status', 'Publish Stage']);
        for (const item of payload.items) for (const key of Object.keys(item)) expect(allowed.has(key)).toBe(true);
        expect(payload.items.map(item => item.sceneId)).toEqual(['scn_0a1b2c3d', 'scn_0a1b2c3e']);
        expect(payload.bookMeta).toEqual({ title: 'The Lighthouse' });
        expect(JSON.stringify(payload)).not.toContain(FOLDER);
    });
});

describe('released text becomes the note body, and reads back as the stored blocks with the stored hash', () => {
    const p = (...runs: SceneRun[]): SceneBlock => ({ kind: 'p', runs });
    const BREAK: SceneBlock = { kind: 'break' };

    const exact: Array<[string, SceneBlock[]]> = [
        ['plain paragraphs', [p('Mira opened the door.'), p('It was late.')]],
        ['an italic run inside a paragraph', [p('She said ', { em: 'no' }, ', twice.')]],
        ['a paragraph that is all italic', [p({ em: 'All of it.' })]],
        ['a scene break', [p('One.'), BREAK, p('Two.')]],
        ['a paragraph that reads like a heading', [p('# Not a heading')]],
        ['a paragraph that reads like a rule or a break', [p('---'), p('*'), p('#'), p('~~~'), p('⁂')]],
        ['an italic run holding an asterisk', [p('a ', { em: 'b*c' }, ' d')]],
        ['quotes, lists, tags and other Markdown marks', [p('> A quote'), p('- a dash'), p('1. Numbered'), p('<b>tag</b> & ampersand'), p('Price: $5, `code`, ==mark==, ~~strike~~')]],
        ['snake_case and a lone asterisk', [p('snake_case and 5 * 3 = 15')]],
        ['letters beyond ASCII', [p('Café, naïve, 東京, 😀')]],
    ];

    it.each(exact)('%s', async (_case, blocks) => {
        const textHash = await sceneTextHash(blocks);
        const document = book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One' })]);
        const plan = await planBookTransfer({ document, releasedText: [{ sceneId: 'scn_0a1b2c3d', blocks, textHash }], settings: DEFAULT_SETTINGS });
        const [note] = plan.notes;
        expect(note.text).toBe('exact');
        expect(sceneTextJson(sceneBlocksFromNote(note.content))).toBe(sceneTextJson(blocks));
        expect(await sceneTextHash(sceneBlocksFromNote(note.content))).toBe(textHash);
        expect(plan.textDiffersCount).toBe(0);
    });

    it('writes italics as *so* and a scene break as a rule', () => {
        expect(sceneBlocksToMarkdown([p('She said ', { em: 'no' }, '.'), BREAK, p('Next.')])).toBe('She said *no*.\n\n***\n\nNext.');
    });

    const differs: Array<[string, SceneBlock[]]> = [
        ['a vault link', [p('[[Link]] here')]],
        ['a comment mark', [p('%%hidden%% text')]],
        ['a web link in Markdown form', [p('[shown](https://example.com)')]],
    ];

    it.each(differs)('reports %s, which a note reads differently, as changed since release', async (_case, blocks) => {
        const textHash = await sceneTextHash(blocks);
        const document = book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One' })]);
        const plan = await planBookTransfer({ document, releasedText: [{ sceneId: 'scn_0a1b2c3d', blocks, textHash }], settings: DEFAULT_SETTINGS });
        expect(plan.notes[0].text).toBe('differs');
        expect(plan.textDiffersCount).toBe(1);
        expect(plan.releasedTextCount).toBe(1);
    });

    it('a note with no released text has an empty body, and released text goes only to its own scene', async () => {
        const blocks = [p('Only the second scene.')];
        const document = book([scene({ id: 'scn_0a1b2c3d', order: 1 }), scene({ id: 'scn_0a1b2c3e', order: 2 })]);
        const plan = await planBookTransfer({ document, releasedText: [{ sceneId: 'scn_0a1b2c3e', blocks, textHash: await sceneTextHash(blocks) }], settings: DEFAULT_SETTINGS });
        expect(plan.notes[0].content.endsWith('---\n\n')).toBe(true);
        expect(sceneBlocksFromNote(plan.notes[0].content)).toEqual([]);
        expect(sceneBlocksFromNote(plan.notes[1].content)).toEqual(blocks);
    });

    it('the timeline is the same with and without released text', async () => {
        const blocks = [p('It was ', { em: 'cold' }, '.')];
        const document = book([scene({ id: 'scn_0a1b2c3d', order: 1, title: '01 One', synopsis: 'Cold.' })]);
        const withText = await roundTrip(document, DEFAULT_SETTINGS, [{ sceneId: 'scn_0a1b2c3d', blocks, textHash: await sceneTextHash(blocks) }]);
        expect(withText.document).toEqual(document);
    });
});

describe('file names', () => {
    it('numbers each note, zero-padded to the widest number', () => {
        expect(transferNoteName({ order: 3, title: 'The Docks' }, 2)).toBe('03 The Docks');
        expect(transferNoteName({ order: 7, title: 'Storm' }, 3)).toBe('007 Storm');
    });

    it('keeps a title that already opens with its own number', () => {
        expect(transferNoteName({ order: 12, title: '12 Night Watch' }, 2)).toBe('12 Night Watch');
        expect(transferNoteName({ order: 1, title: '01 The Docks' }, 3)).toBe('01 The Docks');
    });

    it('numbers a title that opens with a different number', () => {
        expect(transferNoteName({ order: 2, title: '1984 Revisited' }, 2)).toBe('02 1984 Revisited');
    });

    it('drops the characters a file name cannot hold, and names an empty title Scene', () => {
        expect(transferNoteName({ order: 4, title: 'What? A "lighthouse": #3 / [draft]' }, 2)).toBe('04 What A lighthouse 3 draft');
        expect(transferNoteName({ order: 5, title: '???' }, 2)).toBe('05 Scene');
        expect(transferNoteName({ order: 6, title: '.hidden' }, 2)).toBe('06 hidden');
    });

    it('drops the periods and spaces Windows would drop from the end of a title, and never makes a device name', () => {
        expect(transferNoteName({ order: 7, title: 'Wait...' }, 2)).toBe('07 Wait');
        expect(transferNoteName({ order: 8, title: '8 The End. ' }, 2)).toBe('8 The End');
        expect(transferNoteName({ order: 9, title: '...' }, 2)).toBe('09 Scene');
        for (const title of ['CON', 'nul', 'Com1', 'LPT9.txt', 'aux.']) {
            expect(nameProblem(`${transferNoteName({ order: 1, title }, 2)}.md`)).toBeNull();
        }
    });

    it('refuses a note name Windows would not keep as written', () => {
        for (const name of ['CON.md', 'nul.md', 'Com3.md', 'lpt1.md', 'Wait..md', 'Wait .md']) {
            expect(() => transferNotePath(FOLDER, name)).toThrow(/Windows would not keep/);
        }
        expect(transferNotePath(FOLDER, 'Console.md')).toBe(`${FOLDER}/Console.md`);
    });

    it('never places a note anywhere but directly inside the new folder', () => {
        expect(transferNotePath(FOLDER, '01 One.md')).toBe(`${FOLDER}/01 One.md`);
        for (const name of ['../01 One.md', 'Sub/01 One.md', 'Sub\\01 One.md', '.01 One.md', '01 One.txt', '', '..', '.md']) {
            expect(() => transferNotePath(FOLDER, name)).toThrow(/outside the new book folder/);
        }
    });

    it('every planned note name is unique, even for repeated titles', async () => {
        const document = book([scene({ id: 'scn_0a1b2c3d', order: 1, title: 'Chapter' }), scene({ id: 'scn_0a1b2c3e', order: 2, title: 'Chapter' }), scene({ id: 'scn_0a1b2c3f', order: 10, title: '10 Chapter' })]);
        const plan = await planBookTransfer({ document, releasedText: [], settings: DEFAULT_SETTINGS });
        expect(plan.notes.map(note => note.fileName)).toEqual(['01 Chapter.md', '02 Chapter.md', '10 Chapter.md']);
    });
});

describe('the folder', () => {
    const vault = (paths: string[], folders: string[]) => ({
        exists: (path: string) => paths.includes(path) || folders.includes(path),
        isFolder: (path: string) => folders.includes(path),
    });

    it('is offered beside the active book, named for the book, with a number when taken', () => {
        expect(suggestTransferFolder('The Lighthouse', 'Books/Mira', () => false)).toBe('Books/The Lighthouse');
        expect(suggestTransferFolder('The Lighthouse', 'Books/Mira', folder => folder === 'Books/The Lighthouse')).toBe('Books/The Lighthouse 2');
        expect(suggestTransferFolder('The Lighthouse', 'Books/Mira', folder => ['Books/The Lighthouse', 'Books/The Lighthouse 2'].includes(folder))).toBe('Books/The Lighthouse 3');
    });

    it('is offered at the vault root when there is no book', () => {
        expect(suggestTransferFolder('The Lighthouse', undefined, () => false)).toBe('The Lighthouse');
        expect(suggestTransferFolder('What? #1', '', () => false)).toBe('What 1');
    });

    it('is offered under a name Windows keeps as written', () => {
        expect(suggestTransferFolder('Wait...', 'Books/Mira', () => false)).toBe('Books/Wait');
        // Every candidate taken (the parent overlaps another book): the plain name, not an endless loop.
        expect(suggestTransferFolder('The Lighthouse', 'Series/Book 1', () => true)).toBe('Series/The Lighthouse');
        expect(suggestTransferFolder('Wait...', 'Books/Mira', folder => folder === 'Books/Wait')).toBe('Books/Wait 2');
        expect(suggestTransferFolder('...', undefined, () => false)).toBe('Book');
        expect(suggestTransferFolder('CON', 'Books/Mira', () => false)).toBe('Books/CON 2');
        expect(suggestTransferFolder('nul.txt', undefined, () => false)).toBe('nul 2.txt');
        expect(suggestTransferFolder('nul.txt', undefined, folder => folder === 'nul 2.txt')).toBe('nul 3.txt');
    });

    it('refuses a name Windows would change or keeps for a device, saying which', () => {
        const v = vault([], ['Books']);
        expect(checkTransferFolder('Books/Wait...', v, []).problem).toEqual({ kind: 'trailing', name: 'Wait...' });
        expect(checkTransferFolder('Books /The Lighthouse', v, []).problem).toEqual({ kind: 'trailing', name: 'Books ' });
        for (const name of ['CON', 'prn', 'Aux', 'NUL.txt', 'com1', 'LPT9', 'con .md']) {
            expect(checkTransferFolder(`Books/${name}`, v, []).problem).toEqual({ kind: 'reserved', name });
        }
        expect(checkTransferFolder('Books/Console', v, []).problem).toBeNull();
        expect(checkTransferFolder('Books/COM10', v, []).problem).toBeNull();
    });

    it('must be new, inside a folder that exists, and clear of every book', () => {
        const books = [{ id: 'b1', title: 'Mira', sourceFolder: 'Books/Mira' }] as BookProfile[];
        const v = vault([], ['Books', 'Books/Mira', 'Books/Old']);
        expect(checkTransferFolder('Books/The Lighthouse', v, books)).toEqual({ folder: 'Books/The Lighthouse', problem: null });
        expect(checkTransferFolder('  ', v, books).problem).toEqual({ kind: 'empty' });
        expect(checkTransferFolder('Books/Old', v, books).problem).toEqual({ kind: 'exists' });
        expect(checkTransferFolder('Books/Mira/Part Two', v, books).problem).toEqual({ kind: 'overlap', book: 'Mira' });
        expect(checkTransferFolder('Missing/The Lighthouse', v, books).problem).toEqual({ kind: 'parent', parent: 'Missing' });
        expect(checkTransferFolder('Books/What?', v, books).problem).toEqual({ kind: 'invalid' });
        expect(checkTransferFolder('Books/.hidden', v, books).problem).toEqual({ kind: 'invalid' });
    });
});

describe('acts', () => {
    it('writes a book whose acts fit the vault, and holds one that needs more acts than the vault has', () => {
        const document = book([scene({ id: 'scn_0a1b2c3d', order: 1, act: 4 })], 4);
        expect(transferActCounts(document, { actCount: 3 })).toEqual({ book: 4, vault: 3, blocked: true });
        expect(transferActCounts(document, { actCount: 4 })).toEqual({ book: 4, vault: 4, blocked: false });
        expect(transferActCounts(book([scene({ id: 'scn_0a1b2c3d', order: 1, act: 1 })], 3), { actCount: 5 })).toEqual({ book: 3, vault: 5, blocked: false });
    });
});

describe('subplots', () => {
    it('counts each subplot name once across the scenes, Main Plot included', () => {
        expect(transferSubplotCount(book([
            scene({ id: 'scn_0a1b2c3d', order: 1, subplots: ['Main Plot', 'Letters'] }),
            scene({ id: 'scn_0a1b2c3e', order: 2, subplots: ['Letters', 'The Keeper'] }),
            scene({ id: 'scn_0a1b2c3f', order: 3, subplots: ['Main Plot'] }),
        ]))).toBe(3);
        expect(transferSubplotCount(book([scene({ id: 'scn_0a1b2c3d', order: 1 })]))).toBe(1);
    });
});
