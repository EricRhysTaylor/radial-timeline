import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFile } from 'obsidian';
import {
    buildSummaryRunRequest,
    buildSynopsisRunRequest,
    parseSummaryReply,
    parseSynopsisReply,
    requestSynopsis
} from './summaryRefresh';
import { getSummaryJsonSchema, getSynopsisJsonSchema } from '../ai/prompts/synopsis';
import type { AIRunRequest } from '../ai/types';
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

    it('keeps a synopsis a few words over the cap as written, never cut', () => {
        // Cap 30 keeps up to 50 (the hover's word room).
        const synopsis = words(31);
        expect(parseSynopsisReply(JSON.stringify({ synopsis }), 30)).toEqual({ ok: true, text: synopsis });
        expect(parseSynopsisReply(JSON.stringify({ synopsis: words(50) }), 30).ok).toBe(true);
    });

    it('refuses a synopsis past what is kept, naming its length', () => {
        const parsed = parseSynopsisReply(JSON.stringify({ synopsis: words(51) }), 30);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.tooLongWords).toBe(51);
            expect(parsed.problem).toContain('51 words');
        }
    });
});

function words(count: number): string {
    return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(' ');
}

describe('Synopsis pass retry', () => {
    const reply = (count: number) => JSON.stringify({ synopsis: words(count) });

    it('sends one request when the first reply is kept', async () => {
        const sent: AIRunRequest[] = [];
        const result = await requestSynopsis(async request => { sent.push(request); return reply(28); }, scene, 'A factual summary.', 30);
        expect(result).toMatchObject({ ok: true, attempts: 1 });
        expect(sent).toHaveLength(1);
    });

    it('retries once when the reply runs past what is kept, telling the model its length', async () => {
        const sent: AIRunRequest[] = [];
        const answers = [reply(60), reply(27)];
        const result = await requestSynopsis(async request => { sent.push(request); return answers.shift() ?? ''; }, scene, 'A factual summary.', 30);
        expect(result).toMatchObject({ ok: true, text: words(27), attempts: 2 });
        expect(sent).toHaveLength(2);
        expect(sent[1].userInput).toContain('ran 60 words');
        expect(sent[0].userInput).not.toContain('ran 60 words');
    });

    it('fails with the problem when the retry is still too long', async () => {
        const result = await requestSynopsis(async () => reply(70), scene, 'A factual summary.', 30);
        expect(result.ok).toBe(false);
        expect(result.attempts).toBe(2);
    });

    it('does not retry a reply refused for another reason', async () => {
        const sent: AIRunRequest[] = [];
        const result = await requestSynopsis(async request => { sent.push(request); return 'not json'; }, scene, 'A factual summary.', 30);
        expect(result).toMatchObject({ ok: false, attempts: 1 });
        expect(sent).toHaveLength(1);
    });
});

describe('Summary refresh requests', () => {
    it('regenerates on every run: both passes skip the in-memory answer cache', () => {
        expect(buildSummaryRunRequest(scene, 200).bypassInMemoryCache).toBe(true);
        expect(buildSynopsisRunRequest(scene, 'A factual summary.', 30).bypassInMemoryCache).toBe(true);
        // Only the answer cache: provider prompt caching is not bypassed.
        expect(buildSummaryRunRequest(scene, 200).bypassProviderReuse).toBeUndefined();
    });

    it('both passes use the neutral role template, never the author persona', () => {
        expect(buildSummaryRunRequest(scene, 200).bypassRoleTemplate).toBe(true);
        expect(buildSynopsisRunRequest(scene, 'A factual summary.', 30).bypassRoleTemplate).toBe(true);
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
        for (const name of ['buildSummaryRunRequest(', 'requestSynopsis(', 'parseSummaryReply(', 'persistSummaryForScene(']) {
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
