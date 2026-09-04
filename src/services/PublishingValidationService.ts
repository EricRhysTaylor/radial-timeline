import type RadialTimelinePlugin from '../main';
import type {
    BookMeta,
    BookMetaFieldKey,
    BookProfile,
    BookPublishingPreferences,
    OutputIntent,
    PandocLayoutTemplate,
    PublishingValidationSnapshot,
    TemplateProfile,
    UsageContext,
    ValidationIssue,
    ValidationSummary,
} from '../types';
import { assertNever } from '../utils/assertNever';
import { getAutoPdfEngineSelection, isConfiguredExecutablePathMissing, readResolvedTemplateText, resolveTemplatePath, validatePandocLayout } from '../utils/exportFormats';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { parseMatterMetaFromFrontmatter } from '../utils/matterMeta';
import { isPathInFolderScope } from '../utils/pathScope';
import { adaptPandocLayoutsToPublishingModel } from '../utils/publishingModel';
import { BOOK_META_BACKED_ROLES } from '../utils/manuscript';
import { validateRttsTemplateContent } from '../publishing/rttsValidation';
import { getPandocLayoutSortRank, getPandocLayoutTier, resolveTemplateAccess } from '../publishing/templateTiering';
import { hasProFeatureAccess } from '../settings/featureGate';

type ValidationScope = ValidationIssue['scope'];

interface PublishingValidationContext {
    exportType?: 'manuscript' | 'outline';
    outputFormat?: 'pdf' | 'markdown' | 'docx' | 'csv' | 'json';
    manuscriptPreset?: UsageContext;
    selectedLayoutId?: string;
}

export interface MatterReadinessDescriptor {
    label: 'Ready' | 'Needs metadata' | 'Uses page content' | 'Excluded by layout' | 'Needs repair';
    detail: string;
    tone: 'success' | 'warning' | 'error';
}

export function describeMatterReadiness(params: {
    role?: string;
    usesBookMeta?: boolean;
    bookMetaAvailable?: boolean;
    issueCodes?: string[];
}): MatterReadinessDescriptor {
    const role = (params.role || '').trim().toLowerCase();
    const issueCodes = new Set((params.issueCodes || []).map(code => code.toLowerCase()));
    const usesBookMeta = params.usesBookMeta === true;
    const bookMetaAvailable = params.bookMetaAvailable === true;

    if (issueCodes.has('matter_book_meta_missing') || issueCodes.has('book_meta_required_missing')) {
        return {
            label: 'Needs metadata',
            detail: 'This page is configured to use Book Details, but the Book Details note is missing or incomplete.',
            tone: 'error',
        };
    }
    if (issueCodes.has('matter_role_unsupported')) {
        return {
            label: 'Excluded by layout',
            detail: 'This page is not styled by the selected PDF style.',
            tone: 'warning',
        };
    }
    if (issueCodes.has('matter_role_duplicate')) {
        return {
            label: 'Needs repair',
            detail: 'Multiple notes share this matter role. Filename order may be ambiguous.',
            tone: 'warning',
        };
    }
    if (usesBookMeta && BOOK_META_BACKED_ROLES.has(role)) {
        if (!bookMetaAvailable) {
            return {
                label: 'Needs metadata',
                detail: 'This page is configured to use Book Details, but no Book Details note is currently available.',
                tone: 'error',
            };
        }
        return {
            label: 'Ready',
            detail: 'Ready for export. Pulls from Book Details.',
            tone: 'success',
        };
    }
    return {
        label: 'Uses page content',
        detail: 'This page uses the content written in the note.',
        tone: 'success',
    };
}
function pushIssue(
    target: ValidationIssue[],
    scope: ValidationScope,
    level: ValidationIssue['level'],
    code: string,
    message: string,
    extras: Partial<Omit<ValidationIssue, 'scope' | 'level' | 'code' | 'message'>> = {}
): void {
    target.push({
        scope,
        level,
        code,
        message,
        ...extras,
    });
}

