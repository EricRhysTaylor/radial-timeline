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
import { BUNDLED_FICTION_SPECS } from '../publishing/bundledStyleSpecs';

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
        expect(cloned.specVersion).toBe(2);
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
        expect(result.errors.some(e => e.toLowerCase().includes('name'))).toBe(true);
    });

    it('errors when custom paper has zero dimensions', () => {
        const spec = freshSubmissionSpec();
        spec.paperSize = { widthIn: 0, heightIn: 9 };
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors.some(e => e.toLowerCase().includes('width'))).toBe(true);
    });

    it('errors when margins consume the full page height', () => {
        const spec = freshSubmissionSpec();
        spec.margins.topIn = 5;
        spec.margins.bottomIn = 5; // 10 inches >= 9-inch page height
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors.some(e => e.toLowerCase().includes('top + bottom'))).toBe(true);
    });

    it('errors when body size is out of range', () => {
        const spec = freshSubmissionSpec();
        spec.body.sizePt = 30;
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors.some(e => e.includes('30'))).toBe(true);
    });

    it('warns when folio is in headers but headers are off', () => {
        const spec = freshSubmissionSpec();
        spec.folio.position = 'header';
        spec.runningHeader.mode = 'none';
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.errors).toEqual([]);
        expect(result.warnings.some(w => w.toLowerCase().includes('folio'))).toBe(true);
    });

    it('warns when part epigraphs are enabled but parts are off', () => {
        const spec = freshSubmissionSpec();
        spec.parts.mode = 'off';
        spec.parts.epigraph = true;
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.warnings.some(w => w.toLowerCase().includes('parts are off'))).toBe(true);
    });

    it('warns when openerHeadingModes is set but opener is not dedicated-page', () => {
        const spec = freshSubmissionSpec();
        spec.scene.opener = 'inline-separator';
        spec.scene.openerHeadingModes = ['scene-number', 'title-only'];
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.warnings.some(w => w.toLowerCase().includes('dedicated-page'))).toBe(true);
    });

    it('warns when custom paper width is outside common print range', () => {
        const spec = freshSubmissionSpec();
        spec.paperSize = { widthIn: 2, heightIn: 9 };
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.warnings.some(w => w.toLowerCase().includes('paper width'))).toBe(true);
    });

    // Strict font policy (Phase 1): the validation banner surfaces a warning
    // when the body font isn't resolvable. We pick `sorts-mill-goudy` because
    // its diagnostic only reports `ok` once the bundled files have been
    // written into the vault font folder. In a fresh test runner none exist
    // and it is absent from the pinned catalog, so the diagnostic returns
    // `missing-bundled` deterministically.
    //
    // NOT `latin-modern`: that key now resolves from the TeX distribution and
    // is always `ok`, because the texmf tree provides it (GH #34).
    it('warns when the selected body font is not installed', () => {
        const spec = freshSubmissionSpec();
        spec.body.font = 'sorts-mill-goudy';
        const result = validateDesignedStyleSpec(spec, 'Test');
        const hasFontWarning = result.warnings.some(w =>
            w.includes('Sorts Mill Goudy') && w.toLowerCase().includes('not installed')
        );
        expect(hasFontWarning).toBe(true);
    });

    // Complement to the above: a TeX-distribution font must NOT warn. Before
    // the fix, dropping the bundled lmroman files would have left Latin Modern
    // permanently reported as missing, hard-blocking PDF export with an
    // "Install fonts" prompt that could never resolve it.
    it('does not warn for a font provided by the TeX distribution', () => {
        const spec = freshSubmissionSpec();
        spec.body.font = 'latin-modern';
        const result = validateDesignedStyleSpec(spec, 'Test');
        expect(result.warnings.some(w => w.includes('Latin Modern Roman'))).toBe(false);
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

    it('"split-author-page-title-page" populates the four expected corners', () => {
        const spec = freshSubmissionSpec();
        applyHeaderPreset(spec, 'split-author-page-title-page');
        expect(spec.runningHeader.mode).toBe('split-author-page-title-page');
        expect(spec.runningHeader.evenLeft).toBe('page');
        expect(spec.runningHeader.evenRight).toBe('author');
        expect(spec.runningHeader.oddLeft).toBe('title');
        expect(spec.runningHeader.oddRight).toBe('page');
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
