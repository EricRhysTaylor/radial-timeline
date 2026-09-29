/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * AI job mailbox: work Radial Timeline hands to an AI client the author runs
 * themselves (Codex, Claude Code) inside their own subscription.
 *
 * Each job carries the exact prompt the API run would send for the same
 * request, compiled by compileRequestPrompt. No feature's instructions exist
 * anywhere else, so a prompt change in code reaches the next job unchanged.
 * The instruction file the client reads names no feature and no field.
 *
 * Lives in the visible system folder. IO goes through the data adapter, like
 * the Inquiry sessions sidecar: these are frequently rewritten machine JSON
 * files, and the adapter avoids metadata-cache/index timing races.
 */

import { normalizePath, type App, type DataAdapter } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { AIRunRequest } from '../types';
import { compileRequestPrompt } from '../runtime/aiClient';
import { extractJsonPayload } from '../runtime/jsonValidator';
import { fnv1a32Hex } from '../../utils/hash';
import { systemFolderPath } from '../../utils/systemFolder';

export const AI_JOBS_DIR = systemFolderPath('AI Jobs');
const PENDING_FOLDER = 'Pending';
const ANSWERS_FOLDER = 'Answers';
export const AI_JOBS_PENDING_DIR = `${AI_JOBS_DIR}/${PENDING_FOLDER}`;
export const AI_JOBS_ANSWERS_DIR = `${AI_JOBS_DIR}/${ANSWERS_FOLDER}`;

export const AI_JOB_SCHEMA_VERSION = 1;

export interface AiJobTarget {
    /** Vault path of the note the answer is applied to. */
    path: string;
    /** Human-readable name of the target, for the author and the client. */
    label: string;
}

export interface AiJobRejection {
    at: string;
    problems: string[];
}

export interface AiJob {
    schemaVersion: typeof AI_JOB_SCHEMA_VERSION;
    id: string;
    /** AIRunRequest.feature — routes the answer to the feature that applies it. */
    feature: string;
    /** AIRunRequest.task — which request within the feature. */
    task: string;
    createdAt: string;
    target: AiJobTarget;
    /**
     * Hash of the compiled prompt. At apply time the job is rebuilt from the
     * vault as it is now; a different hash means the prompt's source changed
     * (the scene, a neighbor, the manuscript, a setting) and the job is stale.
     */
    sourceFingerprint: string;
    /**
     * The complete prompt, compiled exactly as the API run would send it,
     * relative to the AI Jobs folder. A separate plain-text file rather than a
     * JSON string: a prompt carrying a scene or a whole manuscript is far too
     * long to read as one escaped line.
     */
    promptFile: string;
    /** Where the client writes its answer, relative to the AI Jobs folder. */
    answerFile: string;
    /** Present when the previous answer was not accepted. */
    lastRejection?: AiJobRejection;
}

/**
 * Which targets a "Prepare AI jobs" run covers: those the author flagged for
 * an update, those with no result yet, or all of them.
 */
export type AiJobScope = 'flagged' | 'missing' | 'all';

/** A job and its prompt text, as built; written as two files. */
export interface PreparedAiJob {
    job: AiJob;
    prompt: string;
}

export const AI_JOB_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * Written as both AGENTS.md (Codex) and CLAUDE.md (Claude Code). Deliberately
 * generic: every job carries its own instructions, so this text never changes
 * when a feature's prompt does.
 */