function getIssueState(issues: ValidationIssue[]): ValidationSummary['state'] {
    if (issues.some(issue => issue.level === 'error')) return 'blocked';
    if (issues.some(issue => issue.level === 'warning')) return 'warning';
    return 'ready';
}

export function summarizeValidationIssues(issues: ValidationIssue[]): ValidationSummary {
    const errorCount = issues.filter(issue => issue.level === 'error').length;
    const warningCount = issues.filter(issue => issue.level === 'warning').length;
    return {
        state: getIssueState(issues),
        errorCount,
        warningCount,
        topMessage: issues[0]?.message,
    };
}

export interface BookDetailChecklistItem {
    key: 'title' | 'author' | 'copyright-holder' | 'rights-year' | 'isbn' | 'publisher';
    label: string;
    state: 'Ready' | 'Needs setup' | 'Needs metadata';
    detail: string;
    tone: 'success' | 'warning' | 'error';
    value?: string;
}

export interface BookPageChecklistItem {
    key: 'title-page' | 'copyright' | 'dedication' | 'epigraph' | 'acknowledgments' | 'about-author';
    label: string;
    state: 'Ready' | 'Uses page content' | 'Custom page' | 'Needs setup' | 'Needs metadata' | 'Excluded by layout';
    detail: string;
    tone: 'success' | 'warning' | 'error';
}

export function buildBookDetailsChecklist(bookMeta: BookMeta | null): BookDetailChecklistItem[] {
    const normalized = {
        title: (bookMeta?.title || '').trim(),
        author: (bookMeta?.author || '').trim(),
        copyrightHolder: (bookMeta?.rights?.copyright_holder || '').trim(),
        rightsYear: bookMeta?.rights?.year,
        isbn: (bookMeta?.identifiers?.isbn_paperback || '').trim(),
        publisher: (bookMeta?.publisher?.name || '').trim(),
    };

    return [
        {
            key: 'title',
            label: 'Title',
            state: normalized.title ? 'Ready' : 'Needs setup',
            detail: normalized.title ? 'Used on the title page and in export metadata.' : 'Create Book Details to add the book title.',
            tone: normalized.title ? 'success' : 'error',
            value: normalized.title || undefined,
        },
        {
            key: 'author',
            label: 'Author',
            state: normalized.author ? 'Ready' : 'Needs setup',
            detail: normalized.author ? 'Shown on the title page and in export metadata.' : 'Create Book Details to add the author name.',
            tone: normalized.author ? 'success' : 'error',
            value: normalized.author || undefined,
        },
        {
            key: 'copyright-holder',
            label: 'Copyright holder',
            state: normalized.copyrightHolder ? 'Ready' : 'Needs setup',
            detail: normalized.copyrightHolder ? 'Used on the copyright page.' : 'Add the copyright holder for the copyright page.',
            tone: normalized.copyrightHolder ? 'success' : 'warning',
            value: normalized.copyrightHolder || undefined,
        },
        {
            key: 'rights-year',
            label: 'Rights year',
            state: normalized.rightsYear ? 'Ready' : 'Needs setup',
            detail: normalized.rightsYear ? 'Used on the copyright page.' : 'Add the rights year for the copyright page.',
            tone: normalized.rightsYear ? 'success' : 'warning',
            value: normalized.rightsYear ? String(normalized.rightsYear) : undefined,
        },
        {
            key: 'isbn',
            label: 'ISBN',
            state: normalized.isbn ? 'Ready' : 'Needs setup',
            detail: normalized.isbn ? 'Included in export metadata when present.' : 'Optional, but useful for print-ready exports.',
            tone: normalized.isbn ? 'success' : 'warning',
            value: normalized.isbn || undefined,
        },
        {
            key: 'publisher',
            label: 'Publisher',
            state: normalized.publisher ? 'Ready' : 'Needs setup',
            detail: normalized.publisher ? 'Shown in the publishing details.' : 'Optional, but useful for published editions.',
            tone: normalized.publisher ? 'success' : 'warning',
            value: normalized.publisher || undefined,
        },
    ];
}

