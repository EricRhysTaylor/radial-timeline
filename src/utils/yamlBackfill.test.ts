import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { App, TFile } from 'obsidian';
import { normalizeDefault, planDeprecatedFieldMigration, planFillEmptyValues, runBackdropSynopsisToContextMigration, runBeatDescriptionToPurposeMigration, runYamlBackfill, runYamlFillEmptyValues } from './yamlBackfill';

function makeApp(frontmatterByPath: Record<string, Record<string, unknown>>): App {
    return {
        vault: {
            process: async (file: TFile, cb: (content: string) => string) => {
                const next = cb(`---\n${stringify(frontmatterByPath[file.path] ?? {})}---\nBody`);
                frontmatterByPath[file.path] = parse(next.split('---')[1]) as Record<string, unknown>;
            }
        },
        fileManager: {
            processFrontMatter: async (file: TFile, cb: (fm: Record<string, unknown>) => void) => {
                const fm = frontmatterByPath[file.path] ?? {};
                frontmatterByPath[file.path] = fm;
                cb(fm);
            }
        }
    } as unknown as App;
}

describe('runBeatDescriptionToPurposeMigration', () => {
    it('moves Description to Purpose when Purpose is empty and removes Description', async () => {
        const file = makeFile('Story/10.01 Beat.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [file.path]: { Class: 'Beat', Description: 'Legacy value', Purpose: '' }
        };
        const app = makeApp(frontmatterByPath);

        const result = await runBeatDescriptionToPurposeMigration({ app, files: [file] });

        expect(result.updated).toBe(1);
        expect(result.movedToPurpose).toBe(1);
        expect(result.removedDescription).toBe(1);
        expect(frontmatterByPath[file.path].Purpose).toBe('Legacy value');
        expect(frontmatterByPath[file.path].Description).toBeUndefined();
    });

    it('removes empty Description without changing non-empty Purpose', async () => {
        const file = makeFile('Story/11.01 Beat.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [file.path]: { Class: 'Beat', Description: '   ', Purpose: 'Keep purpose' }
        };
        const app = makeApp(frontmatterByPath);

        const result = await runBeatDescriptionToPurposeMigration({ app, files: [file] });

        expect(result.updated).toBe(1);
        expect(result.movedToPurpose).toBe(0);
        expect(result.removedDescription).toBe(1);
        expect(frontmatterByPath[file.path].Purpose).toBe('Keep purpose');
        expect(frontmatterByPath[file.path].Description).toBeUndefined();
    });

    it('preserves non-empty Description when Purpose already has content', async () => {
        const file = makeFile('Story/12.01 Beat.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [file.path]: { Class: 'Beat', Description: 'Legacy note', Purpose: 'Existing purpose' }
        };
        const app = makeApp(frontmatterByPath);

        const result = await runBeatDescriptionToPurposeMigration({ app, files: [file] });

        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(1);
        expect(result.movedToPurpose).toBe(0);
        expect(result.removedDescription).toBe(0);
        expect(frontmatterByPath[file.path].Purpose).toBe('Existing purpose');
        expect(frontmatterByPath[file.path].Description).toBe('Legacy note');
    });
});

describe('runBackdropSynopsisToContextMigration', () => {
    it('moves Synopsis to Context when Context is empty and removes Synopsis', async () => {
        const file = makeFile('Story/Backdrop.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [file.path]: { Class: 'Backdrop', Synopsis: 'Legacy context', Context: '' }
        };
        const app = makeApp(frontmatterByPath);

        const result = await runBackdropSynopsisToContextMigration({ app, files: [file] });

        expect(result.updated).toBe(1);
        expect(result.movedToContext).toBe(1);
        expect(result.removedSynopsis).toBe(1);
        expect(frontmatterByPath[file.path].Context).toBe('Legacy context');
        expect(frontmatterByPath[file.path].Synopsis).toBeUndefined();
    });
});

function makeCacheApp(frontmatterByPath: Record<string, Record<string, unknown> | undefined>): App {
    return {
        metadataCache: {
            getFileCache: (file: TFile) => (frontmatterByPath[file.path] ? { frontmatter: frontmatterByPath[file.path] } : null)
        }
    } as unknown as App;
}

