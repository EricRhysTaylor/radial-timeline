/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Summary refresh: the AI request each pass sends, how its reply is read, and
 * how the result is written to the scene. The API run (SynopsisCommands) and
 * AI jobs handed to an outside client (summaryRefreshJobs) both go through
 * these functions, so the two can never ask for different things or write
 * different results.
 */

import { Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { AIRunAdvancedContext, AIRunRequest } from '../ai/types';
import {
    buildSummaryPrompt,
    buildSynopsisPrompt,
    getSummaryJsonSchema,
    getSummarySystemPrompt,
    getSynopsisJsonSchema
} from '../ai/prompts/synopsis';
import { getAIClient } from '../ai/runtime/aiClient';
import { extractJsonPayload } from '../ai/runtime/jsonValidator';
import { getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import { resolveBookScopedFiles } from '../services/NoteScopeResolver';
import { describeAiRunModel } from '../utils/modelResolver';
import { snapshotFrontmatterFields } from '../utils/logVaultOps';
import { normalizeBooleanValue } from '../utils/sceneHelpers';
import { truncateToWordLimit } from '../utils/synopsisLimits';
import { getSummaryUpdateFlag } from './data';
import type { SceneData } from './types';
import type { RadialTimelineSettings } from '../types';
import { t } from '../i18n';

const SUMMARY_REFRESH_OVERRIDES: AIRunRequest['overrides'] = {
    temperature: 0.2,
    maxOutputMode: 'high',
    reasoningDepth: 'deep',
    jsonStrict: true
};

function sceneNumberLabel(scene: SceneData): string {
    return String(scene.sceneNumber || 'N/A'); // SAFE: unnumbered scene files have no number; the prompt labels them N/A
}

/** The Summary pass: an extended factual summary of the scene's full text. */
export function buildSummaryRunRequest(scene: SceneData, targetWords: number): AIRunRequest {
    return {
        feature: 'SummaryRefresh',
        task: 'SceneSummary',
        requiredCapabilities: ['jsonStrict', 'reasoningStrong'],
        featureModeInstructions: getSummarySystemPrompt(),
        userInput: buildSummaryPrompt(scene.body, sceneNumberLabel(scene), targetWords),
        returnType: 'json',
        responseSchema: getSummaryJsonSchema(),
        // A refresh regenerates and overwrites the Summary. RT's 2-minute
        // in-memory answer cache would hand a quick re-run (the author
        // re-flags a summary they didn't like) the previous text verbatim.
        bypassInMemoryCache: true,
        // A factual record of events, not editorial work: the author's role
        // template (often an editor persona) must not color it. aiClient
        // swaps in the neutral feature template, as for Gossamer.
        bypassRoleTemplate: true,
        overrides: SUMMARY_REFRESH_OVERRIDES
    };
}

/** The Synopsis pass: a word-capped hover blurb written from the new Summary. */
export function buildSynopsisRunRequest(scene: SceneData, summaryText: string, maxWords: number): AIRunRequest {
    return {
        feature: 'SummaryRefresh',
        task: 'SceneSynopsis',
        requiredCapabilities: ['jsonStrict', 'reasoningStrong'],
        featureModeInstructions: getSummarySystemPrompt(),
        userInput: buildSynopsisPrompt(summaryText, sceneNumberLabel(scene), maxWords),
        returnType: 'json',
        responseSchema: getSynopsisJsonSchema(),
        // Regenerates the Synopsis; never the previous answer, and no author
        // persona (see Summary pass).
        bypassInMemoryCache: true,
        bypassRoleTemplate: true,
        overrides: SUMMARY_REFRESH_OVERRIDES
    };
}

export type SummaryRefreshReply =
    | { ok: true; text: string }
    | { ok: false; problem: string };

function readReplyField(reply: string, field: 'summary' | 'synopsis'): SummaryRefreshReply {
    // Replies can arrive wrapped (a code fence, a sentence before the JSON);
    // extractJsonPayload is the one place that unwraps them.
    let parsed: unknown;
    try {
        parsed = JSON.parse(extractJsonPayload(reply));
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, problem: `The answer is not valid JSON: ${detail}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, problem: 'The answer must be a JSON object.' };
    }
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: false, problem: `The answer's "${field}" field is missing or empty.` };
    }
    return { ok: true, text: value.trim() };
}

export function parseSummaryReply(reply: string): SummaryRefreshReply {
    return readReplyField(reply, 'summary');
}

export function parseSynopsisReply(reply: string, maxWords: number): SummaryRefreshReply {
    const result = readReplyField(reply, 'synopsis');
    return result.ok ? { ok: true, text: truncateToWordLimit(result.text, maxWords) } : result;
}

/**
 * Send one Summary refresh request to the configured AI provider. Throws on
 * failure. `attribution` names the model that actually answered, for the
 * Summary Update stamp.
 */
export async function sendSummaryRefreshRequest(
    plugin: RadialTimelinePlugin,
    request: AIRunRequest
): Promise<{ reply: string; attribution: string; advancedContext?: AIRunAdvancedContext }> {
    const aiSettings = getCanonicalAiSettings(plugin);
    const selection = resolveConfiguredSelection(aiSettings, { feature: 'SummaryRefresh' });
    const provider = selection?.provider ?? aiSettings.provider;
    const result = await getAIClient(plugin).run({
        ...request,
        providerOverride: provider === 'none' ? undefined : provider
    });
    if (result.aiStatus !== 'success' || !result.content || result.provider === 'none') {
        const detail = result.error || t('sceneAnalysis.aiProvider.genericError', { provider: result.provider });
        new Notice(t('sceneAnalysis.aiProvider.callError', { provider, detail }), 8000);
        throw new Error(detail);
    }
    return {
        reply: result.content,
        attribution: describeAiRunModel(result.provider, result.modelResolved || result.modelRequested),
        advancedContext: result.advancedContext
    };
}

/** Target length of a generated Summary, in words. */
export function resolveSummaryTargetWords(settings: RadialTimelineSettings): number {
    return settings.synopsisTargetWords ?? 200; // SAFE: settings saved before the target existed; 200 is the shipped default
}

/** True when the author has flagged the scene with Summary Update: Yes. */
export function isFlaggedForSummaryRefresh(scene: SceneData): boolean {
    return normalizeBooleanValue(getSummaryUpdateFlag(scene.frontmatter));
}

/** The scene files a Summary refresh covers: the active book's scenes. */
export function resolveSummaryRefreshScope(plugin: RadialTimelinePlugin): {
    files: TFile[];
    scopeSummary: string;
    reason?: string;
} {
    const scope = resolveBookScopedFiles({
        app: plugin.app,
        settings: plugin.settings,
        noteType: 'Scene'
    });
    return {
        files: scope.files,
        scopeSummary: scope.scopeSummary,
        reason: scope.reason
    };
}

function setCaseInsensitiveField(frontmatter: Record<string, unknown>, key: string, value: string): void {
    const lowerKey = key.toLowerCase();
    for (const existingKey of Object.keys(frontmatter)) {
        if (existingKey.toLowerCase() === lowerKey && existingKey !== key) {
            delete frontmatter[existingKey];
        }
    }
    frontmatter[key] = value;
}

function placeSummaryAfterSynopsis(frontmatter: Record<string, unknown>): void {
    const keys = Object.keys(frontmatter);
    const summaryKey = keys.find(key => key.toLowerCase() === 'summary');
    const synopsisKey = keys.find(key => key.toLowerCase() === 'synopsis');
    if (!summaryKey || !synopsisKey) return;

    const summaryIndex = keys.indexOf(summaryKey);
    const synopsisIndex = keys.indexOf(synopsisKey);
    if (summaryIndex === synopsisIndex + 1) return;

    const reorderedKeys = keys.filter(key => key !== summaryKey);
    reorderedKeys.splice(reorderedKeys.indexOf(synopsisKey) + 1, 0, summaryKey);

    const snapshot: Record<string, unknown> = {};
    for (const key of reorderedKeys) {
        snapshot[key] = frontmatter[key];
    }
    for (const key of Object.keys(frontmatter)) {
        delete frontmatter[key];
    }
    Object.assign(frontmatter, snapshot);
}

/**
 * Write a Summary refresh result to the scene: Summary and/or Synopsis, the
 * "Summary Update: <time> by <attribution>" stamp, and the per-scene timestamps
 * the stale checks read. Takes a frontmatter snapshot first.
 */
export async function persistSummaryForScene(
    plugin: RadialTimelinePlugin,
    scenePath: string,
    result: { summary?: string; synopsis?: string },
    attribution: string,
    assertSourcesCurrent?: () => void
): Promise<{ summary?: string; synopsis?: string }> {
    const file = plugin.app.vault.getAbstractFileByPath(scenePath);
    if (!(file instanceof TFile)) {
        throw new Error(t('sceneAnalysis.synopsis.notices.sceneFileNotFound', { path: scenePath }));
    }

    const summary = result.summary?.trim();
    const synopsis = result.synopsis?.trim();
    const now = new Date();
    const isoNow = now.toISOString();
    const timestamp = now.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    } as Intl.DateTimeFormatOptions);

    await snapshotFrontmatterFields(plugin.app, [file], {
        operation: 'scene-summary-refresh',
        fields: ['Summary', 'Synopsis', 'Summary Update', 'SummaryUpdate', 'summaryupdate', 'Synopsis Update', 'SynopsisUpdate', 'synopsisupdate'],
        meta: {
            scope: 'scene-note',
            path: file.path
        }
    });

    await plugin.app.fileManager.processFrontMatter(file, (fm) => {
        assertSourcesCurrent?.();
        const frontmatter = fm as Record<string, unknown>;

        // Write canonical keys and clean up case-variant duplicates.
        if (summary !== undefined) {
            setCaseInsensitiveField(frontmatter, 'Summary', summary);
        }
        if (synopsis) {
            setCaseInsensitiveField(frontmatter, 'Synopsis', synopsis);
        }

        // Keep Summary adjacent to the legacy Synopsis key for readability in frontmatter.
        placeSummaryAfterSynopsis(frontmatter);

        // Normalize update markers onto Summary Update while preserving legacy-key compatibility.
        const summaryUpdateKeys = ['Summary Update', 'SummaryUpdate', 'summaryupdate'];
        const legacyKeys = ['Synopsis Update', 'SynopsisUpdate', 'synopsisupdate'];
        const stamp = `${timestamp} by ${attribution}`;

        let updatedFlag = false;
        for (const key of summaryUpdateKeys) {
            if (key in frontmatter) {
                frontmatter[key] = stamp;
                updatedFlag = true;
                break;
            }
        }
        if (!updatedFlag) {
            for (const key of legacyKeys) {
                if (key in frontmatter) {
                    delete frontmatter[key];
                    frontmatter['Summary Update'] = stamp;
                    updatedFlag = true;
                    break;
                }
            }
        }
        if (!updatedFlag) {
            frontmatter['Summary Update'] = stamp;
        }
    });

    // Track internal timestamps per scene so stale checks remain accurate.
    if (!plugin.settings.aiUpdateTimestamps) {
        plugin.settings.aiUpdateTimestamps = {};
    }
    const sceneTimestamps = plugin.settings.aiUpdateTimestamps[scenePath] ?? {};
    if (summary !== undefined) {
        sceneTimestamps.summaryUpdated = isoNow;
    }
    if (synopsis) {
        sceneTimestamps.synopsisUpdated = isoNow;
    }
    plugin.settings.aiUpdateTimestamps[scenePath] = sceneTimestamps;
    try {
        await plugin.saveSettings();
    } catch (error) {
        // Frontmatter writes are already committed; keep processing even if settings persistence fails.
        console.warn('Failed to persist summary timestamp settings:', error);
    }

    return { summary, synopsis };
}
