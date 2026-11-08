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
    withoutPovTemplateField,
} from './narrationMigration';
import { getTemplateParts } from './yamlTemplateNormalize';

const note = (yaml: string, body = 'The scene.') => `---\n${yaml}\n---\n${body}\n`;

describe('POV → Narration value rules', () => {
    it('moves a mode or a count to Narration, value, comment and place kept', () => {
        const before = note('Class: Scene\nCharacter:\n  - "[[Holmes]]"\nPOV: third limited # close on Holmes\nWords: 900');
        const { content, outcome } = migratePovInContent(before);
        expect(outcome).toEqual({ action: 'move', value: 'third limited' });
        expect(content).toBe(note('Class: Scene\nCharacter:\n  - "[[Holmes]]"\nNarration: third limited # close on Holmes\nWords: 900'));

        expect(migratePovInContent(note('POV: two\nCharacter: [Ana, Ben]')).content).toBe(note('Narration: two\nCharacter: [Ana, Ben]'));
        expect(classifyPovField({ POV: 3 })).toEqual({ action: 'move', value: '3' });
        expect(classifyPovField({ POV: 'Omniscient' })).toEqual({ action: 'move', value: 'Omniscient' });
    });

    it('removes an empty POV and one that repeats the first character', () => {
        expect(migratePovInContent(note('Class: Scene\nPOV:\nWords: 10')).content).toBe(note('Class: Scene\nWords: 10'));
        expect(classifyPovField({ POV: '  ' })).toEqual({ action: 'remove', reason: 'empty' });
        expect(classifyPovField({ POV: [] })).toEqual({ action: 'remove', reason: 'empty' });
        const redundant = note('Character:\n  - "[[Elizabeth Bennet]]"\n  - Darcy\nPOV: "[[Elizabeth Bennet]]"');
        const migrated = migratePovInContent(redundant);
        expect(migrated.outcome).toEqual({ action: 'remove', reason: 'firstCharacter' });
        expect(migrated.content).toBe(note('Character:\n  - "[[Elizabeth Bennet]]"\n  - Darcy'));
    });

    it('never carries a name into Narration: other names stay under POV, listed for review', () => {
        const named = note('Character: [Holmes, Watson]\nPOV: Dr. Watson');
        const migrated = migratePovInContent(named);
        expect(migrated.outcome).toEqual({ action: 'keep', value: 'Dr. Watson', reason: 'name' });
        expect(migrated.content).toBe(named);
        // A listed character is a name even when it starts like a mode.
        expect(classifyPovField({ Character: ['Holmes', 'Third Officer Ames'], POV: 'Third Officer Ames' }))
            .toEqual({ action: 'keep', value: 'Third Officer Ames', reason: 'name' });
        // Several entries are not one narration value.
        expect(classifyPovField({ POV: ['first', 'Elizabeth'] })).toEqual({ action: 'keep', value: 'first, Elizabeth', reason: 'name' });
    });

    it('keeps a name that starts with a mode word even when nobody lists it', () => {
        const unlisted = note('Character: [Holmes]\nPOV: Third Officer Ames');
        expect(migratePovInContent(unlisted)).toEqual({ content: unlisted, outcome: { action: 'keep', value: 'Third Officer Ames', reason: 'name' } });
        expect(classifyPovField({ POV: 'first (Watson)' })).toEqual({ action: 'keep', value: 'first (Watson)', reason: 'name' });
        expect(classifyPovField({ POV: 'third person limited' })).toEqual({ action: 'move', value: 'third person limited' });
    });

    it('removes the first character by link target, alias or text, ignoring case', () => {
        expect(classifyPovField({ Character: ['[[Mr. Bennet]]', 'Jane'], POV: '[[Mr. Bennet|Papa]]' })).toEqual({ action: 'remove', reason: 'firstCharacter' });
        expect(classifyPovField({ Character: ['[[Elizabeth Bennet]]'], POV: 'elizabeth bennet' })).toEqual({ action: 'remove', reason: 'firstCharacter' });
        expect(classifyPovField({ Character: ['[[People/Mr. Darcy|Darcy]]'], POV: 'darcy' })).toEqual({ action: 'remove', reason: 'firstCharacter' });
        expect(classifyPovField({ Character: ['Jane', '[[Mr. Bennet]]'], POV: 'mr. bennet' })).toEqual({ action: 'keep', value: 'mr. bennet', reason: 'name' });
    });

    it('leaves POV when Narration already says something, and replaces a blank Narration', () => {
        expect(classifyPovField({ POV: 'first', Narration: 'third' })).toEqual({ action: 'keep', value: 'first', reason: 'narrationSet' });
        expect(migratePovInContent(note('Narration:\nPOV: first')).content).toBe(note('Narration: first'));
    });

    it('keeps the writer’s own Narration text untouched, and the POV beside it', () => {
        const own = note('Narration: Read by Jim Dale\nPOV: first');
        expect(migratePovInContent(own)).toEqual({ content: own, outcome: { action: 'keep', value: 'first', reason: 'narrationTaken' } });
        // The timeline still reads the valid POV, not the writer's text.
        expect(readSceneNarration({ Narration: 'Read by Jim Dale', POV: 'first' })).toBe('first');
    });

    it('follows the author’s mapped names for POV and Narration', () => {
        const mappings = { Viewpoint: 'POV', Voice: 'Narration' };
        expect(migratePovInContent(note('Viewpoint: first'), mappings).content).toBe(note('Voice: first'));
        expect(migratePovInContent(note('Viewpoint: Mara\nCharacter: Ines'), mappings).outcome).toEqual({ action: 'keep', value: 'Mara', reason: 'name' });
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
    it('no longer write POV for a new scene', () => {
        const { base, merged } = getTemplateParts('Scene', DEFAULT_SETTINGS);
        expect(base).not.toMatch(/^POV:/m);
        expect(merged).not.toMatch(/^(POV|Narration):/m);
    });

    it('lose POV when the alert is applied, and keep everything else', () => {
        const stored = { base: 'Class: Scene\nCharacter: {{Character}}\nPOV:\nWords:', advanced: 'Place:\nPOV: third' };
        expect(withoutPovTemplateField(stored)).toEqual({ base: 'Class: Scene\nCharacter: {{Character}}\nWords:', advanced: 'Place:' });
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

    it('plans only scene notes in book folders and lists the names it leaves', async () => {
        const files = [
            file('Book/1.md', note('Class: Scene\nCharacter: [Holmes]\nPOV: first')),
            file('Book/2.md', note('Class: Scene\nCharacter: [Holmes]\nPOV: Holmes')),
            file('Book/3.md', note('Class: Scene\nCharacter: [Holmes]\nPOV: Dr. Watson')),
            file('Book/4.md', note('Class: Beat\nPOV: first')),
            file('Elsewhere/5.md', note('Class: Scene\nPOV: first')),
        ];
        const app = fakeApp(files);
        const plan = planPovToNarration(app, settings);
        expect(plan.files.map(f => f.path)).toEqual(['Book/1.md', 'Book/2.md']);
        expect(plan).toMatchObject({ moves: 1, removals: 1 });
        expect(plan.kept.map(entry => [entry.file.path, entry.value, entry.reason])).toEqual([['Book/3.md', 'Dr. Watson', 'name']]);

        const result = await runPovToNarration(app, plan.files, settings);
        expect(result).toMatchObject({ moved: 1, removed: 1, failed: 0 });
        expect(files[0].content).toBe(note('Class: Scene\nCharacter: [Holmes]\nNarration: first'));
        expect(files[1].content).toBe(note('Class: Scene\nCharacter: [Holmes]'));
        expect(files[2].content).toBe(note('Class: Scene\nCharacter: [Holmes]\nPOV: Dr. Watson'));
        expect(files[3].content).toBe(note('Class: Beat\nPOV: first'));
    });

    it('finds scenes in any book that still need the update, and none for a kept name', () => {
        const storyVault = file('A/1.md', note('Class: Scene\nCharacter: ["[[Elizabeth Bennet]]"]\nPOV: "[[Elizabeth Bennet]]"'));
        const keptName = file('B/1.md', note('Class: Scene\nCharacter: [Ames]\nPOV: Third Officer Benwick'));
        const books = [{ id: 'a', title: 'A', sourceFolder: 'A' }, { id: 'b', title: 'B', sourceFolder: 'B' }];
        const withActive = (activeBookId: string) => ({ ...settings, books, activeBookId } as RadialTimelineSettings);
        // The Story Vault case: POV repeats the first character, so the update
        // removes it. The alert is offered whichever book is active, as the
        // update covers every book (the saga timeline shows them all).
        const app = fakeApp([storyVault, keptName]);
        expect(booksNeedPovMigration(app, withActive('a'))).toBe(true);
        expect(booksNeedPovMigration(app, withActive('b'))).toBe(true);
        expect([...pendingNoteMigrations(app, withActive('b'))]).toEqual([POV_TO_NARRATION_ALERT_ID]);
        // Only a name to review: nothing for the update to do, so no alert.
        const namesOnly = fakeApp([keptName]);
        expect(booksNeedPovMigration(namesOnly, withActive('a'))).toBe(false);
        expect(pendingNoteMigrations(namesOnly, withActive('a')).size).toBe(0);
        expect(scenesNeedPovMigration([{ POV: 'first' }, undefined])).toBe(true);
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
        // The writer edits the scene after the plan: POV now names someone.
        scene.content = note('Class: Scene\nPOV: Dr. Watson');
        const result = await runPovToNarration(app, plan.files, settings);
        expect(result).toMatchObject({ moved: 0, removed: 0, failed: 1 });
        expect(scene.content).toBe(note('Class: Scene\nPOV: Dr. Watson'));

        // A planned note whose text no longer has frontmatter is not done either.
        const bare = file('Book/2.md', 'No properties any more.\n');
        expect((await runPovToNarration(fakeApp([bare]), [bare], settings)).failed).toBe(1);
    });

    it('reports a scene it could not change instead of skipping it quietly', async () => {
        // An anchored value is shared with another property, so it is never removed.
        const broken = file('Book/1.md', note('Class: Scene\nPOV: &blank\nAlso: *blank'));
        const result = await runPovToNarration(fakeApp([broken]), [broken], settings);
        expect(result.failed).toBe(1);
        expect(broken.content).toBe(note('Class: Scene\nPOV: &blank\nAlso: *blank'));
    });
});
