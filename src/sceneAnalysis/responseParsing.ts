/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type RadialTimelinePlugin from '../main';
import type { BeatItem, ParsedSceneAnalysis, SceneAnalysisJsonResponse } from './types';

const MAIN_GRADE_VALUES = new Set(['A', 'B', 'C']);
const LINK_GRADE_VALUES = new Set(['+', '-', '?']);
const SCENE_ID_REGEX = /^scn_[a-f0-9]{8,10}$/i;

function formatBeatLines(
    items: BeatItem[] | undefined,
    section: 'previous' | 'current' | 'next'
): string {
    if (!Array.isArray(items) || items.length === 0) return '';

    return items
        .map((item, index) => {
            const sceneNumber = typeof item.scene === 'string' ? item.scene.trim() : '';
            const title = typeof item.title === 'string' ? item.title.trim() : '';
            const grade = typeof item.grade === 'string' ? item.grade.trim() : '';
            const comment = typeof item.comment === 'string' ? item.comment.trim() : '';

            let lineCore = '';

            if (section === 'current' && index === 0) {
                // Scene pulse headline: "<scene> <grade>"
                lineCore = [sceneNumber, grade.toUpperCase()].filter(Boolean).join(' ').trim();
            } else {
                const pieces: string[] = [];
                if (index === 0 && sceneNumber) pieces.push(sceneNumber);
                if (title) pieces.push(title);
                if (grade) pieces.push(grade);
                lineCore = pieces.join(' ').trim();
            }

            if (!lineCore && comment) lineCore = comment;
            const commentSegment = comment ? ` / ${comment}` : '';
            return `- ${lineCore}${commentSegment}`.trim();
        })
        .join('\n');
}

function validateSceneAnalysisPayload(payload: SceneAnalysisJsonResponse): void {
    if (!Array.isArray(payload.currentSceneAnalysis) || payload.currentSceneAnalysis.length === 0) {
        throw new Error('currentSceneAnalysis must include at least one item with the overall A/B/C grade.');
    }

    const [firstCurrent, ...restCurrent] = payload.currentSceneAnalysis;
    if (!firstCurrent || !MAIN_GRADE_VALUES.has(firstCurrent.grade)) {
        // Fallback: If the model gave a +/-/? for the main grade, map it to a letter
        if (firstCurrent && LINK_GRADE_VALUES.has(firstCurrent.grade)) {
             if (firstCurrent.grade === '+') firstCurrent.grade = 'A';
             else if (firstCurrent.grade === '?') firstCurrent.grade = 'B';
             else if (firstCurrent.grade === '-') firstCurrent.grade = 'C';
        } else {
             throw new Error('The first currentSceneAnalysis item must use grade A, B, or C.');
        }
    }

    normalizeSceneRef(firstCurrent, 'currentSceneAnalysis', 0);

    // Validation for restCurrent is now handled by the shared ensureLinkGrades helper below
    // restCurrent.forEach((item, index) => {
    //    if (!LINK_GRADE_VALUES.has(item.grade)) {
    //        throw new Error(`currentSceneAnalysis item #${index + 2} should use "+", "-", or "?" (additional insight).`);
    //    }
    // });

    const ensureLinkGrades = (items: BeatItem[] | undefined, label: string) => {
        if (!items) return;
        items.forEach((item, index) => {
            // RELAXED VALIDATION: Map A/B/C to +/-/? for non-primary items to support smaller models
            if (MAIN_GRADE_VALUES.has(item.grade) && !LINK_GRADE_VALUES.has(item.grade)) {
                if (item.grade === 'A' || item.grade === 'B') item.grade = '+';
                else if (item.grade === 'C') item.grade = '-';
            }
            
            if (!LINK_GRADE_VALUES.has(item.grade)) {
                // Last ditch effort: if it's not a valid grade, default to '?'
                item.grade = '?'; 
                // Keep parsing resilient when a provider drifts slightly from the requested grading contract.
                // throw new Error(`${label} item #${index + 1} must use "+", "-", or "?".`);
            }
            normalizeSceneRef(item, label, index);
        });
    };

    ensureLinkGrades(payload.previousSceneAnalysis, 'previousSceneAnalysis');
    ensureLinkGrades(payload.nextSceneAnalysis, 'nextSceneAnalysis');

    // Also fix up the REST of the current scene items (skipping the first one)
    if (restCurrent.length > 0) {
        ensureLinkGrades(restCurrent, 'currentSceneAnalysis (subsequent items)');
    }
}

