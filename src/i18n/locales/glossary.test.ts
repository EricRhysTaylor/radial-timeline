import { describe, expect, it } from 'vitest';
import { en } from './en';
import { de } from './de';
import { ja } from './ja';
import { ko } from './ko';
import { zh } from './zh';
import { es } from './es';
import { fr } from './fr';
import { th } from './th';
import { vi } from './vi';

/*
 * Core-term glossary.
 *
 * The locale files are machine translated, and a model picks whichever sense
 * of an English word it guesses. Regenerated translations have rendered a
 * story's "plot" as a plot of land, an "act" as an action or an Act of
 * Parliament, and a "ring" as jewelry or a ringtone. Wherever an English
 * string uses a core term, its translation must use one of the accepted words
 * for that term. Several words are listed only where each is a genuine
 * rendering; the first is preferred. A pattern stands in for a word that also
 * occurs inside unrelated words.
 *
 * A locale missing from a term is not yet consistent for it — the comment by
 * the term says what is wrong. Add the locale once its strings are fixed.
 */

type Locale = 'de' | 'ja' | 'ko' | 'zh' | 'es' | 'fr' | 'th' | 'vi';
type Tree = { [key: string]: unknown };

interface Term {
    /** Matches the term in an English string (placeholders removed first). */
    en: RegExp;
    words: Partial<Record<Locale, Array<string | RegExp>>>;
    /**
     * Keys whose English names a YAML field or an author's own folder or
     * column, so the translation may keep that name verbatim instead.
     */
    fieldNames?: Record<string, string>;
    /** Keys whose English uses the word in another sense ("act as"). */
    otherSense?: string[];
}

const SUBPLOT_FIELD = {
    'ui.addSceneConfirmModal.subplotLabel': 'Subplot',
    'ui.manageSubplotsModal.mainPlotRenameNote': 'Subplot',
    'ui.manageSubplotsModal.renameScenesNote': 'Subplot',
    'ui.subplotManagementService.renameFailed': 'Subplot',
};

const BEAT_FIELD = {
    'settings.runtime.parenthetical.beat.name': '(beat)',
    'sceneAnalysis.runtimeModal.settings.timingBeat': '(beat)',
    'ui.beatPropertiesSection.missingModelPart': 'Beat Model',
    'ui.beatPropertiesSection.setModelOnNotes': 'Beat Model',
    'ui.beatPropertiesSection.repairedNotice': 'Beat Model',
    'ui.promoteToScene.skippedOtherClass': 'Beat',
};

const ACT_FIELD = {
    'settings.beats.beatNotes.repairTooltip': 'Act',
    'ui.beatPropertiesSection.allHaveFilesRepairAct': 'Act',
    'ui.beatPropertiesSection.repairTooltipBoth': 'Act',
    'ui.beatPropertiesSection.repairTooltipMisalignedOne': 'Act',
    'ui.beatPropertiesSection.repairTooltipMisalignedOther': 'Act',
    'ui.beatPropertiesSection.repairTooltipMissingModelOne': 'Act',
    'ui.beatPropertiesSection.repairTooltipMissingModelOther': 'Act',
    'ui.beatPropertiesSection.repairedNotice': 'Act',
    'ui.createRtNoteModal.beatDesc': 'Act',
    'ui.onboardingScrivenerReview.actsFromColumn': 'Act',
    'ui.onboardingScrivenerReview.actsFromFolders': 'ACT',
};

