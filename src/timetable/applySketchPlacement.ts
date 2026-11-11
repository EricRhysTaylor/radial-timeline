import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { classifyForPromotion } from '../services/PromoteToSceneService';
import { findFrontmatterKey } from '../utils/frontmatterKeys';
import type { SketchDropPlan } from './sketchPlacement';
import { authorKeyFor } from './timetableFiles';

/** Apply a move as one recoverable operation across author notes and the sidecar. */
export async function applySketchPlacement(plugin: RadialTimelinePlugin, plan: SketchDropPlan): Promise<void> {
    await plugin.sketchPlacements.assertWritable();
    const changed: Array<{ file: TFile; key: string; existed: boolean; value: unknown }> = [];
    try {
        for (const path of plan.orderedPaths) {
            const file = plugin.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) throw new Error(`Sketch no longer exists: ${path}`);
            await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                const classification = classifyForPromotion(fm);
                if (classification.kind !== 'eligible' || !classification.fromSketch) throw new Error(`Not a sketch: ${path}`);
                const key = findFrontmatterKey(fm, authorKeyFor('Act', plugin.settings)) ?? authorKeyFor('Act', plugin.settings);
                const existed = Object.prototype.hasOwnProperty.call(fm, key);
                if (plan.act === null ? !existed : fm[key] === plan.act) return;
                changed.push({ file, key, existed, value: fm[key] });
                if (plan.act === null) delete fm[key]; else fm[key] = plan.act;
            });
        }
        await plugin.sketchPlacements.set(plan.orderedPaths.map((path, index) => [path, { after: plan.anchorId ?? undefined, order: (index + 1) * 10 }] as const));
    } catch (error) {
        let incomplete = false;
        for (const prior of changed.reverse()) {
            try {
                await plugin.app.fileManager.processFrontMatter(prior.file, (fm: Record<string, unknown>) => {
                    const exists = Object.prototype.hasOwnProperty.call(fm, prior.key);
                    // Do not replace an Act someone changed after this move started.
                    if (plan.act === null ? exists : !exists || fm[prior.key] !== plan.act) { incomplete = true; return; }
                    if (prior.existed) fm[prior.key] = prior.value; else delete fm[prior.key];
                });
            } catch (rollbackError) {
                incomplete = true;
                console.error('Could not restore sketch act', prior.file.path, rollbackError);
            }
        }
        if (incomplete) throw new Error(`Sketch placement failed and some Act values could not be restored: ${String(error)}`);
        throw error;
    }
}
