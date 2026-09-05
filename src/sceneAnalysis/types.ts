/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TFile } from 'obsidian';
import type { AIRunAdvancedContext } from '../ai/types';

/**
 * Local representation of a manuscript scene.
 */
export interface SceneData {
    file: TFile;
    frontmatter: Record<string, unknown>;
    sceneNumber: number | null;
    body: string;
}

/**
 * Response payload returned by AI providers (streamlined for callers).
 */
export interface AiProviderResponse {
    result: string | null;
    parsedAnalysis?: ParsedSceneAnalysis | null;
    modelIdUsed: string | null;
    providerUsed?: Exclude<'openai' | 'anthropic' | 'google' | 'ollama', 'none'> | null;
    advancedContext?: AIRunAdvancedContext;
}

/**
 * Beat items returned by LLMs.
 */
export interface BeatItem {
    ref_id?: string;
    ref_label?: string;
    ref_path?: string;
    scene: string;
    title?: string;
    grade: '+' | '-' | '?' | 'A' | 'B' | 'C';
    comment: string;
}

export interface SceneAnalysisJsonResponse {
    previousSceneAnalysis?: BeatItem[];
    currentSceneAnalysis: BeatItem[];
    nextSceneAnalysis?: BeatItem[];
}

export interface ParsedSceneAnalysis {
    previousSceneAnalysis: string;
    currentSceneAnalysis: string;
    nextSceneAnalysis: string;
    sceneGrade?: 'A' | 'B' | 'C';
}

export interface ProcessedCheckOptions {
    todayOnly?: boolean;
}