export function buildBookPagesChecklist(params: {
    bookMetaAvailable: boolean;
    items: Array<{ role?: string; usesBookMeta?: boolean }>;
    issueCodes?: Array<{ field?: string; code: string; level: ValidationIssue['level'] }>;
}): BookPageChecklistItem[] {
    const itemByRole = new Map<string, { role?: string; usesBookMeta?: boolean }>();
    for (const item of params.items || []) {
        const role = (item.role || '').trim().toLowerCase();
        if (role && !itemByRole.has(role)) {
            itemByRole.set(role, item);
        }
    }

    const issues = params.issueCodes || [];
    const getIssueCodes = (role: string): Set<string> => new Set(
        issues
            .filter(issue => (issue.field || '').trim().toLowerCase() === role)
            .map(issue => issue.code)
    );

    const pageOrder: BookPageChecklistItem['key'][] = [
        'title-page',
        'copyright',
        'dedication',
        'epigraph',
        'acknowledgments',
        'about-author',
    ];

    return pageOrder.map((key) => {
        const roleItem = itemByRole.get(key);
        const codes = getIssueCodes(key);
        const friendlyName = key === 'about-author'
            ? 'About the author'
            : key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const required = key === 'title-page' || key === 'copyright';

        if (codes.has('matter_role_unsupported')) {
            return {
                key,
                label: friendlyName,
                state: 'Excluded by layout',
                detail: 'This page is not styled by the selected PDF style.',
                tone: 'warning',
            };
        }

        if (!roleItem) {
            return {
                key,
                label: friendlyName,
                state: 'Needs setup',
                detail: required
                    ? 'Start here to make the book ready for export.'
                    : 'Add this page if the book needs it.',
                tone: required ? 'error' : 'warning',
            };
        }

        const usesBookMeta = roleItem.usesBookMeta === true;
        const isBookMetaBacked = BOOK_META_BACKED_ROLES.has(key);
        if (usesBookMeta && isBookMetaBacked) {
            if (!params.bookMetaAvailable) {
                return {
                    key,
                    label: friendlyName,
                    state: 'Needs metadata',
                    detail: 'Create Book Details to unlock this page.',
                    tone: 'error',
                };
            }
            return {
                key,
                label: friendlyName,
                state: 'Ready',
                detail: 'Ready for export. Pulls from Book Details.',
                tone: 'success',
            };
        }

        return {
            key,
            label: friendlyName,
            state: 'Uses page content',
            detail: 'This page uses the content written in the note.',
            tone: 'success',
        };
    });
}

export function parseBookMetaFromFrontmatter(frontmatter: Record<string, unknown>, sourcePath: string): BookMeta {
    const book = frontmatter.Book as Record<string, unknown> | undefined;
    const rights = frontmatter.Rights as Record<string, unknown> | undefined;
    const identifiers = frontmatter.Identifiers as Record<string, unknown> | undefined;
    const publisher = frontmatter.Publisher as Record<string, unknown> | undefined;
    const frontmatterBlocks = frontmatter.Frontmatter as Record<string, unknown> | undefined;
    const backmatterBlocks = frontmatter.Backmatter as Record<string, unknown> | undefined;

    const rawYear = rights?.year;
    const year = typeof rawYear === 'number'
        ? rawYear
        : typeof rawYear === 'string'
            ? Number(rawYear)
            : NaN;

    return {
        title: (book?.title as string) || undefined,
        subtitle: (book?.subtitle as string) || undefined,
        author: (book?.author as string) || undefined,
        rights: rights ? {
            copyright_holder: (rights.copyright_holder as string) || undefined,
            year: Number.isFinite(year) ? year : undefined,
        } : undefined,
        identifiers: identifiers ? {
            isbn_paperback: (identifiers.isbn_paperback as string) || undefined,
        } : undefined,
        publisher: publisher ? {
            name: (publisher.name as string) || undefined,
            imprint: (publisher.imprint as string) || undefined,
            edition: (publisher.edition as string) || undefined,
        } : undefined,
        frontmatter: frontmatterBlocks ? {
            title_page_note: (frontmatterBlocks.title_page_note as string) || undefined,
            dedication: (frontmatterBlocks.dedication as string) || undefined,
            epigraph_quote: (frontmatterBlocks.epigraph_quote as string) || undefined,
            epigraph_attribution: (frontmatterBlocks.epigraph_attribution as string) || undefined,
        } : undefined,
        backmatter: backmatterBlocks ? {
            acknowledgments: (backmatterBlocks.acknowledgments as string) || undefined,
            about_author: (backmatterBlocks.about_author as string) || undefined,
            author_note: (backmatterBlocks.author_note as string) || undefined,
            other_works: (backmatterBlocks.other_works as string) || undefined,
        } : undefined,
        sourcePath,
    };
}

