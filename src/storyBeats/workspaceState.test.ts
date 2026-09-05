import { describe, expect, it } from 'vitest';
import { TFolder } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings, SavedBeatSystem } from '../types/settings';
import { getBeatLibraryItems } from './libraryState';
import { activateLoadedBeatTab, autoAdoptDetectedBeatsIfEmpty, ensureBeatWorkspaceState, ensureMaterializedBeatWorkspaceState, getActiveLoadedBeatTab, getLoadedBeatTabs, getMaterializedBeatTabs, loadBeatTabFromLibraryItem, unloadBeatTab } from './workspaceState';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';

function buildSettings(): RadialTimelineSettings {
    return {
        ...DEFAULT_SETTINGS,
        books: [
            {
                id: 'book-1',
                title: 'Book One',
                sourceFolder: 'Books/One',
            },
        ],
        activeBookId: 'book-1',
    };
}

function buildBeatApp(frontmatters: Array<Record<string, unknown>>) {
    const files = frontmatters.map((frontmatter, index) => ({
        path: `Books/One/${index + 1}.md`,
        basename: typeof frontmatter.Title === 'string' ? String(frontmatter.Title) : `Beat ${index + 1}`,
    }));
    const folder = Object.assign(Object.create(TFolder.prototype), {
        path: 'Books/One',
        children: [],
    });
    return {
        vault: {
            getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string) => path === 'Books/One' ? folder : null,
        },
        metadataCache: {
            getFileCache: (file: typeof files[number]) => ({
                frontmatter: frontmatters[files.findIndex((entry) => entry.path === file.path)],
            }),
        },
    } as any;
}

describe('beat workspace initialization', () => {
    it('does not auto-seed tabs when no workspace or manuscript systems exist', () => {
        const settings = buildSettings();

        const workspace = ensureBeatWorkspaceState(settings);
        const loadedTabs = getLoadedBeatTabs(settings);

        expect(workspace.activeTabId).toBeUndefined();
        expect(loadedTabs).toHaveLength(0);
        expect(resolveSelectedBeatModelFromSettings(settings)).toBeUndefined();
    });

    it('materializes detected manuscript systems into the persisted workspace', () => {
        const settings = buildSettings();
        const app = buildBeatApp([
            {
                ID: 'classic-dramatic-structure:setup',
                Class: 'Beat',
                'Beat Model': 'Classic Dramatic Structure',
                Title: 'Setup',
                Act: 1,
            },
        ]);

        const workspace = ensureMaterializedBeatWorkspaceState(app, settings);
        const loadedTabs = getLoadedBeatTabs(settings);

        expect(workspace.activeTabId).toBeUndefined();
        expect(loadedTabs).toHaveLength(1);
        expect(loadedTabs[0].sourceKind).toBe('builtin');
        expect(loadedTabs[0].name).toBe('Classic Dramatic Structure');
        expect(getActiveLoadedBeatTab(settings)).toBeUndefined();
        expect(resolveSelectedBeatModelFromSettings(settings)).toBeUndefined();
    });
});

describe('fresh-vault beat adoption', () => {
    function beatNote(model: string, title: string, act: number): Record<string, unknown> {
        return { ID: `${model}:${title}`, Class: 'Beat', 'Beat Model': model, Title: title, Act: act };
    }

    it('adopts manuscript beats into an empty workspace and activates the dominant system', () => {
        const settings = buildSettings();
        // Mirrors the Pride & Prejudice vault: two canon systems present, Save
        // The Cat has more beat notes so it should win the active slot.
        const app = buildBeatApp([
            beatNote('Save The Cat', 'Opening Image', 1),
            beatNote('Save The Cat', 'Catalyst', 1),
            beatNote('Save The Cat', 'Midpoint', 2),
            beatNote('Classic Dramatic Structure', 'Setup', 1),
        ]);

        const result = autoAdoptDetectedBeatsIfEmpty(app, settings);
        const loadedTabs = getLoadedBeatTabs(settings);

        expect(result.changed).toBe(true);
        expect(result.activatedName).toBe('Save The Cat');
        // Both detected canon systems are loaded as tabs...
        expect(loadedTabs.map((tab) => tab.name).sort()).toEqual(['Classic Dramatic Structure', 'Save The Cat']);
        // ...and the dominant one is active.
        expect(getActiveLoadedBeatTab(settings)?.name).toBe('Save The Cat');
    });

    it('does nothing when the workspace already has loaded tabs', () => {
        const settings = buildSettings();
        const builtinItem = getBeatLibraryItems(settings).find((item) => item.kind === 'builtin' && item.name === 'Classic Dramatic Structure');
        loadBeatTabFromLibraryItem(settings, builtinItem!);
        const app = buildBeatApp([beatNote('Save The Cat', 'Opening Image', 1)]);

        const result = autoAdoptDetectedBeatsIfEmpty(app, settings);

        expect(result.changed).toBe(false);
        // The manuscript's Save The Cat beats were NOT auto-loaded over the user's choice.
        expect(getLoadedBeatTabs(settings).map((tab) => tab.name)).toEqual(['Classic Dramatic Structure']);
        expect(getActiveLoadedBeatTab(settings)?.name).toBe('Classic Dramatic Structure');
    });

    it('does nothing when the manuscript has no beat notes', () => {
        const settings = buildSettings();
        const app = buildBeatApp([{ Class: 'Scene', Title: 'Just a scene' }]);

        const result = autoAdoptDetectedBeatsIfEmpty(app, settings);

        expect(result.changed).toBe(false);
        expect(getLoadedBeatTabs(settings)).toHaveLength(0);
    });
});

