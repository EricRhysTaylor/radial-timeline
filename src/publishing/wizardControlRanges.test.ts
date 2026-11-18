import { describe, expect, it } from 'vitest';
import { BUNDLED_FICTION_IDS, BUNDLED_FICTION_SPECS, cloneArchetypeSpec } from './bundledStyleSpecs';
import { renderFontspec } from './designedStyleFragments';
import { generateDesignedStyleTex } from './designedStyle';
import { replaceGeneratedFontBlock } from './designedLayoutFiles';
import { FONT_REGISTRY } from './fontResolver';
import {
    clampToWizardRange,
    findUntestedSeparatorCharacters,
    findWizardRangeViolations,
    keepTestedSeparatorCharacters,
    WIZARD_CONTROL_RANGES,
    WIZARD_NUMERIC_CONTROLS,
    WIZARD_SEPARATOR_MARKS,
} from './wizardControlRanges';
import { WIZARD_ENUM_CONTROLS, buildWizardMatrixCases } from './wizardControlMatrix';
import { listWizardFontChoices } from './wizardFontChoices';

describe('wizard control ranges', () => {
    it('contain every value the four built-in layouts ship with', () => {
        for (const id of BUNDLED_FICTION_IDS) {
            expect(findWizardRangeViolations(BUNDLED_FICTION_SPECS[id]), id).toEqual([]);
        }
    });

    it('bring a typed value to the nearest end of the range', () => {
        expect(clampToWizardRange('marginIn', 0.2)).toBe(WIZARD_CONTROL_RANGES.marginIn.min);
        expect(clampToWizardRange('marginIn', 3)).toBe(WIZARD_CONTROL_RANGES.marginIn.max);
        expect(clampToWizardRange('bodySizePt', 11)).toBe(11);
    });

    it('every control writes a value it then reads back', () => {
        for (const control of WIZARD_NUMERIC_CONTROLS) {
            const spec = structuredClone(BUNDLED_FICTION_SPECS['bundled-fiction-modern-classic']);
            control.prepare?.(spec);
            const { max } = WIZARD_CONTROL_RANGES[control.range];
            control.write(spec, max);
            expect(control.read(spec), control.id).toBe(max);
        }
    });

    it('reports a stored value outside its range without changing it', () => {
        const spec = structuredClone(BUNDLED_FICTION_SPECS['bundled-fiction-classic-manuscript']);
        spec.margins.leftIn = 0.5;
        const violations = findWizardRangeViolations(spec);
        expect(violations.map(v => v.control.id)).toEqual(['margins.leftIn']);
        expect(spec.margins.leftIn).toBe(0.5);
    });
});

describe('wizard compile matrix cases', () => {
    const allFonts = { isSystemFontFound: () => true, customFontName: 'Georgia' };
    const noSystemFonts = { isSystemFontFound: () => false, customFontName: 'Georgia' };

    it('cover both ends of every numeric control for every built-in layout', () => {
        for (const archetype of ['submission', 'reading-draft', 'literary', 'structured'] as const) {
            const ids = buildWizardMatrixCases(archetype, allFonts).map(c => c.id);
            for (const control of WIZARD_NUMERIC_CONTROLS) {
                const source = cloneArchetypeSpec(archetype);
                control.prepare?.(source);
                const current = control.read(source);
                const { min, max } = WIZARD_CONTROL_RANGES[control.range];
                // An end the layout already sits on is compiled by its baseline case.
                if (current !== min) expect(ids, `${archetype} ${control.id} min`).toContain(`${control.id}=min(${min})`);
                if (current !== max) expect(ids, `${archetype} ${control.id} max`).toContain(`${control.id}=max(${max})`);
            }
        }
    });

    it('cover every enum value the layout does not already use', () => {
        const cases = buildWizardMatrixCases('submission', allFonts);
        const ids = new Set(cases.map(c => c.id));
        for (const control of WIZARD_ENUM_CONTROLS) {
            for (const value of control.values) {
                const spec = structuredClone(BUNDLED_FICTION_SPECS['bundled-fiction-classic-manuscript']);
                control.prepare?.(spec);
                if (control.read(spec) === value) continue;
                expect(ids.has(`${control.id}=${value}`), `${control.id}=${value}`).toBe(true);
            }
        }
        expect(ids.has('baseline')).toBe(true);
        expect(ids.size).toBe(cases.length);
    });

    it('leave out a system font this machine does not have, and nothing else', () => {
        const none = buildWizardMatrixCases('structured', noSystemFonts).map(c => c.id);
        const all = buildWizardMatrixCases('structured', allFonts).map(c => c.id);
        const dropped = all.filter(id => !none.includes(id));
        expect(dropped.sort()).toEqual([
            'body.font=crimson', 'body.font=crimson+scene.separatorGlyph=marks',
            'body.font=eb-garamond', 'body.font=eb-garamond+scene.separatorGlyph=marks',
            'body.font=system-sans', 'body.font=system-sans+scene.separatorGlyph=marks',
        ]);
    });

    it('print every accepted separator mark with every font, the one crossed pair', () => {
        const ids = buildWizardMatrixCases('literary', allFonts).map(c => c.id);
        for (const font of [...Object.keys(FONT_REGISTRY), 'custom']) {
            if (font === 'sorts-mill-goudy') continue; // this layout's own font: covered by scene.separatorGlyph
            expect(ids, font).toContain(`body.font=${font}+scene.separatorGlyph=marks`);
        }
        expect(ids).toContain(`scene.separatorGlyph=${Array.from(WIZARD_SEPARATOR_MARKS).join(' ')}`);
    });
});

