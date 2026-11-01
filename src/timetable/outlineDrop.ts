/** Resolve only explicit Obsidian links naming this vault; callers verify files exist. */
export function vaultDragPaths(text: string, vaultName: string): string[] {
    const paths: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        try {
            const url = new URL(line.trim());
            if (url.protocol !== 'obsidian:' || url.hostname !== 'open' || url.searchParams.get('vault') !== vaultName) continue;
            const path = url.searchParams.get('file');
            if (path) paths.push(path);
        } catch { /* Plain text, external file paths, and malformed URLs are not vault notes. */ }
    }
    return [...new Set(paths)];
}