export const AI_JOB_INSTRUCTIONS = `# Radial Timeline AI jobs

This folder holds work that Radial Timeline has handed to an AI client you run yourself, such as Codex or Claude Code. Paths below are relative to this folder.

## For the AI client

1. Each \`.json\` file in \`${PENDING_FOLDER}/\` is one job. Read it as JSON. Jobs are independent; answer them in any order.
2. The file named in the job's \`promptFile\` field is the complete instruction for that job, including the exact JSON your answer must match. Follow it exactly and use no other instructions for the job. It is plain text and can be very long, with long lines: read all of it, in chunks if you need to, never a truncated preview.
3. Write the JSON the prompt asks for, with nothing before or after it, to the path in the job's \`answerFile\` field. Add one more top-level field to it, \`answeredBy\`, naming the app you are running in and your model, for example \`"Claude app · Opus 5.5"\` or \`"Codex app · GPT-6 Sol"\`. It goes in the note's update stamp.
4. If a job has a \`lastRejection\` field, your earlier answer was not accepted, or the job was rebuilt. Read its \`problems\`, then answer the job's current \`promptFile\` again.
5. Do not edit or delete job files, scene notes, or any other file in the vault. Radial Timeline checks every answer and applies it itself.
6. When you have answered every job, look in \`${PENDING_FOLDER}/\` again. Applying an answer can create a follow-up job.

## For the author

- Radial Timeline writes jobs here when you run a "Prepare AI jobs" command.
- Answers are applied while Obsidian is open, the next time it opens, or when you run "Apply AI job answers".
- An applied job and its answer are deleted. The note's update stamp records who wrote the result, as the client named itself in \`answeredBy\` (for example "by Claude app · Opus 5.5", or "by local agent" if it gave no name), and the previous values are kept in Radial Timeline's snapshots.
- Jobs contain the text of the notes they are about. You can empty this folder at any time; nothing else depends on it.
`;

/** The stamp's "by …" when the client did not name itself. */
export const UNNAMED_CLIENT_ATTRIBUTION = 'local agent';

const MAX_ANSWERED_BY_LENGTH = 60;

/**
 * The client's own name for itself from an answer's \`answeredBy\` field, for
 * the update stamp ("Claude app · Opus 5.5"): control characters and line
 * breaks removed, whitespace collapsed, length capped. UNNAMED_CLIENT_ATTRIBUTION
 * when the field is absent or empty. The plugin cannot verify the claim; it is
 * recorded as the client stated it.
 */
export function readAnswerAttribution(answer: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(extractJsonPayload(answer));
    } catch { // SAFE: an unparseable answer is rejected by the feature's own check; it names no client
        return UNNAMED_CLIENT_ATTRIBUTION;
    }
    const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).answeredBy : undefined;
    if (typeof value !== 'string') return UNNAMED_CLIENT_ATTRIBUTION;
    const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWERED_BY_LENGTH).trim();
    return cleaned.length > 0 ? cleaned : UNNAMED_CLIENT_ATTRIBUTION;
}

function vaultIo(app: App): DataAdapter {
    return app.vault.adapter; // SAFE: frequently-rewritten machine JSON mailbox; adapter avoids metadata-cache/index races
}

function pendingPath(id: string): string {
    return normalizePath(`${AI_JOBS_PENDING_DIR}/${id}.json`);
}

function promptPath(id: string): string {
    return normalizePath(`${AI_JOBS_PENDING_DIR}/${id}.prompt.txt`);
}

function answerPath(id: string): string {
    return normalizePath(`${AI_JOBS_ANSWERS_DIR}/${id}.json`);
}

/**
 * Build a job from the same AIRunRequest the API run sends. The prompt is the
 * request compiled by compileRequestPrompt, never text assembled here.
 */
export function buildAiJob(
    plugin: RadialTimelinePlugin,
    request: AIRunRequest,
    params: { id: string; target: AiJobTarget }
): PreparedAiJob {
    const prompt = compileRequestPrompt(plugin, request).finalPrompt;
    return {
        prompt,
        job: {
            schemaVersion: AI_JOB_SCHEMA_VERSION,
            id: params.id,
            feature: request.feature,
            task: request.task,
            createdAt: new Date().toISOString(),
            target: params.target,
            sourceFingerprint: fnv1a32Hex(prompt),
            promptFile: `${PENDING_FOLDER}/${params.id}.prompt.txt`,
            answerFile: `${ANSWERS_FOLDER}/${params.id}.json`
        }
    };
}

export type AiJobRead =
    | { kind: 'ok'; job: AiJob }
    | { kind: 'missing' }
    | { kind: 'invalid'; reason: string };

