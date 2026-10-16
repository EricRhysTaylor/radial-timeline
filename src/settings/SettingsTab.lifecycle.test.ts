import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component } from 'obsidian';
import { dirtyState } from './sections/beats/dirtyState';
import { renderBeatPropertiesSection } from './sections/BeatPropertiesSection';
import { renderProgressSection } from './sections/ProgressSection';
import { RadialTimelineSettingsTab } from './SettingsTab';

vi.mock('./FolderSuggest', () => ({ FolderSuggest: class {} }));

vi.mock('./sections/BeatPropertiesSection', () => ({ renderBeatPropertiesSection: vi.fn() }));

vi.mock('./sections/GeneralSection', () => ({ renderGeneralSection: vi.fn() }));
vi.mock('./sections/ProgressSection', () => ({ renderCompletionEstimatePreview: vi.fn(), renderProgressSection: vi.fn() }));
vi.mock('./sections/ChronologueSection', () => ({ renderChronologueSection: vi.fn() }));
vi.mock('./sections/BackdropSection', () => ({ renderBackdropSection: vi.fn() }));
vi.mock('./sections/AuthorProgressSection', () => ({ renderAuthorProgressSection: vi.fn() }));
vi.mock('./sections/CommunityShareSection', () => ({ renderCommunityShareSection: vi.fn() }));
vi.mock('./sections/InquirySection', () => ({ renderInquirySection: vi.fn() }));
vi.mock('./sections/ColorsSection', () => ({ renderColorsSection: vi.fn() }));
vi.mock('./sections/ConfigurationSection', () => ({ renderConfigurationSection: vi.fn() }));
vi.mock('./sections/AiSection', () => ({ renderAiSection: vi.fn() }));
vi.mock('./sections/ReleaseNotesSection', () => ({ renderReleaseNotesSection: vi.fn() }));
vi.mock('./sections/PovSection', () => ({ renderPovSection: vi.fn() }));
vi.mock('./sections/PlanetaryTimeSection', () => ({ renderPlanetaryTimeSection: vi.fn() }));
vi.mock('./sections/RuntimeSection', () => ({ renderRuntimeSection: vi.fn() }));
vi.mock('./sections/GoalsSessionsSection', () => ({ renderGoalsSessionsSection: vi.fn() }));
vi.mock('./sections/ProEntitlementPanel', () => ({ renderProEntitlementPanel: vi.fn() }));
vi.mock('./sections/BonusVaultsSection', () => ({ renderBonusVaultsSection: vi.fn() }));
vi.mock('./sections/PublishSection', () => ({ renderPublishSection: vi.fn() }));

const tabs: RadialTimelineSettingsTab[] = [];
afterEach(() => {
    tabs.forEach(tab => tab.disposeAsyncWork());
    tabs.length = 0;
    vi.clearAllMocks();
});

function fakePanel(isConnected = true) {
    return { isConnected, empty: vi.fn(), querySelector: () => null };
}

function mountPanels(settings: { activeBookId?: string } = {}, isConnected = true) {
    const tab = new RadialTimelineSettingsTab({} as never, { settings } as never);
    tabs.push(tab);
    const progressStack = fakePanel(isConnected);
    const beatsWrapper = fakePanel(isConnected);
    // SAFE: supply only the mounted panels used by the public refresh entry point.
    Object.assign(tab as unknown as Record<string, unknown>, { _progressStatusStack: progressStack, _beatsWrapper: beatsWrapper });
    return { tab, progressStack, beatsWrapper };
}

function mount() {
    const { tab } = mountPanels();
    const listeners: ReturnType<typeof vi.fn>[] = [];
    const cleanups: ReturnType<typeof vi.fn>[] = [];
    vi.mocked(renderBeatPropertiesSection).mockImplementation(({ scope }) => {
        expect(scope).toBeInstanceOf(Component);
        const listener = vi.fn();
        const cleanup = vi.fn();
        listeners.push(listener);
        cleanups.push(cleanup);
        scope.register(dirtyState.subscribe(listener));
        scope.register(cleanup);
    });
    tab.refreshActiveBookSections();
    return { tab, listeners, cleanups };
}

