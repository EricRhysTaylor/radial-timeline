export interface MinimapSubsetItem {
    id: string;
    sceneId?: string;
    filePath?: string;
    filePaths?: string[];
}

export interface MinimapSubsetResult {
    included: boolean[];
    includedCount: number;
    hasSubset: boolean;
}

function hasPathMatch(item: MinimapSubsetItem, includedPaths: ReadonlySet<string>): boolean {
    if (!includedPaths.size) return false;
    if (item.filePath && includedPaths.has(item.filePath)) return true;
    if (item.filePaths?.some(path => includedPaths.has(path))) return true;
    return false;
}

export function buildMinimapSubsetResult(
    items: MinimapSubsetItem[],
    includedSceneIds: ReadonlySet<string>,
    includedPaths: ReadonlySet<string>
): MinimapSubsetResult {
    if (!items.length) {
        return { included: [], includedCount: 0, hasSubset: false };
    }

    if (!includedSceneIds.size && !includedPaths.size) {
        return {
            included: items.map(() => true),
            includedCount: items.length,
            hasSubset: false
        };
    }

    const included = items.map(item => {
        const sceneId = (item.sceneId || '').trim();
        if (sceneId && includedSceneIds.has(sceneId)) return true;
        return hasPathMatch(item, includedPaths);
    });

    const includedCount = included.filter(Boolean).length;
    const hasSubset = includedCount > 0 && includedCount < items.length;

    return { included, includedCount, hasSubset };
}
