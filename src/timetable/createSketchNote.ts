import type RadialTimelinePlugin from '../main';
import type { SketchPlacement } from './sketchPlacementFields';

/** Create the note first, preserving its contents if placement fails afterward. */
export async function createSketchNote(plugin: RadialTimelinePlugin, path: string, content: string, placement: SketchPlacement | null): Promise<boolean> {
    if (placement) await plugin.sketchPlacements.assertWritable();
    await plugin.app.vault.create(path, content);
    if (!placement) return true;
    try {
        await plugin.sketchPlacements.set([[path, placement]]);
        return true;
    } catch (error) {
        console.error('Sketch created but placement could not be saved', path, error);
        return false;
    }
}