describe('beat workspace loading', () => {
    it('prevents duplicate loads for the same library item', () => {
        const settings = buildSettings();

        const starterItem = getBeatLibraryItems(settings).find((item) => item.kind === 'starter');
        expect(starterItem).toBeTruthy();

        const firstLoad = loadBeatTabFromLibraryItem(settings, starterItem!);
        const secondLoad = loadBeatTabFromLibraryItem(settings, starterItem!);
        const loadedTabs = getLoadedBeatTabs(settings);

        expect(firstLoad.tabId).toBe(secondLoad.tabId);
        expect(loadedTabs.filter((tab) => tab.tabId === firstLoad.tabId)).toHaveLength(1);
    });

    it('uses the active loaded tab as the beat-model selector', () => {
        const settings = buildSettings();

        const starterItem = getBeatLibraryItems(settings).find((item) => item.kind === 'starter');
        expect(starterItem).toBeTruthy();

        const loaded = loadBeatTabFromLibraryItem(settings, starterItem!);

        expect(getActiveLoadedBeatTab(settings)?.tabId).toBe(loaded.tabId);
        expect(resolveSelectedBeatModelFromSettings(settings)).toBe(loaded.name);
    });

    it('can reactivate a previously loaded tab without fixed-tab state', () => {
        const settings = buildSettings();

        const builtinItem = getBeatLibraryItems(settings).find((item) => item.kind === 'builtin' && item.name === 'Classic Dramatic Structure');
        const starterItem = getBeatLibraryItems(settings).find((item) => item.kind === 'starter');
        expect(builtinItem).toBeTruthy();
        expect(starterItem).toBeTruthy();

        const builtinTab = loadBeatTabFromLibraryItem(settings, builtinItem!);
        const starterTab = loadBeatTabFromLibraryItem(settings, starterItem!);

        expect(resolveSelectedBeatModelFromSettings(settings)).toBe(starterTab.name);

        activateLoadedBeatTab(settings, builtinTab.tabId);

        expect(getActiveLoadedBeatTab(settings)?.tabId).toBe(builtinTab.tabId);
        expect(resolveSelectedBeatModelFromSettings(settings)).toBe('Classic Dramatic Structure');
    });

    it('restores the selected beat system for each book independently', () => {
        const settings: RadialTimelineSettings = {
            ...DEFAULT_SETTINGS,
            books: [
                { id: 'book-1', title: 'Book One', sourceFolder: 'Books/One' },
                { id: 'book-2', title: 'Book Two', sourceFolder: 'Books/Two' },
            ],
            activeBookId: 'book-1',
        };

        const cds = getBeatLibraryItems(settings).find((item) => item.kind === 'builtin' && item.name === 'Classic Dramatic Structure');
        const starter = getBeatLibraryItems(settings).find((item) => item.kind === 'starter');
        expect(cds).toBeTruthy();
        expect(starter).toBeTruthy();

        loadBeatTabFromLibraryItem(settings, cds!);
        expect(resolveSelectedBeatModelFromSettings(settings)).toBe('Classic Dramatic Structure');

        settings.activeBookId = 'book-2';
        loadBeatTabFromLibraryItem(settings, starter!);
        expect(resolveSelectedBeatModelFromSettings(settings)).toBe(starter!.name);

        settings.activeBookId = 'book-1';
        expect(resolveSelectedBeatModelFromSettings(settings)).toBe('Classic Dramatic Structure');
    });
});

