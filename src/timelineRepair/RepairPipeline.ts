/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Pipeline Orchestrator
 * Coordinates deterministic scaffold assignment and optional text-cue refinement.
 */

import type { TFile, Vault } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { TimelineItem } from '../types';
import { buildSharedSceneNoteFileMap, loadScopedSceneNotes, mapSharedSceneNotesToTimelineItems } from '../timeline/sharedSceneNotes';
import type {
    RepairPipelineConfig,
    RepairPipelineResult,
    RepairSceneEntry
} from './types';
import { runPatternSync, type PatternSyncInput } from './patternSync';
import { runKeywordSweep } from './keywordSweep';
import { buildScaffoldStampMap } from './whenChangeLog';

// ============================================================================
// Pipeline Execution
// ============================================================================

export interface PipelineCallbacks {
    /** Called when pipeline phase changes */
    onPhaseChange?: (phase: 'pattern' | 'cues' | 'complete') => void;
    
    /** Abort signal for cancellation */
    abortSignal?: AbortSignal;
}

/**
 * Run the complete repair pipeline.
 * 
 * Flow:
 * 1. Pattern Sync - deterministic baseline
 * 2. Keyword Sweep - simple text-cue refinement (if enabled)
 * 
 * @param scenes - Scenes in manuscript order
 * @param files - Corresponding TFile references
 * @param plugin - Plugin instance
 * @param config - Pipeline configuration
 * @param callbacks - Progress callbacks
 * @returns Pipeline result with entries and statistics
 */
export async function runRepairPipeline(
    scenes: TimelineItem[],
    files: Map<string, TFile>,
    plugin: RadialTimelinePlugin,
    config: RepairPipelineConfig,
    callbacks: PipelineCallbacks = {}
): Promise<RepairPipelineResult> {
    const vault = plugin.app.vault;

    // Build input for pattern sync
    const inputs: PatternSyncInput[] = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const file = scene.path ? files.get(scene.path) : undefined;
        
        // Skip scenes without files
        if (!file) continue;
        
        inputs.push({
            scene,
            file,
            manuscriptIndex: i
        });
    }
    
    if (inputs.length === 0) {
        return createEmptyResult();
    }
    
    // ========================================================================
    // Pattern scaffold
    // ========================================================================
    callbacks.onPhaseChange?.('pattern');
    
    // Machine-write provenance comes from the change log sidecar — scene
    // frontmatter carries no plugin bookkeeping.
    const scaffoldStamps = await buildScaffoldStampMap(plugin.app);

    let entries = runPatternSync(inputs, {
        anchorWhen: config.anchorWhen,
        anchorSceneIndex: config.anchorSceneIndex,
        patternPreset: config.patternPreset,
        preserveAuthoredDates: config.preserveAuthoredDates,
        scaffoldStamps
    });
    
    const patternCount = entries.length;
    
    // Check for abort
    if (callbacks.abortSignal?.aborted) {
        return buildResult(entries, patternCount, 0);
    }
    
    // ========================================================================
    // Simple text cues
    // ========================================================================
    if (config.useTextCues) {
        callbacks.onPhaseChange?.('cues');
        
        entries = await runKeywordSweep(
            entries,
            (entry) => getSceneBodyText(vault, entry),
            { includeSynopsis: true }
        );
    }
    
    const cueCount = entries.filter(e => e.source === 'keyword').length;
    
    // Check for abort
    if (callbacks.abortSignal?.aborted) {
        return buildResult(entries, patternCount, cueCount);
    }
    
    callbacks.onPhaseChange?.('complete');
    
    return buildResult(entries, patternCount, cueCount);
}

/**
 * Get the body text of a scene file (excluding frontmatter).
 */
async function getSceneBodyText(vault: Vault, entry: RepairSceneEntry): Promise<string> {
    try {
        const content = await vault.cachedRead(entry.file);
        
        // Strip frontmatter
        const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
        if (fmMatch) {
            return content.slice(fmMatch[0].length);
        }
        
        return content;
    } catch {
        return '';
    }
}

/**
 * Build the pipeline result object.
 */
function buildResult(
    entries: RepairSceneEntry[],
    patternApplied: number,
    cueRefined: number
): RepairPipelineResult {
    return {
        entries,
        totalScenes: entries.length,
        scenesChanged: entries.filter(e => e.isChanged).length,
        scenesNeedingReview: entries.filter(e => e.needsReview).length,
        scenesWithBackwardTime: entries.filter(e => e.hasBackwardTime).length,
        scenesWithLargeGaps: entries.filter(e => e.hasLargeGap).length,
        scenesAuthored: entries.filter(e => e.source === 'authored').length,
        patternApplied,
        cueRefined
    };
}

/**
 * Create an empty result for edge cases.
 */
function createEmptyResult(): RepairPipelineResult {
    return {
        entries: [],
        totalScenes: 0,
        scenesChanged: 0,
        scenesNeedingReview: 0,
        scenesWithBackwardTime: 0,
        scenesWithLargeGaps: 0,
        scenesAuthored: 0,
        patternApplied: 0,
        cueRefined: 0
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Collect scenes and their file references from plugin data.
 * Returns scenes in manuscript order.
 */
export async function collectScenesForRepair(
    plugin: RadialTimelinePlugin
): Promise<{ scenes: TimelineItem[]; files: Map<string, TFile> }> {
    const sceneNotes = await loadScopedSceneNotes(plugin);
    return {
        scenes: mapSharedSceneNotesToTimelineItems(sceneNotes),
        files: buildSharedSceneNoteFileMap(sceneNotes)
    };
}
