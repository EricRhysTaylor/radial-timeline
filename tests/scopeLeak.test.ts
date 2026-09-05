import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { runSynopsisBatch } from '../src/sceneAnalysis/SynopsisCommands';
import { collectFilesForAuditWithScope, runYamlAudit } from '../src/utils/yamlAudit';
import { runYamlBackfill } from '../src/utils/yamlBackfill';
import { runReferenceIdBackfill } from '../src/utils/referenceIdBackfill';
import { migrateSceneFrontmatterIds } from '../src/migrations/sceneIds';
import type RadialTimelinePlugin from '../src/main';
import type { SceneAnalysisProcessingModal } from '../src/modals/SceneAnalysisProcessingModal';
import { createInMemoryApp, type InMemoryApp } from './helpers/inMemoryObsidian';

type DomShim = {
    createElement: (_tagName: string) => { textContent: string };
};

type TestGlobal = typeof globalThis & {
    document?: DomShim;
    activeDocument?: DomShim;
    window?: { setTimeout: typeof setTimeout };
};

const testGlobal = globalThis as unknown as TestGlobal;

if (!testGlobal.document) {
    testGlobal.document = {
        createElement: () => ({ textContent: '' })
    };
}
// Obsidian defines activeDocument as a global tracking the focused window
if (!testGlobal.activeDocument) {
    testGlobal.activeDocument = testGlobal.document;
}
if (!testGlobal.window) {
    testGlobal.window = {
        setTimeout
    };
}

vi.mock('../src/sceneAnalysis/RequestRunner', () => ({
    createAiRunner: () => async (_prompt: string, _subplot: string | null, _ctx: string, sceneName: string) => ({
        result: JSON.stringify({ summary: `Scoped summary for ${sceneName}` })
    })
}));

vi.mock('../src/sceneAnalysis/aiProvider', () => ({
    callAiProvider: vi.fn()
}));

function sceneDoc(title: string): string {
    return `---\nClass: Scene\nTitle: ${title}\nAct: 1\nWhen: 2026-01-01\n---\nBody`;
}

interface ScopedSettings {
    books: Array<{ id: string; title: string; sourceFolder: string }>;
    activeBookId: string;
    sourcePath: string;
    synopsisWeakThreshold: number;
    synopsisTargetWords: number;
    alsoUpdateSynopsis: boolean;
    aiUpdateTimestamps: Record<string, { summaryUpdated?: string; synopsisUpdated?: string }>;
    defaultAiProvider: 'openai' | 'anthropic' | 'gemini' | 'local';
    openaiModelId: string;
    enableCustomMetadataMapping: boolean;
    frontmatterMappings: Record<string, string>;
}

function createScopedSettings(): ScopedSettings {
    return {
        books: [
            { id: 'book-a', title: 'Book A', sourceFolder: 'Books/BookA' },
            { id: 'book-b', title: 'Book B', sourceFolder: 'Books/BookB' }
        ],
        activeBookId: 'book-a',
        sourcePath: '',
        synopsisWeakThreshold: 75,
        synopsisTargetWords: 200,
        alsoUpdateSynopsis: false,
        aiUpdateTimestamps: {},
        defaultAiProvider: 'openai',
        openaiModelId: 'gpt-5.1-chat-latest',
        enableCustomMetadataMapping: false,
        frontmatterMappings: {}
    };
}

async function readFile(app: InMemoryApp, path: string): Promise<string> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
    return app.vault.read(file);
}

