import type { InquiryZone } from './state';
import {
    ALL_CANONICAL_QUESTIONS,
    CORE_CANONICAL_QUESTIONS,
    getCanonicalQuestionById,
    groupCanonicalQuestionsByZone,
    type InquiryCanonicalQuestionDefinition
} from './questions/canonicalQuestions';
import type {
    InquiryCanonicalPromptState,
    InquiryPromptConfig,
    InquiryPromptSlot
} from '../types/settings';

export type InquiryCanonicalLoadout = 'core' | 'full-signature';
export type InquiryPromptSlotState = 'empty' | 'canonical-loaded' | 'customized';

const ZONE_DESCRIPTIONS: Record<InquiryZone, string> = {
    setup: [
        'Foundations the story depends on.',
        'Questions here examine what must already exist or be understood for the material to work:',
        'context, relationships, rules, and narrative assumptions.',
        'Use this zone to find missing groundwork, unrealized threads, or weak setup that later material relies on.'
    ].join(' '),
    pressure: [
        'Where momentum and tension are changing.',
        'Questions here focus on movement: escalation, pacing, conflict, and cause-and-effect across the material.',
        'Use this zone to identify where the story accelerates, stalls, repeats itself, or dissipates tension.'
    ].join(' '),
    payoff: [
        'What resolves - and what does not.',
        'Questions here evaluate promises made by the material and how they are handled.',
        'Use this zone to locate payoffs, deferrals, dangling threads, abandoned ideas,',
        'and whether consequences feel earned or incomplete.'
    ].join(' ')
};

const getCanonicalQuestionsForLoadout = (
    loadout: InquiryCanonicalLoadout
): readonly InquiryCanonicalQuestionDefinition[] => (loadout === 'core'
    ? CORE_CANONICAL_QUESTIONS
    : ALL_CANONICAL_QUESTIONS);

const getStarterCanonicalQuestions = (): Record<InquiryZone, InquiryCanonicalQuestionDefinition> => {
    const grouped = groupCanonicalQuestionsByZone(CORE_CANONICAL_QUESTIONS);
    return {
        setup: grouped.setup[0],
        pressure: grouped.pressure[0],
        payoff: grouped.payoff[0]
    };
};

const buildCanonicalPromptState = (
    slot: Pick<InquiryPromptSlot, 'label' | 'question'>,
    canonical: InquiryCanonicalQuestionDefinition
): InquiryCanonicalPromptState => {
    const label = (slot.label ?? '').trim();
    const question = (slot.question ?? '').trim();
    const canonicalLabel = canonical.label.trim();
    const canonicalQuestion = canonical.standardPrompt.trim();
    return label === canonicalLabel && question === canonicalQuestion
        ? 'loaded'
        : 'customized';
};

const buildCanonicalSlot = (
    canonical: InquiryCanonicalQuestionDefinition,
    overrides: Partial<InquiryPromptSlot> = {}
): InquiryPromptSlot => {
    const label = overrides.label ?? canonical.label;
    const question = overrides.question ?? canonical.standardPrompt;
    return {
        id: canonical.id,
        label,
        question,
        enabled: overrides.enabled ?? canonical.enabledByDefault ?? true,
        builtIn: true,
        requiresContext: overrides.requiresContext ?? false,
        canonical: {
            id: canonical.id,
            version: canonical.version,
            tier: canonical.tier,
            zone: canonical.zone,
            state: buildCanonicalPromptState({ label, question }, canonical)
        }
    };
};

const buildDetachedCustomSlot = (
    slot: InquiryPromptSlot,
    canonical: InquiryCanonicalQuestionDefinition
): InquiryPromptSlot => {
    const label = slot.label ?? '';
    const question = slot.question ?? '';
    const nextId = slot.id && slot.id !== canonical.id
        ? slot.id
        : `custom-${canonical.zone}-${canonical.id}-converted`;
    return {
        id: nextId,
        label,
        question,
        enabled: !!slot.enabled || question.trim().length > 0,
        builtIn: false,
        requiresContext: slot.requiresContext,
        canonical: undefined
    };
};

export const createCanonicalPromptSlotById = (
    canonicalId: string,
    overrides: Partial<InquiryPromptSlot> = {}
): InquiryPromptSlot | null => {
    const canonical = getCanonicalQuestionById(canonicalId);
    return canonical ? buildCanonicalSlot(canonical, overrides) : null;
};

const buildCustomSlot = (
    slot: InquiryPromptSlot,
    zone: InquiryZone,
    index: number,
    usedIds: Set<string>
): InquiryPromptSlot | null => {
    const label = slot.label ?? '';
    const question = slot.question ?? '';
    const hasContent = label.trim().length > 0 || question.trim().length > 0;
    const rawEnabled = slot.enabled ?? false;
    if (!hasContent && !rawEnabled) return null;

    let id = slot.id;
    if (!id || usedIds.has(id)) {
        const baseId = `custom-${zone}-${index + 1}`;
        let candidate = baseId;
        let suffix = 1;
        while (usedIds.has(candidate)) {
            candidate = `${baseId}-${suffix++}`;
        }
        id = candidate;
    }

    usedIds.add(id);
    return {
        id,
        label,
        question,
        enabled: rawEnabled || question.trim().length > 0,
        builtIn: false,
        requiresContext: slot.requiresContext,
        canonical: undefined
    };
};

