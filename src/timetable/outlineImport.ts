export interface OutlineImportEntry { id: string; title: string; body: string; act: number | null; }
interface Heading { line: number; level: number; title: string; }

/** ATX headings outside fenced code and frontmatter; never infer structure from prose. */
export function parseOutlineHeadings(markdown: string, sketchLevel: number, actLevel: number | null, actCount: number): OutlineImportEntry[] {
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(markdown);
    const body = markdown.slice(frontmatter?.[0].length ?? 0);
    const lines = body.split(/\r?\n/);
    const headings: Heading[] = [];
    let fence: { char: string; length: number } | null = null;
    for (const [line, text] of lines.entries()) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
        if (marker) {
            const char = marker[1][0];
            if (!fence) fence = { char, length: marker[1].length };
            else if (fence.char === char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
            continue;
        }
        if (fence) continue;
        const match = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(text);
        if (match) headings.push({ line, level: match[1].length, title: match[2].replace(/\s+#+\s*$/, '').trim() });
    }
    return headings.filter(heading => heading.level === sketchLevel && heading.title).map(heading => {
        const next = headings.find(other => other.line > heading.line && other.level <= sketchLevel);
        const ancestors = headings.filter(other => other.line < heading.line && actLevel !== null && actLevel < sketchLevel && other.level === actLevel);
        const parent = ancestors.at(-1);
        // A heading at or above the act's level closes the previous act section.
        const validParent = parent && !headings.some(other => other.line > parent.line && other.line < heading.line && other.level <= parent.level);
        const number = validParent ? /^act\s+([1-9]\d*)(?:\b|$)/i.exec(parent.title)?.[1] : undefined;
        const act = number && Number(number) <= actCount ? Number(number) : null;
        return { id: String(heading.line), title: heading.title, body: lines.slice(heading.line + 1, next?.line ?? lines.length).join('\n').trim(), act };
    });
}