describe('manuscript-detected beat tabs', () => {
    it('materializes recognized manuscript systems as canonical tabs', () => {
        const settings = buildSettings();
        const app = buildBeatApp([
            {
                ID: 'classic-dramatic-structure:setup',
                Class: 'Beat',
                'Beat Model': 'Classic Dramatic Structure',
                Title: 'Setup',
                Act: 1,
            },
        ]);

        const tabs = getMaterializedBeatTabs(app, settings);

        expect(tabs.map((tab) => tab.name)).toContain('Classic Dramatic Structure');
        expect(tabs.every((tab) => tab.name !== 'Save The Cat')).toBe(true);
        expect(tabs.find((tab) => tab.name === 'Classic Dramatic Structure')?.sourceKind).toBe('builtin');
    });

    it('resolves legacy Story Grid manuscript references to Classic Dramatic Structure', () => {
        const settings = buildSettings();
        const app = buildBeatApp([
            {
                ID: 'story-grid:inciting-incident',
                Class: 'Beat',
                'Beat Model': 'Story Grid',
                Title: 'Inciting Incident',
                Act: 1,
            },
        ]);

        const tabs = getMaterializedBeatTabs(app, settings);
        const matched = tabs.find((tab) => tab.name === 'Classic Dramatic Structure');

        expect(matched).toBeTruthy();
        expect(matched?.sourceKind).toBe('builtin');
    });

    it('materializes unknown manuscript systems as detected generic tabs', () => {
        const settings = buildSettings();
        const app = buildBeatApp([
            {
                ID: 'beat-1',
                Class: 'Beat',
                'Beat Model': 'Historical Spiral',
                Title: 'Archive Shock',
                Act: 2,
                Purpose: 'The thesis turns.',
            },
        ]);

        const tabs = getMaterializedBeatTabs(app, settings);
        const detectedTab = tabs.find((tab) => tab.name === 'Historical Spiral');

        expect(detectedTab).toBeTruthy();
        expect(detectedTab?.sourceKind).toBe('detected');
        expect(detectedTab?.description).toBe('No matching system definition found.');
        expect(detectedTab?.beats).toHaveLength(1);
        expect(detectedTab?.beats[0].name).toBe('Archive Shock');
    });

    it('does not auto-select a detected manuscript tab when bootstrapped into workspace', () => {
        const settings = buildSettings();
        const app = buildBeatApp([
            {
                ID: 'beat-1',
                Class: 'Beat',
                'Beat Model': 'Historical Spiral',
                Title: 'Archive Shock',
                Act: 2,
            },
        ]);

        ensureMaterializedBeatWorkspaceState(app, settings);

        expect(getActiveLoadedBeatTab(settings)).toBeUndefined();
        expect(resolveSelectedBeatModelFromSettings(settings)).toBeUndefined();
        expect(getLoadedBeatTabs(settings).map((tab) => tab.name)).toContain('Historical Spiral');
    });
});

describe('unloadBeatTab (safe close)', () => {
    it('removes the tab from workspace without affecting other tabs', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const cds = items.find((item) => item.kind === 'builtin' && item.name === 'Classic Dramatic Structure')!;
        const starter = items.find((item) => item.kind === 'starter')!;

        loadBeatTabFromLibraryItem(settings, cds);
        const starterTab = loadBeatTabFromLibraryItem(settings, starter);

        expect(getLoadedBeatTabs(settings)).toHaveLength(2);

        unloadBeatTab(settings, starterTab.tabId);

        const remaining = getLoadedBeatTabs(settings);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].name).toBe('Classic Dramatic Structure');
    });

    it('selects the next tab when the active tab is closed', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const cds = items.find((item) => item.kind === 'builtin' && item.name === 'Classic Dramatic Structure')!;
        const starter = items.find((item) => item.kind === 'starter')!;

        const cdsTab = loadBeatTabFromLibraryItem(settings, cds);
        loadBeatTabFromLibraryItem(settings, starter);

        activateLoadedBeatTab(settings, cdsTab.tabId);
        expect(getActiveLoadedBeatTab(settings)?.tabId).toBe(cdsTab.tabId);

        const nextActiveId = unloadBeatTab(settings, cdsTab.tabId);

        expect(getLoadedBeatTabs(settings)).toHaveLength(1);
        expect(nextActiveId).toBeDefined();
        expect(getActiveLoadedBeatTab(settings)?.name).toBe(starter.name);
    });

    it('returns undefined when the last tab is closed', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const starter = items.find((item) => item.kind === 'starter')!;

        const tab = loadBeatTabFromLibraryItem(settings, starter);
        const nextActiveId = unloadBeatTab(settings, tab.tabId);

        expect(getLoadedBeatTabs(settings)).toHaveLength(0);
        expect(nextActiveId).toBeUndefined();
        expect(getActiveLoadedBeatTab(settings)).toBeUndefined();
    });

    it('is a no-op for an unknown tab id', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const starter = items.find((item) => item.kind === 'starter')!;

        const tab = loadBeatTabFromLibraryItem(settings, starter);
        const result = unloadBeatTab(settings, 'nonexistent-tab-id');

        expect(getLoadedBeatTabs(settings)).toHaveLength(1);
        expect(getActiveLoadedBeatTab(settings)?.tabId).toBe(tab.tabId);
        expect(result).toBe(tab.tabId);
    });

    it('does not touch beat system configs — only removes the workspace tab', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const starter = items.find((item) => item.kind === 'starter')!;

        const tab = loadBeatTabFromLibraryItem(settings, starter);
        const configsBefore = JSON.stringify(settings.beatSystemConfigs);

        unloadBeatTab(settings, tab.tabId);

        expect(JSON.stringify(settings.beatSystemConfigs)).toBe(configsBefore);
        expect(getLoadedBeatTabs(settings)).toHaveLength(0);
    });

    it('unloading multiple tabs sequentially leaves workspace empty', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const cds = items.find((item) => item.kind === 'builtin' && item.name === 'Classic Dramatic Structure')!;
        const starter = items.find((item) => item.kind === 'starter')!;

        loadBeatTabFromLibraryItem(settings, cds);
        const starterTab = loadBeatTabFromLibraryItem(settings, starter);

        const cdsTab = getLoadedBeatTabs(settings).find((t) => t.name === 'Classic Dramatic Structure')!;
        unloadBeatTab(settings, cdsTab.tabId);

        expect(getLoadedBeatTabs(settings)).toHaveLength(1);
        expect(getActiveLoadedBeatTab(settings)?.tabId).toBe(starterTab.tabId);
        expect(resolveSelectedBeatModelFromSettings(settings)).toBe(starter.name);

        const configsAfterClose = JSON.stringify(settings.beatSystemConfigs);

        unloadBeatTab(settings, starterTab.tabId);
        expect(getLoadedBeatTabs(settings)).toHaveLength(0);
        expect(JSON.stringify(settings.beatSystemConfigs)).toBe(configsAfterClose);
    });
});

