import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Array<{ name: string; toggle?: { disabled: boolean; change: (value: boolean) => Promise<void> } }>, notes: [] as string[], record: { enabled: true, lastError: '' }, save: vi.fn(), fetch: vi.fn() }));
vi.mock('../../../tests/mocks/obsidian', async (original) => ({
    ...await original<typeof import('../../../tests/mocks/obsidian')>(),
    Notice: class {},
    setIcon: vi.fn(),
    Setting: class {
        name = '';
        descEl = { createDiv: ({ text }: { text: string }) => { state.notes.push(text); return {}; } };
        controlEl = { createEl: () => ({ createSpan: () => ({}) }) };
        setName(name: string) { this.name = name; return this; }
        setDesc() { return this; }
        setHeading() { return this; }
        addToggle(callback: (toggle: unknown) => void) {
            const toggle = { disabled: false, change: async (_value: boolean) => {}, setValue() { return this; }, setDisabled(value: boolean) { this.disabled = value; return this; }, onChange(fn: (value: boolean) => Promise<void>) { this.change = fn; return this; } };
            state.rows.push({ name: this.name, toggle }); callback(toggle); return this;
        }
    },
}));
vi.mock('../wikiLink', () => ({ addHeadingIcon: () => {}, applyErtHeaderLayout: () => {} }));
vi.mock('../../communityShare/communityShareClient', () => ({ CommunityShareError: class extends Error { constructor(_code: string, message: string) { super(message); } }, fetchTimelineShareStatus: state.fetch, setTimelineShareDetails: state.save }));
vi.mock('../../communityShare/communityShareSettings', () => ({ normalizeCommunityShareSettings: (value: unknown) => value, canShareTimelineToCommunity: () => true, timelineShareFor: () => state.record }));
vi.mock('../../communityShare/communityMailbox', () => ({ COMMUNITY_SITE_URL: 'https://example.test' }));
vi.mock('../../modals/ErtConfirmModal', () => ({ confirmWithErtModal: vi.fn() }));

import { renderCommunityTimelineBlock } from './CommunityTimelineBlock';
import { t } from '../../i18n';
import { Setting } from 'obsidian';

describe('timeline privacy details', () => {
    it.each([false, true])('rechecks the website after a failed save (the website applied it: %s)', async (applied) => {
        expect(typeof (new Setting({} as HTMLElement) as unknown as { setHeading?: unknown }).setHeading).toBe('function');
        const answer = { ok: true, shared: true, project_id: 'project', share: { status: 'active', hidden_scene_fields: ['synopsis'], generic_subplot_names: false } };
        const afterFailure = { ...answer, share: { ...answer.share, hidden_scene_fields: applied ? ['synopsis', 'title'] : ['synopsis'] } };
        state.fetch.mockReset().mockResolvedValueOnce(answer).mockResolvedValue(afterFailure);
        state.save.mockReset();
        let rejectFirst: (error: Error) => void = () => {};
        state.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; })).mockResolvedValue(answer);
        vi.stubGlobal('window', { setTimeout: vi.fn() });
        const node = { createDiv: () => node };
        const container = node as unknown as HTMLElement;
        const plugin = { settings: { communityShare: { connection: { status: 'connected', connectionId: `privacy-test-${applied}` }, sharingPaused: false } } };
        const book = { id: `privacy-test-book-${applied}`, title: 'Book', sourceFolder: 'Book' };
        const render = () => { state.rows = []; renderCommunityTimelineBlock({ plugin: plugin as never, containerEl: container, book: book as never, rerender: render }); };
        render();
        await vi.waitFor(() => expect(state.rows.length).toBeGreaterThan(1));
        const find = (key: string) => state.rows.find(row => row.name === t(key))!.toggle!;
        const title = find('ui.communityShareSection.timelineDetailTitle');
        const cast = find('ui.communityShareSection.timelineDetailCast');
        const first = title.change(false);
        expect(cast.disabled).toBe(true);
        await cast.change(false);
        expect(state.save).toHaveBeenCalledTimes(1);
        render();
        const rerenderedCast = find('ui.communityShareSection.timelineDetailCast');
        expect(rerenderedCast.disabled).toBe(true);
        await rerenderedCast.change(false);
        expect(state.save).toHaveBeenCalledTimes(1);
        rejectFirst(new Error('offline'));
        await first;
        await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(state.rows.some(row => row.name === t('ui.communityShareSection.timelineDetailCast'))).toBe(true));
        await find('ui.communityShareSection.timelineDetailCast').change(false);
        expect(state.save).toHaveBeenLastCalledWith(plugin, book.id, { hiddenSceneFields: applied ? ['synopsis', 'title', 'characters'] : ['synopsis', 'characters'] });
    });
});

describe('Community dates', () => {
    it('writes Last sent and Website checked in one format, kept on one line', async () => {
        const { formatCommunityDate } = await import('./CommunityTimelineBlock');
        const at = Date.UTC(2026, 10, 18, 23, 1);
        const fromIso = formatCommunityDate(new Date(at).toISOString());
        const fromMs = formatCommunityDate(at);
        expect(fromIso).toBe(fromMs);
        expect(fromMs).toBe(new Date(at).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }).replace(/\s/g, '\u00A0'));
        expect(fromMs).toContain('2026');
        expect(fromMs).not.toMatch(/[ \u202F]/);
        expect(fromMs).not.toMatch(/:\d\d:\d\d/);
        expect(formatCommunityDate('not a date')).toBe('not a date');
    });
});

describe('timeline status wording', () => {
    it('does not assume a website timeline is private while its status is unknown', async () => {
        const { shareDescription } = await import('./CommunityTimelineBlock');
        const book = { id: 'book', title: 'Book' } as never;
        expect(shareDescription(book, undefined, undefined)).toBe(t('ui.communityShareSection.timelineShareChecking'));
        expect(shareDescription(book, { enabled: false } as never, { shared: true } as never)).toBe(t('ui.communityShareSection.timelineShareOffExisting'));
        expect(shareDescription(book, { enabled: true } as never, { shared: true, share: { status: 'active' } } as never)).toBe(t('ui.communityShareSection.timelineShareLive'));
    });

    it('shows matching sync and status errors once while retaining distinct errors', async () => {
        const { CommunityShareError } = await import('../../communityShare/communityShareClient');
        vi.stubGlobal('window', { setTimeout: vi.fn() });
        const node = { createDiv: () => node };
        const plugin = { settings: { communityShare: { connection: { status: 'connected', connectionId: 'duplicate-errors' }, sharingPaused: false } } };
        const book = { id: 'duplicate-errors-book', title: 'Book', sourceFolder: 'Book' };
        state.record.lastError = 'Connection key missing';
        state.fetch.mockReset().mockRejectedValue(new CommunityShareError('connection_secret_missing', 'Connection key missing'));
        const render = () => { state.notes = []; renderCommunityTimelineBlock({ plugin: plugin as never, containerEl: node as never, book: book as never, rerender: render }); };
        render();
        await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(state.notes.filter(note => note === 'Connection key missing')).toHaveLength(1));
        state.record.lastError = 'Earlier sync failed';
        render();
        expect(state.notes).toContain('Earlier sync failed');
        expect(state.notes).toContain('Connection key missing');
        state.record.lastError = '';
    });
});
