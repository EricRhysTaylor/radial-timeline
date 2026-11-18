/*
 * Tested ranges for the PDF design wizard's numeric controls.
 *
 * One table, three readers:
 *   - the wizard's inputs and sliders take min / max / step from it,
 *   - the wizard's validation warns when a stored value sits outside it,
 *   - the compile test (tests/publishing-pdf-assembly.test.ts) builds a real
 *     PDF at each control's minimum and maximum for all four built-in layouts.
 *
 * So a range here is a promise that both ends compile. Widening one means
 * re-running the compile test; a failure there is fixed by narrowing the
 * range or fixing the LaTeX the generator emits, never by dropping the case.
 *
 * A control is only listed when the wizard shows it. `prepare` puts a spec
 * into the state the wizard needs before that control appears (for example
 * custom paper width only exists once "Custom" paper is chosen).
 */
import type { DesignedStyleSpec } from './designedStyle';

export interface WizardControlRange {
    min: number;
    max: number;
    step: number;
}

export const WIZARD_CONTROL_RANGES = {
    /** All four page margins, in inches. Compact / Balanced / Airy are 0.75 / 1.0 / 1.25. */
    marginIn:                  { min: 0.75, max: 1.25, step: 0.05 },
    /** Custom paper, in inches. Covers mass-market paperback up to US Letter and A4. */
    customPaperWidthIn:        { min: 4.25, max: 8.5,  step: 0.01 },
    customPaperHeightIn:       { min: 6.75, max: 11.7, step: 0.01 },
    bodySizePt:                { min: 10,   max: 13,   step: 0.5 },
    /** Tight / Standard / Airy are 1.0 / 1.5 / 2.0. */
    lineSpacing:               { min: 1,    max: 2,    step: 0.05 },
    paragraphIndentEm:         { min: 0,    max: 3,    step: 0.1 },
    headerLetterSpacing:       { min: 0,    max: 20,   step: 0.5 },
    /** Fractions of the text height. */
    chapterTopFraction:        { min: 0.08, max: 0.5,  step: 0.02 },
    sceneOpenerTopFraction:    { min: 0.08, max: 0.5,  step: 0.02 },
    sceneOpenerBottomFraction: { min: 0.08, max: 0.5,  step: 0.02 },
} as const satisfies Record<string, WizardControlRange>;

export type WizardControlRangeKey = keyof typeof WIZARD_CONTROL_RANGES;

/** Keep a value the author typed or dragged inside the tested range. */
export function clampToWizardRange(key: WizardControlRangeKey, value: number): number {
    const { min, max } = WIZARD_CONTROL_RANGES[key];
    return Math.min(max, Math.max(min, value));
}

export interface WizardNumericControl {
    /** Stable id, also the compile test's case name. */
    id: string;
    range: WizardControlRangeKey;
    /** Current value, or undefined when the spec leaves it to the generator's default. */
    read(spec: DesignedStyleSpec): number | undefined;
    /** Set the value exactly as the wizard's own control does. */
    write(spec: DesignedStyleSpec, value: number): void;
    /** Put the spec in the state where the wizard shows this control. */
    prepare?(spec: DesignedStyleSpec): void;
}

function marginControl(side: 'topIn' | 'bottomIn' | 'leftIn' | 'rightIn'): WizardNumericControl {
    return {
        id: `margins.${side}`,
        range: 'marginIn',
        read: spec => spec.margins[side],
        write: (spec, value) => { spec.margins[side] = value; },
    };
}

/** "Custom" paper starts from 6 x 9, the same size the wizard's Custom button sets. */
function ensureCustomPaper(spec: DesignedStyleSpec): void {
    if (typeof spec.paperSize === 'string') spec.paperSize = { widthIn: 6, heightIn: 9 };
}

function ensureChaptersOn(spec: DesignedStyleSpec): void {
    if (spec.chapters.mode === 'off') spec.chapters.mode = 'numbered';
}

function ensureDedicatedOpener(spec: DesignedStyleSpec): void {
    spec.scene.opener = 'dedicated-page';
}

