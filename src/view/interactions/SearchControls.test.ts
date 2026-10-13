import { describe, expect, it, vi } from 'vitest';
import { SearchPanelController } from './SearchPanelController';
import { RadialTimelineView } from '../TimeLineView';
import { createSearchState } from '../../services/searchState';

describe('search controls during pending runs', () => {
    it('forces unavailable assist off even though its checkbox is disabled', async () => {
        let options = { timelineFields: true, body: false, llmAssist: true };
        const panel = Object.create(SearchPanelController.prototype); // SAFE: hydrate only the inputs used by the controller probe
        Object.assign(panel, { statusProbeId: 0, assistHint: { textContent: '' },
            assistCheckbox: { disabled: false, checked: true, parentElement: { classList: { toggle: vi.fn() } } },
            host: { getLocalModelStatus: async () => ({ available: false, reason: 'offline' }), getSearchState: () => ({ options }),
                setSearchOptions: (next: typeof options) => { options = next; } } });
        await panel.refreshLocalModelStatus(); expect(panel.assistCheckbox.disabled).toBe(true); expect(options.llmAssist).toBe(false);
    });
    it('clears a run before its first result', () => {
        const view = Object.create(RadialTimelineView.prototype); // SAFE: hydrate the control facade without creating an Obsidian leaf
        const clearSearch = vi.fn();
        Object.assign(view, { timelineSearchInput: { value: 'concept', focus: vi.fn() }, setTimelineSearchButtonMode: vi.fn(),
            plugin: { searchState: { ...createSearchState(), pendingTerm: 'concept', status: 'running' }, clearSearch } });
        view.clearTimelineSearchFromControl(); expect(clearSearch).toHaveBeenCalledOnce();
    });
    it('supersedes a pending run immediately when scopes change, before saving completes', async () => {
        const view = Object.create(RadialTimelineView.prototype); // SAFE: hydrate the control facade without a rendered view
        let saved!: () => void;
        const performSearch = vi.fn();
        Object.assign(view, { plugin: { searchState: { ...createSearchState(), pendingTerm: 'concept', status: 'running' }, settings: {},
            saveSettings: () => new Promise<void>(resolve => { saved = resolve; }), performSearch } });
        const pending = view.applySearchOptions({ timelineFields: false, body: true, llmAssist: true });
        expect(performSearch).toHaveBeenCalledWith('concept'); saved(); await pending;
    });
    it('shows the submitted query rather than previous results during progress', () => {
        const view = Object.create(RadialTimelineView.prototype); // SAFE: hydrate only the input and state used by sync
        const input = { value: 'old query' };
        Object.assign(view, { timelineSearchInput: input, timelineSearchButton: {}, setTimelineSearchButtonMode: vi.fn(),
            plugin: { searchState: { ...createSearchState(), term: 'old query', pendingTerm: 'new concept', active: true, status: 'running' } } });
        view.syncTimelineSearchControl(); expect(input.value).toBe('new concept');
        input.value = 'a draft still being typed'; view.syncTimelineSearchControl(); expect(input.value).toBe('a draft still being typed');
    });
    it('does not count old committed matches as discoveries in a new run', () => {
        const panel = Object.create(SearchPanelController.prototype); // SAFE: status formatting needs no DOM construction
        const state = { ...createSearchState(), active: true, status: 'running', runningHitCount: 0,
            progress: { chunk: 1, chunkCount: 3 }, hits: new Map([['old.md', { path: 'old.md', source: 'body', evidence: [] }]]) };
        expect(panel.describeStatus(state)).toBe('Reading scene 1 of 3');
    });
});

it('makes coverage failures inspectable and resets Cancel for a replacement run', () => {
    const panel = Object.create(SearchPanelController.prototype); // SAFE: status synchronization uses this minimal control facade
    const state = { ...createSearchState(), runId: 2, status: 'running', pendingTerm: 'same query',
        options: { timelineFields: true, body: false, llmAssist: true },
        unreadableNotes: [{ path: 'missing.md', reason: 'read failed' }] };
    const statusText = { textContent: '', title: '' }, cancelButton = { hidden: true, disabled: true };
    Object.assign(panel, { cancelRequested: true, cancelRunId: 1, scopeRows: [], assistCheckbox: { checked: true }, statusText, cancelButton,
        host: { getSearchState: () => state } });
    panel.syncFromState();
    expect(statusText.title).toBe('missing.md: read failed'); expect(statusText.textContent).toBe('Searching…');
    expect(cancelButton.disabled).toBe(false); expect(cancelButton.hidden).toBe(false);
});
