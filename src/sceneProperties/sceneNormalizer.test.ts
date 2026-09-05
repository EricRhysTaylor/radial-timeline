import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    analyzeScenes,
    deleteAdvancedSceneFields,
    ensureSceneIds,
    reorderSceneFields,
} from './sceneNormalizer';
import { createInMemoryApp, type InMemoryApp } from '../../tests/helpers/inMemoryObsidian';
import { formatSemanticWarningReason, runYamlAudit } from '../utils/yamlAudit';

function buildSettings(advancedEnabled?: boolean) {
    return {
        ...DEFAULT_SETTINGS,
        sceneAdvancedPropertiesEnabled: advancedEnabled,
        sceneYamlTemplates: {
            base: 'Class: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:',
            advanced: 'Place: Somewhere\nQuestions:\nReader Emotion:',
        },
        enableCustomMetadataMapping: false,
        frontmatterMappings: {},
        books: [
            { id: 'book-a', title: 'Book A', sourceFolder: 'Books/BookA' },
            { id: 'book-b', title: 'Book B', sourceFolder: 'Books/BookB' },
        ],
        activeBookId: 'book-a',
        sourcePath: '',
    };
}

function coreSceneDoc(idLine = 'ID: scn_core'): string {
    return `---\n${idLine}\nClass: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:\n---\nBody`;
}

function advancedSceneDocAfterCore(): string {
    return `---\nID: scn_adv\nClass: Scene\nAct: 1\nWhen: 2026-01-01\nPlace: Somewhere\nQuestions:\n  - Who\nReader Emotion:\nPulse Update:\nSummary Update:\n---\nBody`;
}

function advancedSceneDocInterleaved(): string {
    return `---\nID: scn_adv\nClass: Scene\nAct: 1\nPlace: Somewhere\nWhen: 2026-01-01\nQuestions:\n  - Who\nPulse Update:\nSummary Update:\nReader Emotion:\n---\nBody`;
}

async function readFile(app: InMemoryApp, path: string): Promise<string> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
    return app.vault.read(file);
}