export const buildInquiryPromptConfigFromLoadout = (
    loadout: InquiryCanonicalLoadout = 'core'
): InquiryPromptConfig => {
    const grouped = groupCanonicalQuestionsByZone(getCanonicalQuestionsForLoadout(loadout));
    return {
        setup: grouped.setup.map(question => buildCanonicalSlot(question)),
        pressure: grouped.pressure.map(question => buildCanonicalSlot(question)),
        payoff: grouped.payoff.map(question => buildCanonicalSlot(question))
    };
};

export const buildDefaultInquiryPromptConfig = (): InquiryPromptConfig => {
    const starter = getStarterCanonicalQuestions();
    return {
        setup: [buildCanonicalSlot(starter.setup)],
        pressure: [buildCanonicalSlot(starter.pressure)],
        payoff: [buildCanonicalSlot(starter.payoff)]
    };
};

export const getCanonicalQuestionForSlot = (
    slot?: Pick<InquiryPromptSlot, 'id' | 'builtIn' | 'canonical'>
): InquiryCanonicalQuestionDefinition | undefined =>
    getCanonicalQuestionById(slot?.canonical?.id ?? (slot?.builtIn ? slot.id : undefined));

export const isCanonicalPromptSlot = (slot?: InquiryPromptSlot): boolean =>
    !!getCanonicalQuestionForSlot(slot);

export const getInquiryPromptSlotState = (slot?: InquiryPromptSlot): InquiryPromptSlotState => {
    if (!slot) return 'empty';
    const label = slot.label?.trim() ?? '';
    const question = getPromptSlotQuestion(slot).trim();
    if (!label && !question) {
        return 'empty';
    }
    if (isCanonicalPromptSlot(slot) && slot.canonical?.state !== 'customized') {
        return 'canonical-loaded';
    }
    return 'customized';
};

export const syncCanonicalPromptSlot = (slot: InquiryPromptSlot): InquiryPromptSlot => {
    const canonical = getCanonicalQuestionForSlot(slot);
    if (!canonical) {
        return {
            ...slot,
            label: slot.label ?? '',
            question: slot.question ?? '',
            enabled: !!slot.enabled || (slot.question ?? '').trim().length > 0,
            builtIn: false,
            canonical: undefined
        };
    }

    const canonicalState = buildCanonicalPromptState({
        label: slot.label ?? '',
        question: slot.question ?? ''
    }, canonical);
    if (canonicalState === 'customized') {
        return buildDetachedCustomSlot(slot, canonical);
    }

    return buildCanonicalSlot(canonical, {
        ...slot,
        label: slot.label?.trim().length ? slot.label : canonical.label,
        question: slot.question?.trim().length ? slot.question : canonical.standardPrompt,
        enabled: true,
        builtIn: true
    });
};

export const getPromptSlotQuestion = (slot: InquiryPromptSlot): string => {
    const stored = slot.question ?? '';
    if (stored.trim().length > 0) {
        return stored;
    }
    return getCanonicalQuestionForSlot(slot)?.standardPrompt ?? stored;
};

export const replaceCanonicalPromptSlots = (
    _raw: InquiryPromptConfig | undefined,
    loadout: InquiryCanonicalLoadout
): InquiryPromptConfig => buildInquiryPromptConfigFromLoadout(loadout);

export const normalizeInquiryPromptConfig = (raw?: InquiryPromptConfig): InquiryPromptConfig => {
    const defaults = buildDefaultInquiryPromptConfig();

    const normalizeZone = (zone: InquiryZone): InquiryPromptSlot[] => {
        const incoming = raw?.[zone] ?? [];
        const slots: InquiryPromptSlot[] = [];
        const usedIds = new Set<string>();
        let hasCanonical = false;

        incoming.forEach((slot, index) => {
            if (!slot) return;
            if (isCanonicalPromptSlot(slot)) {
                const normalizedSlot = syncCanonicalPromptSlot(slot);
                if (usedIds.has(normalizedSlot.id)) return;
                usedIds.add(normalizedSlot.id);
                hasCanonical = true;
                slots.push(normalizedSlot);
                return;
            }

            if (slot.builtIn && slot.enabled === false) return;

            const customSlot = buildCustomSlot(slot, zone, index, usedIds);
            if (customSlot) {
                slots.push(customSlot);
            }
        });

        if (!hasCanonical) {
            defaults[zone].slice().reverse().forEach(slot => {
                if (usedIds.has(slot.id)) return;
                usedIds.add(slot.id);
                slots.unshift(slot);
            });
        }

        return slots;
    };

    return {
        setup: normalizeZone('setup'),
        pressure: normalizeZone('pressure'),
        payoff: normalizeZone('payoff')
    };
};

export const getInquiryZoneDescription = (zone: InquiryZone): string => ZONE_DESCRIPTIONS[zone];
