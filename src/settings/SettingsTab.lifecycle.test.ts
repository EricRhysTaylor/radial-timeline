import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { dirtyState } from './sections/beats/dirtyState';
import { renderBeatPropertiesSection } from './sections/BeatPropertiesSection';
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

function mount() {
    const tab = new RadialTimelineSettingsTab({} as never, { settings: {} } as never);
    tabs.push(tab);
    const wrapper = { isConnected: true, empty: vi.fn(), querySelector: () => null };
    // SAFE: supply only the mounted wrapper used by the public refresh entry point.
    (tab as unknown as { _beatsWrapper: unknown })._beatsWrapper = wrapper;
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
    tab.refreshBeatPropertiesSection();
    return { tab, listeners, cleanups };
}

describe('settings-owned beat render lifetime', () => {
    it('unsubscribes the old render before mounting a replacement', () => {
        const { tab, listeners, cleanups } = mount();
        tab.refreshBeatPropertiesSection();
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
        tab.refreshBeatPropertiesSection();
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
