import type { ValidationIssue } from '../types';
import { escapeRegExp } from '../utils/regex';

export type RttsValidationLevel = 'invalid' | 'legacy' | 'compatible';

export interface RttsValidationResult {
    level: RttsValidationLevel;
    issues: ValidationIssue[];
    variables: {
        hasBody: boolean;
        hasTitle: boolean;
        hasAuthor: boolean;
        hooks: Record<string, boolean>;
    };
    declaredCapabilities: string[];
    detectedCapabilities: string[];
}

export interface RttsValidationOptions {
    declaredCapabilities?: string[];
    readError?: string;
}

export const RTTS_STRUCTURED_HOOKS = [
    'frontmatter_title',
    'frontmatter_dedication',
    'frontmatter_acknowledgments',
    'backmatter_author_note',
] as const;

const CAPABILITY_HOOKS: Record<string, string[]> = {
    semanticMatter: [...RTTS_STRUCTURED_HOOKS],
    frontmatter_title: ['frontmatter_title'],
    frontmatter_dedication: ['frontmatter_dedication'],
    frontmatter_acknowledgments: ['frontmatter_acknowledgments'],
    backmatter_author_note: ['backmatter_author_note'],
};

function hasPandocVariable(content: string, variable: string): boolean {
    const escaped = escapeRegExp(variable);
    return new RegExp(`\\$${escaped}\\$|\\$if\\(${escaped}\\)\\$`, 'i').test(content);
}

/** Argument count the export pipeline emits for `\rtPart`. */
export const RT_PART_REQUIRED_ARITY = 4;

const RT_PART_DEFINITION = /\\(?:new|renew|provide)command\s*\{?\s*\\rtPart\s*\}?\s*\[(\d+)\]/;

/**
 * Arity of a template's own `\rtPart` definition, or `null` when it defines none.
 *
 * A template that never defines `\rtPart` is not broken — layouts with
 * `parts.mode: 'off'` legitimately omit it, and the export simply never calls it.
 * Only a *mismatched* definition is a problem.
 */
export function detectRtPartArity(content: string): number | null {
    const match = RT_PART_DEFINITION.exec(content);
    if (!match) return null;
    const arity = Number(match[1]);
    return Number.isFinite(arity) ? arity : null;
}

/**
 * Blocking issue when a template's `\rtPart` cannot accept the arguments the
 * export emits, or `null` when it is compatible.
 *
 * Shared by import (reject on the way in) and export (block before compiling), so
 * a template that predates the title argument cannot silently mis-render: LaTeX
 * would consume whatever followed the call as the missing argument, swallowing
 * the opening of the part.
 */
export function describeRtPartArityIssue(content: string): { arity: number; message: string } | null {
    const arity = detectRtPartArity(content);
    if (arity === null || arity === RT_PART_REQUIRED_ARITY) return null;
    return {
        arity,
        message: `This template defines \\rtPart with ${arity} arguments, but the export emits ${RT_PART_REQUIRED_ARITY} `
            + `(numeral, title, quote, attribution). Re-import the bundled layout, or update the macro to take `
            + `${RT_PART_REQUIRED_ARITY} arguments.`,
    };
}

function pushIssue(
    target: ValidationIssue[],
    level: ValidationIssue['level'],
    code: string,
    message: string,
    detail?: string
): void {
    target.push({
        scope: 'asset',
        level,
        code,
        message,
        ...(detail ? { detail } : {}),
    });
}

function normalizeDeclaredCapabilities(capabilities: string[] | undefined): string[] {
    return Array.from(new Set(
        (capabilities || [])
            .map(capability => capability.trim())
            .filter(Boolean)
    ));
}

function getRequiredHooksForCapabilities(capabilities: string[]): string[] {
    const hooks = new Set<string>();
    for (const capability of capabilities) {
        for (const hook of CAPABILITY_HOOKS[capability] || []) {
            hooks.add(hook);
        }
    }
    return Array.from(hooks);
}

export function validateRttsTemplateContent(
    content: string,
    options: RttsValidationOptions = {}
): RttsValidationResult {
    const declaredCapabilities = normalizeDeclaredCapabilities(options.declaredCapabilities);
    const issues: ValidationIssue[] = [];
    const source = content || '';

    if (options.readError) {
        pushIssue(issues, 'error', 'rtts_template_unreadable', options.readError);
    }

    const hooks: Record<string, boolean> = {};
    for (const hook of RTTS_STRUCTURED_HOOKS) {
        hooks[hook] = hasPandocVariable(source, hook);
    }

    const variables = {
        hasBody: hasPandocVariable(source, 'body'),
        hasTitle: hasPandocVariable(source, 'title'),
        hasAuthor: hasPandocVariable(source, 'author'),
        hooks,
    };

    // Only template-side issues that BLOCK export are reported here.
    // Anything in the form "the template doesn't have X" is left out — that
    // describes template capability, not an actionable problem for the user.
    // Book-meta gaps the template *needs* are surfaced by
    // PublishingValidationService (the book-details and matter checklists).
    if (!variables.hasBody) {
        pushIssue(
            issues,
            'error',
            'rtts_missing_body',
            'Template is missing $body$; Pandoc has nowhere to place the manuscript.'
        );
    }

    // Fail loudly rather than rendering wrong: a legacy 3-argument \rtPart would
    // absorb the text following the call as its missing argument.
    const partArityIssue = describeRtPartArityIssue(source);
    if (partArityIssue) {
        pushIssue(
            issues,
            'error',
            'rtts_part_arity_mismatch',
            partArityIssue.message
        );
    }

    const hasAnyHook = Object.values(variables.hooks).some(Boolean);

    const requiredHooks = getRequiredHooksForCapabilities(declaredCapabilities);
    const declaredHooksPresent = requiredHooks.every(hook => variables.hooks[hook]);
    const level: RttsValidationLevel = !variables.hasBody || !!options.readError || !!partArityIssue
        ? 'invalid'
        : variables.hasTitle && variables.hasAuthor && declaredHooksPresent && hasAnyHook
            ? 'compatible'
            : 'legacy';

    const detectedCapabilities: string[] = RTTS_STRUCTURED_HOOKS.filter(hook => variables.hooks[hook]);
    if (detectedCapabilities.length > 0) {
        detectedCapabilities.push('structuredBlocks');
    }

    return {
        level,
        issues,
        variables,
        declaredCapabilities,
        detectedCapabilities,
    };
}
