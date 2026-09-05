/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 * 
 * Runtime Estimation Utility
 * Parses scene content to estimate screenplay time / reading time
 */

import type { RadialTimelineSettings, RuntimeContentType, RuntimeRateProfile } from '../types';
import { countWords } from './text';

export interface RuntimeEstimateResult {
    totalSeconds: number;
    dialogueWords: number;
    actionWords: number;
    dialogueSeconds: number;
    actionSeconds: number;
    directiveSeconds: number;
    directiveCounts: Record<string, number>;
}

export interface RuntimeSettings {
    contentType: RuntimeContentType;
    dialogueWpm: number;
    actionWpm: number;
    narrationWpm: number;
    beatSeconds: number;
    pauseSeconds: number;
    longPauseSeconds: number;
    momentSeconds: number;
    silenceSeconds: number;
    sessionPlanning?: {
        draftingWpm?: number;
        recordingWpm?: number;
        editingWpm?: number;
        dailyMinutes?: number;
        dailyWords?: number;
    };
}

function selectRuntimeProfile(settings: RadialTimelineSettings, profileId?: string): RuntimeRateProfile | null {
    const profiles = settings.runtimeRateProfiles || [];
    const targetId = profileId || settings.defaultRuntimeProfileId;
    if (targetId) {
        const match = profiles.find(p => p.id === targetId);
        if (match) return match;
    }
    if (profiles.length > 0) {
        return profiles[0];
    }
    return null;
}

export type RuntimeRates = Pick<RuntimeRateProfile, 'contentType' | 'dialogueWpm' | 'actionWpm' | 'narrationWpm' | 'beatSeconds' | 'pauseSeconds' | 'longPauseSeconds' | 'momentSeconds' | 'silenceSeconds'>;

/** The flat per-vault runtime rate settings as one rates object; the only place their defaults live. */
export function runtimeRatesFromSettings(settings: RadialTimelineSettings): RuntimeRates {
    return {
        contentType: settings.runtimeContentType || 'novel',
        dialogueWpm: settings.runtimeDialogueWpm || 160,
        actionWpm: settings.runtimeActionWpm || 100,
        narrationWpm: settings.runtimeNarrationWpm || 150,
        beatSeconds: settings.runtimeBeatSeconds || 2,
        pauseSeconds: settings.runtimePauseSeconds || 3,
        longPauseSeconds: settings.runtimeLongPauseSeconds || 5,
        momentSeconds: settings.runtimeMomentSeconds || 4,
        silenceSeconds: settings.runtimeSilenceSeconds || 5,
    };
}

function legacyProfile(settings: RadialTimelineSettings): RuntimeRateProfile {
    return {
        id: 'legacy-runtime-default',
        label: 'Legacy default',
        ...runtimeRatesFromSettings(settings)
    };
}

/**
 * Extract runtime settings from plugin settings, optionally using a named profile
 */
export function getRuntimeSettings(settings: RadialTimelineSettings, profileId?: string): RuntimeSettings {
    const profile = selectRuntimeProfile(settings, profileId) || legacyProfile(settings);
    return {
        contentType: profile.contentType || 'novel',
        dialogueWpm: profile.dialogueWpm ?? settings.runtimeDialogueWpm ?? 160,
        actionWpm: profile.actionWpm ?? settings.runtimeActionWpm ?? 100,
        narrationWpm: profile.narrationWpm ?? settings.runtimeNarrationWpm ?? 150,
        beatSeconds: profile.beatSeconds ?? settings.runtimeBeatSeconds ?? 2,
        pauseSeconds: profile.pauseSeconds ?? settings.runtimePauseSeconds ?? 3,
        longPauseSeconds: profile.longPauseSeconds ?? settings.runtimeLongPauseSeconds ?? 5,
        momentSeconds: profile.momentSeconds ?? settings.runtimeMomentSeconds ?? 4,
        silenceSeconds: profile.silenceSeconds ?? settings.runtimeSilenceSeconds ?? 5,
        sessionPlanning: profile.sessionPlanning
    };
}

/**
 * Extract dialogue (quoted text) from content
 * Returns { dialogue: string[], nonDialogue: string }
 */
