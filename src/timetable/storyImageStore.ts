import type RadialTimelinePlugin from '../main';

export interface StoryImageChoice { character?: string; image?: string; placeImage?: string }

/** Rebase choices when either a note, image, or containing folder is renamed. */
export function rebaseStoryImageChoices(choices: Record<string, StoryImageChoice>, oldPath: string, newPath: string): Record<string, StoryImageChoice> {
    const rebase = (path: string) => path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
    const result: Record<string, StoryImageChoice> = {};
    for (const [path, choice] of Object.entries(choices)) {
        const target = rebase(path);
        // Never overwrite an existing choice if the new path already has one.
        if (target !== path && choices[target]) { result[path] = choice; continue; }
        result[target] = { ...choice, ...(choice.image ? { image: rebase(choice.image) } : {}), ...(choice.placeImage ? { placeImage: rebase(choice.placeImage) } : {}) };
    }
    return result;
}

export function storyImageChoice(plugin: RadialTimelinePlugin, path: string): StoryImageChoice {
    return plugin.settings.storyImageChoices?.[path] ?? {};
}

export async function saveStoryImageChoice(plugin: RadialTimelinePlugin, path: string, choice: StoryImageChoice | null): Promise<void> {
    const previous = plugin.settings.storyImageChoices;
    const next = { ...previous };
    if (choice && Object.values(choice).some(Boolean)) next[path] = choice; else delete next[path];
    plugin.settings.storyImageChoices = next;
    try { await plugin.saveSettings(); }
    catch (error) { if (plugin.settings.storyImageChoices === next) plugin.settings.storyImageChoices = previous; throw error; }
}
