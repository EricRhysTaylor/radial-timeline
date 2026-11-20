/*
 * What an imported LaTeX template says about itself.
 *
 * Everything here is read from the file as written. Nothing is inferred: no
 * style name, no score, no guess at what the pages will look like. Two rules
 * keep a reading honest:
 *
 *   - LaTeX comments are removed first, so a commented-out line is never
 *     reported.
 *   - A line inside a Pandoc `$if(...)$` block only takes effect when that
 *     variable is set, so it is reported as conditional, never as on.
 *
 * What the pages actually look like is measured from the test PDF instead
 * (importedTemplateCheck.ts).
 */

/** Remove LaTeX comments: an unescaped `%` to the end of its line. */
export function stripLatexComments(tex: string): string {
    return tex.split('\n').map(line => {
        for (let i = 0; i < line.length; i++) {
            if (line[i] !== '%') continue;
            let backslashes = 0;
            for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++;
            if (backslashes % 2 === 0) return line.slice(0, i);
        }
        return line;
    }).join('\n');
}

export interface TemplateFont {
    /** What the template uses the font for, from the command that sets it. */
    role: 'main' | 'sans' | 'mono' | 'math' | 'other';
    /** The font as named in the template: a family name or a font file. */
    name: string;
    conditional: boolean;
}

export interface TemplatePackage {
    name: string;
    conditional: boolean;
}

export type TemplateDocumentClass =
    /** `\documentclass[options]{name}` as written. Options that are Pandoc variables are left out. */
    | { kind: 'named'; name: string; options: string[] }
    /** `\documentclass{$variable$}`: the class is whatever that Pandoc variable holds. */
    | { kind: 'variable'; variable: string };

export interface TemplateFacts {
    hasBody: boolean;
    documentClass: TemplateDocumentClass | null;
    fonts: TemplateFont[];
    packages: TemplatePackage[];
    /** Pandoc variables the template reads that Radial Timeline fills from Book Details. */
    bookDetails: Array<'title' | 'author'>;
    /** True when the template includes `$header-includes$`, where Radial Timeline's own PDF settings arrive. */
    readsHeaderIncludes: boolean;
    /** Every other Pandoc variable the template reads, by name. */
    otherVariables: string[];
    /** The template defines `\rtPart`, `\rtChapter` and `\rtSceneSep` itself. */
    structuralMacros: boolean;
}

const FONT_ROLES: Record<string, TemplateFont['role']> = {
    setmainfont: 'main', setromanfont: 'main', setsansfont: 'sans', setmonofont: 'mono', setmathfont: 'math',
    newfontfamily: 'other', newfontface: 'other',
};

// Words of Pandoc's template language, and its loop variable, which are not variables a template reads.
const TEMPLATE_KEYWORDS = new Set(['if', 'else', 'elseif', 'endif', 'for', 'endfor', 'sep', 'it']);

/** Start and end offsets of each outermost Pandoc `$if(...)$ … $endif$` block. */
function findConditionalRanges(tex: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const token = /\$if\([^)]*\)\$|\$endif\$/g;
    let depth = 0;
    let start = 0;
    for (let match = token.exec(tex); match; match = token.exec(tex)) {
        if (match[0] === '$endif$') {
            if (depth === 0) continue;
            depth -= 1;
            if (depth === 0) ranges.push([start, match.index + match[0].length]);
        } else {
            if (depth === 0) start = match.index;
            depth += 1;
        }
    }
    // An unclosed block runs to the end of the file.
    if (depth > 0) ranges.push([start, tex.length]);
    return ranges;
}

/** True when the template defines `\name` itself. */
function definesMacro(tex: string, name: string): boolean {
    return new RegExp(`\\\\(?:(?:re)?newcommand|providecommand|(?:Re)?NewDocumentCommand|def)\\*?\\s*\\{?\\s*\\\\${name}(?![A-Za-z])`).test(tex);
}

