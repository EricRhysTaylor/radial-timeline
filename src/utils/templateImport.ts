import { normalizePath, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type {
    PandocLayoutTemplate,
    ProfileOrigin,
    TemplateAsset,
    TemplateProfile,
    UsageContext,
    ValidationIssue,
    ValidationSummary,
} from '../types';
import { getAutoPdfEngineSelection, getPandocFolder, resolveTemplatePath, validatePandocLayout } from './exportFormats';
import { adaptPandocLayoutToTemplateAsset, adaptPandocLayoutToTemplateProfile } from './publishingModel';
import { summarizeValidationIssues } from '../services/PublishingValidationService';
import type { DetectedTemplateProfile } from '../publishing/templateDetection';
import { detectImportedTemplateStyle } from '../publishing/templateDetection';
import { describeRtPartArityIssue } from '../publishing/rttsValidation';
import { basename } from './paths';

export interface ImportedTemplateCandidate {
    layout: PandocLayoutTemplate;
    asset: TemplateAsset;
    profile: TemplateProfile;
    detectedTemplate: DetectedTemplateProfile;
    issues: ValidationIssue[];
    summary: ValidationSummary;
    semanticNote: string;
    previewLines: string[];
    canActivate: boolean;
}

export interface TemplateImportInput {
    sourcePath: string;
    sourceContent?: string;
    name?: string;
    preset?: UsageContext;
    description?: string;
    origin?: ProfileOrigin;
    draft?: boolean;
    usesModernClassicStructure?: boolean;
    hasEpigraphs?: boolean;
    hasSceneOpenerHeadingOptions?: boolean;
}

const NARROW_LAYOUT_HINTS = [
    /screenplay/i,
    /\bslugline\b/i,
    /\bdialogue\b/i,
    /\bcharacter\b/i,
    /\bscene heading\b/i,
    /\bINT\./i,
    /\bEXT\./i,
];

const PODCAST_LAYOUT_HINTS = [
    /podcast/i,
    /\bhost\b/i,
    /\bguest\b/i,
    /\baudio\b/i,
    /\btiming\b/i,
];

const MODERN_CLASSIC_HINTS = [
    /modern classic/i,
    /\\rtPart\b/,
    /\\rtChapter\b/,
    /\\epigraph\b/,
];

const SIGNATURE_HINTS = [
    /signature literary/i,
    /running headers?/i,
    /letter[- ]spaced/i,
    /scene opener/i,
];

export function isAbsolutePath(value: string): boolean {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

export function compactTemplatePathForStorage(plugin: RadialTimelinePlugin, rawPath: string): string {
    const trimmed = rawPath.trim();
    if (!trimmed) return '';
    if (isAbsolutePath(trimmed)) {
        return trimmed;
    }

    const normalized = normalizePath(trimmed.replace(/^\/+/, ''));
    if (!normalized) return '';

    const prefix = `${getPandocFolder(plugin)}/`;
    if (normalized.startsWith(prefix)) {
        return normalized.slice(prefix.length);
    }
    return normalized;
}

export function buildImportedTemplateId(name: string, preset: UsageContext, existingIds: Iterable<string>): string {
    const base = `imported-${slugify(name)}-${preset}`;
    let candidate = base;
    let index = 2;
    const used = new Set(existingIds);
    while (used.has(candidate)) {
        candidate = `${base}-${index}`;
        index += 1;
    }
    return candidate;
}

export async function buildImportedTemplateCandidate(
    plugin: RadialTimelinePlugin,
    input: TemplateImportInput
): Promise<ImportedTemplateCandidate> {
    const issues: ValidationIssue[] = [];
    const rawPath = input.sourcePath.trim();
    const storedPath = compactTemplatePathForStorage(plugin, rawPath);
    const fileName = basename(storedPath || rawPath || 'imported-template.tex');
    const inferredName = input.name?.trim() || stripTemplateExtension(fileName) || 'Imported Template';

    if (!rawPath) {
        issues.push({
            code: 'import_missing_path',
            level: 'error',
            message: 'Choose a .tex file to import.',
            scope: 'asset',
            actionable: true,
            field: 'path',
        });
    }

    const layoutPath = storedPath || rawPath;
    const layout: PandocLayoutTemplate = {
        id: buildImportedTemplateId(inferredName, input.preset || 'novel', plugin.settings.pandocLayouts?.map(item => item.id) || []),
        name: inferredName,
        preset: input.preset || 'novel',
        path: layoutPath,
        description: input.description?.trim() || '',
        bundled: false,
        origin: input.origin || 'imported',
        tier: 'pro',
        templateKind: 'custom',
        draft: input.draft ?? false,
        usesModernClassicStructure: input.usesModernClassicStructure,
        hasEpigraphs: input.hasEpigraphs,
        hasSceneOpenerHeadingOptions: input.hasSceneOpenerHeadingOptions,
    };

    const layoutValidation = validatePandocLayout(plugin, layout);
    if (!layoutValidation.valid) {
        issues.push({
            code: 'import_layout_invalid',
            level: 'error',
            message: layoutValidation.error || 'Template file is not valid.',
            scope: 'asset',
            field: 'path',
            actionable: true,
        });
    }

    const resolvedPath = resolveTemplatePath(plugin, layout.path);
    // rawPath is the user's selection from the suggest modal — already a
    // vault-relative TFile path. Read it directly; no path round-tripping.
    // (resolvedPath is kept for the pandoc-engine check below; that's a
    // separate concern from reading vault content.)
    const content = input.sourceContent ?? await readVaultFile(plugin, rawPath);
    if (content && !/\$body\$/i.test(content)) {
        issues.push({
            code: 'import_missing_body',
            level: 'error',
            message: 'The template must include a $body$ placeholder.',
            scope: 'asset',
            actionable: true,
        });
    }

    // Reject a legacy \rtPart on the way in, rather than accepting the template
    // and blocking every later export with the same message.
    const partArityIssue = content ? describeRtPartArityIssue(content) : null;
    if (partArityIssue) {
        issues.push({
            code: 'import_part_arity_mismatch',
            level: 'error',
            message: partArityIssue.message,
            scope: 'asset',
            actionable: true,
        });
    }

    if (content && /\\usepackage\s*\{fontspec\}|\\setmainfont|\\newfontface/i.test(content)) {
        const engineSelection = getAutoPdfEngineSelection(resolvedPath);
        if (!engineSelection.path) {
            issues.push({
                code: 'import_missing_unicode_engine',
                level: 'warning',
                message: 'This template uses fontspec, but no XeLaTeX or LuaLaTeX engine was detected.',
                scope: 'asset',
                actionable: true,
            });
        }
    }

    const inferredPreset = input.preset || inferUsageContext(content, inferredName);
    layout.preset = inferredPreset;
    layout.usesModernClassicStructure = input.usesModernClassicStructure ?? MODERN_CLASSIC_HINTS.some(pattern => pattern.test(content));
    layout.hasEpigraphs = input.hasEpigraphs ?? (MODERN_CLASSIC_HINTS.some(pattern => pattern.test(content)) || /epigraph/i.test(content));
    layout.hasSceneOpenerHeadingOptions = input.hasSceneOpenerHeadingOptions ?? (
        inferredPreset === 'screenplay'
        || SIGNATURE_HINTS.some(pattern => pattern.test(content))
        || NARROW_LAYOUT_HINTS.some(pattern => pattern.test(content))
    );
    layout.description = input.description?.trim() || buildDefaultDescription(inferredPreset, content);

    const asset = adaptPandocLayoutToTemplateAsset(layout);
    const profile = adaptPandocLayoutToTemplateProfile(layout);
    const summary = summarizeValidationIssues(issues);
    const detectedTemplate = detectImportedTemplateStyle(content, layout.origin);

    return {
        layout,
        asset,
        profile,
        detectedTemplate,
        issues,
        summary,
        semanticNote: buildSemanticNote(inferredPreset),
        previewLines: buildPreviewLines(content),
        canActivate: !issues.some(issue => issue.level === 'error'),
    };
}

function inferUsageContext(content: string, name: string): UsageContext {
    const source = `${name}\n${content}`.toLowerCase();
    if (PODCAST_LAYOUT_HINTS.some(pattern => pattern.test(source))) return 'podcast';
    if (NARROW_LAYOUT_HINTS.some(pattern => pattern.test(source))) return 'screenplay';
    return 'novel';
}

function buildDefaultDescription(preset: UsageContext, content: string): string {
    if (preset === 'screenplay') {
        return 'Screenplay-style template with dialogue-first layout and production-oriented page flow.';
    }
    if (preset === 'podcast') {
        return 'Podcast script template with narration-friendly spacing and cue clarity.';
    }
    if (/\\epigraph\b/i.test(content) || /modern classic/i.test(content)) {
        return 'Literary manuscript template with opener-friendly structure and optional epigraph treatment.';
    }
    return 'Book-style manuscript template for the current Pandoc + LaTeX export path.';
}

function buildSemanticNote(preset: UsageContext): string {
    if (preset === 'novel') {
        return 'Semantic matter is still limited: copyright pages bind to BookMeta today, while title-page, dedication, epigraph, acknowledgments, and about-author still fall back to generic rendering.';
    }
    return 'Matter pages still render through the current generic fallback path; semantic matter expansion is deferred to a later phase.';
}

function buildPreviewLines(content: string): string[] {
    return content
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 6);
}

async function readVaultFile(plugin: RadialTimelinePlugin, vaultPath: string): Promise<string> {
    if (!vaultPath) return '';
    const file = plugin.app.vault.getAbstractFileByPath(normalizePath(vaultPath));
    if (!(file instanceof TFile)) return '';
    try {
        return await plugin.app.vault.read(file);
    } catch {
        return '';
    }
}

function stripTemplateExtension(name: string): string {
    return name.replace(/\.(tex|ltx|latex)$/i, '').trim();
}

function slugify(value: string): string {
    return value
        .replace(/[/\\:*?"<>|]+/g, '')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'template';
}
