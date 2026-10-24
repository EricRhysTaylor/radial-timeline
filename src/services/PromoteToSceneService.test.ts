import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import type { RadialTimelineSettings, TimelineItem } from '../types';
import {
    applyPromotion,
    buildTemplateValues,
    classifyForPromotion,
    filenamePrefix,
    findMissingTemplateKeys,
    planPromotion,
    promotedBasename,
    templateKeysOf,
} from './PromoteToSceneService';
import { DEFAULT_SETTINGS } from '../settings/defaults';

vi.mock('../sceneProperties/sceneNormalizer', () => ({
    ensureSceneIds: vi.fn(async () => ({ updated: 0, skipped: 0, failed: 0, errors: [] })),
    reorderSceneFields: vi.fn(async () => ({ reordered: 0, skipped: 0, failed: 0, errors: [] })),
}));

import { ensureSceneIds, reorderSceneFields } from '../sceneProperties/sceneNormalizer';

const BASE_TEMPLATE = DEFAULT_SETTINGS.sceneYamlTemplates!.base;

function settingsWithBook(overrides: Partial<RadialTimelineSettings> = {}): RadialTimelineSettings {
    return {
        ...DEFAULT_SETTINGS,
        books: [{ id: 'b2', title: 'Book 2', sourceFolder: 'Book 2' }],
        activeBookId: 'b2',
        enableCustomMetadataMapping: false,
        ...overrides,
    } as RadialTimelineSettings;
}

/** An in-memory vault: frontmatter per path, with processFrontMatter and renameFile. */
function fakeApp(frontmatter: Record<string, Record<string, unknown> | undefined>, options: { failOn?: string } = {}) {
    const files = new Map<string, TFile>();
    const renames: Array<{ from: string; to: string }> = [];
    const app = {
        metadataCache: {
            getFileCache: (file: TFile) => {
                const fm = frontmatter[file.path];
                return fm ? { frontmatter: fm } : {};
            },
        },
        vault: {
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        },
        fileManager: {
            processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
                if (options.failOn === file.path) throw new Error('Malformed YAML');
                const fm = frontmatter[file.path] ?? {};
                fn(fm);
                frontmatter[file.path] = fm;
            },
            renameFile: async (file: TFile, to: string) => {
                renames.push({ from: file.path, to });
            },
        },
    } as unknown as App;
    const file = (path: string): TFile => {
        const created = new TFile(path);
        files.set(path, created);
        return created;
    };
    return { app, file, renames, frontmatter };
}

describe('classifyForPromotion', () => {
    it('accepts notes with no class and sketches', () => {
        expect(classifyForPromotion(undefined)).toEqual({ kind: 'eligible', fromSketch: false });
        expect(classifyForPromotion({ Synopsis: 'x' })).toEqual({ kind: 'eligible', fromSketch: false });
        expect(classifyForPromotion({ Class: 'Sketch' })).toEqual({ kind: 'eligible', fromSketch: true });
        expect(classifyForPromotion({ class: 'sketch' })).toEqual({ kind: 'eligible', fromSketch: true });
    });

    it('skips scenes and never converts other classes', () => {
        expect(classifyForPromotion({ Class: 'Scene' })).toEqual({ kind: 'alreadyScene' });
        expect(classifyForPromotion({ class: ['scene'] })).toEqual({ kind: 'alreadyScene' });
        expect(classifyForPromotion({ Class: 'Beat' })).toEqual({ kind: 'otherClass', className: 'Beat' });
        expect(classifyForPromotion({ Class: 'Frontmatter' })).toEqual({ kind: 'otherClass', className: 'Frontmatter' });
    });
});

