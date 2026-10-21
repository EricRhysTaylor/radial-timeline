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
import { DEFAULT_MAIN_PLOT_NAME, getMainPlotName, resolveMainPlotName, syncMainPlotName, toSagaMainPlot } from './mainPlot';
import { isSubplotNameTaken } from '../services/SubplotManagementService';
import type { BookProfile } from '../types/settings';

// The main plot owns ring 1. Each book may rename its own; everything that
// decides ring 1 must follow the new name, and nothing may recreate a "Main Plot".
afterEach(() => syncMainPlotName({}));

/** Settings for a book timeline whose active book calls its main plot `name`. */
const named = (name: string) => ({ books: [{ id: 'a', title: 'A', sourceFolder: 'Book', mainPlotName: name }], activeBookId: 'a' });

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
    it("defaults to Main Plot and follows the active book's own name", () => {
        expect(getMainPlotName()).toBe(DEFAULT_MAIN_PLOT_NAME);
        syncMainPlotName(named('  The Heist '));
        expect(getMainPlotName()).toBe('The Heist');
        syncMainPlotName(named(''));
        expect(getMainPlotName()).toBe(DEFAULT_MAIN_PLOT_NAME);
    });

    it('is per book: switching books switches the name', () => {
        const books: BookProfile[] = [
            { id: 'a', title: 'A', sourceFolder: 'A', mainPlotName: 'The Heist' },
            { id: 'b', title: 'B', sourceFolder: 'B' },
        ];
        expect(resolveMainPlotName({ books, activeBookId: 'a' })).toBe('The Heist');
        expect(resolveMainPlotName({ books, activeBookId: 'b' })).toBe(DEFAULT_MAIN_PLOT_NAME);
    });

    it('in saga view uses the name every book shares, else Main Plot', () => {
        const saga = (...names: Array<string | undefined>) => ({
            timelineScope: 'saga' as const,
            activeBookId: 'b0',
            books: names.map((mainPlotName, i): BookProfile => ({ id: `b${i}`, title: `B${i}`, sourceFolder: `B${i}`, ...(mainPlotName ? { mainPlotName } : {}) })),
        });
        expect(resolveMainPlotName(saga('The Heist', 'The Heist'))).toBe('The Heist');
        expect(resolveMainPlotName(saga('The Heist', 'The Long Con'))).toBe(DEFAULT_MAIN_PLOT_NAME);
        expect(resolveMainPlotName(saga('The Heist', undefined))).toBe(DEFAULT_MAIN_PLOT_NAME);
    });
});

describe('toSagaMainPlot', () => {
    it("shows each book's own main plot in ring 1 under the saga's name", () => {
        syncMainPlotName({
            timelineScope: 'saga', activeBookId: 'a',
            books: [
                { id: 'a', title: 'A', sourceFolder: 'A', mainPlotName: 'The Heist' },
                { id: 'b', title: 'B', sourceFolder: 'B', mainPlotName: 'The Long Con' },
            ],
        });
        const scenes = [scene(1, 'The Heist'), scene(2, 'Romance'), scene(3, DEFAULT_MAIN_PLOT_NAME)];

        expect(toSagaMainPlot(scenes, { mainPlotName: 'The Heist' }).map(s => s.subplot))
            .toEqual([DEFAULT_MAIN_PLOT_NAME, 'Romance', DEFAULT_MAIN_PLOT_NAME]);
    });

    it('leaves scenes alone when the book already uses the saga name', () => {
        syncMainPlotName({});
        const scenes = [scene(1, DEFAULT_MAIN_PLOT_NAME)];
        expect(toSagaMainPlot(scenes, {})).toBe(scenes);
    });
});

