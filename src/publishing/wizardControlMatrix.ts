/*
 * The compile test's case list for the PDF design wizard.
 *
 * Imported by tests only (tests/publishing-pdf-assembly.test.ts builds a real
 * PDF from every case; wizardControlRanges.test.ts checks the list itself).
 * It lives in src/ so the TypeScript build checks it: each enum below is
 * declared as a record over the spec's own union type, so adding a value to
 * the spec without listing it here fails `tsc`, and the new value cannot
 * reach authors uncompiled.
 *
 * For one built-in layout the list is:
 *   - the layout unchanged ("baseline"),
 *   - every numeric control at its minimum and at its maximum
 *     (WIZARD_CONTROL_RANGES), one control at a time,
 *   - every value of every choice the wizard offers that the layout does not
 *     already use, one choice at a time.
 *
 * Changing one thing at a time keeps the list in the low hundreds. `prepare`
 * first puts the spec where the wizard shows that control, exactly as an
 * author would have to (parts on before "Print part title", and so on).
 */
import {
    applyHeaderPreset,
    DESIGNED_HEADER_CORNER_KEYS,
    getEffectiveHeaderField,
    setHeaderCornerField,
    type DesignArchetype,
    type DesignedHeaderField,
    type DesignedStyleSpec,
} from './designedStyle';
import { cloneArchetypeSpec } from './bundledStyleSpecs';
import { FONT_REGISTRY } from './fontResolver';
import { WIZARD_CONTROL_RANGES, WIZARD_NUMERIC_CONTROLS, WIZARD_SEPARATOR_MARKS } from './wizardControlRanges';
import { getWizardFontSource, type WizardFontKey } from './wizardFontChoices';
import type { ManuscriptSceneHeadingMode } from '../utils/manuscript';

export interface WizardEnumControl {
    id: string;
    values: readonly string[];
    /** The value the spec has now, in the same vocabulary as `values`. */
    read(spec: DesignedStyleSpec): string;
    /** Set the value exactly as the wizard's own control does. */
    write(spec: DesignedStyleSpec, value: string): void;
    prepare?(spec: DesignedStyleSpec): void;
}

export interface WizardMatrixCase {
    id: string;
    apply(spec: DesignedStyleSpec): void;
}

/** What the machine running the test can print with. */
export interface WizardMatrixMachine {
    /** The export pipeline's own check for a registry font that must be installed on the computer. */
    isSystemFontFound(key: WizardFontKey): boolean;
    /** A font family installed on this machine, for the "Custom (system font)" choice. */
    customFontName: string;
}

/** Every member of a string union, enforced by the compiler. */
function valuesOf<T extends string>(record: Record<T, true>): T[] {
    return Object.keys(record) as T[];
}

const ON_OFF = ['true', 'false'] as const;

function flag(
    id: string,
    read: (spec: DesignedStyleSpec) => boolean | undefined,
    write: (spec: DesignedStyleSpec, value: boolean) => void,
    prepare?: (spec: DesignedStyleSpec) => void,
): WizardEnumControl {
    return {
        id,
        values: ON_OFF,
        // An unset flag is neither: the wizard's checkbox writes true or false
        // from then on, and the generator can treat unset differently.
        read: (spec) => { const value = read(spec); return value === undefined ? 'unset' : String(value); },
        write: (spec, value) => write(spec, value === 'true'),
        prepare,
    };
}

const partsOn = (spec: DesignedStyleSpec): void => { if (spec.parts.mode === 'off') spec.parts.mode = 'roman'; };
const chaptersOn = (spec: DesignedStyleSpec): void => { if (spec.chapters.mode === 'off') spec.chapters.mode = 'numbered'; };
const dedicatedOpener = (spec: DesignedStyleSpec): void => { spec.scene.opener = 'dedicated-page'; };

/** Text with every character LaTeX and Pandoc templates treat specially. */
const HOSTILE_TEXT = 'QA & Co. #1 $5 50% {x}_y^z~\\';

type PaperChoice = Exclude<DesignedStyleSpec['paperSize'], object> | 'custom';
type HeaderFieldChoice = Exclude<DesignedHeaderField, object> | 'literal';

const HEADER_FIELD_CHOICES = valuesOf<HeaderFieldChoice>({
    page: true, author: true, title: true, 'scene-context': true, chapter: true, empty: true, literal: true,
});

function headerFieldChoice(field: DesignedHeaderField | undefined): HeaderFieldChoice {
    if (field === undefined) return 'empty';
    return typeof field === 'object' ? 'literal' : field;
}

/** Every mark the separator field accepts beyond ASCII, as one separator. */
const SEPARATOR_MARKS_SAMPLE = Array.from(WIZARD_SEPARATOR_MARKS).join(' ');
const SEPARATOR_GLYPHS = ['* * *', '#', HOSTILE_TEXT, SEPARATOR_MARKS_SAMPLE] as const;

