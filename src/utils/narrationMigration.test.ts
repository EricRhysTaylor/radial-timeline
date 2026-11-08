import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings } from '../types/settings';
import { readSceneNarration } from './frontmatter';
import { readFrontmatterText, frontmatterValues } from './frontmatterText';
import {
    booksNeedPovMigration,
    classifyPovField,
    pendingNoteMigrations,
    POV_TO_NARRATION_ALERT_ID,
    scenesNeedPovMigration,
    migratePovInContent,
    planPovToNarration,
    runPovToNarration,
    withNarrationTemplateField,
} from './narrationMigration';
import { getTemplateParts } from './yamlTemplateNormalize';

const note = (yaml: string, body = 'The scene.') => `---\n${yaml}\n---\n${body}\n`;

describe('POV → Narration is a rename', () => {
    it('renames a narration value, value, comment and place kept', () => {
        const before = note('Class: Scene\nCharacter:\n  - "[[Holmes]]"\nPOV: third limited # close on Holmes\nWords: 900');
        const { content, outcome } = migratePovInContent(before);
        expect(outcome).toEqual({ action: 'rename', value: 'third limited' });
        expect(content).toBe(note('Class: Scene\nCharacter:\n  - "[[Holmes]]"\nNarration: third limited # close on Holmes\nWords: 900'));
        expect(migratePovInContent(note('POV: two\nCharacter: [Ana, Ben]')).content).toBe(note('Narration: two\nCharacter: [Ana, Ben]'));
        expect(classifyPovField({ POV: 3 })).toEqual({ action: 'rename', value: '3' });
    });

    it('renames a character name with its value intact, never deleting it', () => {
        const named = note('Character: [Holmes, Watson]\nPOV: Dr. Watson');
        expect(migratePovInContent(named)).toEqual({ content: note('Character: [Holmes, Watson]\nNarration: Dr. Watson'), outcome: { action: 'rename', value: 'Dr. Watson' } });
        // Even the name of the scene's first character stays: the update deletes nothing.
        const first = note('Character:\n  - "[[Elizabeth Bennet]]"\nPOV: "[[Elizabeth Bennet]]"');
        expect(migratePovInContent(first).content).toBe(note('Character:\n  - "[[Elizabeth Bennet]]"\nNarration: "[[Elizabeth Bennet]]"'));
        // A list stays a list.
        expect(migratePovInContent(note('POV: [first, Elizabeth]')).content).toBe(note('Narration: [first, Elizabeth]'));
        // The timeline reads only a mode there, so a name falls back to the book's narration.
        expect(readSceneNarration({ Narration: 'Dr. Watson' })).toBeUndefined();
    });

    it('renames an empty POV to an empty Narration', () => {
        expect(migratePovInContent(note('Class: Scene\nPOV:\nWords: 10'))).toEqual({ content: note('Class: Scene\nNarration:\nWords: 10'), outcome: { action: 'rename', value: '' } });
        expect(classifyPovField({ POV: [] })).toEqual({ action: 'rename', value: '' });
    });

    it('renames into an empty Narration line, which holds nothing', () => {
        expect(migratePovInContent(note('Narration:\nPOV: first')).content).toBe(note('Narration: first'));
        expect(migratePovInContent(note('Narration:\nPOV:')).content).toBe(note('Narration:'));
    });

    it('drops an empty or identical POV beside an existing Narration', () => {
        expect(migratePovInContent(note('Narration: third\nPOV:'))).toEqual({ content: note('Narration: third'), outcome: { action: 'remove', reason: 'empty' } });
        expect(migratePovInContent(note('Narration: third\nPOV: third'))).toEqual({ content: note('Narration: third'), outcome: { action: 'remove', reason: 'sameAsNarration' } });
        expect(classifyPovField({ Narration: ['two', 'omni'], POV: ['two', 'omni'] })).toEqual({ action: 'remove', reason: 'sameAsNarration' });
    });

    it('leaves a POV that differs from an existing Narration untouched, for review', () => {
        const own = note('Narration: Read by Jim Dale\nPOV: first');
        expect(migratePovInContent(own)).toEqual({ content: own, outcome: { action: 'keep', value: 'first', narration: 'Read by Jim Dale' } });
        // Case counts as different: nothing is judged equal that the writer could tell apart.
        expect(classifyPovField({ Narration: 'third', POV: 'Third' })).toEqual({ action: 'keep', value: 'Third', narration: 'third' });
        // The timeline still reads the valid POV, not the writer's text.
        expect(readSceneNarration({ Narration: 'Read by Jim Dale', POV: 'first' })).toBe('first');
    });

    it('follows the author’s mapped names for POV and Narration', () => {
        const mappings = { Viewpoint: 'POV', Voice: 'Narration' };
        expect(migratePovInContent(note('Viewpoint: first'), mappings).content).toBe(note('Voice: first'));
        expect(migratePovInContent(note('Viewpoint: Mara\nVoice: first'), mappings).outcome).toEqual({ action: 'keep', value: 'Mara', narration: 'first' });
    });

    it('does nothing to a scene without POV', () => {
        const plain = note('Class: Scene\nNarration: first');
        expect(migratePovInContent(plain)).toEqual({ content: plain, outcome: null });
    });
});