describe('sceneNormalizer', () => {
    it('treats core-only scenes as clean when advanced is disabled', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 Core.md': coreSceneDoc(),
        });

        const audit = await analyzeScenes({
            app: app as never,
            settings: buildSettings(false),
            files: [app.vault.getMarkdownFiles()[0]],
        });

        expect(audit.summary.scenesWithMissingCore).toBe(0);
        expect(audit.summary.scenesWithMissingAdvanced).toBe(0);
        expect(audit.notes).toHaveLength(0);
    });

    it('treats core-only scenes as missing advanced fields when advanced is enabled', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 Core.md': coreSceneDoc(),
        });

        const audit = await analyzeScenes({
            app: app as never,
            settings: buildSettings(true),
            files: [app.vault.getMarkdownFiles()[0]],
        });

        expect(audit.summary.scenesWithMissingAdvanced).toBe(1);
        expect(audit.notes[0].missingAdvancedKeys).toEqual(['Place', 'Questions', 'Reader Emotion']);
    });

    it('keeps core plus advanced scenes clean when advanced is enabled', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 Advanced.md': advancedSceneDocAfterCore(),
        });

        const audit = await analyzeScenes({
            app: app as never,
            settings: buildSettings(true),
            files: [app.vault.getMarkdownFiles()[0]],
        });

        expect(audit.notes).toHaveLength(0);
    });

    it('reports scene Synopsis warnings by word count', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 Long Synopsis.md': `---\nID: scn_long\nClass: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:\nSynopsis: one two three four five six seven eight nine ten eleven twelve thirteen\n---\nBody`,
        });

        const audit = await analyzeScenes({
            app: app as never,
            settings: {
                ...buildSettings(false),
                synopsisGenerationMaxWords: 12,
            },
            files: [app.vault.getMarkdownFiles()[0]],
        });

        expect(audit.summary.scenesWithWarnings).toBe(1);
        expect(audit.notes[0].semanticWarnings).toEqual(['Synopsis length above target: 13 words (target 12 words).']);
        expect(formatSemanticWarningReason(audit.notes[0].semanticWarnings)).toBe('Synopsis Warnings: 13 words');
    });

    it('reports beat Purpose warnings by word count instead of lines', async () => {
        const app = createInMemoryApp({
            'Books/BookA/03 Beat.md': `---\nID: beat_1\nClass: Beat\nAct: 1\nPurpose: ${Array.from({ length: 76 }, (_, index) => `word${index + 1}`).join(' ')}\nBeat Model: Save The Cat\nRange: 1-10\n---\nBody`,
        });

        const audit = await runYamlAudit({
            app: app as never,
            settings: buildSettings(false),
            noteType: 'Beat',
            files: [app.vault.getMarkdownFiles()[0]],
        });

        expect(audit.summary.notesWithWarnings).toBe(1);
        expect(audit.notes[0].semanticWarnings).toContain('Purpose length above target: 76 words (target 75 words).');
        expect(audit.notes[0].semanticWarnings.join(' ')).not.toContain('lines');
    });

    it('tolerates inactive advanced fields and reorders them after core in original relative order', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 Advanced.md': advancedSceneDocInterleaved(),
        });
        const file = app.vault.getMarkdownFiles()[0];
        const settings = buildSettings(false);

        const audit = await analyzeScenes({
            app: app as never,
            settings,
            files: [file],
        });

        expect(audit.summary.scenesWithMissingAdvanced).toBe(0);
        expect(audit.notes).toHaveLength(1);
        expect(audit.notes[0].orderDrift).toBe(true);
        expect(audit.notes[0].toleratedInactiveAdvancedKeys).toEqual(['Place', 'Questions', 'Reader Emotion']);

        const result = await reorderSceneFields({
            app: app as never,
            settings,
            files: [file],
            audit,
        });

        expect(result.reordered).toBe(1);
        const content = await readFile(app, 'Books/BookA/01 Advanced.md');
        expect(content).toContain('ID: scn_adv\nClass: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update: \nSummary Update: \nPlace: Somewhere\nQuestions:');
        expect(content).toContain('Questions:\n  - Who\nReader Emotion: ');
    });

    it('ensures scene ids only inside the active-book scope', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 A1.md': `---\nClass: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:\n---\nBody`,
            'Books/BookB/01 B1.md': `---\nClass: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:\n---\nBody`,
        });
        const settings = buildSettings(undefined);

        const audit = await analyzeScenes({
            app: app as never,
            settings,
        });
        expect(audit.summary.scenesWithMissingAdvanced).toBe(1);
        expect(audit.summary.scenesMissingIds).toBe(1);

        const result = await ensureSceneIds({
            app: app as never,
            settings,
        });

        expect(result.updated).toBe(1);
        expect(await readFile(app, 'Books/BookA/01 A1.md')).toMatch(/ID:\s*scn_[0-9a-f]{8,10}/);
        expect(await readFile(app, 'Books/BookB/01 B1.md')).not.toMatch(/ID:\s*scn_[0-9a-f]{8,10}/);
    });

    it('blocks advanced-field removal while advanced mode is enabled', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 Advanced.md': advancedSceneDocAfterCore(),
        });
        const file = app.vault.getMarkdownFiles()[0];

        await expect(deleteAdvancedSceneFields({
            app: app as never,
            settings: buildSettings(true),
            files: [file],
        })).rejects.toThrow('Advanced Properties are enabled');
    });

    it('removes advanced fields only from scoped scenes that actually contain them when advanced mode is disabled', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 Advanced.md': advancedSceneDocAfterCore(),
            'Books/BookA/02 Core.md': coreSceneDoc('ID: scn_core_two'),
            'Books/BookA/03 Beat.md': `---\nID: beat_1\nClass: Beat\nAct: 1\nPurpose: Setup\nBeat Model: Save The Cat\nRange: 1-10\n---\nBody`,
            'Books/BookA/04 Backdrop.md': `---\nID: backdrop_1\nClass: Backdrop\nContext: World\nStart: 2026-01-01\nEnd: 2026-01-02\n---\nBody`,
        });
        const settings = buildSettings(false);
        const audit = await analyzeScenes({
            app: app as never,
            settings,
        });

        const result = await deleteAdvancedSceneFields({
            app: app as never,
            settings,
            audit,
        });

        expect(result.deleted).toBe(1);
        expect(await readFile(app, 'Books/BookA/01 Advanced.md')).not.toContain('Place: Somewhere');
        expect(await readFile(app, 'Books/BookA/02 Core.md')).toContain('ID: scn_core_two');
        expect(await readFile(app, 'Books/BookA/03 Beat.md')).toContain('Class: Beat');
        expect(await readFile(app, 'Books/BookA/04 Backdrop.md')).toContain('Class: Backdrop');
    });
});
