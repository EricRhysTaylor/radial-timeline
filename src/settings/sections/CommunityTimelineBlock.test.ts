import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Array<{ name: string; toggle?: { disabled: boolean; change: (value: boolean) => Promise<void> } }>, save: vi.fn(), fetch: vi.fn() }));
vi.mock('../../../tests/mocks/obsidian', async (original) => ({
    ...await original<typeof import('../../../tests/mocks/obsidian')>(),
    Notice: class {},
    Setting: class {
        name = '';
        descEl = { createDiv: () => ({}) };
        controlEl = { createEl: () => ({}) };
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
vi.mock('../../communityShare/communityShareClient', () => ({ CommunityShareError: class extends Error {}, fetchTimelineShareStatus: state.fetch, setTimelineShareDetails: state.save }));
vi.mock('../../communityShare/communityShareSettings', () => ({ normalizeCommunityShareSettings: (value: unknown) => value, canShareTimelineToCommunity: () => true, timelineShareFor: () => ({ enabled: true }) }));
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
        const container = { createDiv: () => ({}) } as unknown as HTMLElement;
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
