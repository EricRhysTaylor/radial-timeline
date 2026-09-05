import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { updateSceneWordCounts } from './manuscript';

function makeApp(frontmatterByPath: Record<string, Record<string, unknown>>): App {
    return {
        fileManager: {
            processFrontMatter: async (file: TFile, cb: (fm: Record<string, unknown>) => void) => {
                const fm = frontmatterByPath[file.path] ?? {};
                frontmatterByPath[file.path] = fm;
                cb(fm);
            }
        }
    } as unknown as App;
}

describe('updateSceneWordCounts', () => {
    it('updates scene notes and skips matter/beat classes without deleting fields', async () => {
        const matterFile = makeFile('Story/0.01 Front Matter.md');
        const sceneFile = makeFile('Story/1 Scene.md');
        const beatFile = makeFile('Story/5 Midpoint Beat.md');

        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [matterFile.path]: { Class: 'Matter', Words: 99 },
            [sceneFile.path]: { Class: 'Scene' },
            [beatFile.path]: { Class: 'Beat' }
        };

        const app = makeApp(frontmatterByPath);
        const updated = await updateSceneWordCounts(
            app,
            [matterFile, sceneFile, beatFile],
            [
                { title: 'matter', bodyText: '', wordCount: 11 },
                { title: 'scene', bodyText: '', wordCount: 22 },
                { title: 'beat', bodyText: '', wordCount: 33 }
            ]
        );

        expect(updated).toBe(1);
        expect(frontmatterByPath[matterFile.path].Words).toBe(99);
        expect(frontmatterByPath[beatFile.path].Words).toBeUndefined();
        expect(frontmatterByPath[sceneFile.path].Words).toBe(22);
    });

    it('preserves existing words key casing', async () => {
        const sceneFile = makeFile('Story/2 Lowercase Words Scene.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [sceneFile.path]: { class: 'scene', words: 5 }
        };

        const app = makeApp(frontmatterByPath);
        const updated = await updateSceneWordCounts(
            app,
            [sceneFile],
            [{ title: 'scene', bodyText: '', wordCount: 77 }]
        );

        expect(updated).toBe(1);
        expect(frontmatterByPath[sceneFile.path].words).toBe(77);
        expect(frontmatterByPath[sceneFile.path].Words).toBeUndefined();
    });

    it('updates notes without a class field (legacy scene fallback)', async () => {
        const legacyFile = makeFile('Story/3 Legacy Scene.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [legacyFile.path]: {}
        };

        const app = makeApp(frontmatterByPath);
        const updated = await updateSceneWordCounts(
            app,
            [legacyFile],
            [{ title: 'legacy', bodyText: '', wordCount: 101 }]
        );

        expect(updated).toBe(1);
        expect(frontmatterByPath[legacyFile.path].Words).toBe(101);
    });

    it('matches assembled scene word counts by source path when synthetic BookMeta pages precede scenes', async () => {
        const sceneFile = makeFile('Story/1 Opening.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [sceneFile.path]: { Class: 'Scene' }
        };

        const app = makeApp(frontmatterByPath);
        const updated = await updateSceneWordCounts(
            app,
            [sceneFile],
            [
                { title: 'Title Page', bodyText: '', wordCount: 8 },
                { title: 'Copyright', bodyText: '', wordCount: 12 },
                { title: '1 Opening', bodyText: '', wordCount: 345, sourcePath: sceneFile.path }
            ]
        );

        expect(updated).toBe(1);
        expect(frontmatterByPath[sceneFile.path].Words).toBe(345);
    });
});