describe('library catalog structure', () => {
    it('all library items have a category field', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);

        for (const item of items) {
            expect(item.category).toBeDefined();
            expect(['narrative', 'engine', 'format', 'saved', 'blank']).toContain(item.category);
        }
    });

    it('Classic Dramatic Structure appears in the catalog with narrative category', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const cds = items.find((item) => item.name === 'Classic Dramatic Structure');

        expect(cds).toBeTruthy();
        expect(cds?.kind).toBe('builtin');
        expect(cds?.category).toBe('narrative');
    });

    it('no library item is named Story Grid', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const sg = items.find((item) => item.name === 'Story Grid');

        expect(sg).toBeUndefined();
    });

    it('Classic Dramatic Structure uses neutral beat labels', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const cds = items.find((item) => item.name === 'Classic Dramatic Structure')!;

        const beatNames = cds.beats.map((b) => b.name);
        expect(beatNames).toEqual(['Setup', 'Complication', 'Pressure', 'Pivotal Choice', 'Outcome']);
    });

    it('categories are correctly assigned across all library items', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);

        const narrativeItems = items.filter((i) => i.category === 'narrative');
        const engineItems = items.filter((i) => i.category === 'engine');
        const formatItems = items.filter((i) => i.category === 'format');
        const blankItems = items.filter((i) => i.category === 'blank');

        expect(narrativeItems.map((i) => i.name).sort()).toEqual(['Classic Dramatic Structure', "Hero's Journey", 'Save The Cat']);
        expect(engineItems.map((i) => i.name).sort()).toEqual(['Romance Tropes Ladder', 'Thriller Escalation Ladder']);
        expect(formatItems.map((i) => i.name).sort()).toEqual(['Documentary Narrative Arc', 'Podcast Narrative Arc', 'YouTube Explainer Arc']);
        expect(blankItems).toHaveLength(1);
        expect(blankItems[0].name).toBe('Blank custom');
    });

    it('every built-in and starter library item includes a valid icon', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const libraryItems = items.filter((i) => i.kind === 'builtin' || i.kind === 'starter');

        expect(libraryItems.length).toBeGreaterThan(0);
        for (const item of libraryItems) {
            expect(typeof item.icon).toBe('string');
            expect(item.icon!.length).toBeGreaterThan(0);
        }
    });

    it('blank library item uses square icon', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);
        const blank = items.find((i) => i.kind === 'blank');

        expect(blank).toBeDefined();
        expect(blank!.icon).toBe('square');
    });

    it('no user-visible library item name contains Story Grid or grid', () => {
        const settings = buildSettings();
        const items = getBeatLibraryItems(settings);

        for (const item of items) {
            expect(item.name.toLowerCase()).not.toContain('story grid');
            expect(item.name.toLowerCase()).not.toContain('grid');
        }
    });

    it('fresh vault shows only Add system with no preloaded tabs', () => {
        const settings = buildSettings();
        const workspace = ensureBeatWorkspaceState(settings);
        const tabs = getLoadedBeatTabs(settings);

        expect(workspace.activeTabId).toBeUndefined();
        expect(tabs).toHaveLength(0);
    });
});
