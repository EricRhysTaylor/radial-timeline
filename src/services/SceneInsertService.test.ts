import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { createInMemoryApp } from '../../tests/helpers/inMemoryObsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings, TimelineItem } from '../types';
import {
    buildDecimalSceneInsertionPrefix,
    isSafeSceneInsertionPrefix,
    insertSceneAfterAnchor,
    planActEndScenePrefixes
} from './SceneInsertService';

function settings(overrides: Partial<RadialTimelineSettings> = {}): RadialTimelineSettings {
    return {
        ...DEFAULT_SETTINGS,
        sceneYamlTemplates: { ...DEFAULT_SETTINGS.sceneYamlTemplates! },
        beatYamlTemplates: { ...DEFAULT_SETTINGS.beatYamlTemplates! },
        ...overrides
    };
}

function scene(path: string, actNumber = 1): TimelineItem {
    return {
        path,
        title: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
        date: '',
        itemType: 'Scene',
        act: String(actNumber),
        actNumber
    };
}

function beat(path: string, actNumber = 1): TimelineItem {
    return {
        path,
        title: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
        date: '',
        itemType: 'Beat',
        act: String(actNumber),
        actNumber
    };
}

describe('planActEndScenePrefixes', () => {
    const numbers = (planned: Map<string, string> | null) => planned ? [...planned.values()] : null;

    it('numbers a new book from 1, in the order given', () => {
        const planned = planActEndScenePrefixes([], new Map([[1, ['Lord Ashby.md', 'The butler.md', 'Inspector Vale.md']]]));
        expect([...planned!]).toEqual([['Lord Ashby.md', '1'], ['The butler.md', '2'], ['Inspector Vale.md', '3']]);
    });

    it('continues with whole numbers after the last scene of the book', () => {
        expect(numbers(planActEndScenePrefixes([scene('Book/40 End.md', 3)], new Map([[3, ['A.md', 'B.md']]])))).toEqual(['41', '42']);
    });

    it('uses whole numbers in a gap wide enough for them', () => {
        const items = [scene('Book/20 Last.md', 1), scene('Book/30 Next.md', 2)];
        expect(numbers(planActEndScenePrefixes(items, new Map([[1, ['A.md', 'B.md']]])))).toEqual(['21', '22']);
    });

    it('counts up in decimals between two acts, leaving the neighbouring scenes alone', () => {
        const items = [scene('Book/20 Last.md', 1), scene('Book/21 Next.md', 2)];
        expect(numbers(planActEndScenePrefixes(items, new Map([[1, ['A.md', 'B.md', 'C.md']]])))).toEqual(['20.1', '20.2', '20.3']);
    });

    it('stays in natural order past nine decimals', () => {
        const items = [scene('Book/20 Last.md', 1), scene('Book/21 Next.md', 2)];
        const paths = Array.from({ length: 11 }, (_, index) => `${index}.md`);
        const prefixes = numbers(planActEndScenePrefixes(items, new Map([[1, paths]])))!;
        expect(prefixes.slice(-3)).toEqual(['20.9', '20.10', '20.11']);
        expect([...prefixes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))).toEqual(prefixes);
    });

    it('follows the beats that close an act', () => {
        const items = [scene('Book/20 Last.md', 1), beat('Book/20.02 Break into Two.md', 1), scene('Book/21 Next.md', 2)];
        expect(numbers(planActEndScenePrefixes(items, new Map([[1, ['A.md']]])))).toEqual(['20.3']);
    });

    it('carries the count from one act into the next when both are new', () => {
        const planned = planActEndScenePrefixes([], new Map([[2, ['C.md']], [1, ['A.md', 'B.md']]]));
        expect(Object.fromEntries(planned!)).toEqual({ 'A.md': '1', 'B.md': '2', 'C.md': '3' });
    });

    it('is not held back by a later act that restarts its numbering', () => {
        const items = [scene('Book/20 Last.md', 1), scene('Book/1 Part Two.md', 2)];
        expect(numbers(planActEndScenePrefixes(items, new Map([[1, ['A.md']]])))).toEqual(['21']);
    });

    it('reports no room rather than sorting a scene into the wrong act', () => {
        const items = [scene('Book/20.5 Last.md', 1), scene('Book/20.6 Next.md', 2)];
        expect(planActEndScenePrefixes(items, new Map([[1, ['A.md']]]))).toBeNull();
    });
});