/** Parse and validate a job file's contents. */
export function parseAiJob(raw: string): AiJobRead {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return { kind: 'invalid', reason: `job file is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { kind: 'invalid', reason: 'job file is not a JSON object' };
    }
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== AI_JOB_SCHEMA_VERSION) {
        return { kind: 'invalid', reason: `unsupported job schemaVersion ${JSON.stringify(record.schemaVersion)}` };
    }
    const target = record.target as Record<string, unknown> | null | undefined;
    const stringFields = ['id', 'feature', 'task', 'createdAt', 'sourceFingerprint', 'promptFile', 'answerFile'] as const;
    for (const field of stringFields) {
        const value = record[field];
        if (typeof value !== 'string' || value.length === 0) {
            return { kind: 'invalid', reason: `job field "${field}" is missing` };
        }
    }
    if (!target || typeof target.path !== 'string' || typeof target.label !== 'string') {
        return { kind: 'invalid', reason: 'job field "target" is missing' };
    }
    return { kind: 'ok', job: parsed as AiJob };
}

/** Create the mailbox folders and (re)write the instruction files. */
export async function ensureAiJobMailbox(app: App): Promise<void> {
    const io = vaultIo(app);
    for (const dir of [AI_JOBS_PENDING_DIR, AI_JOBS_ANSWERS_DIR]) {
        const normalized = normalizePath(dir);
        if (!(await io.exists(normalized))) {
            await io.mkdir(normalized);
        }
    }
    for (const name of AI_JOB_INSTRUCTION_FILES) {
        await io.write(normalizePath(`${AI_JOBS_DIR}/${name}`), AI_JOB_INSTRUCTIONS);
    }
}

/** Write a job's prompt file and its JSON record. */
export async function writeAiJob(app: App, prepared: PreparedAiJob): Promise<void> {
    const io = vaultIo(app);
    await io.write(promptPath(prepared.job.id), prepared.prompt);
    await io.write(pendingPath(prepared.job.id), JSON.stringify(prepared.job, null, 2));
}

/** Record why an answer was sent back, on the job the client will read again. */
export async function recordAiJobRejection(app: App, job: AiJob, problems: string[]): Promise<void> {
    const rejected: AiJob = { ...job, lastRejection: { at: new Date().toISOString(), problems } };
    await vaultIo(app).write(pendingPath(job.id), JSON.stringify(rejected, null, 2));
}

export async function readAiJobPrompt(app: App, id: string): Promise<string> {
    return vaultIo(app).read(promptPath(id));
}

export async function readAiJob(app: App, id: string): Promise<AiJobRead> {
    const io = vaultIo(app);
    const path = pendingPath(id);
    if (!(await io.exists(path))) return { kind: 'missing' };
    return parseAiJob(await io.read(path));
}

export async function removeAiJob(app: App, id: string): Promise<void> {
    const io = vaultIo(app);
    await io.remove(pendingPath(id));
    const prompt = promptPath(id);
    if (await io.exists(prompt)) await io.remove(prompt);
}

/** Ids of the answers waiting in the Answers folder, sorted. */
export async function listAiJobAnswerIds(app: App): Promise<string[]> {
    const io = vaultIo(app);
    const dir = normalizePath(AI_JOBS_ANSWERS_DIR);
    if (!(await io.exists(dir))) return [];
    const listing = await io.list(dir);
    return listing.files
        .filter(path => path.endsWith('.json'))
        .map(path => path.slice(path.lastIndexOf('/') + 1, -'.json'.length))
        .sort((a, b) => a.localeCompare(b));
}

export async function readAiJobAnswer(app: App, id: string): Promise<string> {
    return vaultIo(app).read(answerPath(id));
}

export async function removeAiJobAnswer(app: App, id: string): Promise<void> {
    await vaultIo(app).remove(answerPath(id));
}

/** True for a vault path inside the Answers folder that could hold an answer. */
export function isAiJobAnswerPath(path: string): boolean {
    return path.startsWith(`${AI_JOBS_ANSWERS_DIR}/`) && path.endsWith('.json');
}
