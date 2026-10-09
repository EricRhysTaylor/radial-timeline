export const MARKDOWN_FENCE_OPEN_PATTERN = /^\s*(`{3,}|~{3,})/;

/** A closer uses the same character, at least the opener's length, and no info string. */
export function isClosingMarkdownFence(line: string, opener: string): boolean {
    const match = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    return Boolean(match && match[1][0] === opener[0] && match[1].length >= opener.length);
}
