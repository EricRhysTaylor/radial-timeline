/*
 * Chunker cascade tests for buildEvidenceChunkPrompts.
 *
 * Pins the contract that the chunker MUST produce >= 2 chunks for any
 * non-trivial evidence — first via `## ` heading splits, then paragraph
 * splits, then a hard char-bounded chop as last resort. The prior
 * implementation returned 1 chunk (and broke multi-pass preflight) when
 * the corpus lacked `## ` boundaries — this suite catches that regression.
 */

import { describe, it, expect } from 'vitest';
import { InquiryRunnerService } from './InquiryRunnerService';

type ChunkPromptPlan = {
    prompts: string[];
    maxChunkTokens: number;
    maxChunkChars: number;
    evidenceChars: number;
    prefixChars: number;
    targetPasses: number | null;
} | null;

interface ChunkOptions {
    maxChunkTokens: number;
    estimatedInputTokens?: number;
    safeInputTokens?: number;
}

function instance(): InquiryRunnerService {
    // The chunker doesn't touch plugin/vault/metadataCache, so undefined
    // stand-ins are fine for the pure-function surface under test.
    return new InquiryRunnerService(
        undefined as never,
        undefined as never,
        undefined as never
    );
}

function callChunker(userPrompt: string, options: ChunkOptions): ChunkPromptPlan {
    const runner = instance() as unknown as {
        buildEvidenceChunkPrompts(p: string, o: ChunkOptions): ChunkPromptPlan;
    };
    return runner.buildEvidenceChunkPrompts(userPrompt, options);
}

function wrapEvidence(body: string): string {
    return `Instructions: do the thing.\nEvidence:\n${body}`;
}

describe('buildEvidenceChunkPrompts cascade', () => {
    it('splits on `## ` headings when the corpus is structured', () => {
        const body = ['## Scene 1', 'a'.repeat(8000),
            '## Scene 2', 'b'.repeat(8000),
            '## Scene 3', 'c'.repeat(8000)].join('\n\n');
        const plan = callChunker(wrapEvidence(body), { maxChunkTokens: 4000 });
        expect(plan).not.toBeNull();
        expect(plan!.prompts.length).toBeGreaterThanOrEqual(2);
    });

    it('falls back to paragraph splits when there are no `## ` headings', () => {
        // Three "scenes" separated by blank lines but no `## ` markers.
        const body = [
            'a'.repeat(8000),
            'b'.repeat(8000),
            'c'.repeat(8000)
        ].join('\n\n');
        const plan = callChunker(wrapEvidence(body), { maxChunkTokens: 4000 });
        expect(plan).not.toBeNull();
        expect(plan!.prompts.length).toBeGreaterThanOrEqual(2);
    });

    it('hard-chops a single unbroken blob (no headings, no paragraph breaks)', () => {
        // Worst case: one giant paragraph with no markdown structure at all.
        // The chunker must still produce multiple chunks so multi-pass can run.
        const body = 'x'.repeat(40000);
        const plan = callChunker(wrapEvidence(body), { maxChunkTokens: 2000 });
        expect(plan).not.toBeNull();
        expect(plan!.prompts.length).toBeGreaterThanOrEqual(2);
    });

    it('returns null when the prompt lacks the Evidence marker', () => {
        // Defensive guard at the top of the chunker — no marker means no
        // evidence to slice and the caller (multi-pass) bails out cleanly.
        const plan = callChunker('Just a prompt, no marker.', { maxChunkTokens: 4000 });
        expect(plan).toBeNull();
    });

    it('preserves the prefix in every produced chunk prompt', () => {
        const body = ['## Scene 1', 'a'.repeat(5000),
            '## Scene 2', 'b'.repeat(5000)].join('\n\n');
        const plan = callChunker(wrapEvidence(body), { maxChunkTokens: 2000 });
        expect(plan).not.toBeNull();
        for (const prompt of plan!.prompts) {
            expect(prompt.startsWith('Instructions: do the thing.\nEvidence:\n')).toBe(true);
        }
    });
});
