import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate, RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    buildBookDetailsChecklist,
    buildBookPagesChecklist,
    describeMatterReadiness,
    PublishingValidationService
} from './PublishingValidationService';

function writeTempTemplate(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-rtts-'));
    const filePath = path.join(dir, 'template.tex');
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

function createValidationPlugin(layout: PandocLayoutTemplate | PandocLayoutTemplate[], options: { pro?: boolean } = { pro: true }): RadialTimelinePlugin {
    const layouts = Array.isArray(layout) ? layout : [layout];
    const settings: RadialTimelineSettings = {
        ...DEFAULT_SETTINGS,
        books: [{
            id: 'book-1',
            title: 'Example Book',
            sourceFolder: 'Book',
        }],
        activeBookId: 'book-1',
        pandocLayouts: layouts,
        proLicenseKey: options.pro === false ? '' : '1234567890123456',
    };

    return {
        settings,
        app: {
            vault: {
                getMarkdownFiles: () => [],
                getAbstractFileByPath: () => null,
            },
            metadataCache: {
                getFileCache: () => null,
            },
        },
        getBookMeta: () => ({
            title: 'Example Book',
            author: 'Example Author',
            sourcePath: 'Book/000 BookMeta.md',
        }),
    } as unknown as RadialTimelinePlugin;
}

function makeNovelLayout(content: string, overrides: Partial<PandocLayoutTemplate> = {}): PandocLayoutTemplate {
    return {
        id: overrides.id || 'test-layout',
        name: overrides.name || 'Test Layout',
        preset: 'novel',
        path: writeTempTemplate(content),
        bundled: false,
        ...overrides,
    };
}

describe('PublishingValidationService matter readiness', () => {
    it.each(['copyright', 'title-page', 'about-author'])(
        'marks %s as ready when UseBookMeta is true and Book Details exist',
        (role) => {
            const result = describeMatterReadiness({
                role,
                usesBookMeta: true,
                bookMetaAvailable: true
            });

            expect(result.label).toBe('Ready');
            expect(result.tone).toBe('success');
        }
    );

    it.each(['copyright', 'title-page', 'about-author'])(
        'marks %s as Needs metadata when UseBookMeta is true but Book Details are missing',
        (role) => {
            const result = describeMatterReadiness({
                role,
                usesBookMeta: true,
                bookMetaAvailable: false
            });

            expect(result.label).toBe('Needs metadata');
            expect(result.tone).toBe('error');
        }
    );

    it('marks UseBookMeta on a non-backed role as Uses page content (flag is a no-op)', () => {
        const result = describeMatterReadiness({
            role: 'foreword',
            usesBookMeta: true,
            bookMetaAvailable: true
        });

        expect(result.label).toBe('Uses page content');
        expect(result.tone).toBe('success');
    });

    it('marks unsupported roles as excluded by layout', () => {
        const result = describeMatterReadiness({
            role: 'appendix',
            usesBookMeta: false,
            bookMetaAvailable: true,
            issueCodes: ['matter_role_unsupported']
        });

        expect(result.label).toBe('Excluded by layout');
        expect(result.tone).toBe('warning');
    });

    it('marks duplicate roles as Needs repair', () => {
        const result = describeMatterReadiness({
            role: 'copyright',
            usesBookMeta: true,
            bookMetaAvailable: true,
            issueCodes: ['matter_role_duplicate']
        });

        expect(result.label).toBe('Needs repair');
        expect(result.tone).toBe('warning');
    });
});

describe('PublishingValidationService checklists', () => {
    it('summarizes missing Book Details fields', () => {
        const checklist = buildBookDetailsChecklist(null);

        expect(checklist.find(item => item.key === 'title')?.state).toBe('Needs setup');
        expect(checklist.find(item => item.key === 'author')?.state).toBe('Needs setup');
        expect(checklist.find(item => item.key === 'copyright-holder')?.state).toBe('Needs setup');
    });

    it('marks completed Book Details fields as ready', () => {
        const checklist = buildBookDetailsChecklist({
            title: 'Example Title',
            author: 'Example Author',
            rights: {
                copyright_holder: 'Example Author',
                year: 2026
            },
            identifiers: {
                isbn_paperback: '9780000000000'
            },
            publisher: {
                name: 'Example Press'
            }
        });

        expect(checklist.find(item => item.key === 'title')?.state).toBe('Ready');
        expect(checklist.find(item => item.key === 'author')?.state).toBe('Ready');
        expect(checklist.find(item => item.key === 'publisher')?.state).toBe('Ready');
    });

    it('surfaces missing Book Pages as setup needed', () => {
        const checklist = buildBookPagesChecklist({
            bookMetaAvailable: false,
            items: [],
            issueCodes: []
        });

        expect(checklist.find(item => item.key === 'title-page')?.state).toBe('Needs setup');
        expect(checklist.find(item => item.key === 'copyright')?.state).toBe('Needs setup');
    });

    it.each(['copyright', 'title-page', 'about-author'] as const)(
        'marks %s as Ready when Book Details exist',
        (role) => {
            const checklist = buildBookPagesChecklist({
                bookMetaAvailable: true,
                items: [
                    { role, usesBookMeta: true }
                ],
                issueCodes: []
            });

            const entry = checklist.find(item => item.key === role);
            expect(entry?.state).toBe('Ready');
            expect(entry?.tone).toBe('success');
        }
    );

    it('marks title-page as Needs metadata when UseBookMeta is true but Book Details missing', () => {
        const checklist = buildBookPagesChecklist({
            bookMetaAvailable: false,
            items: [
                { role: 'title-page', usesBookMeta: true }
            ],
            issueCodes: []
        });

        const entry = checklist.find(item => item.key === 'title-page');
        expect(entry?.state).toBe('Needs metadata');
        expect(entry?.tone).toBe('error');
    });

    it('labels unsupported book pages as excluded by layout', () => {
        const checklist = buildBookPagesChecklist({
            bookMetaAvailable: true,
            items: [
                { role: 'title-page', usesBookMeta: false }
            ],
            issueCodes: [
                { field: 'title-page', code: 'matter_role_unsupported', level: 'warning' }
            ]
        });

        expect(checklist.find(item => item.key === 'title-page')?.state).toBe('Excluded by layout');
    });

});

describe('PublishingValidationService template compatibility', () => {
    it('includes a Template Compatibility snapshot for selected PDF layouts', () => {
        const layout = makeNovelLayout('$title$\n$author$\n$body$');
        const plugin = createValidationPlugin(layout);
        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: layout.id,
        });

        expect(snapshot.templateCompatibility).toMatchObject({
            templateName: 'Test Layout',
            templateId: layout.id,
            level: 'legacy',
        });
        expect(snapshot.templateCompatibility?.variables.hasBody).toBe(true);
    });

    it('blocks export when RTTS validation is invalid because $body$ is missing', () => {
        const layout = makeNovelLayout('$title$\n$author$');
        const plugin = createValidationPlugin(layout);
        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: layout.id,
        });

        expect(snapshot.templateCompatibility?.level).toBe('invalid');
        expect(snapshot.templateCompatibilityIssues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'error',
                code: 'rtts_missing_body',
            }),
        ]));
        expect(snapshot.preflightIssues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'error',
                code: 'export_template_compatibility_invalid',
            }),
        ]));
    });

    it('allows legacy RTTS templates with $body$ and reports fallback info', () => {
        const layout = makeNovelLayout('$body$');
        const plugin = createValidationPlugin(layout);
        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: layout.id,
        });

        expect(snapshot.templateCompatibility?.level).toBe('legacy');
        // Template-side absences (no $title$, no $author$, no hooks) are not
        // user-facing problems — the snapshot should not surface warnings or
        // info entries describing template design.
        expect(snapshot.templateCompatibilityIssues || []).toEqual([]);
        expect(snapshot.preflightIssues.some(issue => issue.code === 'export_template_compatibility_invalid')).toBe(false);
    });

    it('does not surface warnings for missing $title$ or $author$ in the template', () => {
        const layout = makeNovelLayout('$body$');
        const plugin = createValidationPlugin(layout);
        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: layout.id,
        });

        const warningIssues = (snapshot.templateCompatibilityIssues || []).filter(issue => issue.level === 'warning');
        expect(warningIssues).toEqual([]);
        expect(snapshot.preflightIssues.some(issue => issue.code === 'export_template_compatibility_invalid')).toBe(false);
    });

    it('keeps Standard Manuscript-style $body$ templates exportable', () => {
        const layout = makeNovelLayout('$if(title)$$title$$endif$\n$body$', {
            id: 'bundled-fiction-classic-manuscript',
            name: 'Standard Manuscript',
            bundled: true,
            tier: 'free',
            templateKind: 'book',
        });
        const plugin = createValidationPlugin(layout);
        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: layout.id,
        });

        expect(snapshot.templateCompatibility?.level).toBe('legacy');
        expect(snapshot.templateCompatibility?.variables.hasBody).toBe(true);
        expect(snapshot.preflightIssues.some(issue => issue.level === 'error')).toBe(false);
    });

    it('reports a Standard Manuscript fallback when a non-Pro user has a saved Pro template selected', () => {
        const basic = makeNovelLayout('$body$', {
            id: 'bundled-fiction-classic-manuscript',
            name: 'Standard Manuscript',
            bundled: true,
            tier: 'free',
            templateKind: 'book',
        });
        const signature = makeNovelLayout('$title$\n$author$\n$body$', {
            id: 'bundled-fiction-signature-literary',
            name: 'Signature Literary',
            bundled: true,
            tier: 'pro',
            templateKind: 'book',
        });
        const plugin = createValidationPlugin([signature, basic], { pro: false });

        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: signature.id,
        });

        expect(snapshot.templateAccess).toMatchObject({
            requestedTemplateName: 'Signature Literary',
            effectiveTemplateName: 'Standard Manuscript',
            usedFallback: true,
        });
        expect(snapshot.templateAccessIssues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'warning',
                code: 'template_access_fallback_to_basic',
            }),
        ]));
        expect(snapshot.templateCompatibility?.templateId).toBe(basic.id);
        expect(snapshot.preflightIssues.some(issue => issue.level === 'error')).toBe(false);
    });

    it('keeps the selected Pro template for Pro users', () => {
        const modernClassic = makeNovelLayout('$title$\n$author$\n$body$', {
            id: 'bundled-fiction-modern-classic',
            name: 'Modern Classic',
            bundled: true,
            tier: 'pro',
            templateKind: 'book',
        });
        const plugin = createValidationPlugin(modernClassic, { pro: true });

        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: modernClassic.id,
        });

        expect(snapshot.templateAccess).toMatchObject({
            effectiveTemplateName: 'Modern Classic',
            usedFallback: false,
        });
        expect(snapshot.templateAccessIssues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'info',
                code: 'template_access_requires_pro',
            }),
        ]));
    });
});
