/**
 * Settings → Community → Community → Vault: the website's list of waiting
 * books is read fresh each time Settings opens, kept only for the rerenders of
 * one open view. A website or network that does not answer leaves the card
 * closed and dimmed, No books waiting, and logs nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../tests/mocks/obsidian', async (original) => {
    const dom = await import('../../../tests/mocks/fakeDom');
    return {
        ...await original<typeof import('../../../tests/mocks/obsidian')>(),
        Setting: dom.FakeSetting,
        setIcon: () => {},
    };
});
vi.mock('../../communityShare/communityShareClient', () => ({ listBookTransfers: state.list }));
vi.mock('../../communityShare/communityShareSettings', () => ({
    normalizeCommunityShareSettings: (value: unknown) => value,
    canShareTimelineToCommunity: () => true,
    bookTransferRecords: () => [],
}));
vi.mock('../../communityShare/bookTransferWriter', () => ({ obsidianBookTransferDeps: vi.fn() }));
vi.mock('../../modals/BookFromCommunityModal', () => ({ BookFromCommunityModal: class {} }));

import { FakeElement } from '../../../tests/mocks/fakeDom';
import { t } from '../../i18n';
import { forgetBookTransferList, renderCommunityBookFromCommunityBlock } from './CommunityBookFromCommunityBlock';

const OFFER = { transferId: '55555555-5555-4555-8555-555555555555', title: 'The Glass Orchard', sceneCount: 12 };
const plugin = { settings: { communityShare: { connection: { status: 'connected', connectionId: 'conn-1' }, sharingPaused: false } } };

/** One open Settings view: its own element, and a render that repaints it. */
function openSettings() {
    const view = { isConnected: true } as HTMLElement;
    const screen = new FakeElement();
    const render = (): void => {
        screen.empty();
        renderCommunityBookFromCommunityBlock({ plugin: plugin as never, viewEl: view, containerEl: screen as never, rerender: render });
    };
    render();
    return {
        render,
        /** The Community → Vault card: its details element and its one-line summary. */
        direction: () => screen.find('ert-community-direction')[0],
        line: () => screen.find('ert-community-direction__line')[0].text,
        books: () => screen.settings,
        screen,
    };
}

afterEach(() => {
    forgetBookTransferList();
    vi.restoreAllMocks();
});

describe('Community → Vault', () => {
    it('reads the list fresh each time Settings opens, and once per open view', async () => {
        state.list.mockReset().mockResolvedValueOnce([]).mockResolvedValue([OFFER]);
        const first = openSettings();
        await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(1));
        first.render();
        first.render();
        expect(state.list).toHaveBeenCalledTimes(1);
        expect(first.books()).toEqual([]);

        // The author chose Add to my vault, then opened Settings again: the book is there at once.
        const second = openSettings();
        await vi.waitFor(() => expect(second.books()).toHaveLength(1));
        expect(state.list).toHaveBeenCalledTimes(2);
        expect(second.books()[0].name).toBe(OFFER.title);
        expect(second.line()).toBe('1 book waiting');
        expect(second.direction().classList.contains('is-muted')).toBe(false);
        expect((second.direction() as unknown as { open: boolean }).open).toBe(true);
    });

    it('reads again after the link or the preview forgets the list', async () => {
        state.list.mockReset().mockResolvedValue([OFFER]);
        const view = openSettings();
        await vi.waitFor(() => expect(view.books()).toHaveLength(1));
        forgetBookTransferList();
        view.render();
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
        second.render();
        expect(second.books()).toEqual([]);
    });

    it.each([
        ['a 404', () => Promise.reject(Object.assign(new Error('Not found'), { code: 'not_found' }))],
        ['no network', () => Promise.reject(new TypeError('net::ERR_INTERNET_DISCONNECTED'))],
    ])('stays closed and dimmed, says how a book gets here, and logs nothing on %s', async (_name, answer) => {
        const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
        state.list.mockReset().mockImplementation(answer);
        const view = openSettings();
        await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        view.render();
        expect(view.books()).toEqual([]);
        const row = view.direction();
        expect(row.classList.contains('is-muted')).toBe(true);
        expect((row as unknown as { open: boolean }).open).toBe(false);
        expect(view.line()).toBe(t('ui.bookFromCommunity.importNone'));
        expect(view.screen.content).toContain(t('ui.bookFromCommunity.importEmpty'));
        for (const log of logs) expect(log).not.toHaveBeenCalled();
    });
});
