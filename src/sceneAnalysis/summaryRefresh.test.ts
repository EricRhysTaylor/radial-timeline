import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFile } from 'obsidian';
import {
    buildSummaryRunRequest,
    buildSynopsisRunRequest,
    parseSummaryReply,
    parseSynopsisReply
} from './summaryRefresh';
import { getSummaryJsonSchema, getSynopsisJsonSchema } from '../ai/prompts/synopsis';
import type { SceneData } from './types';

const scene: SceneData = {
    file: { path: 'Book 2/24 Distress call.md', basename: '24 Distress call' } as TFile,
    frontmatter: {},
    sceneNumber: 24,
    body: 'The station receives a distress call from the outer ring.'
};

describe('Summary refresh replies', () => {
    it('reads a summary wrapped in a code fence with a sentence before it', () => {
        const reply = 'Here is the summary:\n```json\n{ "summary": "  The station hears a distress call.  " }\n```';
        expect(parseSummaryReply(reply)).toEqual({ ok: true, text: 'The station hears a distress call.' });
    });

    it('does not accept the other pass\'s field in place of the one asked for', () => {
        expect(parseSummaryReply('{ "synopsis": "A call arrives." }').ok).toBe(false);
        expect(parseSynopsisReply('{ "summary": "A call arrives." }', 30).ok).toBe(false);
    });

    it('rejects empty text and non-JSON replies with a stated problem', () => {
        const empty = parseSummaryReply('{ "summary": "   " }');
        expect(empty.ok).toBe(false);
        if (!empty.ok) expect(empty.problem).toContain('"summary"');
        const prose = parseSummaryReply('The station hears a call.');
        expect(prose.ok).toBe(false);
        if (!prose.ok) expect(prose.problem).toContain('not valid JSON');
    });

    it('caps the synopsis at the word limit', () => {
        expect(parseSynopsisReply('{ "synopsis": "one two three four five" }', 3)).toEqual({ ok: true, text: 'one two three...' });
    });
});

describe('Summary refresh requests', () => {
    it('regenerates on every run: both passes skip the in-memory answer cache', () => {
        expect(buildSummaryRunRequest(scene, 200).bypassInMemoryCache).toBe(true);
        expect(buildSynopsisRunRequest(scene, 'A factual summary.', 30).bypassInMemoryCache).toBe(true);
        // Only the answer cache: provider prompt caching is not bypassed.
        expect(buildSummaryRunRequest(scene, 200).bypassProviderReuse).toBeUndefined();
    });

    it('sends the summary schema with the Summary pass', () => {
        const request = buildSummaryRunRequest(scene, 200);
        expect(request.feature).toBe('SummaryRefresh');
        expect(request.task).toBe('SceneSummary');
        expect(request.responseSchema).toEqual(getSummaryJsonSchema());
        expect(request.userInput).toContain('Scene 24:');
        expect(request.userInput).toContain(scene.body);
    });

    it('sends the synopsis schema with the Synopsis pass — its prompt asks for "synopsis"', () => {
        // The Synopsis pass used to send the Summary schema while its prompt
        // asked for a "synopsis" field; the parser hid it by accepting either.
        const request = buildSynopsisRunRequest(scene, 'A factual summary.', 30);
        expect(request.task).toBe('SceneSynopsis');
        expect(request.responseSchema).toEqual(getSynopsisJsonSchema());
        expect(request.userInput).toContain('"synopsis"');
        expect(request.userInput).toContain('A factual summary.');
    });
});

describe('Summary refresh has one request, reply and write path', () => {
    const strip = (source: string) => source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const read = (path: string) => strip(readFileSync(resolve(process.cwd(), path), 'utf8'));

    it('the API run uses the shared builders, parsers and writer', () => {
        const source = read('src/sceneAnalysis/SynopsisCommands.ts');
        for (const name of ['buildSummaryRunRequest(', 'buildSynopsisRunRequest(', 'parseSummaryReply(', 'parseSynopsisReply(', 'persistSummaryForScene(']) {
            expect(source).toContain(name);
        }
        expect(source).not.toContain('buildSummaryPrompt(');
        expect(source).not.toContain('buildSynopsisPrompt(');
        expect(source).not.toContain('JSON.parse(');
    });

    it('AI jobs use the same builders, parsers and writer', () => {
        const source = read('src/sceneAnalysis/summaryRefreshJobs.ts');
        for (const name of ['buildSummaryRunRequest(', 'buildSynopsisRunRequest(', 'parseSummaryReply(', 'parseSynopsisReply(', 'persistSummaryForScene(', 'buildAiJob(']) {
            expect(source).toContain(name);
        }
    });

    it('the Pulse provider call no longer carries a Summary branch', () => {
        const source = read('src/sceneAnalysis/aiProvider.ts');
        expect(source).not.toContain("'synopsis'");
        expect(source).not.toContain('getSummaryJsonSchema');
    });
});