export const WIZARD_NUMERIC_CONTROLS: readonly WizardNumericControl[] = [
    marginControl('topIn'),
    marginControl('bottomIn'),
    marginControl('leftIn'),
    marginControl('rightIn'),
    {
        id: 'paperSize.widthIn',
        range: 'customPaperWidthIn',
        prepare: ensureCustomPaper,
        read: spec => typeof spec.paperSize === 'string' ? undefined : spec.paperSize.widthIn,
        write: (spec, value) => { if (typeof spec.paperSize !== 'string') spec.paperSize.widthIn = value; },
    },
    {
        id: 'paperSize.heightIn',
        range: 'customPaperHeightIn',
        prepare: ensureCustomPaper,
        read: spec => typeof spec.paperSize === 'string' ? undefined : spec.paperSize.heightIn,
        write: (spec, value) => { if (typeof spec.paperSize !== 'string') spec.paperSize.heightIn = value; },
    },
    {
        id: 'body.sizePt',
        range: 'bodySizePt',
        read: spec => spec.body.sizePt,
        write: (spec, value) => { spec.body.sizePt = value; },
    },
    {
        id: 'body.lineSpacing',
        range: 'lineSpacing',
        read: spec => spec.body.lineSpacing,
        write: (spec, value) => { spec.body.lineSpacing = value; },
    },
    {
        id: 'body.paragraphIndentEm',
        range: 'paragraphIndentEm',
        read: spec => spec.body.paragraphIndentEm,
        // Zero means "no opinion": the wizard drops the field and LaTeX's own indent applies.
        write: (spec, value) => {
            if (value === 0) delete spec.body.paragraphIndentEm;
            else spec.body.paragraphIndentEm = value;
        },
    },
    {
        id: 'runningHeader.letterSpacing',
        range: 'headerLetterSpacing',
        read: spec => spec.runningHeader.letterSpacing,
        write: (spec, value) => {
            if (value === 0) delete spec.runningHeader.letterSpacing;
            else spec.runningHeader.letterSpacing = value;
        },
    },
    {
        id: 'chapters.spacing.topFraction',
        range: 'chapterTopFraction',
        prepare: ensureChaptersOn,
        read: spec => spec.chapters.mode === 'off' ? undefined : spec.chapters.spacing?.topFraction,
        write: (spec, value) => { spec.chapters.spacing = { ...spec.chapters.spacing, topFraction: value }; },
    },
    {
        id: 'scene.openerSpacing.topFraction',
        range: 'sceneOpenerTopFraction',
        prepare: ensureDedicatedOpener,
        read: spec => spec.scene.opener === 'dedicated-page' ? spec.scene.openerSpacing?.topFraction : undefined,
        write: (spec, value) => { spec.scene.openerSpacing = { ...spec.scene.openerSpacing, topFraction: value }; },
    },
    {
        id: 'scene.openerSpacing.bottomFraction',
        range: 'sceneOpenerBottomFraction',
        prepare: ensureDedicatedOpener,
        read: spec => spec.scene.opener === 'dedicated-page' ? spec.scene.openerSpacing?.bottomFraction : undefined,
        write: (spec, value) => { spec.scene.openerSpacing = { ...spec.scene.openerSpacing, bottomFraction: value }; },
    },
];

/**
 * The marks a scene separator may use beyond plain ASCII.
 *
 * The separator is typed by the author, and whether a mark prints depends on
 * the body font: the export stops rather than print an empty box for a
 * character the font lacks (an asterism, a fleuron). So the field accepts
 * printable ASCII plus this short list, and the compile test prints the whole
 * list with every font the wizard offers.
 */
export const WIZARD_SEPARATOR_MARKS = '·•–—…§¶†‡°«»';

/** One character: printable ASCII (space through tilde) or a listed mark. */
function isTestedSeparatorCharacter(character: string): boolean {
    return (character >= ' ' && character <= '~') || WIZARD_SEPARATOR_MARKS.includes(character);
}

/** What the separator field keeps of what was typed. */
export function keepTestedSeparatorCharacters(text: string): string {
    return Array.from(text).filter(isTestedSeparatorCharacter).join('');
}

/** Characters in a stored separator that the field would not accept today. */
export function findUntestedSeparatorCharacters(separator: string | undefined): string[] {
    if (!separator) return [];
    return Array.from(new Set(Array.from(separator).filter(character => !isTestedSeparatorCharacter(character))));
}

export interface WizardRangeViolation {
    control: WizardNumericControl;
    value: number;
    range: WizardControlRange;
}

/**
 * Stored values outside the tested ranges.
 *
 * The wizard never moves such a value by itself: a style saved before the
 * ranges existed keeps printing exactly as it did until its author changes
 * that control. The wizard only says so.
 */
export function findWizardRangeViolations(spec: DesignedStyleSpec): WizardRangeViolation[] {
    const violations: WizardRangeViolation[] = [];
    for (const control of WIZARD_NUMERIC_CONTROLS) {
        const value = control.read(spec);
        if (value === undefined) continue;
        const range = WIZARD_CONTROL_RANGES[control.range];
        if (value < range.min || value > range.max) violations.push({ control, value, range });
    }
    return violations;
}