const GLOSSARY: Record<string, Term> = {
    mainPlot: {
        en: /\bmain plot\b/i,
        words: {
            de: ['Haupthandlung'],
            ja: ['メインプロット'],
            ko: ['메인 플롯'],
            zh: ['主情节'],
            es: ['trama principal'],
            fr: ['intrigue principale'],
            th: ['พล็อตหลัก'],
            vi: ['cốt truyện chính'],
        },
    },
    subplot: {
        en: /\bsub-?plots?\b/i,
        words: {
            de: ['Nebenhandlung'],
            ja: ['サブプロット'],
            ko: ['서브플롯'],
            zh: ['副情节', '副线', '支线'],
            es: ['subtrama', 'trama secundaria', 'tramas secundarias'],
            fr: ['sous-intrigue', 'intrigue secondaire', 'intrigues secondaires'],
            th: ['พล็อตย่อย'],
            vi: ['cốt truyện phụ'],
        },
        fieldNames: SUBPLOT_FIELD,
    },
    act: {
        en: /\bacts?\b/i,
        words: {
            de: ['Akt'],
            ja: ['幕'],
            ko: ['막'],
            zh: ['幕'],
            es: ['acto'],
            fr: ['acte'],
            th: ['องก์'],
            vi: ['hồi'],
        },
        fieldNames: ACT_FIELD,
        otherSense: ['ui.refactorAlerts.pendingEditsTypeDescription'],
    },
    ring: {
        en: /\brings?\b/i,
        words: {
            de: ['Ring'],
            ja: ['リング'],
            ko: ['링'],
            zh: ['环'],
            es: ['anillo'],
            fr: ['anneau'],
            th: ['วงแหวน'],
            vi: ['vòng'],
        },
    },
    // A story beat. Spanish, French and Thai use the loanword because their
    // native words (ritmo, rythme, จังหวะ) already mean pacing; Vietnamese
    // also keeps "beat" in places, matching Class: Beat.
    beat: {
        en: /\bbeats?\b/i,
        words: {
            de: ['Beat'],
            ja: ['ビート'],
            ko: ['비트'],
            zh: ['节拍'],
            es: ['beat'],
            fr: ['beat'],
            th: ['บีท'],
            vi: ['nhịp', 'beat'],
        },
        fieldNames: BEAT_FIELD,
        // "Reflective beat" describes the (a moment) pause, not a story beat.
        otherSense: ['settings.runtime.parenthetical.moment.desc'],
    },
    // The word Obsidian's own interface uses in each language.
    vault: {
        en: /\bvaults?\b/i,
        words: {
            de: ['Vault'],
            es: ['bóveda'],
            fr: ['coffre'],
            th: ['ห้องนิรภัย'],
            vi: [/(?<!\p{L})kho(?!\p{L})/iu],
        },
    },
    apiKey: {
        en: /\bAPI keys?\b/i,
        words: {
            de: ['API-Schlüssel'],
            ja: ['API キー', 'APIキー'],
            ko: ['API 키'],
            zh: ['API 密钥'],
            es: ['clave de API', 'claves de API', 'clave API', 'claves API'],
            fr: ['clé API', 'clés API'],
            th: ['คีย์ API'],
            vi: ['khóa API'],
        },
    },
};

/**
 * Screenplay parentheticals the runtime estimator matches in the author's own
 * text (runtimeEstimator.ts). A translated label would name a directive the
 * plugin never detects, so these stay exactly as in English.
 */
const VERBATIM = [
    'settings.runtime.parenthetical.beat.name',
    'settings.runtime.parenthetical.pause.name',
    'settings.runtime.parenthetical.longPause.name',
    'settings.runtime.parenthetical.moment.name',
    'settings.runtime.parenthetical.silence.name',
    'sceneAnalysis.runtimeModal.settings.timingBeat',
    'sceneAnalysis.runtimeModal.settings.timingPause',
    'sceneAnalysis.runtimeModal.settings.timingLongPause',
    'sceneAnalysis.runtimeModal.settings.timingMoment',
    'sceneAnalysis.runtimeModal.settings.timingSilence',
];

/** YAML the author is told to type, quoted in English ("Class: Beat"). */
const QUOTED_YAML = /"((?:Class|Beat Model|Subplot|Act|When|Pulse Update): [^"]*)"/g;

