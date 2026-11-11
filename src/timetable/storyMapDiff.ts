/** A saved description of the manuscript used to generate a story map.
 * Paths are identities here, not Canvas node IDs: one scene may appear in
 * several subplot lanes. Callers must update paths when notes are renamed. */
export interface StoryMapScene {
    path: string;
    act: number | null;
    subplots: string[];
}

export interface StoryMapChanges {
    added: StoryMapScene[];
    removed: StoryMapScene[];
    actChanged: Array<{ before: StoryMapScene; after: StoryMapScene }>;
    subplotsChanged: Array<{ before: StoryMapScene; after: StoryMapScene }>;
    orderChanged: boolean;
}

/** Compare manuscript structure without treating a newly inserted or removed
 * scene as a reorder of every scene following it. This does not mutate Canvas. */
export function diffStoryMap(before: readonly StoryMapScene[], after: readonly StoryMapScene[]): StoryMapChanges {
    const oldByPath = new Map(before.map(scene => [scene.path, scene]));
    const newByPath = new Map(after.map(scene => [scene.path, scene]));
    const added = after.filter(scene => !oldByPath.has(scene.path));
    const removed = before.filter(scene => !newByPath.has(scene.path));
    const actChanged: StoryMapChanges['actChanged'] = [];
    const subplotsChanged: StoryMapChanges['subplotsChanged'] = [];
    for (const scene of after) {
        const previous = oldByPath.get(scene.path);
        if (!previous) continue;
        if (previous.act !== scene.act) actChanged.push({ before: previous, after: scene });
        const oldLanes = new Set(previous.subplots);
        const newLanes = new Set(scene.subplots);
        if (oldLanes.size !== newLanes.size || [...oldLanes].some(lane => !newLanes.has(lane))) {
            subplotsChanged.push({ before: previous, after: scene });
        }
    }
    const oldOrder = before.filter(scene => newByPath.has(scene.path)).map(scene => scene.path);
    const newOrder = after.filter(scene => oldByPath.has(scene.path)).map(scene => scene.path);
    return { added, removed, actChanged, subplotsChanged, orderChanged: oldOrder.some((path, index) => path !== newOrder[index]) };
}
