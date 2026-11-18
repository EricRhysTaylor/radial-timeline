import type { TimelineItem } from '../../types';
import { isSceneItem } from '../../utils/sceneHelpers';
import type { TimeReference } from './model';

/** Only highlight dated scenes when the reference itself identifies a day or a clock time.
 * A year, month or explicit span is useful context but does not identify a particular scene. */
export function referenceSceneMatches(references: TimeReference[], scenes: TimelineItem[]): Set<string> {
    const matches = new Set<string>();
    for (const reference of references) {
        const date = reference.when;
        if (reference.end || date.precision === 'year' || date.precision === 'month') continue;
        for (const scene of scenes) {
            if (!isSceneItem(scene) || !scene.path || !(scene.when instanceof Date) || !Number.isFinite(scene.when.getTime())) continue;
            // An undated clock cannot establish that a scene occurred at an exact reference time.
            if ((date.precision === 'minute' || date.precision === 'second') && scene.whenHasClock !== true) continue;
            const when = scene.when.getTime();
            if (when >= date.start && when < date.end) matches.add(scene.path);
        }
    }
    return matches;
}