describe('legacy POV reading until the migration', () => {
    it('reads Narration first, then the legacy POV', () => {
        expect(readSceneNarration({ POV: 'first' })).toBe('first');
        expect(readSceneNarration({ Narration: 'third', POV: 'first' })).toBe('third');
        expect(readSceneNarration({ Narration: '', POV: ['', 'omni'] })).toBe('omni');
        expect(readSceneNarration({ POV: 2 })).toBe('2');
        expect(readSceneNarration({})).toBeUndefined();
    });

    it('reads only a mode or count, skipping a name or the writer’s own text', () => {
        expect(readSceneNarration({ POV: 'Dr. Watson' })).toBeUndefined();
        expect(readSceneNarration({ Narration: 'Read by Jim Dale' })).toBeUndefined();
        expect(readSceneNarration({ Narration: ['Read by Jim Dale', 'omni'] })).toBe('omni');
        expect(readSceneNarration({ POV: 'Third Officer Ames' })).toBeUndefined();
    });
});

describe('scene templates', () => {
    it('write an empty Narration after Character for a new scene, and no POV', () => {
        const { base, merged } = getTemplateParts('Scene', DEFAULT_SETTINGS);
        expect(base).toMatch(/^Character: \{\{Character\}\}\nNarration:\n/m);
        expect(merged).not.toMatch(/^POV:/m);
    });

    it('rename POV to Narration when the alert is applied, and keep everything else', () => {
        const stored = { base: 'Class: Scene\nCharacter: {{Character}}\nPOV:\nWords:', advanced: 'Place:' };
        expect(withNarrationTemplateField(stored)).toEqual({ base: 'Class: Scene\nCharacter: {{Character}}\nNarration:\nWords:', advanced: 'Place:' });
        // A default value comes along; a second POV, or one beside Narration, is dropped.
        expect(withNarrationTemplateField({ base: 'Class: Scene\nPOV: third', advanced: 'Place:\nPOV: first' }))
            .toEqual({ base: 'Class: Scene\nNarration: third', advanced: 'Place:' });
        expect(withNarrationTemplateField({ base: 'Class: Scene\nNarration:\nPOV:', advanced: '' })).toEqual({ base: 'Class: Scene\nNarration:', advanced: '' });
    });

    it('add an empty Narration after Character to a template that has neither', () => {
        expect(withNarrationTemplateField({ base: 'Class: Scene\nCharacter: {{Character}}\nWords:', advanced: 'Place:' }))
            .toEqual({ base: 'Class: Scene\nCharacter: {{Character}}\nNarration:\nWords:', advanced: 'Place:' });
        expect(withNarrationTemplateField({ base: 'Class: Scene', advanced: '' })).toEqual({ base: 'Class: Scene\nNarration:', advanced: '' });
    });
});