/**
 * A template built on Radial Timeline's structural macros, such as an edited
 * copy of a built-in layout. Only then does an export send it parts, chapters
 * and scene separators as `\rtPart`, `\rtChapter` and `\rtSceneSep`; any other
 * template gets plain Markdown headings. All three must be defined, because
 * an export that takes this path may call each of them.
 */
export function templateDefinesStructuralMacros(tex: string): boolean {
    const source = stripLatexComments(tex);
    return ['rtPart', 'rtChapter', 'rtSceneSep'].every(name => definesMacro(source, name));
}

/** True when the template has the `$body$` placeholder outside a comment. */
export function templateHasBody(tex: string): boolean {
    return /\$body\$/.test(stripLatexComments(tex));
}

export function readTemplateFacts(tex: string): TemplateFacts {
    const source = stripLatexComments(tex);
    const conditionalRanges = findConditionalRanges(source);
    const isConditional = (index: number) => conditionalRanges.some(([start, end]) => index >= start && index < end);
    const isVariable = (text: string) => text.includes('$');

    let documentClass: TemplateDocumentClass | null = null;
    const classMatch = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(source);
    if (classMatch) {
        const name = classMatch[2].trim();
        const variable = /^\$([A-Za-z][\w.-]*)\$$/.exec(name);
        if (variable) documentClass = { kind: 'variable', variable: variable[1] };
        else if (name && !isVariable(name)) {
            const written = classMatch[1] ?? ''; // SAFE: no [options] written means an empty list
            const options = written.split(/[,\n]/).map(option => option.trim()).filter(option => option && !isVariable(option));
            documentClass = { kind: 'named', name, options };
        }
    }

    const fonts: TemplateFont[] = [];
    // \setmainfont[options]{Name}, \setmainfont{Name}[options], \newfontfamily\name{Name}, \newfontfamily{\name}[options]{Name}
    const fontCommand = /\\(setmainfont|setromanfont|setsansfont|setmonofont|setmathfont|newfontfamily|newfontface)\b\s*(?:\\[A-Za-z@]+|\{\\[A-Za-z@]+\})?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
    for (let match = fontCommand.exec(source); match; match = fontCommand.exec(source)) {
        const name = match[2].trim();
        if (!name || isVariable(name)) continue;
        // A font named twice is listed once, under the first use the template gives it.
        if (fonts.some(font => font.name === name)) continue;
        fonts.push({ role: FONT_ROLES[match[1]], name, conditional: isConditional(match.index) });
    }

    const packages: TemplatePackage[] = [];
    const packageCommand = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
    for (let match = packageCommand.exec(source); match; match = packageCommand.exec(source)) {
        const conditional = isConditional(match.index);
        for (const name of match[1].split(',').map(part => part.trim())) {
            if (!name || isVariable(name)) continue;
            const known = packages.find(item => item.name === name);
            // Loaded in more than one place: unconditional wins.
            if (known) known.conditional = known.conditional && conditional;
            else packages.push({ name, conditional });
        }
    }

    const variables = new Set<string>();
    const variableUse = /\$(?:if|for|elseif)\(([A-Za-z][\w-]*)[^)]*\)\$|\$([A-Za-z][\w-]*)(?:\.[\w.-]+)?(?:\/[a-z]+)?\$/g;
    for (let match = variableUse.exec(source); match; match = variableUse.exec(source)) {
        const name = match[1] || match[2];
        if (name && !TEMPLATE_KEYWORDS.has(name)) variables.add(name);
    }
    const hasBody = variables.delete('body');
    const readsHeaderIncludes = variables.delete('header-includes');
    const bookDetails = (['title', 'author'] as const).filter(name => variables.delete(name));

    return {
        hasBody,
        documentClass,
        fonts,
        packages,
        bookDetails,
        readsHeaderIncludes,
        otherVariables: [...variables].sort((a, b) => a.localeCompare(b)),
        structuralMacros: ['rtPart', 'rtChapter', 'rtSceneSep'].every(name => definesMacro(source, name)),
    };
}
