/*
 * The cacheable Inquiry prefix must not depend on the order the vault hands
 * files back in. The corpus fingerprints sort their entries, so two runs over
 * the same corpus share a fingerprint whatever order the manifest arrived in;
 * if the prompt followed that order instead, an equal fingerprint would claim
 * a warm cache over a prefix the provider has never seen.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../ai/runtime/aiClient', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../ai/runtime/aiClient')>()),
    getAIClient: vi.fn(() => ({}))
}));

import { TFile } from 'obsidian';
import { InquiryRunnerService } from './InquiryRunnerService';
import type { CorpusManifestEntry, InquiryOmnibusInput, InquiryRunSubject } from './types';

type Note = { frontmatter: Record<string, unknown>; body: string };

const notes: Record<string, Note> = {
    'Book 1 Signal/2 Silence.md': { frontmatter: { Class: 'Scene', 'Scene Number': 2, Title: 'Silence', id: 'scn_00000002' }, body: 'The colony stops answering.' },
    'Book 1 Signal/1 Distress call.md': { frontmatter: { Class: 'Scene', 'Scene Number': 1, Title: 'Distress call', id: 'scn_00000001' }, body: 'The station hears a distress call.' },
    'Book 1 Signal/3 Landing.md': { frontmatter: { Class: 'Scene', 'Scene Number': 3, Title: 'Landing', id: 'scn_00000003' }, body: 'The crew lands in the dark.' },
    'Book 1 Signal/Outline/Act Two.md': { frontmatter: { Class: 'Outline' }, body: 'Act two: the descent.' },
    'Book 1 Signal/Outline/Act One.md': { frontmatter: { Class: 'Outline' }, body: 'Act one: the call.' },
    'World/Characters/Vega.md': { frontmatter: { Class: 'Character', Title: 'Vega' }, body: 'Vega is the pilot.' },
    'World/Characters/Ash.md': { frontmatter: { Class: 'Character', Title: 'Ash' }, body: 'Ash is the engineer.' },
    'World/Places/Colony.md': { frontmatter: { Class: 'Place', Title: 'Colony' }, body: 'The colony sits on a moon.' }
};

const entry = (path: string): CorpusManifestEntry => {
    const className = String(notes[path].frontmatter.Class).toLowerCase();
    return {
        path,
        sceneId: className === 'scene' ? String(notes[path].frontmatter.id) : undefined,
        mtime: 1,
        class: className,
        scope: className === 'outline' ? 'book' : undefined,
        mode: 'full',
        isTarget: false
    };
};

const vaultOrder = Object.keys(notes).map(entry);

const subject = (entries: CorpusManifestEntry[]): InquiryRunSubject => ({
    scope: 'book',
    scopeLabel: 'B1',
    targetSceneIds: [],
    selectionMode: 'discover',
    activeBookId: 'Book 1 Signal',
    mode: 'flow',
    questionId: 'setup-core',
    questionText: 'Is the premise set up before it pays off?',
    questionPromptForm: 'standard',
    questionZone: 'setup',
    corpus: {
        entries,
        fingerprint: 'f',
        corpusOnlyFingerprint: 'c',
        cacheReuseFingerprint: 'r',
        snapshot: [],
        generatedAt: 0,
        resolvedRoots: [],
        allowedClasses: [],
        synopsisOnly: false,
        classCounts: {}
    },
    rules: { sagaOutlineScope: 'saga-only', bookOutlineScope: 'book-only', crossScopeUsage: 'conflict-only' }
});

type PromptParts = { systemPrompt: string; userPrompt: string; instructionPrompt: string; cacheableUserInput: string };
type RunnerInternals = {
    buildEvidenceBlocks(input: InquiryRunSubject): Promise<Array<{ label: string; content: string }>>;
    buildPrompt(input: InquiryRunSubject, blocks: Array<{ label: string; content: string }>): PromptParts;
    buildOmnibusPrompt(input: InquiryOmnibusInput, blocks: Array<{ label: string; content: string }>): PromptParts;
};

function createRunner(): RunnerInternals {
    const files = new Map(Object.keys(notes).map(path => [path, new TFile(path)]));
    const vault = {
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        read: async (file: TFile) => notes[file.path].body
    };
    const metadataCache = {
        getFileCache: (file: TFile) => ({ frontmatter: notes[file.path].frontmatter })
    };
    return new InquiryRunnerService({ settings: {} } as never, vault as never, metadataCache as never) as unknown as RunnerInternals;
}

async function promptFor(entries: CorpusManifestEntry[]): Promise<PromptParts> {
    const runner = createRunner();
    const input = subject(entries);
    return runner.buildPrompt(input, await runner.buildEvidenceBlocks(input));
}

describe('Inquiry cacheable prefix', () => {
    it('is byte-identical whatever order the corpus entries arrive in', async () => {
        const forward = await promptFor(vaultOrder);
        const reversed = await promptFor([...vaultOrder].reverse());
        const shuffled = await promptFor([4, 1, 7, 0, 5, 2, 6, 3].map(index => vaultOrder[index]));

        expect(reversed.cacheableUserInput).toBe(forward.cacheableUserInput);
        expect(shuffled.cacheableUserInput).toBe(forward.cacheableUserInput);
        expect(reversed.instructionPrompt).toBe(forward.instructionPrompt);
        expect(shuffled.instructionPrompt).toBe(forward.instructionPrompt);
        expect(reversed.systemPrompt).toBe(forward.systemPrompt);
    });

    it('keeps scenes in scene-number order and the rest in path order', async () => {
        const runner = createRunner();
        const labels = (await runner.buildEvidenceBlocks(subject([...vaultOrder].reverse()))).map(block => block.label);
        expect(labels).toEqual([
            'Book 1 outline (Full)',
            'Book 1 outline (Full)',
            'Scene Distress call (S1) (scn_00000001) (Full)',
            'Scene Silence (S2) (scn_00000002) (Full)',
            'Scene Landing (S3) (scn_00000003) (Full)',
            'Character: Ash (Full)',
            'Character: Vega (Full)',
            'Place: Colony (Full)'
        ]);
        const { cacheableUserInput } = await promptFor([...vaultOrder].reverse());
        expect(cacheableUserInput.indexOf('Act one: the call.')).toBeLessThan(cacheableUserInput.indexOf('Act two: the descent.'));
    });

    it('gives the combined Omnibus prompt the same order-independence', async () => {
        const runner = createRunner();
        const omnibus = async (entries: CorpusManifestEntry[]): Promise<string> => {
            const base = subject(entries);
            const input: InquiryOmnibusInput = {
                scope: base.scope,
                scopeLabel: base.scopeLabel,
                targetSceneIds: base.targetSceneIds,
                selectionMode: base.selectionMode,
                activeBookId: base.activeBookId,
                mode: base.mode,
                questions: [{ id: 'setup-core', zone: 'setup', questionText: base.questionText, questionPromptForm: 'standard' }],
                corpus: base.corpus,
                rules: base.rules,
                ai: { provider: 'google', modelId: 'model', modelLabel: 'Model' },
                citationsEnabled: false
            };
            return runner.buildOmnibusPrompt(input, await runner.buildEvidenceBlocks(base)).cacheableUserInput;
        };
        expect(await omnibus([...vaultOrder].reverse())).toBe(await omnibus(vaultOrder));
    });
});
