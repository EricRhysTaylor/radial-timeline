import { it, expect, vi } from 'vitest';
import { SearchService } from './SearchService';
import { createSearchState } from './searchState';
it('restarts a pending query in the new book and rejects the old corpus', async () => {
    let source = 'A', releaseOld!: (scenes: unknown[]) => void;
    const oldCorpus = new Promise(resolve => { releaseOld = resolve; });
    const plugin = { settings: {}, searchState: createSearchState(), registerEvent: vi.fn(),
        getTimelineViews: () => [{ syncTimelineSearchControl: vi.fn(), refreshTimeline: vi.fn() }],
        getTimelineSceneData: () => source === 'A' ? oldCorpus
            : Promise.resolve([{ path: 'B/scene.md', title: 'A coast', rawFrontmatter: {} }]) };
    const service = new SearchService({ vault: { on: vi.fn() } } as never, plugin as never);
    service.performSearch('coast'); source = 'B'; service.restartForScopeChange();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...plugin.searchState.hits.keys()]).toEqual(['B/scene.md']);
    releaseOld([{ path: 'A/scene.md', title: 'A coast', rawFrontmatter: {} }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...plugin.searchState.hits.keys()]).toEqual(['B/scene.md']);
});
