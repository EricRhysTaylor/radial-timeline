import { describe, expect, it } from 'vitest';

/**
 * Regression: a deactivated font produced only "Pandoc export failed during
 * PDF compilation." The engine had already said exactly which font and why —
 * that detail was collected into `detail` and then dropped from the message
 * the user actually reads. fontspec wraps the error across lines with a
 * "(fontspec)" gutter, so the extraction must survive that shape.
 */
describe('categorizeExportError — missing font', () => {
    const fontspecStderr = [
        'Error producing PDF.',
        '! Package fontspec Error: ',
        '(fontspec)                The font "EB Garamond" cannot be found; this',
        '(fontspec)                may be but usually is not a fontspec bug.',
    ].join('\n');

    it('names the font that could not be loaded', () => {
        const failure = categorizeExportError(new Error(fontspecStderr));
        expect(failure.message).toContain('EB Garamond');
        expect(failure.message).not.toBe('Pandoc export failed during PDF compilation.');
    });

    it('points at deactivation, the cause a user cannot otherwise guess', () => {
        const failure = categorizeExportError(new Error(fontspecStderr));
        expect(failure.message.toLowerCase()).toContain('font book');
    });

    it('keeps the generic message when no font error is present', () => {
        const failure = categorizeExportError(new Error('pandoc: something else went wrong'));
        expect(failure.message).not.toContain('cannot be found');
    });
});
import { categorizeExportError, extractLatexErrorLines, identifyLatexMissingCause } from './exportErrors';

describe('export error categorization', () => {
    it('categorizes missing dependencies ahead of generic pandoc failures', () => {
        const failure = categorizeExportError('xelatex not found on PATH');
        expect(failure.category).toBe('missing_dependency');
        expect(failure.message).toMatch(/Missing export dependency/i);
    });

    it('categorizes template validation failures', () => {
        const failure = categorizeExportError('Layout "Signature Literary" is invalid: Template file must use a .tex extension.');
        expect(failure.category).toBe('invalid_template');
    });

    it('preserves raw detail for disclosure', () => {
        const failure = categorizeExportError('! LaTeX Error: File `foo.sty` not found.');
        expect(failure.category).toBe('pandoc_compile_failure');
        expect(failure.detail).toContain('foo.sty');
    });
});

// What Pandoc 3 and XeLaTeX (TeX Live 2026) print for each kind of template
// failure, recorded on 2026-11-19.
describe('extractLatexErrorLines', () => {
    it('keeps the error and where LaTeX stopped', () => {
        expect(extractLatexErrorLines('Error producing PDF.\n! Undefined control sequence.\nl.3 \\thisMacroDoesNotExist\n\n\n'))
            .toEqual(['! Undefined control sequence.', 'l.3 \\thisMacroDoesNotExist']);
    });

    it('drops the prompts LaTeX prints for a terminal', () => {
        const raw = "Error producing PDF.\n! LaTeX Error: \\begin{center} on input line 3 ended by \\end{document}.\n\nSee the LaTeX manual or LaTeX Companion for explanation.\nType  H <return>  for immediate help.\n ...                                              \n                                                  \nl.7 \\end{document}\n\n";
        expect(extractLatexErrorLines(raw)).toEqual(['! LaTeX Error: \\begin{center} on input line 3 ended by \\end{document}.', 'l.7 \\end{document}']);
    });

    it('keeps a missing-font report whole and stops at the line number', () => {
        const raw = 'Error producing PDF.\n! Package fontspec Error: \n(fontspec)                The font "RT No Such Font" cannot be\n(fontspec)                found; this may be but usually is not a fontspec\n(fontspec)                bug. Either there is a typo in the font name/file,\n(fontspec)                the font is not installed (correctly), or there is\n(fontspec)                a bug in the underlying font loading engine\n(fontspec)                (XeTeX/luaotfload).\n\nFor immediate help type H <return>.\n ...                                              \n                                                  \nl.4 \\begin\n\nAND MUCH MORE LOG\n';
        const lines = extractLatexErrorLines(raw);
        expect(lines[0]).toBe('! Package fontspec Error:');
        expect(lines[1]).toBe('(fontspec) The font "RT No Such Font" cannot be');
        expect(lines.at(-1)).toBe('l.4 \\begin');
        expect(lines).toHaveLength(8);
    });

    it('never returns more than the limit, however long the log', () => {
        const raw = `! First error.\n${Array.from({ length: 200 }, (_, i) => `noise line ${i}`).join('\n')}`;
        expect(extractLatexErrorLines(raw)).toHaveLength(9);
        expect(extractLatexErrorLines(raw, 3)).toEqual(['! First error.', 'noise line 0', 'noise line 1']);
    });

    it('names a missing font or package from what LaTeX printed, and nothing else', () => {
        const font = 'Error producing PDF.\n! Package fontspec Error: \n(fontspec)                The font "Garamond Premier Pro" cannot be\n(fontspec)                found; this may be but usually is not a fontspec\nl.5 \\begin\n';
        expect(identifyLatexMissingCause(font)).toEqual({ kind: 'font', name: 'Garamond Premier Pro' });
        expect(identifyLatexMissingCause("! LaTeX Error: File `lettrine.sty' not found.\n! Emergency stop.")).toEqual({ kind: 'package', name: 'lettrine' });
        // Another kind of missing file, or any other error, is not given a cause.
        expect(identifyLatexMissingCause("! LaTeX Error: File `cover.png' not found.")).toBeNull();
        expect(identifyLatexMissingCause('! Undefined control sequence.\nl.3 \\nope')).toBeNull();
        expect(identifyLatexMissingCause('')).toBeNull();
    });

    it('falls back to the first lines when LaTeX gave no "!" error', () => {
        expect(extractLatexErrorLines('Error producing PDF.\n[WARNING] Missing character: There is no X in font Y\n')).toEqual(['[WARNING] Missing character: There is no X in font Y']);
        expect(extractLatexErrorLines('')).toEqual([]);
    });
});