describe('planFillEmptyValues', () => {
    const inScope = makeFile('Book/10 Beat.md');
    const outOfScope = makeFile('Other/10 Beat.md');

    it('counts only existing empty keys that have a template default, inside the book folder', () => {
        const app = makeCacheApp({
            [inScope.path]: { Class: 'Beat', Mood: '', Tags: [], Extra: '' },
            [outOfScope.path]: { Class: 'Beat', Mood: '' }
        });
        const plan = planFillEmptyValues({
            app,
            files: [inScope, outOfScope],
            sourcePath: 'Book',
            customKeys: ['Mood', 'Tags', 'Extra', 'Absent'],
            defaults: { Mood: 'calm', Tags: ['a'], Extra: '', Absent: 'x' }
        });
        expect(plan).not.toBeNull();
        expect(plan!.files).toEqual([inScope]);
        expect(plan!.entries[0].emptyKeys).toEqual(['Mood', 'Tags']);
        expect(plan!.filledFields).toBe(2);
        expect(plan!.touchedKeys).toEqual(['Mood', 'Tags']);
        expect(Object.keys(plan!.fieldsToInsert).sort()).toEqual(['Absent', 'Mood', 'Tags']);
        expect(plan!.sourcePath).toBe('Book');
    });

    it('is null without a source path, without custom keys, without defaults, or with nothing empty', () => {
        const app = makeCacheApp({ [inScope.path]: { Mood: 'set' } });
        const base = { app, files: [inScope], sourcePath: 'Book', customKeys: ['Mood'], defaults: { Mood: 'calm' } };
        expect(planFillEmptyValues({ ...base, sourcePath: '' })).toBeNull();
        expect(planFillEmptyValues({ ...base, customKeys: [] })).toBeNull();
        expect(planFillEmptyValues({ ...base, defaults: { Mood: '' } })).toBeNull();
        expect(planFillEmptyValues(base)).toBeNull();
    });
});

describe('planDeprecatedFieldMigration', () => {
    it('separates moves, empty removals, and preserved values for beats', () => {
        const move = makeFile('a.md'); const empty = makeFile('b.md'); const keep = makeFile('c.md'); const clean = makeFile('d.md');
        const app = makeCacheApp({
            [move.path]: { Description: 'legacy', Purpose: '' },
            [empty.path]: { Description: '  ' },
            [keep.path]: { Description: 'legacy', Purpose: 'already' },
            [clean.path]: { Purpose: 'fine' }
        });
        const plan = planDeprecatedFieldMigration({ app, files: [move, empty, keep, clean], noteType: 'Beat', mappings: null });
        expect(plan).toEqual({
            legacyKey: 'Description', canonicalKey: 'Purpose',
            files: [move, empty, keep], moveCount: 1, removeEmptyCount: 1, preservedCount: 1
        });
    });

    it('maps backdrops from Synopsis to Context and is null when only preserved notes remain', () => {
        const keep = makeFile('bd.md');
        const app = makeCacheApp({ [keep.path]: { Synopsis: 'legacy', Context: 'already' } });
        expect(planDeprecatedFieldMigration({ app, files: [keep], noteType: 'Backdrop', mappings: null })).toBeNull();
        const move = makeFile('bd2.md');
        const app2 = makeCacheApp({ [move.path]: { Synopsis: 'legacy' } });
        expect(planDeprecatedFieldMigration({ app: app2, files: [move], noteType: 'Backdrop', mappings: null })?.canonicalKey).toBe('Context');
    });
});

describe('template placeholders never reach a note', () => {
    it('normalizes {{Placeholder}} defaults to empty and drops placeholder list items', () => {
        expect(normalizeDefault('{{Character}}')).toBe('');
        expect(normalizeDefault(' {{Due}} ')).toBe('');
        expect(normalizeDefault(['{{Character}}', 'Chae Ban'])).toEqual(['Chae Ban']);
        expect(normalizeDefault('Zero')).toBe('Zero');
        expect(normalizeDefault('See {{Character}} notes')).toBe('');
        expect(normalizeDefault('[[{{Place}}]]')).toBe('');
        expect(normalizeDefault(['[[{{Place}}]]', '[[Rome]]'])).toEqual(['[[Rome]]']);
    });

    it('inserts a missing Character key as empty, not as {{Character}}', async () => {
        const file = makeFile('Book/36 Scene.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [file.path]: { Class: 'Scene', Sashaacter: ['[[Sasha]]'] }
        };
        const app = makeApp(frontmatterByPath);

        const result = await runYamlBackfill({
            app,
            files: [file],
            fieldsToInsert: { Character: '{{Character}}', Act: '{{Act}}', Duration: '1 hour' }
        });

        expect(result.updated).toBe(1);
        expect(frontmatterByPath[file.path].Character).toBeNull();
        expect(frontmatterByPath[file.path].Act).toBeNull();
        expect(frontmatterByPath[file.path].Duration).toBe('1 hour');
    });

    it('never fills an empty key with a placeholder default', async () => {
        const file = makeFile('Book/37 Scene.md');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [file.path]: { Class: 'Scene', Character: '', Due: '' }
        };
        const app = makeApp(frontmatterByPath);

        const result = await runYamlFillEmptyValues({
            app,
            files: [file],
            fieldsToInsert: { Character: '{{Character}}', Due: '{{Due}}' }
        });

        expect(result.filledFields).toBe(0);
        expect(frontmatterByPath[file.path].Character).toBe('');
        expect(frontmatterByPath[file.path].Due).toBe('');
    });
});