describe('planning and applying the migration', () => {
    type FakeFile = TFile & { content: string };
    const file = (path: string, content: string): FakeFile => ({ path, basename: path.split('/').pop()!.replace(/\.md$/, ''), content } as FakeFile);
    const fakeApp = (files: FakeFile[]) => ({
        vault: {
            getMarkdownFiles: () => files,
            process: async (target: FakeFile, edit: (content: string) => string) => { target.content = edit(target.content); },
        },
        metadataCache: {
            getFileCache: (target: FakeFile) => {
                const text = readFrontmatterText(target.content);
                return text ? { frontmatter: frontmatterValues(text) } : null;
            },
        },
    }) as unknown as App;
    const settings = { ...DEFAULT_SETTINGS, books: [{ id: 'b', title: 'Book', sourceFolder: 'Book' }] } as RadialTimelineSettings;

    it('plans only scene notes in book folders, renames every POV and lists the ones that differ', async () => {
        const files = [
            file('Book/1.md', note('Class: Scene\nCharacter: [Holmes]\nPOV: first')),
            file('Book/2.md', note('Class: Scene\nCharacter: [Holmes]\nPOV: Holmes')),
            file('Book/3.md', note('Class: Scene\nCharacter: [Holmes]\nNarration: third\nPOV: Dr. Watson')),
            file('Book/4.md', note('Class: Scene\nNarration: omni\nPOV: omni')),
            file('Book/5.md', note('Class: Beat\nPOV: first')),
            file('Elsewhere/6.md', note('Class: Scene\nPOV: first')),
        ];
        const app = fakeApp(files);
        const plan = planPovToNarration(app, settings);
        expect(plan.files.map(f => f.path)).toEqual(['Book/1.md', 'Book/2.md', 'Book/4.md']);
        expect(plan).toMatchObject({ renames: 2, removals: 1 });
        expect(plan.kept.map(entry => [entry.file.path, entry.value, entry.narration])).toEqual([['Book/3.md', 'Dr. Watson', 'third']]);

        const result = await runPovToNarration(app, plan.files, settings);
        expect(result).toMatchObject({ renamed: 2, removed: 1, failed: 0 });
        expect(files[0].content).toBe(note('Class: Scene\nCharacter: [Holmes]\nNarration: first'));
        expect(files[1].content).toBe(note('Class: Scene\nCharacter: [Holmes]\nNarration: Holmes'));
        // Nothing is deleted when the values differ.
        expect(files[2].content).toBe(note('Class: Scene\nCharacter: [Holmes]\nNarration: third\nPOV: Dr. Watson'));
        expect(files[3].content).toBe(note('Class: Scene\nNarration: omni'));
        expect(files[4].content).toBe(note('Class: Beat\nPOV: first'));
        expect(files[5].content).toBe(note('Class: Scene\nPOV: first'));
    });

    it('finds scenes in any book that still need the update, and none for a POV left to review', () => {
        const storyVault = file('A/1.md', note('Class: Scene\nCharacter: ["[[Elizabeth Bennet]]"]\nPOV: "[[Elizabeth Bennet]]"'));
        const differs = file('B/1.md', note('Class: Scene\nCharacter: [Ames]\nNarration: third\nPOV: Third Officer Benwick'));
        const books = [{ id: 'a', title: 'A', sourceFolder: 'A' }, { id: 'b', title: 'B', sourceFolder: 'B' }];
        const withActive = (activeBookId: string) => ({ ...settings, books, activeBookId } as RadialTimelineSettings);
        // The alert is offered whichever book is active, as the update covers
        // every book (the saga timeline shows them all).
        const app = fakeApp([storyVault, differs]);
        expect(booksNeedPovMigration(app, withActive('a'))).toBe(true);
        expect(booksNeedPovMigration(app, withActive('b'))).toBe(true);
        expect([...pendingNoteMigrations(app, withActive('b'))]).toEqual([POV_TO_NARRATION_ALERT_ID]);
        // Only a POV to review: nothing for the update to do, so no alert or badge.
        const reviewOnly = fakeApp([differs]);
        expect(booksNeedPovMigration(reviewOnly, withActive('a'))).toBe(false);
        expect(pendingNoteMigrations(reviewOnly, withActive('a')).size).toBe(0);
        expect(scenesNeedPovMigration([{ POV: 'Dr. Watson' }, undefined])).toBe(true);
        expect(scenesNeedPovMigration([{ POV: '' }])).toBe(true);
        expect(scenesNeedPovMigration([{ Narration: 'third' }, {}])).toBe(false);
    });

    it('offers the alert exactly when applying it has something to do', () => {
        const books = [{ id: 'a', title: 'A', sourceFolder: 'A' }, { id: 'b', title: 'B', sourceFolder: 'B' }];
        const saga = { ...settings, books, activeBookId: 'a' } as RadialTimelineSettings;
        const app = fakeApp([file('B/1.md', note('Class: Scene\nPOV: first'))]);
        expect(planPovToNarration(app, saga).files.length > 0).toBe(booksNeedPovMigration(app, saga));
    });

    it('counts a planned scene that changed before the write as failed, not done', async () => {
        const scene = file('Book/1.md', note('Class: Scene\nPOV: first'));
        const app = fakeApp([scene]);
        const plan = planPovToNarration(app, settings);
        expect(plan.files).toHaveLength(1);
        // The writer adds a different Narration after the plan: both now stay.
        scene.content = note('Class: Scene\nNarration: third\nPOV: first');
        const result = await runPovToNarration(app, plan.files, settings);
        expect(result).toMatchObject({ renamed: 0, removed: 0, failed: 1 });
        expect(scene.content).toBe(note('Class: Scene\nNarration: third\nPOV: first'));

        // A planned note whose text no longer has frontmatter is not done either.
        const bare = file('Book/2.md', 'No properties any more.\n');
        expect((await runPovToNarration(fakeApp([bare]), [bare], settings)).failed).toBe(1);
    });

    it('reports a scene it could not change instead of skipping it quietly', async () => {
        // An anchored value is shared with another property, so it is never removed.
        const broken = file('Book/1.md', note('Class: Scene\nNarration: first\nPOV: &blank\nAlso: *blank'));
        const result = await runPovToNarration(fakeApp([broken]), [broken], settings);
        expect(result.failed).toBe(1);
        expect(broken.content).toBe(note('Class: Scene\nNarration: first\nPOV: &blank\nAlso: *blank'));
    });
});
