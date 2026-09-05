import type { ProfileOrigin } from '../types';

export type DetectedTemplateUsageContext = 'novel' | 'screenplay' | 'unknown';
export type DetectedTemplateStyleHint = 'manuscript' | 'book' | 'literary' | 'chaptered' | 'custom';
export type DetectedTemplateConfidence = 'low' | 'medium' | 'high';
export type DetectedTemplateMockPreviewKind = 'manuscript' | 'book' | 'literary' | 'chaptered' | 'generic';

export interface DetectedTemplateProfile {
    usageContext: DetectedTemplateUsageContext;
    styleHint: DetectedTemplateStyleHint;
    traits: string[];
    confidence: DetectedTemplateConfidence;
    mockPreviewKind: DetectedTemplateMockPreviewKind;
}

/**
 * Generated Designed-Style .tex files are derived artifacts and must not be
 * reclassified by content heuristics — return a stable "custom" profile so
 * the layout's declared origin is the source of truth.
 */
const DESIGNED_PROFILE: DetectedTemplateProfile = {
    usageContext: 'novel',
    styleHint: 'custom',
    traits: ['Designed style'],
    confidence: 'high',
    mockPreviewKind: 'generic',
};

/**
 * Wrapper around detectTemplateProfile that early-returns for layouts with
 * origin === 'designed'. Use this from any code path that infers style from
 * a .tex file's contents (e.g. import flows, settings reload).
 */
export function detectImportedTemplateStyle(
    texContent: string,
    origin?: ProfileOrigin,
): DetectedTemplateProfile {
    if (origin === 'designed') return DESIGNED_PROFILE;
    return detectTemplateProfile(texContent);
}