export class PublishingValidationService {
    constructor(private readonly plugin: RadialTimelinePlugin) {}

    summarize(issues: ValidationIssue[]): ValidationSummary {
        return summarizeValidationIssues(issues);
    }

    collect(bookId?: string, context: PublishingValidationContext = {}): PublishingValidationSnapshot {
        const snapshot: PublishingValidationSnapshot = {
            assetIssues: {},
            profileIssues: {},
            exportProfileIssues: {},
            activeBookMetaIssues: [],
            matterIssues: [],
            preflightIssues: [],
            templateAccessIssues: [],
            templateCompatibilityIssues: [],
        };

        const layouts = Array.isArray(this.plugin.settings.pandocLayouts) ? this.plugin.settings.pandocLayouts : [];
        const { assets, profiles } = adaptPandocLayoutsToPublishingModel(layouts);
        const book = this.resolveBook(bookId);
        const sourceFolder = (book?.sourceFolder || '').trim();
        let selectedProfile = this.resolveSelectedProfile(layouts, profiles, book, context);
        let selectedLayout = selectedProfile
            ? layouts.find(layout => layout.id === selectedProfile!.legacyLayoutId)
            : undefined;
        if (context.exportType === 'manuscript' && context.outputFormat === 'pdf' && selectedLayout) {
            const access = resolveTemplateAccess({
                layouts,
                selectedLayoutId: selectedLayout.id,
                manuscriptPreset: context.manuscriptPreset,
                hasProAccess: hasProFeatureAccess(this.plugin),
            });
            snapshot.templateAccessIssues = access.issues;
            if (access.requestedLayout) {
                snapshot.templateAccess = {
                    requestedTemplateName: access.requestedLayout.name,
                    requestedTemplateId: access.requestedLayout.id,
                    effectiveTemplateName: access.effectiveLayout?.name || access.requestedLayout.name,
                    effectiveTemplateId: access.effectiveLayout?.id || access.requestedLayout.id,
                    tier: access.tier || 'pro',
                    usedFallback: access.usedFallback,
                };
            }
            const accessError = access.issues.find(issue => issue.level === 'error');
            if (accessError) {
                pushIssue(snapshot.preflightIssues, 'export', 'error', accessError.code, accessError.message, {
                    actionable: true,
                    field: accessError.field,
                });
            } else if (access.effectiveLayout && access.effectiveLayout.id !== selectedLayout.id) {
                selectedLayout = access.effectiveLayout;
                selectedProfile = profiles.find(profile => profile.legacyLayoutId === selectedLayout?.id || profile.id === selectedLayout?.id);
            }
        }
        const bookMetaResolution = sourceFolder ? this.resolveBookMetaForBook(sourceFolder) : { bookMeta: null as BookMeta | null };
        const matterFiles = sourceFolder ? this.getMatterFiles(sourceFolder) : [];

        assets.forEach(asset => {
            const issues: ValidationIssue[] = [];
            const layout = layouts.find(item => item.id === asset.id.replace(/::asset$/, ''));
            if (!layout) {
                pushIssue(issues, 'asset', 'error', 'asset_layout_missing', 'Template asset is missing its source layout record.');
                snapshot.assetIssues[asset.id] = issues;
                return;
            }

            const layoutValidation = validatePandocLayout(this.plugin, layout);
            if (!layoutValidation.valid) {
                pushIssue(issues, 'asset', 'error', 'asset_invalid', layoutValidation.error || 'Template asset is invalid.', {
                    actionable: true,
                    field: 'path',
                });
            }
            if (!layout.path.trim().toLowerCase().endsWith('.tex')) {
                pushIssue(issues, 'asset', 'error', 'asset_extension_invalid', 'Template assets must use a .tex extension.', {
                    actionable: true,
                    field: 'path',
                });
            }

            const resolvedPath = resolveTemplatePath(this.plugin, layout.path);
            const templateRead = readResolvedTemplateText(resolvedPath);
            if (templateRead.error && layoutValidation.valid) {
                pushIssue(issues, 'asset', 'error', 'asset_unreadable', templateRead.error, {
                    actionable: true,
                    field: 'path',
                });
            }
            if (templateRead.text && !/\$body\$/i.test(templateRead.text)) {
                pushIssue(issues, 'asset', 'error', 'asset_missing_body', 'Template is missing the required $body$ placeholder.', {
                    actionable: true,
                });
            }
            if (templateRead.text && /\\usepackage\s*\{fontspec\}|\\setmainfont|\\newfontface/i.test(templateRead.text)) {
                const engineSelection = getAutoPdfEngineSelection(resolvedPath);
                if (!engineSelection.path) {
                    pushIssue(
                        issues,
                        'asset',
                        'warning',
                        'asset_unicode_engine_missing',
                        'Template uses fontspec, but no XeLaTeX or LuaLaTeX engine was detected.',
                        { actionable: true }
                    );
                }
            }

            snapshot.assetIssues[asset.id] = issues;
        });

        profiles.forEach(profile => {
            const issues: ValidationIssue[] = [];
            const assetIssues = snapshot.assetIssues[profile.assetId] || [];
            const outputIntentAllowed = this.isOutputIntentAllowed(profile.outputIntent, profile.usageContexts[0]);

            if (!outputIntentAllowed) {
                pushIssue(issues, 'profile', 'error', 'profile_output_intent_invalid', 'Template profile declares an incompatible output intent.');
            }
            if (profile.status === 'draft') {
                pushIssue(issues, 'profile', 'warning', 'profile_status_draft', 'Template profile is saved as a draft and has not been activated yet.');
            }
            if (profile.status === 'invalid') {
                pushIssue(issues, 'profile', 'error', 'profile_status_invalid', 'Template profile is not ready for export.');
            }
            if (profile.capabilities.some(capability => capability.key === 'semanticMatter') && profile.usageContexts[0] !== 'novel') {
                pushIssue(issues, 'profile', 'warning', 'profile_semantic_matter_scope', 'Semantic matter support is only expected on novel profiles.');
            }
            if (profile.supportedMatterRoles.some(role => !role.trim())) {
                pushIssue(issues, 'profile', 'warning', 'profile_matter_role_blank', 'Template profile contains a blank matter role mapping.');
            }
            if (assetIssues.some(issue => issue.level === 'error')) {
                pushIssue(issues, 'profile', 'warning', 'profile_blocked_by_asset', 'Template profile depends on an invalid template asset.');
            }

            snapshot.profileIssues[profile.id] = issues;
        });

        if (bookMetaResolution.warning) {
            pushIssue(snapshot.activeBookMetaIssues, 'book-meta', 'warning', 'book_meta_ambiguous', bookMetaResolution.warning);
        }

        if (selectedProfile) {
            const missingRequired = this.collectMissingBookMetaFields(bookMetaResolution.bookMeta, selectedProfile.requiredBookMetaFields);
            missingRequired.forEach(field => {
                pushIssue(snapshot.activeBookMetaIssues, 'book-meta', 'error', 'book_meta_required_missing', `Missing required publishing metadata: ${field}.`, {
                    actionable: true,
                    field,
                });
            });

            const missingRecommended = this.collectMissingBookMetaFields(bookMetaResolution.bookMeta, selectedProfile.recommendedBookMetaFields);
            missingRecommended.forEach(field => {
                pushIssue(snapshot.activeBookMetaIssues, 'book-meta', 'warning', 'book_meta_recommended_missing', `Recommended publishing metadata is missing: ${field}.`, {
                    actionable: true,
                    field,
                });
            });
        }

        const seenRoles = new Map<string, string[]>();
        matterFiles.forEach(file => {
            const parsedMeta = parseMatterMetaFromFrontmatter(file.frontmatter);
            if (!parsedMeta) return;

            const role = (parsedMeta.role || '').trim().toLowerCase();
            if (role) {
                const paths = seenRoles.get(role) || [];
                paths.push(file.path);
                seenRoles.set(role, paths);
            }

            const isBookMetaBacked = role && BOOK_META_BACKED_ROLES.has(role);
            if (parsedMeta.usesBookMeta && isBookMetaBacked && !bookMetaResolution.bookMeta) {
                pushIssue(snapshot.matterIssues, 'matter', 'error', 'matter_book_meta_missing', `Matter note "${file.path}" expects Book Details, but no Book Details note was found.`, {
                    actionable: true,
                    field: role || file.path,
                });
            }

            if (
                role &&
                selectedProfile &&
                selectedProfile.supportedMatterRoles.length > 0 &&
                !selectedProfile.supportedMatterRoles.includes(role)
            ) {
                pushIssue(snapshot.matterIssues, 'matter', 'warning', 'matter_role_unsupported', `This page is excluded by the selected layout.`, {
                    field: role,
                });
            }
        });

        for (const [role, paths] of seenRoles.entries()) {
            if (BOOK_META_BACKED_ROLES.has(role) && paths.length > 1) {
                pushIssue(snapshot.matterIssues, 'matter', 'warning', 'matter_role_duplicate', `Multiple "${role}" matter notes found. Filename order may be ambiguous.`, {
                    detail: paths.join('\n'),
                    field: role,
                    actionable: true,
                });
            }
        }

        if (context.exportType === 'manuscript' && context.outputFormat === 'pdf') {
            if (!selectedLayout) {
                pushIssue(snapshot.preflightIssues, 'export', 'error', 'export_layout_missing', 'Select a PDF layout before exporting.', {
                    actionable: true,
                });
            }
            if (selectedProfile && snapshot.profileIssues[selectedProfile.id]?.some(issue => issue.level === 'error')) {
                pushIssue(snapshot.preflightIssues, 'export', 'error', 'export_profile_invalid', 'Selected publishing profile is not valid for export.', {
                    actionable: true,
                });
            }
            if (selectedLayout) {
                const assetIssues = snapshot.assetIssues[`${selectedLayout.id}::asset`] || [];
                if (assetIssues.some(issue => issue.level === 'error')) {
                    pushIssue(snapshot.preflightIssues, 'export', 'error', 'export_template_invalid', 'Selected PDF template is not valid for export.', {
                        actionable: true,
                    });
                }

                const resolvedPath = resolveTemplatePath(this.plugin, selectedLayout.path);
                const templateRead = readResolvedTemplateText(resolvedPath);
                const declaredCapabilities = (selectedProfile?.capabilities || []).map(capability => capability.key);
                const rtts = validateRttsTemplateContent(templateRead.text, {
                    declaredCapabilities,
                    readError: templateRead.error,
                });
                snapshot.templateCompatibility = {
                    templateName: selectedProfile?.name || selectedLayout.name || 'Selected template',
                    templateId: selectedLayout.id,
                    level: rtts.level,
                    variables: rtts.variables,
                    declaredCapabilities: rtts.declaredCapabilities,
                    detectedCapabilities: rtts.detectedCapabilities,
                };
                snapshot.templateCompatibilityIssues = rtts.issues.map(issue => ({
                    ...issue,
                    scope: 'asset',
                    actionable: issue.level === 'error' || issue.level === 'warning',
                }));
                if (rtts.level === 'invalid') {
                    const blocking = snapshot.templateCompatibilityIssues.find(issue => issue.level === 'error');
                    pushIssue(
                        snapshot.preflightIssues,
                        'export',
                        'error',
                        'export_template_compatibility_invalid',
                        blocking?.message || 'Selected PDF template is not compatible with manuscript export.',
                        {
                            actionable: true,
                            field: selectedLayout.id,
                            detail: blocking?.detail,
                        }
                    );
                }
            }
            const pandocPath = (this.plugin.settings.pandocPath || '').trim();
            if (isConfiguredExecutablePathMissing(pandocPath)) {
                pushIssue(snapshot.preflightIssues, 'export', 'error', 'export_pandoc_missing', 'Configured Pandoc binary could not be found.', {
                    actionable: true,
                    field: 'pandocPath',
                });
            }
            if (selectedLayout) {
                const engineSelection = getAutoPdfEngineSelection(resolveTemplatePath(this.plugin, selectedLayout.path));
                if (!engineSelection.path) {
                    pushIssue(snapshot.preflightIssues, 'export', 'warning', 'export_latex_engine_missing', 'No supported LaTeX PDF engine was detected for the selected template.', {
                        actionable: true,
                    });
                }
            }
        }

        return snapshot;
    }

