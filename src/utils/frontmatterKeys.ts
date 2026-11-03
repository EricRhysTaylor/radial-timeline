/*
 * Case-insensitive frontmatter property access. Dependency-free so pure
 * modules can read author-typed keys ("sketch order", "Sketch Order") alike.
 */

/** The key a note's frontmatter actually uses for `name`: an exact match, else a case variant. */
export function findFrontmatterKey(frontmatter: Record<string, unknown> | undefined, name: string): string | undefined {
    if (!frontmatter) return undefined;
    if (Object.prototype.hasOwnProperty.call(frontmatter, name)) return name;
    const lower = name.toLowerCase();
    return Object.keys(frontmatter).find(key => key.toLowerCase() === lower);
}

/** A frontmatter value read case-insensitively; undefined when the note lacks the property. */
export function readFrontmatterProperty(frontmatter: Record<string, unknown> | undefined, name: string): unknown {
    const key = findFrontmatterKey(frontmatter, name);
    return frontmatter && key !== undefined ? frontmatter[key] : undefined;
}
