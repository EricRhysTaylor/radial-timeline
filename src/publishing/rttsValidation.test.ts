import { describe, expect, it } from 'vitest';
import {
    describeRtPartArityIssue,
    detectRtPartArity,
    validateRttsTemplateContent,
} from './rttsValidation';

describe('\\rtPart arity', () => {
    it('reads the declared argument count from a definition', () => {
        expect(detectRtPartArity('\\newcommand{\\rtPart}[4]{%\n}')).toBe(4);
        expect(detectRtPartArity('\\newcommand{\\rtPart}[3]{%\n}')).toBe(3);
        // Templates may redefine rather than define.
        expect(detectRtPartArity('\\renewcommand{\\rtPart}[4]{}')).toBe(4);
        expect(detectRtPartArity('\\providecommand{\\rtPart}[3]{}')).toBe(3);
        // Tolerates the spacing variations real templates carry.
        expect(detectRtPartArity('\\newcommand {\\rtPart} [4] {}')).toBe(4);
    });

    it('reports no arity when the template defines no \\rtPart', () => {
        // Not an error: layouts with parts off legitimately omit the macro, and
        // the export never calls it for them.
        expect(detectRtPartArity('$body$')).toBeNull();
        expect(detectRtPartArity('\\rtPart{I}{}{q}{a}')).toBeNull();
        expect(describeRtPartArityIssue('$body$')).toBeNull();
    });

    it('flags a legacy 3-argument definition with a repair path', () => {
        const issue = describeRtPartArityIssue('\\newcommand{\\rtPart}[3]{%\n}');
        expect(issue?.arity).toBe(3);
        expect(issue?.message).toContain('3 arguments');
        expect(issue?.message).toContain('4');
        // The message has to tell the author what to do, not just what is wrong.
        expect(issue?.message).toMatch(/re-import|update the macro/i);
    });

    it('accepts the arity the export actually emits', () => {
        expect(describeRtPartArityIssue('\\newcommand{\\rtPart}[4]{%\n}')).toBeNull();
    });

    it('blocks export for a legacy definition rather than rendering it wrong', () => {
        const result = validateRttsTemplateContent(
            '$title$\n$author$\n\\newcommand{\\rtPart}[3]{}\n$body$'
        );

        // 'invalid' is what PublishingValidationService turns into a blocking
        // preflight error, so this is the difference between a clear failure and
        // LaTeX swallowing the text after the call as its missing argument.
        expect(result.level).toBe('invalid');
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'error',
                code: 'rtts_part_arity_mismatch',
            }),
        ]));
    });

    it('does not block a compatible template', () => {
        const result = validateRttsTemplateContent(
            '$title$\n$author$\n\\newcommand{\\rtPart}[4]{}\n$body$'
        );
        expect(result.issues.filter(issue => issue.code === 'rtts_part_arity_mismatch')).toEqual([]);
        expect(result.level).not.toBe('invalid');
    });
});

describe('RTTS validation', () => {
    it('marks templates without $body$ as invalid', () => {
        const result = validateRttsTemplateContent('\\documentclass{book}\\begin{document}\\end{document}');

        expect(result.level).toBe('invalid');
        expect(result.variables.hasBody).toBe(false);
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'error',
                code: 'rtts_missing_body',
            }),
        ]));
    });

    it('marks $body$-only templates as legacy without surfacing warnings', () => {
        const result = validateRttsTemplateContent('\\begin{document}\n$body$\n\\end{document}');

        expect(result.level).toBe('legacy');
        expect(result.variables.hasBody).toBe(true);
        expect(result.detectedCapabilities).toEqual([]);
        // Template-side absences (no $title$, no $author$, no hooks) are not
        // user-facing problems — they describe template design, not export
        // blockers. The issues array should contain no warnings.
        expect(result.issues.filter(issue => issue.level === 'warning')).toEqual([]);
    });

    it('marks templates with body, metadata, and declared hooks as compatible', () => {
        const result = validateRttsTemplateContent([
            '\\begin{document}',
            '$title$',
            '$author$',
            '$frontmatter_title$',
            '$body$',
            '\\end{document}',
        ].join('\n'), {
            declaredCapabilities: ['frontmatter_title'],
        });

        expect(result.level).toBe('compatible');
        expect(result.variables.hasTitle).toBe(true);
        expect(result.variables.hasAuthor).toBe(true);
        expect(result.variables.hooks.frontmatter_title).toBe(true);
        expect(result.detectedCapabilities).toContain('frontmatter_title');
        expect(result.detectedCapabilities).toContain('structuredBlocks');
    });

    it('does not warn when $title$ or $author$ are absent — those describe template design, not export blockers', () => {
        const result = validateRttsTemplateContent('$body$');

        expect(result.level).toBe('legacy');
        expect(result.variables.hasTitle).toBe(false);
        expect(result.variables.hasAuthor).toBe(false);
        expect(result.issues.filter(issue => issue.level === 'warning')).toEqual([]);
    });

    it('does not warn when a declared capability lacks its hook — those describe template design, not export blockers', () => {
        const result = validateRttsTemplateContent('$title$\n$author$\n$body$', {
            declaredCapabilities: ['frontmatter_dedication'],
        });

        expect(result.level).toBe('legacy');
        expect(result.issues.filter(issue => issue.level === 'warning')).toEqual([]);
    });
});
