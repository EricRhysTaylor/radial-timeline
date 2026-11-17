/**
 * Guards the model onboarding test vault (tests/fixtures/model-onboarding).
 * The live certification harness (src/ai/certification/featureCertification
 * .test.ts) runs on it by default, so it must stay loadable, small, and true
 * to its answer key: a planted fault edited out of the prose would make every
 * model look worse, and a dropped thread picked up again would make it vanish.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInMemoryApp } from './helpers/inMemoryObsidian';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { getAllSceneData } from '../src/sceneAnalysis/data';
import { readSceneId } from '../src/utils/sceneIds';
import { PLOT_SYSTEMS } from '../src/utils/beatsSystems';
import { countWords } from '../src/utils/text';

const FIXTURE_DIR = resolve(__dirname, 'fixtures', 'model-onboarding');
const BOOK = 'The Tidewater Ledger';
/** Keeps a full certification run cheap. Raise only with a reason. */
const MAX_SCENE_WORDS = 10_000;

type AnswerKey = {
    book: string;
    faults: {
        id: string;
        plantedIn: string[];
        plantText: string;
        keywords: string[];
        absentAfter?: { scene: string; terms: string[] };
    }[];
};

function loadBook(): Record<string, string> {
    const dir = join(FIXTURE_DIR, 'vault', BOOK);
    return Object.fromEntries(readdirSync(dir)
        .filter(name => name.endsWith('.md'))
        .map(name => [`${BOOK}/${name}`, readFileSync(join(dir, name), 'utf8')]));
}

async function loadScenes() {
    const app = createInMemoryApp(loadBook());
    const plugin = { app, settings: { ...structuredClone(DEFAULT_SETTINGS), sourcePath: BOOK } } as never;
    const scenes = await getAllSceneData(plugin, app.vault as never);
    return { app, scenes: scenes.sort((a, b) => Number(a.sceneNumber) - Number(b.sceneNumber)) };
}

describe('model onboarding test vault', () => {
    const key = JSON.parse(readFileSync(join(FIXTURE_DIR, 'answer-key.json'), 'utf8')) as AnswerKey;

    it('loads 12 scenes in story order, each with a unique ID, Act and When', async () => {
        const { scenes } = await loadScenes();
        expect(scenes.map(scene => scene.sceneNumber)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
        const ids = scenes.map(scene => readSceneId(scene.frontmatter));
        expect(new Set(ids).size).toBe(12);
        for (const scene of scenes) {
            expect(scene.frontmatter.Act, scene.file.path).toBeDefined();
            expect(String(scene.frontmatter.When), scene.file.path).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        }
        const whens = scenes.map(scene => String(scene.frontmatter.When));
        expect([...whens].sort()).toEqual(whens);
    });

    it('stays small enough to keep a certification run cheap', async () => {
        const { scenes } = await loadScenes();
        const words = scenes.reduce((sum, scene) => sum + countWords(scene.body), 0);
        expect(words).toBeLessThanOrEqual(MAX_SCENE_WORDS);
    });

    it('carries one note for every Save The Cat beat', async () => {
        const { app } = await loadScenes();
        const beats = app.vault.getMarkdownFiles()
            .map(file => app.metadataCache.getFileCache(file)?.frontmatter)
            .filter(fm => fm?.Class === 'Beat' && fm['Beat Model'] === 'Save The Cat');
        expect(beats).toHaveLength(PLOT_SYSTEMS['Save The Cat'].beatCount);
        for (const beat of beats) {
            expect(String(beat?.Purpose ?? '').length).toBeGreaterThan(0);
            expect(String(beat?.Range)).toMatch(/^\d+-\d+$/);
        }
    });

    it('keeps every planted fault in the prose, and abandoned threads abandoned', async () => {
        const { scenes } = await loadScenes();
        expect(key.book).toBe(BOOK);
        const byId = new Map(scenes.map(scene => [readSceneId(scene.frontmatter), scene]));
        for (const fault of key.faults) {
            for (const sceneId of fault.plantedIn) expect(byId.has(sceneId), `${fault.id}: ${sceneId}`).toBe(true);
            expect(byId.get(fault.plantedIn[0])?.body, fault.id).toContain(fault.plantText);
            expect(fault.keywords.length, fault.id).toBeGreaterThan(0);
            if (!fault.absentAfter) continue;
            const after = Number(byId.get(fault.absentAfter.scene)?.sceneNumber);
            for (const scene of scenes.filter(entry => Number(entry.sceneNumber) > after)) {
                for (const term of fault.absentAfter.terms) {
                    expect(scene.body.includes(term), `${fault.id}: "${term}" reappears in ${scene.file.basename}`).toBe(false);
                }
            }
        }
    });
});
