import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { createInMemoryApp } from '../../tests/helpers/inMemoryObsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings, TimelineItem } from '../types';
import {
    buildDecimalSceneInsertionPrefix,
    insertSceneAfterAnchor
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
