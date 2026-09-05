import { describe, expect, it } from 'vitest';
import type { PandocLayoutTemplate } from '../types';
import { buildImportedTemplateCandidate } from '../utils/templateImport';
import { getBundledPandocLayouts } from '../utils/pandocBundledLayouts';
import {
    BASIC_MANUSCRIPT_LAYOUT_ID,
    CONTEMPORARY_LITERARY_LAYOUT_ID,
    getLayoutAbbreviation,
    getPandocLayoutKind,
    getPandocLayoutTier,
    resolveTemplateAccess,
} from './templateTiering';
import type RadialTimelinePlugin from '../main';

function layout(overrides: Partial<PandocLayoutTemplate>): PandocLayoutTemplate {
    return {
        id: 'test-layout',
        name: 'Test Layout',
        preset: 'novel',
        path: 'test.tex',
        ...overrides,
    };
}

describe('template tiering', () => {
    it('marks Basic and Standard as Core templates', () => {
        const bundled = getBundledPandocLayouts();
        const basic = bundled.find(item => item.id === BASIC_MANUSCRIPT_LAYOUT_ID);
        const standard = bundled.find(item => item.id === CONTEMPORARY_LITERARY_LAYOUT_ID);

        expect(basic).toMatchObject({
            name: 'Basic',
            tier: 'free',
            templateKind: 'book',
        });
        expect(standard).toMatchObject({
            name: 'Standard',
            tier: 'free',
            templateKind: 'book',
        });
        expect(getPandocLayoutTier(basic!)).toBe('free');
        expect(getPandocLayoutTier(standard!)).toBe('free');
    });

    it('marks Professional and Signature as Pro templates', () => {
        const bundled = getBundledPandocLayouts();

        expect(getPandocLayoutTier(bundled.find(item => item.id === 'bundled-fiction-signature-literary')!)).toBe('pro');
        expect(getPandocLayoutTier(bundled.find(item => item.id === 'bundled-fiction-modern-classic')!)).toBe('pro');
    });

    it('treats imported and custom templates as Pro custom templates', async () => {
        const plugin = {
            settings: { pandocLayouts: [], pandocFolder: 'Pandoc' },
            app: {
                vault: { getAbstractFileByPath: () => null },
            },
        } as unknown as RadialTimelinePlugin;

        const candidate = await buildImportedTemplateCandidate(plugin, {
            sourcePath: '/tmp/imported-template.tex',
            name: 'Imported Template',
        });

        expect(candidate.layout).toMatchObject({
            tier: 'pro',
            templateKind: 'custom',
        });
        expect(getPandocLayoutTier(candidate.layout)).toBe('pro');
        expect(getPandocLayoutKind(candidate.layout)).toBe('custom');
        expect(getPandocLayoutTier(layout({ bundled: false }))).toBe('pro');
        expect(getPandocLayoutKind(layout({ bundled: false }))).toBe('custom');
    });

    it('falls a non-Pro novel Pro template back to Basic', () => {
        const basic = layout({
            id: BASIC_MANUSCRIPT_LAYOUT_ID,
            name: 'Basic',
            bundled: true,
            tier: 'free',
        });
        const professional = layout({
            id: 'bundled-fiction-signature-literary',
            name: 'Professional',
            bundled: true,
            tier: 'pro',
        });

        const access = resolveTemplateAccess({
            layouts: [professional, basic],
            selectedLayoutId: professional.id,
            manuscriptPreset: 'novel',
            hasProAccess: false,
        });

        expect(access.usedFallback).toBe(true);
        expect(access.effectiveLayout?.id).toBe(BASIC_MANUSCRIPT_LAYOUT_ID);
        expect(access.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'warning',
                code: 'template_access_fallback_to_basic',
            }),
        ]));
    });

    it('treats designed-origin layouts as Pro regardless of name/id', () => {
        const designed = layout({
            id: 'designed-style-my-look',
            name: 'My Submission Look', // contains 'submission' but origin should win
            origin: 'designed',
            bundled: false,
        });
        expect(getPandocLayoutTier(designed)).toBe('pro');
    });

    describe('getLayoutAbbreviation', () => {
        it('returns the correct two-letter code for each bundled fiction layout', () => {
            const bundled = getBundledPandocLayouts();
            const byId = (id: string) => bundled.find(item => item.id === id)!;
            expect(getLayoutAbbreviation(byId(BASIC_MANUSCRIPT_LAYOUT_ID))).toBe('BA');
            expect(getLayoutAbbreviation(byId(CONTEMPORARY_LITERARY_LAYOUT_ID))).toBe('ST');
            expect(getLayoutAbbreviation(byId('bundled-fiction-signature-literary'))).toBe('PR');
            expect(getLayoutAbbreviation(byId('bundled-fiction-modern-classic'))).toBe('SG');
        });

        it('returns "DS" for designed-origin layouts', () => {
            expect(getLayoutAbbreviation(layout({
                id: 'designed-style-my-look',
                origin: 'designed',
                bundled: false,
            }))).toBe('DS');
        });

        it('returns "CT" for imported / unknown / undefined layouts', () => {
            expect(getLayoutAbbreviation(layout({
                id: 'random-imported-layout',
                origin: 'imported',
                bundled: false,
            }))).toBe('CT');
            expect(getLayoutAbbreviation(layout({
                id: 'whatever-custom',
                bundled: false,
            }))).toBe('CT');
            expect(getLayoutAbbreviation(undefined)).toBe('CT');
            expect(getLayoutAbbreviation(null)).toBe('CT');
        });
    });

    it('keeps the selected Pro template for Pro users', () => {
        const signatureLayout = layout({
            id: 'bundled-fiction-modern-classic',
            name: 'Signature',
            bundled: true,
            tier: 'pro',
        });

        const access = resolveTemplateAccess({
            layouts: [signatureLayout],
            selectedLayoutId: signatureLayout.id,
            manuscriptPreset: 'novel',
            hasProAccess: true,
        });

        expect(access.usedFallback).toBe(false);
        expect(access.effectiveLayout?.id).toBe(signatureLayout.id);
        expect(access.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'info',
                code: 'template_access_requires_pro',
            }),
        ]));
    });
});