describe('scene separator characters', () => {
    it('keeps ASCII and the tested marks, and drops symbols not every font has', () => {
        expect(keepTestedSeparatorCharacters('* * *')).toBe('* * *');
        expect(keepTestedSeparatorCharacters('• — §')).toBe('• — §');
        // The asterism and the fleuron stopped the export on all four layouts.
        expect(keepTestedSeparatorCharacters('⁂')).toBe('');
        expect(keepTestedSeparatorCharacters('~ ❦ ~')).toBe('~  ~');
    });

    it('names the characters of a stored separator the field would not accept', () => {
        expect(findUntestedSeparatorCharacters('* * *')).toEqual([]);
        expect(findUntestedSeparatorCharacters('⁂ ❦ ⁂')).toEqual(['⁂', '❦']);
    });
});

describe('wizard font choices', () => {
    it('lists every registry font once, with where it comes from', () => {
        const choices = listWizardFontChoices(() => false);
        expect(choices.map(c => c.key).sort()).toEqual(Object.keys(FONT_REGISTRY).sort());
        const bySource = (source: string) => choices.filter(c => c.source === source).map(c => c.key).sort();
        expect(bySource('included')).toEqual(['sorts-mill-goudy', 'source-serif']);
        expect(bySource('latex')).toEqual(['latin-modern', 'system-serif', 'tex-gyre-heros']);
        expect(bySource('computer')).toEqual(['crimson', 'eb-garamond', 'system-sans']);
    });

    it('offers a system font only when this machine can load it', () => {
        const choices = listWizardFontChoices(key => key === 'system-sans');
        const found = choices.filter(c => c.found).map(c => c.key).sort();
        expect(found).toEqual(['latin-modern', 'sorts-mill-goudy', 'source-serif', 'system-sans', 'system-serif', 'tex-gyre-heros']);
    });
});

describe('replaceGeneratedFontBlock', () => {
    const spec = BUNDLED_FICTION_SPECS['bundled-fiction-contemporary-literary'];

    it('swaps only the font block, leaving every other byte as saved', () => {
        const bySystemName = generateDesignedStyleTex(spec, { bundledLayoutId: 'designed-qa' });
        expect(bySystemName).toContain('\\setmainfont{Source Serif 4}\n');
        const fontDir = `${process.cwd()}/src/assets/fonts`;
        const refreshed = replaceGeneratedFontBlock(bySystemName, renderFontspec(spec, { vaultFontDir: fontDir }));
        expect(refreshed).toBe(generateDesignedStyleTex(spec, { bundledLayoutId: 'designed-qa', vaultFontDir: fontDir }));
        expect(refreshed).toContain(`Path = ${fontDir}/source-serif-4/ ,`);
    });

    it('follows the vault when it moves', () => {
        const fontDir = `${process.cwd()}/src/assets/fonts`;
        const saved = generateDesignedStyleTex(spec, { vaultFontDir: fontDir }).replace(fontDir, '/Volumes/Old/Vault/fonts');
        const refreshed = replaceGeneratedFontBlock(saved, renderFontspec(spec, { vaultFontDir: fontDir }));
        expect(refreshed).not.toContain('/Volumes/Old/Vault');
        expect(refreshed).toContain(`Path = ${fontDir}/source-serif-4/ ,`);
    });

    it('declines a file with no generated font block', () => {
        expect(replaceGeneratedFontBlock('\\documentclass{book}\n\\setmainfont{Georgia}\n', 'x')).toBeNull();
    });
});