describe('a renamed main plot', () => {
    it('receives scenes with no Subplot, and beat notes, when scenes load', async () => {
        syncMainPlotName(named('The Heist'));
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
        syncMainPlotName(named('The Heist'));
        const scenes = [
            scene(1, 'Romance'), scene(2, 'Romance'), scene(3, 'Romance'),
            scene(4, 'The Heist'),
            scene(5, 'Main Plot'), scene(6, 'Main Plot'),
        ];

        const { masterSubplotOrder } = computeCacheableValues(rendererPlugin('narrative') as never, scenes);

        expect(masterSubplotOrder).toEqual(['The Heist', 'Romance', 'Main Plot']);
    });

    it('is where a scene with no memberships lives', () => {
        syncMainPlotName(named('The Heist'));
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
    function vaultWith(frontmatter: Record<string, Record<string, unknown>>, unwritable: string[] = []) {
        const app = {
            vault: { getMarkdownFiles: () => Object.keys(frontmatter).map(path => makeFile(path)) },
            metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) },
            fileManager: {
                processFrontMatter: async (file: TFile, edit: (fm: Record<string, unknown>) => void) => {
                    if (unwritable.includes(file.path)) throw new Error('unparseable frontmatter');
                    edit(frontmatter[file.path]);
                },
            },
        } as unknown as App;
        const settings = {
            ...DEFAULT_SETTINGS,
            sourcePath: 'Book A',
            activeBookId: 'a',
            books: [
                { id: 'a', title: 'A', sourceFolder: 'Book A' } as BookProfile,
                { id: 'b', title: 'B', sourceFolder: 'Book B' } as BookProfile,
            ],
        };
        // SAFE: the service reads only getSettings() from SceneDataService
        const service = new SubplotManagementService(app, { getSettings: () => settings } as unknown as SceneDataService);
        return { service, settings };
    }

    it("renames the main plot in the active book only, on that book's profile", async () => {
        const frontmatter = {
            'Book A/1.md': { Class: 'Scene', Subplot: 'Main Plot' },
            'Book A/2.md': { Class: 'Scene' },
            'Book A/3.md': { Class: 'Scene', Subplot: ['Main Plot'] },
            'Book B/1.md': { Class: 'Scene', Subplot: ['Main Plot', 'Romance'] },
        };
        const { service, settings } = vaultWith(frontmatter);

        expect(service.countScenesListing('Main Plot')).toBe(2);
        const result = await service.renameSubplot('Main Plot', 'The Heist');

        expect(result).toEqual({ renamed: 2, failed: [] });
        expect(settings.books[0].mainPlotName).toBe('The Heist');
        expect(settings.books[1].mainPlotName).toBeUndefined();
        expect(frontmatter['Book A/1.md'].Subplot).toBe('The Heist');
        expect('Subplot' in frontmatter['Book A/2.md']).toBe(false);
        // A one-item list stays a list.
        expect(frontmatter['Book A/3.md'].Subplot).toEqual(['The Heist']);
        expect(frontmatter['Book B/1.md'].Subplot).toEqual(['Main Plot', 'Romance']);
    });

    it('keeps other renames in the active book and leaves the main plot name alone', async () => {
        const frontmatter = {
            'Book A/1.md': { Class: 'Scene', Subplot: 'Romance' },
            'Book B/1.md': { Class: 'Scene', Subplot: 'Romance' },
        };
        const { service, settings } = vaultWith(frontmatter);

        await service.renameSubplot('Romance', 'Courtship');

        expect(settings.books[0].mainPlotName).toBeUndefined();
        expect(frontmatter['Book A/1.md'].Subplot).toBe('Courtship');
        expect(frontmatter['Book B/1.md'].Subplot).toBe('Romance');
    });

    it('changes the main plot back when a scene cannot be updated, so ring 1 never splits', async () => {
        const frontmatter = {
            'Book A/1 Opening.md': { Class: 'Scene', Subplot: ['Main Plot', 'Romance'] },
            'Book A/2 Broken.md': { Class: 'Scene', Subplot: 'Main Plot' },
            'Book A/3 Close.md': { Class: 'Scene', Subplot: 'Main Plot' },
        };
        const { service, settings } = vaultWith(frontmatter, ['Book A/2 Broken.md']);

        const result = await service.renameSubplot('Main Plot', 'The Heist');

        expect(result).toEqual({ renamed: 0, failed: ['2 Broken'] });
        expect(settings.books[0].mainPlotName).toBeUndefined();
        expect(frontmatter['Book A/1 Opening.md'].Subplot).toEqual(['Main Plot', 'Romance']);
        expect(frontmatter['Book A/3 Close.md'].Subplot).toBe('Main Plot');
    });

    it('reports a subplot scene it could not update and still renames the rest', async () => {
        const frontmatter = {
            'Book A/1 Opening.md': { Class: 'Scene', Subplot: 'Romance' },
            'Book A/2 Broken.md': { Class: 'Scene', Subplot: 'Romance' },
        };
        const { service } = vaultWith(frontmatter, ['Book A/2 Broken.md']);

        expect(await service.renameSubplot('Romance', 'Courtship')).toEqual({ renamed: 1, failed: ['2 Broken'] });
        expect(frontmatter['Book A/1 Opening.md'].Subplot).toBe('Courtship');
    });

    it("never lets the main plot take another subplot's name", () => {
        const stats = [{ name: 'Main Plot', count: 3 }, { name: 'Romance', count: 2 }];
        expect(isSubplotNameTaken(stats, 'Main Plot', 'romance ')).toBe(true);
        expect(isSubplotNameTaken(stats, 'Main Plot', 'MAIN PLOT')).toBe(false);
        expect(isSubplotNameTaken(stats, 'Main Plot', 'The Heist')).toBe(false);
    });
});
