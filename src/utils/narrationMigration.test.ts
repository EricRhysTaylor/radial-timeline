import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings } from '../types/settings';
import { readSceneNarration } from './frontmatter';
import { readFrontmatterText, frontmatterValues } from './frontmatterText';
import {
    classifyPovField,
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

    it('leaves POV when Narration already says something, and replaces a blank Narration', () => {
        expect(classifyPovField({ POV: 'first', Narration: 'third' })).toEqual({ action: 'keep', value: 'first', reason: 'narrationSet' });
        expect(migratePovInContent(note('Narration:\nPOV: first')).content).toBe(note('Narration: first'));
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

    it('still reads a name, which resolution then ignores', () => {
        expect(readSceneNarration({ POV: 'Dr. Watson' })).toBe('Dr. Watson');
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
        expect(plan.kept.map(entry => [entry.file.path, entry.value])).toEqual([['Book/3.md', 'Dr. Watson']]);

        const result = await runPovToNarration(app, plan.files, settings);
        expect(result).toMatchObject({ moved: 1, removed: 1, failed: 0 });
        expect(files[0].content).toBe(note('Class: Scene\nCharacter: [Holmes]\nNarration: first'));
        expect(files[1].content).toBe(note('Class: Scene\nCharacter: [Holmes]'));
        expect(files[2].content).toBe(note('Class: Scene\nCharacter: [Holmes]\nPOV: Dr. Watson'));
        expect(files[3].content).toBe(note('Class: Beat\nPOV: first'));
    });

    it('reports a scene it could not change instead of skipping it quietly', async () => {
        // An anchored value is shared with another property, so it is never removed.
        const broken = file('Book/1.md', note('Class: Scene\nPOV: &blank\nAlso: *blank'));
        const result = await runPovToNarration(fakeApp([broken]), [broken], settings);
        expect(result.failed).toBe(1);
        expect(broken.content).toBe(note('Class: Scene\nPOV: &blank\nAlso: *blank'));
    });
});