    private resolveBook(bookId?: string): BookProfile | null {
        const books = Array.isArray(this.plugin.settings.books) ? this.plugin.settings.books : [];
        if (!books.length) return null;
        if (bookId) {
            return books.find(book => book.id === bookId) || null;
        }
        const activeId = this.plugin.settings.activeBookId;
        return (activeId ? books.find(book => book.id === activeId) : books[0]) || books[0] || null;
    }

    private resolveSelectedProfile(
        layouts: PandocLayoutTemplate[],
        profiles: TemplateProfile[],
        book: BookProfile | null,
        context: PublishingValidationContext
    ): TemplateProfile | undefined {
        const selectedLayoutId = context.selectedLayoutId || undefined;
        if (selectedLayoutId) {
            return profiles.find(profile => profile.legacyLayoutId === selectedLayoutId || profile.id === selectedLayoutId);
        }

        const preferences = this.resolveBookPublishingPreferences(book?.id);
        const preferredTemplateId = context.manuscriptPreset
            ? preferences?.preferredTemplateProfileIdByContext?.[context.manuscriptPreset]
            : undefined;
        if (preferredTemplateId) {
            const preferredProfile = profiles.find(profile => profile.id === preferredTemplateId || profile.legacyLayoutId === preferredTemplateId);
            if (preferredProfile) return preferredProfile;
        }

        const exportProfiles = Array.isArray(this.plugin.settings.exportProfiles) ? this.plugin.settings.exportProfiles : [];
        const prioritizedExportProfileId = preferences?.lastUsedExportProfileId
            || this.plugin.settings.lastUsedExportProfileId
            || preferences?.defaultExportProfileId
            || undefined;
        if (prioritizedExportProfileId) {
            const exportProfile = exportProfiles.find(profile => profile.id === prioritizedExportProfileId);
            const templateProfileId = exportProfile?.templateProfileId;
            if (templateProfileId) {
                const byExportProfile = profiles.find(profile => profile.id === templateProfileId || profile.legacyLayoutId === templateProfileId);
                if (byExportProfile) return byExportProfile;
            }
        }

        const legacySelectedLayoutId = context.manuscriptPreset
            ? book?.lastUsedPandocLayoutByPreset?.[context.manuscriptPreset]
            : undefined;
        if (legacySelectedLayoutId) {
            const legacyProfile = profiles.find(profile => profile.legacyLayoutId === legacySelectedLayoutId || profile.id === legacySelectedLayoutId);
            if (legacyProfile) return legacyProfile;
        }

        if (context.manuscriptPreset) {
            const hasProAccess = hasProFeatureAccess(this.plugin);
            const layout = layouts
                .filter(item => item.preset === context.manuscriptPreset)
                .sort((a, b) => getPandocLayoutSortRank(a) - getPandocLayoutSortRank(b) || a.name.localeCompare(b.name))
                .find(item => hasProAccess || getPandocLayoutTier(item) === 'free')
                || layouts.find(item => item.preset === context.manuscriptPreset);
            if (layout) return profiles.find(profile => profile.legacyLayoutId === layout.id);
        }

        return profiles[0];
    }