describe('Scope leak protections', () => {
    it('Summary refresh writes only active-book scenes', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 A1.md': sceneDoc('A1'),
            'Books/BookA/02 A2.md': sceneDoc('A2'),
            'Books/BookA/03 A3.md': sceneDoc('A3'),
            'Books/BookB/01 B1.md': sceneDoc('B1'),
            'Books/BookB/02 B2.md': sceneDoc('B2'),
            'Books/BookB/03 B3.md': sceneDoc('B3')
        });
        const plugin = {
            app,
            settings: createScopedSettings(),
            saveSettings: vi.fn().mockResolvedValue(undefined)
        };
        const modal = {
            isAborted: () => false,
            addError: vi.fn(),
            addWarning: vi.fn(),
            setProcessingQueue: vi.fn(),
            setSynopsisPreview: vi.fn(),
            setAiAdvancedContext: vi.fn(),
            startSceneAnimation: vi.fn(),
            updateProgress: vi.fn(),
            markQueueStatus: vi.fn()
        };

        await runSynopsisBatch(
            plugin as unknown as RadialTimelinePlugin,
            app.vault,
            'synopsis-all',
            modal as unknown as SceneAnalysisProcessingModal,
            75,
            160
        );

        const a1 = await readFile(app, 'Books/BookA/01 A1.md');
        const b1 = await readFile(app, 'Books/BookB/01 B1.md');

        expect(a1).toContain('Summary: Scoped summary for');
        expect(a1).toContain('Summary Update:');
        expect(b1).not.toContain('Summary: Scoped summary for');
        expect(b1).not.toContain('Summary Update:');
        expect(Object.keys(plugin.settings.aiUpdateTimestamps)).toHaveLength(3);
        expect(Object.keys(plugin.settings.aiUpdateTimestamps).every(path => path.startsWith('Books/BookA/'))).toBe(true);
    });

    it('Scene YAML heal (backfill) writes only active-book scenes', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 A1.md': sceneDoc('A1'),
            'Books/BookA/02 A2.md': sceneDoc('A2'),
            'Books/BookA/03 A3.md': sceneDoc('A3'),
            'Books/BookB/01 B1.md': sceneDoc('B1'),
            'Books/BookB/02 B2.md': sceneDoc('B2'),
            'Books/BookB/03 B3.md': sceneDoc('B3')
        });
        const settings = createScopedSettings();

        const scope = collectFilesForAuditWithScope(app, 'Scene', settings);
        expect(scope.reason).toBeUndefined();
        expect(scope.files).toHaveLength(3);
        expect(scope.files.every(file => file.path.startsWith('Books/BookA/'))).toBe(true);

        const result = await runYamlBackfill({
            app,
            files: scope.files,
            fieldsToInsert: { 'Review Window': 'Q1' }
        });

        expect(result.updated).toBe(3);
        expect((await readFile(app, 'Books/BookA/01 A1.md'))).toContain('Review Window: Q1');
        expect((await readFile(app, 'Books/BookB/01 B1.md'))).not.toContain('Review Window: Q1');
    });

    it('startup scene-id migration only touches active-book scope', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 A1.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookA/02 A2.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookB/01 B1.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookB/02 B2.md': `---\nClass: Scene\nAct: 1\n---\nBody`
        });
        const plugin = {
            app,
            settings: createScopedSettings()
        };

        await migrateSceneFrontmatterIds(plugin as unknown as RadialTimelinePlugin);

        const a1 = await readFile(app, 'Books/BookA/01 A1.md');
        const b1 = await readFile(app, 'Books/BookB/01 B1.md');

        expect(a1).toMatch(/id:\s*scn_[0-9a-f]{8,10}/i);
        expect(b1).not.toMatch(/id:\s*scn_[0-9a-f]{8,10}/i);
    });

    it('audit marks missing IDs as critical and scoped insert only updates active book', async () => {
        const app = createInMemoryApp({
            'Books/BookA/01 A1.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookA/02 A2.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookA/03 A3.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookB/01 B1.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookB/02 B2.md': `---\nClass: Scene\nAct: 1\n---\nBody`,
            'Books/BookB/03 B3.md': `---\nClass: Scene\nAct: 1\n---\nBody`
        });
        const settings = createScopedSettings();
        const scope = collectFilesForAuditWithScope(app, 'Scene', settings);
        expect(scope.files).toHaveLength(3);
        expect(scope.files.every(file => file.path.startsWith('Books/BookA/'))).toBe(true);

        const audit = await runYamlAudit({
            app,
            settings,
            noteType: 'Scene',
            files: scope.files
        });
        expect(audit.summary.notesMissingIds).toBe(3);
        expect(audit.notes.filter(note => note.missingReferenceId)).toHaveLength(3);

        const insertResult = await runReferenceIdBackfill({
            app,
            files: scope.files,
            noteType: 'Scene'
        });
        expect(insertResult.updated).toBe(3);

        const a1 = await readFile(app, 'Books/BookA/01 A1.md');
        const b1 = await readFile(app, 'Books/BookB/01 B1.md');
        expect(a1).toMatch(/^---\nid:\s*scn_[0-9a-f]{8,10}\nClass:\s*Scene/im);
        expect(b1).not.toMatch(/id:\s*scn_[0-9a-f]{8,10}/i);
    });
});