describe('SceneInsertService', () => {
    const today = new Date();
    const todayString = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0')
    ].join('-');

    it('builds a decimal scene prefix after the anchor beat gap', () => {
        const items = [
            scene('Book/1 Opening.md'),
            beat('Book/1.01 Opening Beat.md'),
            scene('Book/2 Next.md')
        ];

        expect(buildDecimalSceneInsertionPrefix(items, 'Book/1 Opening.md')).toBe('1.5');
    });

    it('bisects again when the next scene already holds the halfway decimal', () => {
        const items = [
            scene('Book/36 Bears Breakfast.md'),
            scene('Book/36.5 Sixteen.md'),
            scene('Book/37 Stage 2.md')
        ];

        expect(buildDecimalSceneInsertionPrefix(items, 'Book/36 Bears Breakfast.md')).toBe('36.25');
    });

    it('rejects a midpoint that sorts after the following scene', () => {
        const items = [scene('Book/12.5 A.md'), scene('Book/12.25 B.md'), scene('Book/13 C.md')];
        expect(isSafeSceneInsertionPrefix(items, 'Book/12.5 A.md', '12.75')).toBe(false);
        expect(isSafeSceneInsertionPrefix(items, 'Book/12.5 A.md', '12.10')).toBe(true);
    });

    it('creates a basic scene with copied When and one primary subplot', async () => {
        const app = createInMemoryApp({
            'Book/1 Opening.md': ['---', 'ID: scn_opening', 'Class: Scene', 'Act: 1', 'When: 2024-01-01 09:00', 'Subplot: Romance', '---', 'Body'].join('\n'),
            'Book/2 Next.md': ['---', 'ID: scn_next', 'Class: Scene', 'Act: 1', 'When: 2024-01-02', '---', 'Body'].join('\n')
        });
        const anchor = app.vault.getAbstractFileByPath('Book/1 Opening.md');
        expect(anchor).toBeInstanceOf(TFile);

        const result = await insertSceneAfterAnchor({
            app: app as never,
            settings: settings({ sceneAdvancedPropertiesEnabled: false, enableManuscriptRippleRename: false }),
            anchorFile: anchor as TFile,
            primarySubplot: 'Romance',
            getSceneData: async () => [scene('Book/1 Opening.md'), scene('Book/2 Next.md')]
        });

        expect(result.path).toBe('Book/1.5 New Scene.md');
        const created = app.vault.getAbstractFileByPath(result.path);
        expect(created).toBeInstanceOf(TFile);
        const content = await app.vault.read(created as TFile);
        expect(content).toContain('When: 2024-01-01 09:00');
        expect(content).toContain(`Due: ${todayString}`);
        expect(content).toContain('Subplot: Romance');
        expect(content).toContain('Total Time:');
        expect(content).not.toContain('Place:');
    });

    it('leaves Subplot blank for Main Plot insertion', async () => {
        const app = createInMemoryApp({
            'Book/1 Opening.md': ['---', 'ID: scn_opening', 'Class: Scene', 'Act: 1', 'When: 2024-01-01', '---', 'Body'].join('\n'),
            'Book/2 Next.md': ['---', 'ID: scn_next', 'Class: Scene', 'Act: 1', 'When: 2024-01-02', '---', 'Body'].join('\n')
        });
        const anchor = app.vault.getAbstractFileByPath('Book/1 Opening.md') as TFile;

        const result = await insertSceneAfterAnchor({
            app: app as never,
            settings: settings({ sceneAdvancedPropertiesEnabled: false }),
            anchorFile: anchor,
            primarySubplot: 'Main Plot',
            getSceneData: async () => [scene('Book/1 Opening.md'), scene('Book/2 Next.md')]
        });

        const created = app.vault.getAbstractFileByPath(result.path) as TFile;
        const content = await app.vault.read(created);
        expect(content).toMatch(/^Subplot:\s*$/m);
    });

    it('uses merged advanced scene YAML when advanced properties are maintained', async () => {
        const app = createInMemoryApp({
            'Book/1 Opening.md': ['---', 'ID: scn_opening', 'Class: Scene', 'Act: 1', 'When: 2024-01-01', '---', 'Body'].join('\n'),
            'Book/2 Next.md': ['---', 'ID: scn_next', 'Class: Scene', 'Act: 1', 'When: 2024-01-02', '---', 'Body'].join('\n')
        });
        const anchor = app.vault.getAbstractFileByPath('Book/1 Opening.md') as TFile;

        const result = await insertSceneAfterAnchor({
            app: app as never,
            settings: settings({ sceneAdvancedPropertiesEnabled: true }),
            anchorFile: anchor,
            primarySubplot: 'Main Plot',
            getSceneData: async () => [scene('Book/1 Opening.md'), scene('Book/2 Next.md')]
        });

        const created = app.vault.getAbstractFileByPath(result.path) as TFile;
        const content = await app.vault.read(created);
        expect(content).toContain('Place:');
        expect(content).toContain('Iteration:');
    });

    it('inserts a decimal and renames nothing even when manuscript ripple rename is on', async () => {
        const app = createInMemoryApp({
            'Book/1 Opening.md': ['---', 'ID: scn_opening', 'Class: Scene', 'Act: 1', 'When: 2024-01-01', '---', 'Body'].join('\n'),
            'Book/1.01 Opening Beat.md': ['---', 'ID: beat_opening', 'Class: Beat', 'Act: 1', 'Beat Model:', '---', 'Beat'].join('\n'),
            'Book/2 Next.md': ['---', 'ID: scn_next', 'Class: Scene', 'Act: 1', 'When: 2024-01-10', '---', 'Body'].join('\n')
        });
        const anchor = app.vault.getAbstractFileByPath('Book/1 Opening.md') as TFile;

        const result = await insertSceneAfterAnchor({
            app: app as never,
            settings: settings({ enableManuscriptRippleRename: true, sceneAdvancedPropertiesEnabled: false }),
            anchorFile: anchor,
            primarySubplot: 'Main Plot',
            getSceneData: async () => [
                scene('Book/1 Opening.md'),
                beat('Book/1.01 Opening Beat.md'),
                scene('Book/2 Next.md')
            ]
        });

        expect(result.path).toBe('Book/1.5 New Scene.md');
        expect(app.vault.getAbstractFileByPath('Book/1 Opening.md')).toBeInstanceOf(TFile);
        expect(app.vault.getAbstractFileByPath('Book/1.01 Opening Beat.md')).toBeInstanceOf(TFile);
        expect(app.vault.getAbstractFileByPath('Book/2 Next.md')).toBeInstanceOf(TFile);
        expect(app.vault.getAbstractFileByPath('Book/3 Next.md')).toBeNull();
        const inserted = app.vault.getAbstractFileByPath('Book/1.5 New Scene.md') as TFile;
        expect(await app.vault.read(inserted)).toContain('When: 2024-01-01');
    });
});