function extractDialogue(content: string): { dialogue: string[]; nonDialogue: string } {
    const dialogueBlocks: string[] = [];
    
    // Match text in double quotes (handles escaped quotes)
    const dialogueRegex = /"([^"\\]*(\\.[^"\\]*)*)"/g;
    let match;
    
    while ((match = dialogueRegex.exec(content)) !== null) {
        dialogueBlocks.push(match[1]);
    }
    
    // Remove dialogue from content to get non-dialogue
    const nonDialogue = content.replace(dialogueRegex, ' ');
    
    return { dialogue: dialogueBlocks, nonDialogue };
}

/**
 * Parse explicit duration from parenthetical
 * Handles: (30 seconds), (30s), (2 minutes), (2m), (2 min), (runtime: 3m), (allow 5 minutes)
 */
function parseExplicitDuration(text: string): number | null {
    // Normalize
    const normalized = text.toLowerCase().trim();
    
    // Pattern: (30 seconds) or (30s) or (30 sec)
    const secondsMatch = normalized.match(/^\(?(\d+(?:\.\d+)?)\s*(?:seconds?|s|sec)\)?$/);
    if (secondsMatch) {
        return parseFloat(secondsMatch[1]);
    }
    
    // Pattern: (2 minutes) or (2m) or (2 min)
    const minutesMatch = normalized.match(/^\(?(\d+(?:\.\d+)?)\s*(?:minutes?|m|min)\)?$/);
    if (minutesMatch) {
        return parseFloat(minutesMatch[1]) * 60;
    }
    
    // Pattern: (runtime: 3m) or (runtime: 30s)
    const runtimeMatch = normalized.match(/^\(?runtime:\s*(\d+(?:\.\d+)?)\s*(m|s|min|sec|minutes?|seconds?)?\)?$/);
    if (runtimeMatch) {
        const value = parseFloat(runtimeMatch[1]);
        const unit = runtimeMatch[2] || 's';
        if (unit.startsWith('m')) return value * 60;
        return value;
    }
    
    // Pattern: (allow 5 minutes) or (allow 30 seconds)
    const allowMatch = normalized.match(/^\(?allow\s+(\d+(?:\.\d+)?)\s*(minutes?|seconds?|m|s)\)?$/);
    if (allowMatch) {
        const value = parseFloat(allowMatch[1]);
        const unit = allowMatch[2];
        if (unit.startsWith('m')) return value * 60;
        return value;
    }
    
    return null;
}

/**
 * Parse parenthetical directives from content
 * Returns array of { type: string, seconds: number }
 */
function parseDirectives(content: string, settings: RuntimeSettings): { type: string; seconds: number }[] {
    const directives: { type: string; seconds: number }[] = [];
    
    // Find all parentheticals
    const parentheticalRegex = /\(([^)]+)\)/gi;
    let match;
    
    while ((match = parentheticalRegex.exec(content)) !== null) {
        const text = match[1].trim().toLowerCase();
        
        // Check for explicit duration first
        const explicitSeconds = parseExplicitDuration(match[0]);
        if (explicitSeconds !== null) {
            directives.push({ type: 'explicit', seconds: explicitSeconds });
            continue;
        }
        
        // Check for standard parentheticals
        if (/^long\s+pause$/.test(text)) {
            directives.push({ type: 'long pause', seconds: settings.longPauseSeconds });
        } else if (/^a\s+moment$/.test(text)) {
            directives.push({ type: 'a moment', seconds: settings.momentSeconds });
        } else if (/^beat$/.test(text)) {
            directives.push({ type: 'beat', seconds: settings.beatSeconds });
        } else if (/^pause$/.test(text)) {
            directives.push({ type: 'pause', seconds: settings.pauseSeconds });
        } else if (/^silence$/.test(text)) {
            directives.push({ type: 'silence', seconds: settings.silenceSeconds });
        }
    }
    
    return directives;
}

/**
 * Remove parentheticals from text for word counting
 */
function removeParentheticals(text: string): string {
    return text.replace(/\([^)]*\)/g, ' ');
}

/**
 * Estimate runtime for scene content
 */
