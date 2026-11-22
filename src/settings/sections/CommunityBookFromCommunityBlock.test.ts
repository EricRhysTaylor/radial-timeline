/**
 * Settings → Community → Book from Community: the website's list of waiting
 * books is read fresh each time Settings opens, kept only for the rerenders of
 * one open view, and a website or network that does not answer shows nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cards: [] as string[], list: vi.fn() }));
vi.mock('../../../tests/mocks/obsidian', async (original) => ({
    ...await original<typeof import('../../../tests/mocks/obsidian')>(),
    Setting: class {
        setName() { return this; }
        setDesc(desc: string) { state.cards.push(desc); return this; }
        addButton() { return this; }
    },
}));
vi.mock('../../communityShare/communityShareClient', () => ({ listBookTransfers: state.list }));
vi.mock('../../communityShare/communityShareSettings', () => ({
    normalizeCommunityShareSettings: (value: unknown) => value,
    canShareTimelineToCommunity: () => true,
    bookTransferRecords: () => [],
}));
vi.mock('../../communityShare/bookTransferWriter', () => ({ obsidianBookTransferDeps: vi.fn() }));
vi.mock('../../modals/BookFromCommunityModal', () => ({ BookFromCommunityModal: class {} }));

import { forgetBookTransferList, renderCommunityBookFromCommunityBlock } from './CommunityBookFromCommunityBlock';

const OFFER = { transferId: '55555555-5555-4555-8555-555555555555', title: 'The Glass Orchard', sceneCount: 12 };
const plugin = { settings: { communityShare: { connection: { status: 'connected', connectionId: 'conn-1' }, sharingPaused: false } } };

/** One open Settings view: its own element, and a render that repaints it. */
function openSettings() {
    const view = { isConnected: true } as HTMLElement;
    const node = { createDiv: () => node };
    const render = (): void => {
        state.cards = [];
        renderCommunityBookFromCommunityBlock({ plugin: plugin as never, viewEl: view, containerEl: node as never, rerender: render });
    };
    render();
    return render;
}

afterEach(() => {
    forgetBookTransferList();
    vi.restoreAllMocks();
});

describe('Book from Community card', () => {
    it('reads the list fresh each time Settings opens, and once per open view', async () => {
        state.list.mockReset().mockResolvedValueOnce([]).mockResolvedValue([OFFER]);
        const first = openSettings();
        await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(1));
        first();
        first();
        expect(state.list).toHaveBeenCalledTimes(1);
        expect(state.cards).toEqual([]);

        // The author chose Add to my vault, then opened Settings again: the card is there at once.
        openSettings();
        await vi.waitFor(() => expect(state.cards).toHaveLength(1));
        expect(state.list).toHaveBeenCalledTimes(2);
        expect(state.cards[0]).toContain(OFFER.title);
    });

    it('reads again after the link or the preview forgets the list', async () => {
        state.list.mockReset().mockResolvedValue([OFFER]);
        const render = openSettings();
        await vi.waitFor(() => expect(state.cards).toHaveLength(1));
        forgetBookTransferList();
        render();
        await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(2));
    });

    it('drops an answer for a view that is no longer open', async () => {
        let answerFirst: (offers: unknown[]) => void = () => {};
        state.list.mockReset()
            .mockImplementationOnce(() => new Promise(resolve => { answerFirst = resolve; }))
            .mockResolvedValue([]);
        openSettings();
        const second = openSettings();
        await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(2));
        answerFirst([OFFER]);
        await Promise.resolve();
        second();
        expect(state.cards).toEqual([]);
    });

    it.each([
        ['a 404', () => Promise.reject(Object.assign(new Error('Not found'), { code: 'not_found' }))],
        ['no network', () => Promise.reject(new TypeError('net::ERR_INTERNET_DISCONNECTED'))],
    ])('shows nothing and logs nothing on %s', async (_name, answer) => {
        const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
        state.list.mockReset().mockImplementation(answer);
        const render = openSettings();
        await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        render();
        expect(state.cards).toEqual([]);
        for (const log of logs) expect(log).not.toHaveBeenCalled();
    });
});