function normalizeSceneRef(item: BeatItem | undefined, section: string, index: number): void {
    if (!item) return;
    const candidate = typeof item.ref_id === 'string' ? item.ref_id.trim() : '';
    if (candidate && SCENE_ID_REGEX.test(candidate)) {
        item.ref_id = candidate.toLowerCase();
        return;
    }

    const fromScene = typeof item.scene === 'string' ? item.scene.trim() : '';
    if (fromScene && SCENE_ID_REGEX.test(fromScene)) {
        item.ref_id = fromScene.toLowerCase();
        return;
    }

    if (!candidate && fromScene) {
        item.ref_id = fromScene;
    }

    if (!candidate) {
        console.warn(`[Pulse] Missing stable ref_id in ${section}[${index}]; using legacy scene token.`);
    }
}

function sanitizeJsonControlCharacters(input: string): string {
    // Replace unescaped control characters (except common whitespace) with spaces so JSON.parse succeeds.
    return input.replace(/\p{Cc}/gu, char => {
        if (char === '\n' || char === '\r' || char === '\t') {
            return char;
        }
        return ' ';
    });
}

function parseJsonBeatsResponse(jsonResult: string, plugin: RadialTimelinePlugin): ParsedSceneAnalysis | null {
    try {
        let parsed: SceneAnalysisJsonResponse;
        try {
            parsed = JSON.parse(jsonResult) as SceneAnalysisJsonResponse;
        } catch (error) {
            if (error instanceof SyntaxError) {
                const sanitized = sanitizeJsonControlCharacters(jsonResult);
                if (sanitized !== jsonResult) {
                    parsed = JSON.parse(sanitized) as SceneAnalysisJsonResponse;
                } else {
                    throw error;
                }
            } else {
                throw error;
            }
        }
        validateSceneAnalysisPayload(parsed);
        plugin.lastAnalysisError = '';
        
        // Extract the main grade (A/B/C) from first currentSceneAnalysis item
        const firstCurrent = parsed.currentSceneAnalysis?.[0];
        const sceneGrade = (firstCurrent?.grade === 'A' || firstCurrent?.grade === 'B' || firstCurrent?.grade === 'C')
            ? firstCurrent.grade
            : undefined;
        
        return {
            previousSceneAnalysis: formatBeatLines(parsed.previousSceneAnalysis, 'previous'),
            currentSceneAnalysis: formatBeatLines(parsed.currentSceneAnalysis, 'current'),
            nextSceneAnalysis: formatBeatLines(parsed.nextSceneAnalysis, 'next'),
            sceneGrade
        };
    } catch (error) {
        console.error('[parseJsonBeatsResponse] Error parsing JSON beats response:', error);
        plugin.lastAnalysisError = String(error);
        return null;
    }
}

export function parsePulseAnalysisResponse(llmResult: string, plugin: RadialTimelinePlugin): ParsedSceneAnalysis | null {
    try {
        if (!llmResult || typeof llmResult !== 'string') {
            throw new Error('LLM returned empty result.');
        }

        let trimmed = llmResult.trim();
        if (trimmed.startsWith('```')) {
            trimmed = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/i, '');
            if (trimmed.endsWith('```')) {
                trimmed = trimmed.slice(0, -3);
            }
            trimmed = trimmed.trim();
        }

        if (!trimmed.startsWith('{')) {
            throw new Error('LLM response was not valid JSON.');
        }

        const jsonResult = parseJsonBeatsResponse(trimmed, plugin);
        if (jsonResult) {
            plugin.lastAnalysisError = '';
            return jsonResult;
        }
        return null;
    } catch (error) {
        console.error('[parsePulseAnalysisResponse] Error parsing beats response:', error);
        plugin.lastAnalysisError = String(error);
        return null;
    }
}