export function estimateRuntime(content: string, settings: RuntimeSettings): RuntimeEstimateResult {
    if (!content || content.trim().length === 0) {
        return {
            totalSeconds: 0,
            dialogueWords: 0,
            actionWords: 0,
            dialogueSeconds: 0,
            actionSeconds: 0,
            directiveSeconds: 0,
            directiveCounts: {},
        };
    }
    
    // Parse directives first
    const directives = parseDirectives(content, settings);
    const directiveSeconds = directives.reduce((sum, d) => sum + d.seconds, 0);
    
    // Count directive types
    const directiveCounts: Record<string, number> = {};
    for (const d of directives) {
        directiveCounts[d.type] = (directiveCounts[d.type] || 0) + 1;
    }
    
    // Remove parentheticals for word counting
    const cleanContent = removeParentheticals(content);
    
    let dialogueWords = 0;
    let actionWords = 0;
    let dialogueSeconds = 0;
    let actionSeconds = 0;
    
    if (settings.contentType === 'screenplay') {
        // Screenplay: separate dialogue and action
        const { dialogue, nonDialogue } = extractDialogue(cleanContent);
        
        dialogueWords = dialogue.reduce((sum, d) => sum + countWords(d), 0);
        actionWords = countWords(nonDialogue);
        
        dialogueSeconds = (dialogueWords / settings.dialogueWpm) * 60;
        actionSeconds = (actionWords / settings.actionWpm) * 60;
    } else {
        // Novel/Audiobook: all text at narration rate
        const totalWords = countWords(cleanContent);
        actionWords = totalWords; // All words counted as "narration"
        actionSeconds = (totalWords / settings.narrationWpm) * 60;
    }
    
    const totalSeconds = dialogueSeconds + actionSeconds + directiveSeconds;
    
    return {
        totalSeconds: Math.round(totalSeconds),
        dialogueWords,
        actionWords,
        dialogueSeconds: Math.round(dialogueSeconds),
        actionSeconds: Math.round(actionSeconds),
        directiveSeconds: Math.round(directiveSeconds),
        directiveCounts,
    };
}

/**
 * Parse a Runtime YAML field value to seconds
 * Supports: "2:30", "2m30s", "150", "150s", "2.5m", "2 minutes 30 seconds"
 */
export function parseRuntimeField(value: string | number | undefined): number | null {
    if (value === undefined || value === null || value === '') return null;
    
    // If it's a number, assume seconds
    if (typeof value === 'number') return value;
    
    const text = String(value).trim().toLowerCase();
    if (text === '' || text === '0') return 0;
    
    // Format: "2:30" (MM:SS) or "1:23:45" (H:MM:SS)
    const colonMatch = text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (colonMatch) {
        if (colonMatch[3]) {
            // H:MM:SS
            const hours = parseInt(colonMatch[1]);
            const minutes = parseInt(colonMatch[2]);
            const seconds = parseInt(colonMatch[3]);
            return hours * 3600 + minutes * 60 + seconds;
        } else {
            // MM:SS
            const minutes = parseInt(colonMatch[1]);
            const seconds = parseInt(colonMatch[2]);
            return minutes * 60 + seconds;
        }
    }
    
    // Format: "2m30s" or "2m 30s" or "2min 30sec"
    const compoundMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|minutes?)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?$/);
    if (compoundMatch) {
        const minutes = parseFloat(compoundMatch[1]);
        const seconds = parseFloat(compoundMatch[2]);
        return Math.round(minutes * 60 + seconds);
    }
    
    // Format: "150s" or "150 seconds"
    const secondsMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?$/);
    if (secondsMatch) {
        return Math.round(parseFloat(secondsMatch[1]));
    }
    
    // Format: "2.5m" or "2.5 minutes"
    const minutesMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|minutes?)$/);
    if (minutesMatch) {
        return Math.round(parseFloat(minutesMatch[1]) * 60);
    }
    
    // Format: "1h" or "1 hour" or "1.5 hours"
    const hoursMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hours?)$/);
    if (hoursMatch) {
        return Math.round(parseFloat(hoursMatch[1]) * 3600);
    }
    
    // Try plain number
    const numericMatch = text.match(/^(\d+(?:\.\d+)?)$/);
    if (numericMatch) {
        return Math.round(parseFloat(numericMatch[1]));
    }
    
    return null;
}

/**
 * Format seconds to a Runtime YAML field value
 * Returns "MM:SS" or "H:MM:SS" depending on length
 */
export function formatRuntimeValue(totalSeconds: number): string {
    if (totalSeconds <= 0) return '0:00';
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.round(totalSeconds % 60);
    
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