describe('template helpers', () => {
    it('reads template keys in order', () => {
        const keys = templateKeysOf(BASE_TEMPLATE);
        expect(keys[0]).toBe('Class');
        expect(keys).toContain('Publish Stage');
        expect(keys.indexOf('Act')).toBeLessThan(keys.indexOf('Status'));
    });

    it('finds missing keys under any case and never reports Class', () => {
        const missing = findMissingTemplateKeys(
            ['Class', 'Act', 'Synopsis', 'Subplot', 'Publish Stage', 'Status'],
            { synopsis: 'x', 'publish stage': 'Zero', Subplot: ['Main Plot'] },
            undefined
        );
        expect(missing).toEqual(['Act', 'Status']);
    });

    it('treats a mapped custom key as present', () => {
        const missing = findMissingTemplateKeys(['Synopsis', 'Status'], { 'Scene Synopsis': 'x' }, { 'Scene Synopsis': 'Synopsis' });
        expect(missing).toEqual(['Status']);
    });

    it('reads the numeric filename prefix', () => {
        expect(filenamePrefix("67.4 Chelan's Revenge")).toBe('67.4');
        expect(filenamePrefix('1 Artifice Long Neglected')).toBe('1');
        expect(filenamePrefix('Dry Tank')).toBeNull();
    });

    it('fills template values from the given act, when and due date', () => {
        const values = buildTemplateValues(BASE_TEMPLATE, { act: 2, when: '2085-05-10', due: '2026-10-12' });
        expect(values.Act).toBe(2);
        expect(values.When).toBe('2085-05-10');
        expect(values.Due).toBe('2026-10-12');
        expect(values.Status).toBe('Todo');
        expect(values['Publish Stage']).toBe('Zero');
    });
});

describe('planPromotion', () => {
    it('sorts notes into entries and skips', () => {
        const { app, file } = fakeApp({
            'Book 2/78 Dry Tank.md': undefined,
            'Book 2/School by Cascade.md': { Class: 'Sketch', Act: 1 },
            'Book 2/90 Rescue.md': { Class: 'Scene' },
            'Book 2/2.01 SETUP.md': { Class: 'Beat' },
            'Elsewhere/Loose note.md': undefined,
        });
        const plan = planPromotion(app, settingsWithBook(), [
            file('Book 2/78 Dry Tank.md'),
            file('Book 2/School by Cascade.md'),
            file('Book 2/90 Rescue.md'),
            file('Book 2/2.01 SETUP.md'),
            file('Elsewhere/Loose note.md'),
            file('Book 2/cover.png'),
        ]);

        expect(plan.entries.map(entry => entry.file.basename)).toEqual(['78 Dry Tank', 'School by Cascade']);
        expect(plan.entries[0].prefix).toBe('78');
        expect(plan.entries[0].fromSketch).toBe(false);
        expect(plan.entries[0].missingCoreKeys).toContain('Act');
        expect(plan.entries[1].fromSketch).toBe(true);
        expect(plan.entries[1].prefix).toBeNull();
        expect(plan.entries[1].missingCoreKeys).not.toContain('Act');
        expect(plan.skipped.map(skip => [skip.file.basename, skip.reason])).toEqual([
            ['90 Rescue', 'alreadyScene'],
            ['2.01 SETUP', 'otherClass'],
            ['Loose note', 'notInBook'],
            ['cover', 'notMarkdown'],
        ]);
    });
});

