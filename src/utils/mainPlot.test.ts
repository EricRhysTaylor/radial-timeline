import { afterEach, describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { makeFile } from '../../tests/helpers/obsidianFixtures';
import type { TimelineItem } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { createSearchState } from '../services/searchState';
import { SceneDataService } from '../services/SceneDataService';
import { SubplotManagementService } from '../services/SubplotManagementService';
import { formatMemberships, planSubplotMembership } from '../services/SubplotMembership';
import { computeCacheableValues } from '../renderer/utils/Precompute';
import { getSubplotLabelText } from '../renderer/modules/ModeRenderingHelpers';
import type { PluginRendererFacade } from './sceneHelpers';
import { t } from '../i18n';
import { DEFAULT_MAIN_PLOT_NAME, getMainPlotName, syncMainPlotName } from './mainPlot';

// The main plot owns ring 1. Authors may rename it; everything that decides
// ring 1 must follow the new name, and nothing may recreate a "Main Plot".
afterEach(() => syncMainPlotName({}));

function rendererPlugin(currentMode: string) {
    return {
        settings: { ...DEFAULT_SETTINGS, currentMode, actCount: 1 },
        searchState: createSearchState(),
        openScenePaths: new Set<string>(),
    };
}

function scene(number: number, subplot: string): TimelineItem {
    return { title: `${number} Scene`, path: `Book/${number} Scene.md`, date: '', subplot, actNumber: 1 };
}

describe('syncMainPlotName', () => {
    it('defaults to Main Plot and follows the saved setting', () => {
        expect(getMainPlotName()).toBe(DEFAULT_MAIN_PLOT_NAME);
        syncMainPlotName({ mainPlotName: '  The Heist ' });
        expect(getMainPlotName()).toBe('The Heist');
        syncMainPlotName({ mainPlotName: '' });
        expect(getMainPlotName()).toBe(DEFAULT_MAIN_PLOT_NAME);
    });
});

describe('a renamed main plot', () => {
    it('receives scenes with no Subplot, and beat notes, when scenes load', async () => {
        syncMainPlotName({ mainPlotName: 'The Heist' });
        const frontmatter: Record<string, Record<string, unknown>> = {
            'Book/1 Opening.md': { Class: 'Scene', Act: 1 },
            'Book/2 Aside.md': { Class: 'Scene', Act: 1, Subplot: ['', ' '] },
            'Book/3 Catalyst.md': { Class: 'Beat', 'Beat Model': 'Custom', Act: 1 },
        };
        const app = {
            vault: { getMarkdownFiles: () => Object.keys(frontmatter).map(path => makeFile(path)) },
            metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) },
        } as unknown as App;
        const service = new SceneDataService(app, { ...DEFAULT_SETTINGS, beatSystem: 'Custom', sourcePath: 'Book' });

        const items = await service.getSceneData();

        expect(items.map(item => item.subplot)).toEqual(['The Heist', 'The Heist', 'The Heist']);
    });

    it('owns ring 1 even when another subplot has more scenes, and "Main Plot" becomes ordinary', () => {
        syncMainPlotName({ mainPlotName: 'The Heist' });
        const scenes = [
            scene(1, 'Romance'), scene(2, 'Romance'), scene(3, 'Romance'),
            scene(4, 'The Heist'),
            scene(5, 'Main Plot'), scene(6, 'Main Plot'),
        ];

        const { masterSubplotOrder } = computeCacheableValues(rendererPlugin('narrative') as never, scenes);

        expect(masterSubplotOrder).toEqual(['The Heist', 'Romance', 'Main Plot']);
    });

    it('is where a scene with no memberships lives', () => {
        syncMainPlotName({ mainPlotName: 'The Heist' });
        expect(formatMemberships([])).toBe('The Heist');
        expect(planSubplotMembership([], { kind: 'move', from: 'The Heist', to: 'Romance' })).toEqual(['Romance']);
        expect(planSubplotMembership(['Romance'], { kind: 'remove', from: 'Romance' })).toEqual(['The Heist']);
    });

    it('labels the Progress outer ring by its name; the default keeps the translated label', () => {
        const plugin = rendererPlugin('progress') as unknown as PluginRendererFacade;
        expect(getSubplotLabelText(plugin, DEFAULT_MAIN_PLOT_NAME, true)).toBe(t('timeline.subplotRing.mainPlot'));
        expect(getSubplotLabelText(plugin, 'The Heist', true)).toBe('THE HEIST');
    });
});

describe('SubplotManagementService.renameSubplot', () => {
    function vaultWith(frontmatter: Record<string, Record<string, unknown>>) {
        const app = {
            vault: { getMarkdownFiles: () => Object.keys(frontmatter).map(path => makeFile(path)) },
            metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) },
            fileManager: {
                processFrontMatter: async (file: TFile, edit: (fm: Record<string, unknown>) => void) => edit(frontmatter[file.path]),
            },
        } as unknown as App;
        const settings = {
            ...DEFAULT_SETTINGS,
            sourcePath: 'Book A',
            books: [
                { id: 'a', title: 'A', sourceFolder: 'Book A' },
                { id: 'b', title: 'B', sourceFolder: 'Book B' },
            ],
        };
        // SAFE: the service reads only getSettings() from SceneDataService
        const service = new SubplotManagementService(app, { getSettings: () => settings } as unknown as SceneDataService);
        return { service, settings };
    }

    it('renames the main plot in settings and in every book', async () => {
        const frontmatter = {
            'Book A/1.md': { Class: 'Scene', Subplot: 'Main Plot' },
            'Book A/2.md': { Class: 'Scene' },
            'Book B/1.md': { Class: 'Scene', Subplot: ['Main Plot', 'Romance'] },
        };
        const { service, settings } = vaultWith(frontmatter);

        await service.renameSubplot('Main Plot', 'The Heist');

        expect(settings.mainPlotName).toBe('The Heist');
        expect(frontmatter['Book A/1.md'].Subplot).toBe('The Heist');
        expect('Subplot' in frontmatter['Book A/2.md']).toBe(false);
        expect(frontmatter['Book B/1.md'].Subplot).toEqual(['The Heist', 'Romance']);
    });

    it('keeps other renames in the active book and leaves the main plot name alone', async () => {
        const frontmatter = {
            'Book A/1.md': { Class: 'Scene', Subplot: 'Romance' },
            'Book B/1.md': { Class: 'Scene', Subplot: 'Romance' },
        };
        const { service, settings } = vaultWith(frontmatter);

        await service.renameSubplot('Romance', 'Courtship');

        expect(settings.mainPlotName).toBe(DEFAULT_MAIN_PLOT_NAME);
        expect(frontmatter['Book A/1.md'].Subplot).toBe('Courtship');
        expect(frontmatter['Book B/1.md'].Subplot).toBe('Romance');
    });
});