export const WIZARD_ENUM_CONTROLS: readonly WizardEnumControl[] = [
    {
        id: 'paperSize',
        values: valuesOf<PaperChoice>({ 'us-trade-6x9': true, 'us-letter': true, a4: true, custom: true }),
        read: spec => typeof spec.paperSize === 'string' ? spec.paperSize : 'custom',
        write: (spec, value) => {
            spec.paperSize = value === 'custom' ? { widthIn: 6, heightIn: 9 } : value as Exclude<PaperChoice, 'custom'>;
        },
    },
    flag('margins.mirrored', spec => spec.margins.mirrored, (spec, value) => { spec.margins.mirrored = value; }),

    // body.font is added per machine in buildWizardMatrixCases.
    flag(
        'body.firstLineIndentSuppressedAfterBreak',
        spec => spec.body.firstLineIndentSuppressedAfterBreak,
        (spec, value) => { spec.body.firstLineIndentSuppressedAfterBreak = value; },
    ),

    {
        id: 'runningHeader.mode',
        values: valuesOf<DesignedStyleSpec['runningHeader']['mode']>({
            none: true, 'centered-title': true, 'split-author-page-title-page': true, 'left-title-right-context': true,
        }),
        read: spec => spec.runningHeader.mode,
        write: (spec, value) => applyHeaderPreset(spec, value as DesignedStyleSpec['runningHeader']['mode']),
    },
    ...DESIGNED_HEADER_CORNER_KEYS.map((corner): WizardEnumControl => ({
        id: `runningHeader.${corner}`,
        values: HEADER_FIELD_CHOICES,
        read: spec => headerFieldChoice(getEffectiveHeaderField(spec, corner)),
        write: (spec, value) => setHeaderCornerField(
            spec,
            corner,
            value === 'literal' ? { literal: HOSTILE_TEXT } : value as Exclude<HeaderFieldChoice, 'literal'>,
        ),
    })),
    {
        id: 'runningHeader.font',
        values: valuesOf<NonNullable<DesignedStyleSpec['runningHeader']['font']>>({ inherit: true, sans: true }),
        read: spec => spec.runningHeader.font ?? 'inherit', // SAFE: unset is the generator's body-font header, the wizard's "inherit" choice
        write: (spec, value) => {
            if (value === 'sans') spec.runningHeader.font = 'sans';
            else delete spec.runningHeader.font;
        },
    },

    {
        id: 'folio.position',
        values: valuesOf<DesignedStyleSpec['folio']['position']>({ header: true, 'bottom-center': true, none: true }),
        read: spec => spec.folio.position,
        write: (spec, value) => { spec.folio.position = value as DesignedStyleSpec['folio']['position']; },
    },
    {
        id: 'folio.format',
        values: valuesOf<NonNullable<DesignedStyleSpec['folio']['format']>>({ arabic: true, 'roman-frontmatter': true }),
        read: spec => spec.folio.format ?? 'roman-frontmatter', // SAFE: unset prints roman front matter, the choice the wizard shows selected
        write: (spec, value) => { spec.folio.format = value as DesignedStyleSpec['folio']['format']; },
    },

    {
        id: 'parts.mode',
        values: valuesOf<DesignedStyleSpec['parts']['mode']>({ off: true, roman: true, arabic: true, word: true }),
        read: spec => spec.parts.mode,
        write: (spec, value) => { spec.parts.mode = value as DesignedStyleSpec['parts']['mode']; },
    },
    flag('parts.pageBreak', spec => spec.parts.pageBreak, (spec, value) => { spec.parts.pageBreak = value; }, partsOn),
    flag('parts.title', spec => !!spec.parts.title, (spec, value) => { spec.parts.title = value; }, partsOn),
    flag('parts.epigraph', spec => spec.parts.epigraph, (spec, value) => { spec.parts.epigraph = value; }, partsOn),
    {
        id: 'parts.epigraphPlacement',
        values: valuesOf<NonNullable<DesignedStyleSpec['parts']['epigraphPlacement']>>({ inline: true, 'own-page': true }),
        // The wizard shows placement once parts print an epigraph.
        prepare: (spec) => { partsOn(spec); if (!spec.epigraph.enabled) spec.parts.epigraph = true; },
        read: spec => spec.parts.epigraphPlacement ?? 'inline', // SAFE: unset prints the epigraph inline, the choice the wizard shows selected
        write: (spec, value) => { spec.parts.epigraphPlacement = value as 'inline' | 'own-page'; },
    },
    flag('parts.openAny', spec => !!spec.parts.openAny, (spec, value) => { spec.parts.openAny = value; }),

    {
        id: 'chapters.mode',
        values: valuesOf<DesignedStyleSpec['chapters']['mode']>({ off: true, numbered: true, titled: true, 'numbered-titled': true }),
        read: spec => spec.chapters.mode,
        write: (spec, value) => { spec.chapters.mode = value as DesignedStyleSpec['chapters']['mode']; },
    },
    flag('chapters.pageBreak', spec => spec.chapters.pageBreak, (spec, value) => { spec.chapters.pageBreak = value; }, chaptersOn),
    flag('chapters.resetSceneCounter', spec => spec.chapters.resetSceneCounter, (spec, value) => { spec.chapters.resetSceneCounter = value; }, chaptersOn),

    {
        id: 'scene.opener',
        values: valuesOf<DesignedStyleSpec['scene']['opener']>({ 'inline-separator': true, 'dedicated-page': true, 'roman-with-rule': true }),
        read: spec => spec.scene.opener,
        write: (spec, value) => { spec.scene.opener = value as DesignedStyleSpec['scene']['opener']; },
    },
    {
        id: 'scene.separatorGlyph',
        values: SEPARATOR_GLYPHS,
        prepare: (spec) => { spec.scene.opener = 'inline-separator'; },
        read: spec => spec.scene.separatorGlyph ?? '* * *', // SAFE: unset prints the generator's three asterisks, which the wizard's field shows
        write: (spec, value) => { spec.scene.separatorGlyph = value; },
    },
    {
        id: 'scene.headingMode',
        values: valuesOf<ManuscriptSceneHeadingMode>({ 'scene-number': true, 'scene-number-title': true, 'title-only': true }),
        prepare: dedicatedOpener,
        read: spec => spec.scene.headingMode,
        write: (spec, value) => { spec.scene.headingMode = value as ManuscriptSceneHeadingMode; },
    },
    flag(
        'scene.suppressHeaderFooterOnOpener',
        spec => spec.scene.suppressHeaderFooterOnOpener,
        (spec, value) => { spec.scene.suppressHeaderFooterOnOpener = value; },
        dedicatedOpener,
    ),
    flag(
        'scene.firstWordEmphasisOnOpener',
        spec => !!spec.scene.firstWordEmphasisOnOpener,
        (spec, value) => { spec.scene.firstWordEmphasisOnOpener = value; },
        dedicatedOpener,
    ),

    flag('epigraph.enabled', spec => spec.epigraph.enabled, (spec, value) => { spec.epigraph.enabled = value; }),
    flag('epigraph.italic', spec => spec.epigraph.italic, (spec, value) => { spec.epigraph.italic = value; }),
    {
        id: 'epigraph.attributionStyle',
        values: valuesOf<DesignedStyleSpec['epigraph']['attributionStyle']>({ 'em-dash-caps': true, plain: true }),
        read: spec => spec.epigraph.attributionStyle,
        write: (spec, value) => { spec.epigraph.attributionStyle = value as DesignedStyleSpec['epigraph']['attributionStyle']; },
    },
];