describe('applyPromotion', () => {
    beforeEach(() => {
        vi.mocked(ensureSceneIds).mockClear();
        vi.mocked(reorderSceneFields).mockClear();
    });

    it('adds missing properties without overwriting the author\'s values', async () => {
        const { app, file, frontmatter } = fakeApp({
            'Book 2/68 Consortia Attack.md': { Synopsis: 'Consortia attacks.', Subplot: ['Entiat Chelan Arc'], Status: 'Complete', Act: 2 },
        });
        const note = file('Book 2/68 Consortia Attack.md');
        const settings = settingsWithBook();
        const plan = planPromotion(app, settings, [note]);
        const result = await applyPromotion(app, settings, plan, { advanced: false });

        const fm = frontmatter['Book 2/68 Consortia Attack.md']!;
        expect(result.promoted).toEqual([note]);
        expect(fm.Class).toBe('Scene');
        expect(fm.Synopsis).toBe('Consortia attacks.');
        expect(fm.Subplot).toEqual(['Entiat Chelan Arc']);
        expect(fm.Status).toBe('Complete');
        expect(fm['Publish Stage']).toBe('Zero');
        expect(fm.Chapter).toBeNull();
        expect(fm).not.toHaveProperty('Place');
        expect(ensureSceneIds).toHaveBeenCalledWith(expect.objectContaining({ files: [note] }));
        expect(reorderSceneFields).toHaveBeenCalledWith(expect.objectContaining({ files: [note] }));
    });

    it('turns a sketch into a scene, keeping the author\'s Class key casing', async () => {
        const { app, file, frontmatter } = fakeApp({ 'Book 2/School by Cascade.md': { class: 'Sketch', Act: 1 } });
        const note = file('Book 2/School by Cascade.md');
        const settings = settingsWithBook();
        await applyPromotion(app, settings, planPromotion(app, settings, [note]), { advanced: true });

        const fm = frontmatter['Book 2/School by Cascade.md']!;
        expect(fm.class).toBe('Scene');
        expect(fm).not.toHaveProperty('Class');
        expect(fm).toHaveProperty('Place');
    });

    it('numbers a single unnumbered note after the chosen scene', async () => {
        const { app, file, renames } = fakeApp({ 'Book 2/School by Cascade.md': { Class: 'Sketch' }, 'Book 2/68 Consortia Attack.md': { Class: 'Scene', Act: 1 }, 'Book 2/72 Entiat Returns.md': { Class: 'Scene', Act: 1 } });
        const note = file('Book 2/School by Cascade.md');
        file('Book 2/68 Consortia Attack.md');
        const sceneData = [
            { path: 'Book 2/68 Consortia Attack.md', itemType: 'Scene', actNumber: 1 },
            { path: 'Book 2/72 Entiat Returns.md', itemType: 'Scene', actNumber: 1 },
        ] as TimelineItem[];
        const settings = settingsWithBook();
        const result = await applyPromotion(app, settings, planPromotion(app, settings, [note]), {
            advanced: false,
            anchorPath: 'Book 2/68 Consortia Attack.md',
            sceneData,
        });

        expect(renames).toEqual([{ from: 'Book 2/School by Cascade.md', to: 'Book 2/70 School by Cascade.md' }]);
        expect(result.renamed).toEqual(renames);
    });

    it('gives an untitled sketch the typed title along with its new number', async () => {
        const { app, file, renames } = fakeApp({ 'Book 2/Untitled sketch.md': { Class: 'Sketch' }, 'Book 2/68 Consortia Attack.md': { Class: 'Scene', Act: 1 }, 'Book 2/72 Entiat Returns.md': { Class: 'Scene', Act: 1 } });
        const note = file('Book 2/Untitled sketch.md');
        file('Book 2/68 Consortia Attack.md');
        const sceneData = [
            { path: 'Book 2/68 Consortia Attack.md', itemType: 'Scene', actNumber: 1 },
            { path: 'Book 2/72 Entiat Returns.md', itemType: 'Scene', actNumber: 1 },
        ] as TimelineItem[];
        const settings = settingsWithBook();
        await applyPromotion(app, settings, planPromotion(app, settings, [note]), {
            advanced: false,
            anchorPath: 'Book 2/68 Consortia Attack.md',
            sceneData,
            title: 'The Lighthouse Stair',
        });

        expect(renames).toEqual([{ from: 'Book 2/Untitled sketch.md', to: 'Book 2/70 The Lighthouse Stair.md' }]);
    });

    it('renames nothing when there is neither a new number nor a title', async () => {
        const { app, file, renames } = fakeApp({ 'Book 2/School by Cascade.md': { Class: 'Sketch' } });
        const note = file('Book 2/School by Cascade.md');
        const settings = settingsWithBook();
        await applyPromotion(app, settings, planPromotion(app, settings, [note]), { advanced: false, title: null });

        expect(renames).toEqual([]);
    });

    it('reports a failing note and still promotes the rest', async () => {
        const { app, file } = fakeApp({ 'Book 2/A.md': undefined, 'Book 2/B.md': undefined }, { failOn: 'Book 2/A.md' });
        const a = file('Book 2/A.md');
        const b = file('Book 2/B.md');
        const settings = settingsWithBook();
        const result = await applyPromotion(app, settings, planPromotion(app, settings, [a, b]), { advanced: false });

        expect(result.promoted).toEqual([b]);
        expect(result.failed).toEqual([{ file: a, message: 'Malformed YAML' }]);
    });
});

describe('promotedBasename', () => {
    it('combines the new number, the kept number and the typed title', () => {
        expect(promotedBasename('Untitled sketch', '12.5', 'The Lighthouse Stair')).toBe('12.5 The Lighthouse Stair');
        expect(promotedBasename('12 Untitled sketch', null, 'The Lighthouse Stair')).toBe('12 The Lighthouse Stair');
        expect(promotedBasename('School by Cascade', '70', null)).toBe('70 School by Cascade');
        expect(promotedBasename('School by Cascade', null, null)).toBe('School by Cascade');
    });

    it('keeps the old name when the typed title has nothing usable', () => {
        expect(promotedBasename('Untitled sketch', null, '///')).toBe('Untitled sketch');
    });
});
