/*
 * Unit tests for the pure helpers exported by DesignedStyleWizardModal.
 *
 * The modal lifecycle itself (Obsidian's Modal class, DOM rendering) is not
 * tested here — those rely on Obsidian runtime APIs that are awkward to mock.
 * Helpers cover the load-bearing logic: validation rules, slug uniqueness,
 * archetype cloning, and header preset → per-corner field mapping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    applyHeaderPreset,
    cloneArchetypeSpec,
    derivePageFeel,
    deriveHeaderStyle,
    deriveSpacingPreset,
    generateUniqueDesignedSlug,
    validateDesignedStyleSpec,
} from './DesignedStyleWizardModal';
import type { DesignedStyleSpec } from '../publishing/designedStyle';
import { DESIGNED_STYLE_SPEC_VERSION } from '../publishing/designedStyle';
import { BUNDLED_FICTION_SPECS } from '../publishing/bundledStyleSpecs';
import { t } from '../i18n';

function freshSubmissionSpec(): DesignedStyleSpec {
    return cloneArchetypeSpec('submission');
}

describe('cloneArchetypeSpec', () => {
    it('produces a deep clone (mutation does not affect bundled spec)', () => {
        const cloned = cloneArchetypeSpec('submission');
        cloned.body.sizePt = 99;
        expect(BUNDLED_FICTION_SPECS['bundled-fiction-classic-manuscript'].body.sizePt).not.toBe(99);
    });

    it('returns spec equal in shape to the bundled archetype source', () => {
        const cloned = cloneArchetypeSpec('literary');
        const source = BUNDLED_FICTION_SPECS['bundled-fiction-signature-literary'];
        expect(cloned.archetype).toBe(source.archetype);
        expect(cloned.body.font).toBe(source.body.font);
        expect(cloned.runningHeader.mode).toBe(source.runningHeader.mode);
    });

    it('always sets specVersion to the current constant', () => {
        const cloned = cloneArchetypeSpec('structured');
        // Bound to the constant, not a literal: the assertion is "the wizard
        // stamps the current version", which stays true across version bumps.
        expect(cloned.specVersion).toBe(DESIGNED_STYLE_SPEC_VERSION);
    });
});

describe('generateUniqueDesignedSlug', () => {
    it('returns the base slug when there are no collisions', () => {
        const existing = new Set<string>();
        expect(generateUniqueDesignedSlug('My Style', existing)).toBe('my-style');
    });

    it('suffixes -2 on first collision', () => {
        const existing = new Set<string>(['designed-my-style']);
        expect(generateUniqueDesignedSlug('My Style', existing)).toBe('my-style-2');
    });

    it('walks past consecutive collisions to -3, -4, ...', () => {
        const existing = new Set<string>(['designed-my-style', 'designed-my-style-2', 'designed-my-style-3']);
        expect(generateUniqueDesignedSlug('My Style', existing)).toBe('my-style-4');
    });

    it('handles names with mixed case + punctuation', () => {
        const existing = new Set<string>();
        // slugifyToFileStem strips forbidden chars and collapses spaces; lowercase
        // is applied by generateUniqueDesignedSlug.
        const result = generateUniqueDesignedSlug('Foo Bar?', existing);
        expect(result).toBe('foo-bar');
    });
});

describe('validateDesignedStyleSpec', () => {
    // Font-install diagnostics shell out to the host font list, which is
    // non-deterministic across machines (CI Linux runners lack Arial). Pin a
    // catalog so the "no warnings" assertion is host-independent. The
    // latin-modern case below is bundled-path based and unaffected by this.
    const priorFontCatalog = process.env.RT_FONT_CATALOG;
    beforeAll(() => {
        process.env.RT_FONT_CATALOG = 'Arial,Times New Roman,Georgia,Garamond,EB Garamond';
    });
    afterAll(() => {
        if (priorFontCatalog === undefined) delete process.env.RT_FONT_CATALOG;
        else process.env.RT_FONT_CATALOG = priorFontCatalog;
    });

    it('accepts a valid base spec with no errors and no warnings', () => {
        const spec = freshSubmissionSpec();
        const result = validateDesignedStyleSpec(spec, 'My Style');
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    it('reports an error when the name is empty', () => {
        const spec = freshSubmissionSpec();
        const result = validateDesignedStyleSpec(spec, '   ');
        expect(result.errors).toContain(t('ui.designedStyleWizardModal.errStyleNameRequired'));
    });

    it('errors when custom paper has zero dimensions', () => {
        const spec = freshSubmissionSpec();
        spec.paperSize = { widthIn: 0, heightIn: 9 };
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toContain(t('ui.designedStyleWizardModal.errCustomWidthPositive'));
    });

    it('errors when margins consume the full page height', () => {
        const spec = freshSubmissionSpec();
        spec.margins.topIn = 5;
        spec.margins.bottomIn = 5; // 10 inches >= 9-inch page height
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toContain(t('ui.designedStyleWizardModal.errTopBottomMargins'));
    });

    it('errors when body size is out of range', () => {
        const spec = freshSubmissionSpec();
        spec.body.sizePt = 30;
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toContain(t('ui.designedStyleWizardModal.errBodySizeRange', { size: 30 }));
    });

    it('warns when folio is in headers but headers are off', () => {
        const spec = freshSubmissionSpec();
        spec.folio.position = 'header';
        spec.runningHeader.mode = 'none';
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toEqual([]);
        expect(result.warnings).toContain(t('ui.designedStyleWizardModal.warnFolioHeadersOff'));
    });

    it('warns when part epigraphs are enabled but parts are off', () => {
        const spec = freshSubmissionSpec();
        spec.parts.mode = 'off';
        spec.parts.epigraph = true;
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.warnings).toContain(t('ui.designedStyleWizardModal.warnPartEpigraphsOff'));
    });

    it('warns when openerHeadingModes is set but opener is not dedicated-page', () => {
        const spec = freshSubmissionSpec();
        spec.scene.opener = 'inline-separator';
        spec.scene.openerHeadingModes = ['scene-number', 'title-only'];
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.warnings).toContain(t('ui.designedStyleWizardModal.warnMultiHeadingModes'));
    });

    // A value saved before the tested ranges existed is left alone and
    // pointed out; it never blocks Save and is never moved by the wizard.
    it('warns, without blocking, when a stored value is outside the tested range', () => {
        const spec = freshSubmissionSpec();
        spec.paperSize = { widthIn: 10, heightIn: 9 };
        spec.body.sizePt = 14;
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toEqual([]);
        expect(result.warnings).toContain(t('ui.designedStyleWizardModal.warnOutsideTestedRange', {
            control: t('ui.designedStyleWizardModal.customWidth'), value: '10', min: '4.25', max: '8.5',
        }));
        expect(result.warnings).toContain(t('ui.designedStyleWizardModal.warnOutsideTestedRange', {
            control: t('ui.designedStyleWizardModal.sizeLabel'), value: '14', min: '10', max: '13',
        }));
    });

    it('shows text-height fractions as the percentages the sliders show', () => {
        const spec = cloneArchetypeSpec('reading-draft');
        spec.chapters.spacing = { topFraction: 0.9 };
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.warnings).toContain(t('ui.designedStyleWizardModal.warnOutsideTestedRange', {
            control: t('ui.designedStyleWizardModal.headingTopPositionLabel'), value: '90%', min: '8%', max: '50%',
        }));
    });

    // The Save rule: a font the author would have to install themselves, and
    // has not, blocks the save with the export dialog's own message. Crimson
    // Text is a system-only registry font absent from the pinned catalog.
    it('blocks Save, with the export dialog message, when the body font cannot be found', () => {
        const spec = freshSubmissionSpec();
        spec.body.font = 'crimson';
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toEqual([t('ui.manuscriptOptionsModal.fontNotInstalled', { font: 'Crimson Text' })]);
        expect(result.fontDiagnostic?.state).toBe('missing-system');
        expect(result.fontDiagnostic?.installHint?.url).toBe('https://fonts.google.com/specimen/Crimson+Text');
    });

    it('blocks Save when "Custom" is chosen and no font name has been typed', () => {
        const spec = freshSubmissionSpec();
        spec.body.font = 'custom';
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toHaveLength(1);
        expect(result.fontDiagnostic?.state).toBe('missing-system');
    });

    // A font that ships with the plugin is copied into the vault by Save, so
    // "not in the vault yet" is nothing the author has to fix. In a fresh
    // test runner no vault font folder exists and Sorts Mill Goudy is absent
    // from the pinned catalog, so its diagnostic is `missing-bundled`.
    it('does not block or warn for a font that ships with the plugin', () => {
        const spec = freshSubmissionSpec();
        spec.body.font = 'sorts-mill-goudy';
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    // A TeX-distribution font resolves from the texmf tree (GH #34).
    it('does not block or warn for a font provided by the TeX distribution', () => {
        const spec = freshSubmissionSpec();
        spec.body.font = 'latin-modern';
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    it('accepts every built-in layout as it ships', () => {
        for (const archetype of ['submission', 'reading-draft', 'literary', 'structured'] as const) {
            const result = validateDesignedStyleSpec(cloneArchetypeSpec(archetype), 'Test');
            expect(result.errors, archetype).toEqual([]);
            expect(result.warnings, archetype).toEqual([]);
        }
    });

    // The Literary line ("12 | AUTHOR") already carries the page number.
    describe('page number printed twice', () => {
        it('warns when the Literary line and a bottom page number both print it', () => {
            const spec = cloneArchetypeSpec('literary');
            spec.folio.position = 'bottom-center';
            const result = validateDesignedStyleSpec(spec, 'Test');
            expect(result.warnings).toEqual([
                t('ui.designedStyleWizardModal.warnPageTwiceFolio', { corner: t('ui.designedStyleWizardModal.cornerEvenCenter') }),
            ]);
        });

        it('warns when a corner adds a page number beside the Literary line', () => {
            const spec = cloneArchetypeSpec('literary');
            spec.runningHeader.oddRight = 'page';
            const result = validateDesignedStyleSpec(spec, 'Test');
            expect(result.warnings).toEqual([
                t('ui.designedStyleWizardModal.warnPageTwicePreset', { corner: t('ui.designedStyleWizardModal.cornerOddRight') }),
            ]);
        });

        it('does not warn when the page number is on left- and right-hand pages once each', () => {
            const spec = freshSubmissionSpec();
            spec.folio.position = 'header';
            spec.runningHeader.evenLeft = 'page';
            spec.runningHeader.oddRight = 'page';
            expect(validateDesignedStyleSpec(spec, 'Test').warnings).toEqual([]);
        });
    });
});

describe('applyHeaderPreset', () => {
    it('"centered-title" populates centers and clears edges', () => {
        const spec = freshSubmissionSpec();
        // Seed left/right values to verify they get cleared.
        spec.runningHeader.evenLeft = 'page';
        spec.runningHeader.oddRight = 'author';
        applyHeaderPreset(spec, 'centered-title');
        expect(spec.runningHeader.mode).toBe('centered-title');
        expect(spec.runningHeader.evenCenter).toBe('title');
        expect(spec.runningHeader.oddCenter).toBe('title');
        expect(spec.runningHeader.evenLeft).toBeUndefined();
        expect(spec.runningHeader.evenRight).toBeUndefined();
        expect(spec.runningHeader.oddLeft).toBeUndefined();
        expect(spec.runningHeader.oddRight).toBeUndefined();
    });

    it('"split-author-page-title-page" (Literary) fills the two centres it prints in', () => {
        const spec = freshSubmissionSpec();
        applyHeaderPreset(spec, 'split-author-page-title-page');
        expect(spec.runningHeader.mode).toBe('split-author-page-title-page');
        expect(spec.runningHeader.evenCenter).toEqual({ join: ['page', 'author'] });
        expect(spec.runningHeader.oddCenter).toEqual({ join: ['title', 'page'] });
        expect(spec.runningHeader.evenLeft).toBeUndefined();
        expect(spec.runningHeader.evenRight).toBeUndefined();
        expect(spec.runningHeader.oddLeft).toBeUndefined();
        expect(spec.runningHeader.oddRight).toBeUndefined();
    });

    it('"left-title-right-context" populates evenLeft + oddRight', () => {
        const spec = freshSubmissionSpec();
        applyHeaderPreset(spec, 'left-title-right-context');
        expect(spec.runningHeader.evenLeft).toBe('title');
        expect(spec.runningHeader.oddRight).toBe('scene-context');
    });

    it('"none" clears all fields', () => {
        const spec = freshSubmissionSpec();
        applyHeaderPreset(spec, 'split-author-page-title-page');
        applyHeaderPreset(spec, 'none');
        expect(spec.runningHeader.mode).toBe('none');
        expect(spec.runningHeader.evenLeft).toBeUndefined();
        expect(spec.runningHeader.evenRight).toBeUndefined();
        expect(spec.runningHeader.oddLeft).toBeUndefined();
        expect(spec.runningHeader.oddRight).toBeUndefined();
        expect(spec.runningHeader.evenCenter).toBeUndefined();
        expect(spec.runningHeader.oddCenter).toBeUndefined();
    });
});

describe('derivePageFeel', () => {
    it('returns "balanced" when all four margins are 1.0in', () => {
        const spec = freshSubmissionSpec();
        spec.margins = { topIn: 1.0, bottomIn: 1.0, leftIn: 1.0, rightIn: 1.0 };
        expect(derivePageFeel(spec)).toBe('balanced');
    });

    it('returns "compact" when all four margins are 0.75in', () => {
        const spec = freshSubmissionSpec();
        spec.margins = { topIn: 0.75, bottomIn: 0.75, leftIn: 0.75, rightIn: 0.75 };
        expect(derivePageFeel(spec)).toBe('compact');
    });

    it('returns "airy" when all four margins are 1.25in', () => {
        const spec = freshSubmissionSpec();
        spec.margins = { topIn: 1.25, bottomIn: 1.25, leftIn: 1.25, rightIn: 1.25 };
        expect(derivePageFeel(spec)).toBe('airy');
    });

    it('returns "custom" for Signature-style asymmetric margins', () => {
        const spec = freshSubmissionSpec();
        spec.margins = { topIn: 0.85, bottomIn: 1.05, leftIn: 0.9, rightIn: 0.9 };
        expect(derivePageFeel(spec)).toBe('custom');
    });

    it('returns "custom" when one margin diverges from the others', () => {
        const spec = freshSubmissionSpec();
        spec.margins = { topIn: 1.0, bottomIn: 1.0, leftIn: 1.0, rightIn: 0.9 };
        expect(derivePageFeel(spec)).toBe('custom');
    });
});

describe('deriveSpacingPreset', () => {
    it('returns "standard" for 1.5', () => {
        const spec = freshSubmissionSpec();
        spec.body.lineSpacing = 1.5;
        expect(deriveSpacingPreset(spec)).toBe('standard');
    });

    it('returns "tight" for 1.0', () => {
        const spec = freshSubmissionSpec();
        spec.body.lineSpacing = 1.0;
        expect(deriveSpacingPreset(spec)).toBe('tight');
    });

    it('returns "airy" for 2.0', () => {
        const spec = freshSubmissionSpec();
        spec.body.lineSpacing = 2.0;
        expect(deriveSpacingPreset(spec)).toBe('airy');
    });

    it('returns "custom" for Modern Classic\'s 1.18', () => {
        const spec = freshSubmissionSpec();
        spec.body.lineSpacing = 1.18;
        expect(deriveSpacingPreset(spec)).toBe('custom');
    });
});

describe('deriveHeaderStyle', () => {
    it('returns "none" when runningHeader.mode is "none"', () => {
        const spec = freshSubmissionSpec();
        spec.runningHeader.mode = 'none';
        expect(deriveHeaderStyle(spec)).toBe('none');
    });

    it('returns "minimal" when runningHeader.mode is "centered-title"', () => {
        const spec = freshSubmissionSpec();
        spec.runningHeader.mode = 'centered-title';
        expect(deriveHeaderStyle(spec)).toBe('minimal');
    });

    it('returns "literary" when runningHeader.mode is "split-author-page-title-page"', () => {
        const spec = freshSubmissionSpec();
        spec.runningHeader.mode = 'split-author-page-title-page';
        expect(deriveHeaderStyle(spec)).toBe('literary');
    });

    it('returns "contemporary" for the "left-title-right-context" mode', () => {
        const spec = freshSubmissionSpec();
        spec.runningHeader.mode = 'left-title-right-context';
        expect(deriveHeaderStyle(spec)).toBe('contemporary');
    });
});