export function detectTemplateProfile(texContent: string): DetectedTemplateProfile {
    const source = texContent || '';

    const hasBookClass = /\\documentclass(?:\[[^\]]*\])?\{book\}/i.test(source);
    const hasArticleClass = /\\documentclass(?:\[[^\]]*\])?\{article\}/i.test(source);
    const hasMemoirClass = /\\documentclass(?:\[[^\]]*\])?\{memoir\}/i.test(source);
    const hasKomaClass = /\\documentclass(?:\[[^\]]*\])?\{scrbook\}|\\documentclass(?:\[[^\]]*\])?\{scrreprt\}/i.test(source);
    const hasChapter = /\\chapter\b/i.test(source);
    const hasPart = /\\part\b/i.test(source);
    const hasSection = /\\section\b/i.test(source);
    const hasFancyhdr = /\\usepackage(?:\[[^\]]*\])?\{fancyhdr\}|\\fancyhead|\\fancyfoot/i.test(source);
    const hasTitlesec = /\\usepackage(?:\[[^\]]*\])?\{titlesec\}|\\titleformat|\\titlespacing/i.test(source);
    const hasGeometry = /\\usepackage(?:\[[^\]]*\])?\{geometry\}|\\geometry\b/i.test(source);
    const hasFontspec = /\\usepackage(?:\[[^\]]*\])?\{fontspec\}|\\setmainfont|\\newfontface/i.test(source);
    const hasSetspace = /\\usepackage(?:\[[^\]]*\])?\{setspace\}|\\onehalfspacing|\\doublespacing|\\setstretch\b/i.test(source);
    const hasMicrotype = /\\usepackage(?:\[[^\]]*\])?\{microtype\}|\\microtypesetup\b/i.test(source);
    const hasParskip = /\\usepackage(?:\[[^\]]*\])?\{parskip\}|\\parskip\b|\\parindent\b/i.test(source);
    const hasTwosideLayout = /\btwoside\b|\bopenright\b|\bopenany\b/i.test(source);
    const hasHeaderFooterCommands = /\\pagestyle|\\thispagestyle|\\headrulewidth|\\footrulewidth/i.test(source);
    const hasTitlePageSignals = /\$if\(title\)\$|\$title\$|\\maketitle|titlepage/i.test(source);
    const hasBodyHook = /\$body\$/i.test(source);
    const hasTocSignals = /\\tableofcontents\b|\$if\(toc\)\$|\$toc-title\$/i.test(source);
    const hasSceneBreakSignals = /\\scenebreak\b|\\scenebreak\b|\\asterism\b|\\rtSceneSep\b/i.test(source);
    const hasDropCapSignals = /\\lettrine\b|\\dropcap\b/i.test(source);
    const screenplaySignals = [
        /\bint\.\b/i,
        /\bext\.\b/i,
        /\bscene heading\b/i,
        /\bslugline\b/i,
        /\bdialogue\b/i,
        /\bcharacter\b/i,
    ].filter((pattern) => pattern.test(source)).length;

    const hasBookLikeClass = hasBookClass || hasMemoirClass || hasKomaClass;
    const hasRunningHeaders = hasFancyhdr || hasHeaderFooterCommands;
    const hasStructuralCommands = hasChapter || hasPart || hasSection;
    const hasLiterarySignals = hasTitlesec
        || (hasFontspec && hasRunningHeaders)
        || hasMicrotype
        || hasDropCapSignals;

    const traits: string[] = [];
    const addTrait = (trait: string, confidenceBoost = 0) => {
        if (!traits.includes(trait)) traits.push(trait);
        confidenceScore += confidenceBoost;
    };
    let usageContext: DetectedTemplateUsageContext = 'unknown';
    let styleHint: DetectedTemplateStyleHint = 'custom';
    let mockPreviewKind: DetectedTemplateMockPreviewKind = 'generic';
    let confidenceScore = 0;

    if (screenplaySignals >= 2) {
        usageContext = 'screenplay';
        addTrait('Scene headings detected');
        addTrait('Dialogue-first formatting');
        confidenceScore += screenplaySignals >= 3 ? 3 : 2;
    } else if (hasBookLikeClass || hasStructuralCommands) {
        usageContext = 'novel';
        confidenceScore += 1;
    }

    if (hasChapter) {
        styleHint = 'chaptered';
        mockPreviewKind = 'chaptered';
        addTrait('Chapter-based structure', 2);
        if (hasPart) {
            addTrait('Part breaks detected', 1);
        }
    } else if (hasBookLikeClass && hasRunningHeaders) {
        styleHint = 'book';
        mockPreviewKind = 'book';
        addTrait('Running headers detected', 2);
    } else if (hasLiterarySignals) {
        styleHint = 'literary';
        mockPreviewKind = 'literary';
        addTrait('Refined heading styles', 2);
    } else if ((hasArticleClass || !hasBookClass) && hasGeometry && hasSetspace && !hasChapter && !hasFancyhdr) {
        styleHint = 'manuscript';
        mockPreviewKind = 'manuscript';
        addTrait('Minimal manuscript formatting', 2);
    }

    if (hasBookLikeClass) {
        addTrait('Book-style page structure', 1);
    }
    if (hasRunningHeaders) {
        addTrait('Running headers detected');
    }
    if (hasFontspec) {
        addTrait('OpenType fonts configured', 1);
    }
    if (hasMicrotype) {
        addTrait('Fine typography adjustments');
    }
    if (hasGeometry && styleHint === 'manuscript') {
        addTrait('Wide page spacing');
    } else if (hasGeometry) {
        addTrait('Custom margins detected');
    }
    if (hasSetspace) {
        addTrait('Adjusted line spacing');
    }
    if (hasTwosideLayout) {
        addTrait('Two-sided print layout');
    }
    if (hasParskip) {
        addTrait('Paragraph spacing tuned');
    }
    if (hasTitlePageSignals) {
        addTrait('Front-page metadata detected', 1);
    }
    if (hasTocSignals) {
        addTrait('Contents page support');
    }
    if (hasSceneBreakSignals) {
        addTrait('Scene break styling');
    }
    if (hasSection && !hasChapter) {
        addTrait('Section-based structure');
    }
    if (hasDropCapSignals) {
        addTrait('Decorative opening styling');
    }

    if (styleHint === 'custom' && traits.length === 0) {
        if (hasBodyHook) {
            addTrait('Pandoc manuscript body hook');
        }
        addTrait('Custom LaTeX styling');
    } else if (styleHint === 'custom') {
        addTrait('Custom LaTeX styling');
    }

    if (usageContext === 'screenplay' && styleHint === 'custom') {
        mockPreviewKind = 'generic';
    } else if (usageContext === 'screenplay' && mockPreviewKind === 'generic') {
        mockPreviewKind = 'manuscript';
    }

    const dedupedTraits = [...new Set(traits)].slice(0, 5);
    const confidence: DetectedTemplateConfidence =
        confidenceScore >= 4 ? 'high' : confidenceScore >= 2 ? 'medium' : 'low';

    return {
        usageContext,
        styleHint,
        traits: dedupedTraits,
        confidence,
        mockPreviewKind,
    };
}