/** Wrong senses already removed from a locale; any return is a regression. */
const BANNED: Partial<Record<Locale, RegExp[]>> = {
    fr: [
        /terrain principal/i, /tracé principal/i, /bague/i, /sonnerie/i, /sous-(parcelle|plaque|plancher|plot)/i,
        /battement/i, /\bbatt(re|ez|er)\b/i, /coffre-fort/i, /touche API/i,
    ],
    es: [/parcela/i, /subtrabajo/i, /latido/i, /\bbat(ir|ido|idos|ite)\b/i, /tecla API/i],
    th: [
        /พระราชบัญญัติ/, /แปลงหลัก/, /แผนย่อย/, /ซับพล็อต/, /กรรมาธิการ/, /(?<!วง)แหวน/,
        /เต้น/, /เอาชนะ/, /เพชฌฆาต/, /คว่ำบาตร/, /บีต/, /วอลต์/, /กุญแจ API/,
    ],
    vi: [
        /nhẫn/i, /(?<!\p{L})(ô|lô) phụ/iu, /mảnh ghép/i, /biểu đồ phụ/i, /sublot/i, /vòng đệm/i, /phím chuông/i,
        /ghi chú đánh bại/i, /đánh đập/i, /nhịp đập/i, /nốt (nhạc|nhịp)/i, /mô hình (beat|nhịp)/i,
        /kho tiền/i, /(?<!\p{L})hầm(?!\p{L})/iu, /phím API|API phím/i,
    ],
};

function flatten(node: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
    for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out[path] = value;
        else if (value && typeof value === 'object') flatten(value as Tree, path, out);
    }
    return out;
}

const withoutPlaceholders = (value: string): string => value.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');

/**
 * The field name as a word of its own: "Act" in "Act y Beat Model", not in
 * "Actualice". Only Latin letters count as joined, because Korean attaches
 * particles directly to the name ("Act와").
 */
const namesField = (value: string, name: string): boolean =>
    new RegExp(`(?<![A-Za-z\u00C0-\u024F])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z\u00C0-\u024F])`).test(value);

const english = flatten(en as unknown as Tree);
const locales: Record<Locale, Record<string, string>> = {
    de: flatten(de as unknown as Tree),
    ja: flatten(ja as unknown as Tree),
    ko: flatten(ko as unknown as Tree),
    zh: flatten(zh as unknown as Tree),
    es: flatten(es as unknown as Tree),
    fr: flatten(fr as unknown as Tree),
    th: flatten(th as unknown as Tree),
    vi: flatten(vi as unknown as Tree),
};

const cases = Object.entries(GLOSSARY).flatMap(([term, spec]) =>
    (Object.entries(spec.words) as Array<[Locale, Array<string | RegExp>]>).map(([locale, words]) => ({ term, spec, locale, words })));

describe('core-term glossary', () => {
    it.each(cases)('$locale translates "$term" with $words', ({ spec, locale, words }) => {
        const wrong = Object.keys(english).filter(key => {
            if (!spec.en.test(withoutPlaceholders(english[key]))) return false;
            if (spec.otherSense?.includes(key)) return false;
            const translated = locales[locale][key];
            if (translated === undefined) return false;
            const fieldName = spec.fieldNames?.[key];
            if (fieldName && namesField(translated, fieldName)) return false;
            const lower = translated.toLowerCase();
            return !words.some(word => typeof word === 'string' ? lower.includes(word.toLowerCase()) : word.test(translated));
        });
        expect(wrong.map(key => `${key}: ${locales[locale][key]}`)).toEqual([]);
    });

    it.each(Object.keys(locales) as Locale[])('%s keeps screenplay parentheticals and quoted YAML verbatim', locale => {
        const translated = locales[locale];
        const changed = Object.keys(english).filter(key => {
            if (translated[key] === undefined) return false;
            if (VERBATIM.includes(key)) return translated[key] !== english[key];
            return [...english[key].matchAll(QUOTED_YAML)].some(([, yaml]) => !translated[key].includes(yaml));
        });
        expect(changed.map(key => `${key}: ${translated[key]}`)).toEqual([]);
    });

    it.each(Object.entries(BANNED) as Array<[Locale, RegExp[]]>)('%s keeps out wrong senses already fixed', (locale, patterns) => {
        const found = Object.entries(locales[locale])
            .filter(([, value]) => patterns.some(pattern => pattern.test(value)))
            .map(([key, value]) => `${key}: ${value}`);
        expect(found).toEqual([]);
    });
});