describe('settings-owned beat render lifetime', () => {
    it('unsubscribes the old render before mounting a replacement', () => {
        const { tab, listeners, cleanups } = mount();
        tab.refreshActiveBookSections();
        dirtyState.notify();
        expect(listeners[0]).not.toHaveBeenCalled();
        expect(listeners[1]).toHaveBeenCalledTimes(1);
        expect(cleanups[0]).toHaveBeenCalledTimes(1);
        expect(cleanups[1]).not.toHaveBeenCalled();
    });

    it.each(['hide', 'disposeAsyncWork'] as const)('disposes the current render on %s and supports reopening', (method) => {
        const { tab, listeners, cleanups } = mount();
        tab[method]();
        tab[method]();
        dirtyState.notify();
        expect(listeners[0]).not.toHaveBeenCalled();
        expect(cleanups[0]).toHaveBeenCalledTimes(1);
        tab.refreshActiveBookSections();
        dirtyState.notify();
        expect(listeners[1]).toHaveBeenCalledTimes(1);
        expect(listeners[0]).not.toHaveBeenCalled();
    });

    it('disposes both AI and beat work before rebuilding the full settings DOM', () => {
        const { tab, cleanups } = mount();
        const disposeAi = vi.fn();
        // SAFE: inject the existing AI lifecycle to verify the shared teardown boundary.
        (tab as unknown as { _aiSectionLifecycle: unknown })._aiSectionLifecycle = { dispose: disposeAi };
        const stop = new Error('stop before unrelated settings UI');
        tab.containerEl = { empty: () => {
            expect(cleanups[0]).toHaveBeenCalledTimes(1);
            expect(disposeAi).toHaveBeenCalledTimes(1);
            throw stop;
        } } as unknown as HTMLElement;
        expect(() => tab.display()).toThrow(stop);
    });
});

describe('settings panels that read the active book', () => {
    it('re-renders Progress and status in place when the active book changes', () => {
        const settings = { activeBookId: 'broken-draft' };
        const { tab, progressStack } = mountPanels(settings);
        const renderedFor: Array<string | undefined> = [];
        vi.mocked(renderProgressSection).mockImplementation(({ plugin, containerEl }) => {
            expect(containerEl).toBe(progressStack);
            renderedFor.push(plugin.settings.activeBookId);
        });
        tab.refreshActiveBookSections();
        settings.activeBookId = 'harbor-book';
        tab.refreshActiveBookSections();
        expect(renderedFor).toEqual(['broken-draft', 'harbor-book']);
        expect(progressStack.empty).toHaveBeenCalledTimes(2);
        expect(renderBeatPropertiesSection).toHaveBeenCalledTimes(2);
    });

    it('drops the previous Progress render listeners before mounting a replacement', () => {
        const { tab } = mountPanels();
        const cleanups: ReturnType<typeof vi.fn>[] = [];
        vi.mocked(renderProgressSection).mockImplementation(({ scope }) => {
            const cleanup = vi.fn();
            cleanups.push(cleanup);
            scope.register(cleanup);
        });
        tab.refreshActiveBookSections();
        tab.refreshActiveBookSections();
        expect(cleanups[0]).toHaveBeenCalledTimes(1);
        expect(cleanups[1]).not.toHaveBeenCalled();
    });

    it('does nothing while the Core panels are not displayed', () => {
        const { tab, progressStack } = mountPanels({}, false);
        tab.refreshActiveBookSections();
        expect(progressStack.empty).not.toHaveBeenCalled();
        expect(renderProgressSection).not.toHaveBeenCalled();
        expect(renderBeatPropertiesSection).not.toHaveBeenCalled();
    });

    it.each(['setActiveBookId', 'persistBookSettings'])('plugin %s refreshes the open panels', (method) => {
        const mainSrc = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
        const body = mainSrc.match(new RegExp(`public async ${method}\\([^)]*\\): Promise<void> \\{[\\s\\S]+?\\n {4}\\}`))?.[0] ?? '';
        expect(body).toContain('this.settingsTab?.refreshActiveBookSections();');
    });
});
