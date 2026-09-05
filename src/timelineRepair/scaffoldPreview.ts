/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Scaffold Preview
 * Small presentational helper for the config-phase pattern preview.
 */

import type { PatternPresetId, TimeBucket } from './types';
import { TIME_BUCKET_LABELS, SCAFFOLD_PATTERNS } from './types';
import { getInitialBeatIndex } from './patternSync';
import { getFormattingLocale } from '../i18n';

export interface ScaffoldPreviewStep {
    sceneLabel: string;
    spacingLabel: string;
}

export interface ScaffoldPreviewModel {
    startLabel: string;
    helperLabel: string;
    steps: ScaffoldPreviewStep[];
}

export function buildScaffoldPreview(
    patternPreset: PatternPresetId,
    anchorWhen: Date,
    totalScenes: number,
    maxSteps = 5
): ScaffoldPreviewModel {
    const visibleSteps = Math.max(1, Math.min(Math.max(totalScenes, 1), maxSteps));

    return {
        startLabel: `Start: ${formatAnchorLabel(anchorWhen)}`,
        helperLabel: `Scaffolds ${totalScenes} ${totalScenes === 1 ? 'scene' : 'scenes'} in narrative order.`,
        steps: buildPreviewLabels(patternPreset, anchorWhen, visibleSteps).map((spacingLabel, index) => ({
            sceneLabel: `S${index + 1}`,
            spacingLabel
        }))
    };
}

function buildPreviewLabels(
    patternPreset: PatternPresetId,
    anchorWhen: Date,
    count: number
): string[] {
    const pattern = SCAFFOLD_PATTERNS[patternPreset];
    
    if (pattern.type === 'interval') {
        if (patternPreset === 'weekly') {
            return Array.from({ length: count }, (_, index) => `Week ${index + 1}`);
        } else {
            return Array.from({ length: count }, (_, index) => `Day ${index + 1}`);
        }
    }
    
    // Cycle pattern
    const startIndex = getInitialBeatIndex(anchorWhen, patternPreset);
    return buildBeatLabels(pattern.sequence, startIndex, count);
}

function buildBeatLabels(cycle: TimeBucket[], startIndex: number, count: number): string[] {
    const labels: string[] = [];

    for (let index = 0; index < count; index++) {
        const cycleIndex = (startIndex + index) % cycle.length;
        const bucket = cycle[cycleIndex];
        const bucketLabel = TIME_BUCKET_LABELS[bucket];
        labels.push(bucketLabel);
    }

    return labels;
}

function formatAnchorLabel(anchorWhen: Date): string {
    const dateLabel = new Intl.DateTimeFormat(getFormattingLocale(), {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(anchorWhen);

    const timeLabel = new Intl.DateTimeFormat(getFormattingLocale(), {
        hour: 'numeric',
        minute: '2-digit'
    }).format(anchorWhen);

    return `${dateLabel} · ${timeLabel}`;
}