    private resolveBookPublishingPreferences(bookId?: string): BookPublishingPreferences | null {
        if (!bookId) return null;
        const preferences = Array.isArray(this.plugin.settings.bookPublishingPreferences)
            ? this.plugin.settings.bookPublishingPreferences
            : [];
        return preferences.find(entry => entry.bookId === bookId) || null;
    }

    private isOutputIntentAllowed(outputIntent: OutputIntent, usageContext: string): boolean {
        if (usageContext === 'screenplay') return outputIntent === 'screenplay-pdf';
        if (usageContext === 'podcast') return outputIntent === 'podcast-script';
        return outputIntent === 'print-book' || outputIntent === 'submission-manuscript';
    }

    private collectMissingBookMetaFields(bookMeta: BookMeta | null, fields: BookMetaFieldKey[]): BookMetaFieldKey[] {
        return fields.filter(field => {
            switch (field) {
                case 'Book.title':
                    return !(bookMeta?.title || '').trim();
                case 'Book.author':
                    return !(bookMeta?.author || '').trim();
                case 'Rights.year':
                    return !bookMeta?.rights?.year;
                case 'Rights.copyright_holder':
                    return !(bookMeta?.rights?.copyright_holder || '').trim();
                case 'Publisher.name':
                    return !(bookMeta?.publisher?.name || '').trim();
                case 'Identifiers.isbn_paperback':
                    return !(bookMeta?.identifiers?.isbn_paperback || '').trim();
                default:
                    return assertNever(field, 'collectMissingBookMetaFields');
            }
        });
    }

