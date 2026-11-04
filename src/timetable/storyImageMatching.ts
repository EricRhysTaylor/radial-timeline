import type { TFile } from 'obsidian';

const IMAGE_EXTENSION = /^(png|jpe?g|gif|webp|avif)$/i;
const indexes = new WeakMap<readonly TFile[], Map<string, TFile[]>>();
const normalized = (value: string) => value.trim().normalize('NFC').toLocaleLowerCase();

function indexImages(files: readonly TFile[]): Map<string, TFile[]> {
    const cached = indexes.get(files);
    if (cached) return cached;
    const index = new Map<string, TFile[]>();
    for (const file of files) {
        if (!IMAGE_EXTENSION.test(file.extension)) continue;
        const name = normalized(file.basename);
        const variant = /^(.*) \d+$/.exec(name)?.[1];
        for (const key of new Set([name, ...(variant ? [variant] : [])])) {
            const entries = index.get(key) ?? [];
            entries.push(file);
            index.set(key, entries);
        }
    }
    indexes.set(files, index);
    return index;
}

/** The linked note name, independent of folder and display alias. */
export function imageSubjectName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const path = value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim();
    const name = path.split('/').pop()?.replace(/\.md$/i, '').trim();
    return name || null;
}

/** Match an exact subject name or a numbered variant. Ambiguous same-name files are excluded. */
export function matchingStoryImages(files: readonly TFile[], subject: string): TFile[] {
    const key = normalized(subject);
    if (!key) return [];
    const matches = indexImages(files).get(key) ?? [];
    const counts = new Map<string, number>();
    for (const file of matches) {
        const name = file.basename.normalize('NFC').toLocaleLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return matches.filter(file => counts.get(file.basename.normalize('NFC').toLocaleLowerCase()) === 1)
        .sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' }) || a.path.localeCompare(b.path));
}

/** A deterministic selection per scene, unchanged by rendering or filter changes. */
export function stableStoryImage(files: readonly TFile[], scenePath: string, subject: string): TFile | null {
    const candidates = matchingStoryImages(files, subject);
    if (!candidates.length) return null;
    let hash = 2166136261;
    for (const char of `${scenePath}\0${subject}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return candidates[(hash >>> 0) % candidates.length];
}

export type StoryImageStrategy = 'first' | 'distinctive' | 'pov' | 'balanced';

/** Rank candidates using whole-book counts supplied by the caller. */
export function chooseImageSubject(candidates: readonly string[], strategy: StoryImageStrategy, frequencies: ReadonlyMap<string, number>, pov: string | null, previous: string | null): string | null {
    if (!candidates.length) return null;
    const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase();
    if (strategy === 'pov' && pov) {
        const match = candidates.find(name => normalize(name) === normalize(pov));
        if (match) return match;
    }
    if (strategy === 'first' || strategy === 'pov') return candidates[0];
    return [...candidates].sort((a, b) => {
        if (strategy === 'balanced' && previous) {
            const aRepeat = normalize(a) === normalize(previous) ? 1 : 0;
            const bRepeat = normalize(b) === normalize(previous) ? 1 : 0;
            if (aRepeat !== bRepeat) return aRepeat - bRepeat;
        }
        return (frequencies.get(normalize(a)) ?? 0) - (frequencies.get(normalize(b)) ?? 0) || candidates.indexOf(a) - candidates.indexOf(b);
    })[0];
}
