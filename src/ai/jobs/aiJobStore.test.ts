import { describe, expect, it } from 'vitest';
import {
    AI_JOB_INSTRUCTIONS,
    AI_JOB_SCHEMA_VERSION,
    buildAiJob,
    isAiJobAnswerPath,
    parseAiJob,
    readAnswerAttribution,
    UNNAMED_CLIENT_ATTRIBUTION
} from './aiJobStore';
import { compileRequestPrompt } from '../runtime/aiClient';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import type { AIRunRequest } from '../types';

const plugin = {
    settings: { aiSettings: buildDefaultAiSettings() },
    getActiveBookTitle: () => 'Book Two'
} as never;

const request: AIRunRequest = {
    feature: 'SummaryRefresh',
    task: 'SceneSummary',
    requiredCapabilities: ['jsonStrict'],
    featureModeInstructions: 'Summarize factually.',
    userInput: 'Scene 24:\nThe station receives a distress call.',
    returnType: 'json',
    responseSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }
};

describe('AI jobs', () => {
    const job = buildAiJob(plugin, request, {
        id: 'summary-1a2b3c4d',
        target: { path: 'Book 2/24 Distress call.md', label: '24 Distress call' },
        sourceFingerprint: 'abc123'
    });

    it('carry exactly the prompt the API run would send for the same request', () => {
        expect(job.prompt).toBe(compileRequestPrompt(plugin, request).finalPrompt);
        expect(job.feature).toBe('SummaryRefresh');
        expect(job.task).toBe('SceneSummary');
        expect(job.schemaVersion).toBe(AI_JOB_SCHEMA_VERSION);
    });

    it('name their answer file relative to the AI Jobs folder', () => {
        expect(job.answerFile).toBe('Answers/summary-1a2b3c4d.json');
        expect(isAiJobAnswerPath('Radial Timeline/AI Jobs/Answers/summary-1a2b3c4d.json')).toBe(true);
        expect(isAiJobAnswerPath('Radial Timeline/AI Jobs/Pending/summary-1a2b3c4d.json')).toBe(false);
        expect(isAiJobAnswerPath('Radial Timeline/AI Jobs/Answers/notes.md')).toBe(false);
    });

    it('round-trip through their JSON file and reject malformed ones', () => {
        expect(parseAiJob(JSON.stringify(job))).toEqual({ kind: 'ok', job });
        expect(parseAiJob('{ not json').kind).toBe('invalid');
        expect(parseAiJob(JSON.stringify({ ...job, schemaVersion: 2 })).kind).toBe('invalid');
        const noPrompt: Record<string, unknown> = { ...job };
        delete noPrompt.prompt;
        const read = parseAiJob(JSON.stringify(noPrompt));
        expect(read.kind).toBe('invalid');
        if (read.kind === 'invalid') expect(read.reason).toContain('"prompt"');
    });

    it('read the client\'s name for itself from answeredBy, cleaned for a one-line stamp', () => {
        expect(readAnswerAttribution('{"summary": "x", "answeredBy": "Codex app · GPT-6 Sol"}')).toBe('Codex app · GPT-6 Sol');
        expect(readAnswerAttribution('```json\n{"answeredBy": "  Claude app\\n· Opus 5.5 "}\n```')).toBe('Claude app · Opus 5.5');
        expect(readAnswerAttribution(`{"answeredBy": "${'x'.repeat(200)}"}`)).toHaveLength(60);
        expect(readAnswerAttribution('{"summary": "x"}')).toBe(UNNAMED_CLIENT_ATTRIBUTION);
        expect(readAnswerAttribution('{"answeredBy": 42}')).toBe(UNNAMED_CLIENT_ATTRIBUTION);
        expect(readAnswerAttribution('not json')).toBe(UNNAMED_CLIENT_ATTRIBUTION);
    });

    it('come with instructions that name no feature, so prompt changes never make them stale', () => {
        expect(AI_JOB_INSTRUCTIONS).not.toMatch(/Summary|Synopsis|Pulse|Gossamer|Inquiry/);
        expect(AI_JOB_INSTRUCTIONS).toContain('`prompt`');
        expect(AI_JOB_INSTRUCTIONS).toContain('`answerFile`');
        expect(AI_JOB_INSTRUCTIONS).toContain('`lastRejection`');
        expect(AI_JOB_INSTRUCTIONS).toContain('`answeredBy`');
    });
});
