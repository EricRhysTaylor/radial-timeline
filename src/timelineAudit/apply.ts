/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Auditor - Apply Adapter
 */

import type { App } from 'obsidian';
import { writeFrontmatterUpdates, type WriteOptions } from '../timelineRepair/frontmatterWriter';
import type { FrontmatterUpdate, FrontmatterWriteResult } from '../timelineRepair/types';
import type { TimelineAuditFinding } from './types';

export interface TimelineAuditApplyPlan {
    whenUpdates: FrontmatterUpdate[];
}

/**
 * Only accepted When replacements touch files. Keep/mark-review decisions
 * are session state — the author's YAML carries no plugin bookkeeping.
 */
export function buildAuditApplyPlan(findings: TimelineAuditFinding[]): TimelineAuditApplyPlan {
    const whenUpdates: FrontmatterUpdate[] = [];

    for (const finding of findings) {
        if (finding.reviewAction === 'apply' && finding.suggestedWhen && finding.suggestedProvenance) {
            whenUpdates.push({
                file: finding.file,
                when: finding.suggestedWhen,
                whenSource: finding.suggestedProvenance
            });
        }
    }

    return { whenUpdates };
}

export async function applyAuditFindings(
    app: App,
    findings: TimelineAuditFinding[],
    options: WriteOptions = {}
): Promise<FrontmatterWriteResult> {
    const plan = buildAuditApplyPlan(findings);
    return writeFrontmatterUpdates(app, plan.whenUpdates, options);
}