describe('backfill keeps the author\'s YAML', () => {
    const run = async (source: string, options: Partial<Parameters<typeof runYamlBackfill>[0]>) => {
        let content = source;
        const app = { vault: { process: async (_file: TFile, cb: (data: string) => string) => { content = cb(content); } } } as unknown as App;
        const result = await runYamlBackfill({ app, files: [makeFile('Book/1 Scene.md')], fieldsToInsert: {}, ...options });
        return { content, result };
    };

    it('does not duplicate a property under another case or mapped name', async () => {
        const source = '---\nClass: Scene\nsynopsis: Mine\nStory Act: 2\n---\nBody';
        const { content, result } = await run(source, { fieldsToInsert: { Synopsis: '', Act: '' }, mappings: { 'Story Act': 'Act' } });
        expect(content).toBe(source);
        expect(result.skipped).toBe(1);
    });

    it('adds fields in template order and keeps comments and custom fields', async () => {
        const { content } = await run('---\nClass: Scene # c\nSynopsis: Mine # s\nMine: 1\nDue: x\n---\nBody', {
            fieldsToInsert: { Act: '', Status: 'Todo' },
            order: ['Class', 'Act', 'Synopsis', 'Status', 'Due'],
        });
        expect(content).toBe('---\nClass: Scene # c\nAct:\nSynopsis: Mine # s\nMine: 1\nStatus: Todo\nDue: x\n---\nBody');
    });

    it('adds template fields above plugin-managed keys, below custom fields', async () => {
        const { content } = await run('---\nClass: Beat\nPurpose: Mine\nMy Note: kept\nGossamer1: 66\nGossamerStage1: Press\n---\nBody', {
            fieldsToInsert: { 'In This Book': '', Range: '' },
            order: ['Class', 'Purpose', 'In This Book', 'Range'],
            isDynamic: key => key.startsWith('Gossamer'),
        });
        expect(content).toBe('---\nClass: Beat\nPurpose: Mine\nMy Note: kept\nIn This Book:\nRange:\nGossamer1: 66\nGossamerStage1: Press\n---\nBody');
    });

    it('uses the name the author mapped', async () => {
        const { content } = await run('---\nClass: Scene\n---\nBody', { fieldsToInsert: { Synopsis: '' }, mappings: { 'Scene Blurb': 'Synopsis' } });
        expect(content).toBe('---\nClass: Scene\nScene Blurb:\n---\nBody');
    });

    it('renames a deprecated update key the audit asked for, rather than adding a second one', async () => {
        const { content, result } = await run('---\nClass: Scene\nBeats Update: Yes # old\n---\nBody', { fieldsToInsert: { 'Pulse Update': '' } });
        expect(content).toBe('---\nClass: Scene\nPulse Update: Yes # old\n---\nBody');
        expect(result.updated).toBe(1);
    });

    it('fails on a broken note and leaves it alone', async () => {
        const source = '---\nClass: [\n---\nBody';
        const { content, result } = await run(source, { fieldsToInsert: { Act: '' } });
        expect(content).toBe(source);
        expect(result.failed).toBe(1);
    });

    it('fills an empty value in place and keeps its comment', async () => {
        let content = '---\nClass: Scene\nStatus: # pick one\nOther: kept\n---\nBody';
        const app = { vault: { process: async (_file: TFile, cb: (data: string) => string) => { content = cb(content); } } } as unknown as App;
        const result = await runYamlFillEmptyValues({ app, files: [makeFile('Book/1 Scene.md')], fieldsToInsert: { Status: 'Todo', Other: 'no' } });
        expect(content).toBe('---\nClass: Scene\nStatus: Todo # pick one\nOther: kept\n---\nBody');
        expect(result.filledFields).toBe(1);
    });
});