    private resolveBookMetaForBook(sourceFolder: string): { bookMeta: BookMeta | null; warning?: string } {
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);

        const candidates = this.plugin.app.vault.getMarkdownFiles()
            .filter(file => isPathInFolderScope(file.path, sourceFolder))
            .map(file => {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                if (!cache?.frontmatter) return null;
                const normalized = normalizeFrontmatterKeys(cache.frontmatter, mappings);
                if (normalized.Class !== 'BookMeta') return null;
                return {
                    path: file.path,
                    meta: parseBookMetaFromFrontmatter(normalized, file.path),
                };
            })
            .filter((entry): entry is { path: string; meta: BookMeta } => !!entry)
            .sort((a, b) => a.path.localeCompare(b.path));

        if (candidates.length === 0) {
            return { bookMeta: this.plugin.getBookMeta() };
        }

        const current = this.plugin.getBookMeta();
        const preferred = current?.sourcePath
            ? candidates.find(candidate => candidate.path === current.sourcePath)
            : undefined;
        const selected = preferred || candidates[0];

        if (candidates.length > 1) {
            return {
                bookMeta: selected.meta,
                warning: `Multiple Book Details notes found. Using: ${selected.path}`,
            };
        }

        return { bookMeta: selected.meta };
    }

    private getMatterFiles(sourceFolder: string): Array<{ path: string; frontmatter: Record<string, unknown> }> {
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);

        return this.plugin.app.vault.getMarkdownFiles()
            .filter(file => isPathInFolderScope(file.path, sourceFolder))
            .map(file => {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                if (!cache?.frontmatter) return null;
                const normalized = normalizeFrontmatterKeys(cache.frontmatter, mappings);
                const parsed = parseMatterMetaFromFrontmatter(normalized);
                if (!parsed) return null;
                return {
                    path: file.path,
                    frontmatter: normalized,
                };
            })
            .filter((entry): entry is { path: string; frontmatter: Record<string, unknown> } => !!entry);
    }
}
