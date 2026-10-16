import { describe, expect, it, vi } from 'vitest';
import { SearchPanelController } from './SearchPanelController';
import { RadialTimelineView } from '../TimeLineView';
import { createSearchState } from '../../services/searchState';

function availabilityHarness(options = { timelineFields: true, body: false, llmAssist: true, semanticIndex: true }) {
    const panel = Object.create(SearchPanelController.prototype); // SAFE: exercise the controller state machine without an Obsidian leaf
    const checkbox = () => ({ disabled: false, checked: false, parentElement: { title: '', classList: { toggle: vi.fn() } } });
    const localProbe = vi.fn(async () => ({ available: true, modelId: 'model' }));
    const setSearchOptions = vi.fn((next: typeof options) => { options = next; });
    Object.assign(panel, { statusProbeId: 0, scopeRows: [], assistCheckbox: checkbox(), indexCheckbox: checkbox(),
        assistHint: { textContent: '' }, indexHint: { textContent: '' },
        assistIndicator: { hidden: true }, indexIndicator: { hidden: true },
        host: { getLocalModelStatus: localProbe,
            getSearchState: () => ({ options }), setSearchOptions } });
    return { panel, localProbe, setSearchOptions, options: () => options };
}

describe('single-server local search availability', () => {
    it('mutes unavailable options without changing modes, but lets a selected option be turned off', async () => {
        const h = availabilityHarness();
        h.localProbe.mockResolvedValue({ available: false, reason: 'Server not detected' } as never);
        await h.panel.refreshLocalModelStatus();
        expect(h.setSearchOptions).not.toHaveBeenCalled();
        expect(h.panel.assistIndicator.hidden).toBe(false);
        expect(h.panel.indexIndicator.hidden).toBe(false);
        expect(h.panel.assistCheckbox.disabled).toBe(false);
        expect(h.panel.indexCheckbox.disabled).toBe(false);
        expect(h.panel.assistCheckbox.parentElement.title).toContain('Uncheck');
        h.panel.assistCheckbox.checked = false; h.panel.indexCheckbox.checked = true;
        h.panel.commitOptions(); h.panel.syncAvailability();
        expect(h.options().llmAssist).toBe(false);
        expect(h.options().semanticIndex).toBe(true);
        expect(h.panel.assistCheckbox.disabled).toBe(true);
    });
    it('uses the same configured server for index availability and recovers without changing preferences', async () => {
        const h = availabilityHarness({ timelineFields: true, body: false, llmAssist: true, semanticIndex: false });
        h.localProbe.mockResolvedValueOnce({ available: false, reason: 'Server not detected' } as never);
        await h.panel.refreshLocalModelStatus();
        expect(h.panel.assistIndicator.hidden).toBe(false); expect(h.panel.indexIndicator.hidden).toBe(false);
        expect(h.panel.indexCheckbox.disabled).toBe(true);
        await h.panel.refreshLocalModelStatus();
        expect(h.panel.indexIndicator.hidden).toBe(true); expect(h.panel.indexCheckbox.disabled).toBe(false);
        expect(h.panel.indexHint.textContent).toContain('server and model selected in AI settings');
        expect(h.setSearchOptions).not.toHaveBeenCalled();
    });
    it('keeps an unselected index disabled when assist is off, even when both servers respond', async () => {
        const h = availabilityHarness({ timelineFields: true, body: true, llmAssist: false, semanticIndex: false });
        await h.panel.refreshLocalModelStatus();
        expect(h.panel.assistCheckbox.disabled).toBe(false);
        expect(h.panel.indexCheckbox.disabled).toBe(true);
        expect(h.panel.indexHint.textContent).toContain('Turn on Local LLM assist');
    });
    it('does not let a late failed probe overwrite a newer healthy result', async () => {
        const h = availabilityHarness(); let finish!: (value: { available: boolean }) => void;
        h.localProbe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const stale = h.panel.refreshLocalModelStatus();
        await h.panel.refreshLocalModelStatus(); finish({ available: false }); await stale;
        expect(h.panel.assistIndicator.hidden).toBe(true);
    });
    it('rechecks while open and stops checking on collapse or disposal', async () => {
        vi.useFakeTimers();
        try {
            const h = availabilityHarness();
            Object.assign(h.panel, { expanded: false, panel: { hidden: true, ownerDocument: { win: window } }, shell: { classList: { add: vi.fn(), remove: vi.fn() } },
                input: { setAttribute: vi.fn() }, syncFromState: vi.fn(), applyEdgeAnchor: vi.fn() });
            h.panel.expand(); await vi.advanceTimersByTimeAsync(5000);
            expect(h.localProbe).toHaveBeenCalledTimes(2);
            h.panel.collapse(); await vi.advanceTimersByTimeAsync(10000);
            expect(h.localProbe).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });
    it('shows a rejected health check and ignores an answer after closing', async () => {
        const h = availabilityHarness();
        h.localProbe.mockRejectedValueOnce(new Error('Connection refused'));
        await h.panel.refreshLocalModelStatus();
        expect(h.panel.assistHint.textContent).toContain('Connection refused');
        let finish!: (value: { available: boolean }) => void;
        h.localProbe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = h.panel.refreshLocalModelStatus();
        h.panel.statusProbeId += 1; finish({ available: true }); await pending;
        expect(h.panel.assistHint.textContent).toContain('Connection refused');
    });
});

describe('search controls during pending runs', () => {
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
    Object.assign(panel, { syncAvailability: vi.fn(), cancelRequested: true, cancelRunId: 1, scopeRows: [], indexCheckbox: { checked: false, disabled: false }, assistCheckbox: { checked: true }, statusText, cancelButton,
        host: { getSearchState: () => state } });
    panel.syncFromState();
    expect(statusText.title).toBe('missing.md: read failed'); expect(statusText.textContent).toBe('Searching…');
    expect(cancelButton.disabled).toBe(false); expect(cancelButton.hidden).toBe(false);
});


it('discloses indexed excerpt coverage and indexing progress in the existing status line', () => {
    const panel = Object.create(SearchPanelController.prototype); // SAFE: status formatting needs no rendered Obsidian leaf
    const state = createSearchState({ timelineFields: true, body: true, llmAssist: true, semanticIndex: true });
    state.status = 'running'; state.indexProgress = { done: 2, total: 7 };
    expect(panel.describeStatus(state)).toBe('Updating index: 2 of 7 scenes');
    state.status = 'ready'; state.active = true; state.indexProgress = undefined;
    state.retrieval = { candidates: 12, total: 84, updatedNotes: 0, passages: 100, elapsedMs: 10 };
    expect(panel.describeStatus(state)).toContain('12 of 84 scenes reviewed');
    expect(panel.describeStatus(state)).toContain('other matches may be missed');
});