/**
 * The font choice, for this machine: the fonts the wizard's picker would
 * offer here. A registry font that has to be installed on the computer is
 * only a case where it is installed — on a machine without it the picker
 * does not offer it and Save refuses it, so there is nothing to compile.
 */
function fontControl(machine: WizardMatrixMachine): WizardEnumControl {
    const registryKeys = (Object.keys(FONT_REGISTRY) as WizardFontKey[])
        .filter(key => getWizardFontSource(key) !== 'computer' || machine.isSystemFontFound(key));
    return {
        id: 'body.font',
        values: [...registryKeys, 'custom'],
        read: spec => spec.body.font,
        write: (spec, value) => {
            spec.body.font = value as DesignedStyleSpec['body']['font'];
            if (value === 'custom') spec.body.customFontName = machine.customFontName;
            else delete spec.body.customFontName;
        },
    };
}

export function buildWizardMatrixCases(archetype: DesignArchetype, machine: WizardMatrixMachine): WizardMatrixCase[] {
    const cases: WizardMatrixCase[] = [{ id: 'baseline', apply: () => undefined }];

    for (const control of WIZARD_NUMERIC_CONTROLS) {
        const { min, max } = WIZARD_CONTROL_RANGES[control.range];
        const prepared = cloneArchetypeSpec(archetype);
        control.prepare?.(prepared);
        const current = control.read(prepared);
        for (const [end, value] of [['min', min], ['max', max]] as const) {
            if (current === value) continue;
            cases.push({
                id: `${control.id}=${end}(${value})`,
                apply: (spec) => { control.prepare?.(spec); control.write(spec, value); },
            });
        }
    }

    // The one pair that is crossed: whether a separator mark prints depends on
    // the font, so every font is compiled with every accepted mark. (The
    // layout's own font gets them from scene.separatorGlyph below.)
    const fonts = fontControl(machine);
    const ownFont = fonts.read(cloneArchetypeSpec(archetype));
    for (const font of fonts.values) {
        if (font === ownFont) continue;
        cases.push({
            id: `body.font=${font}+scene.separatorGlyph=marks`,
            apply: (spec) => {
                fonts.write(spec, font);
                spec.scene.opener = 'inline-separator';
                spec.scene.separatorGlyph = SEPARATOR_MARKS_SAMPLE;
            },
        });
    }

    for (const control of [...WIZARD_ENUM_CONTROLS, fonts]) {
        const prepared = cloneArchetypeSpec(archetype);
        control.prepare?.(prepared);
        const current = control.read(prepared);
        for (const value of control.values) {
            if (current === value) continue;
            cases.push({
                id: `${control.id}=${value}`,
                apply: (spec) => { control.prepare?.(spec); control.write(spec, value); },
            });
        }
    }

    return cases;
}
