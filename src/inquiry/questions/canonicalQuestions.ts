import type { InquiryCanonicalQuestionTier } from '../../types/settings';
import type { InquiryZone } from '../state';

export interface InquiryCanonicalQuestionDefinition {
    id: string;
    version: number;
    tier: InquiryCanonicalQuestionTier;
    zone: InquiryZone;
    label: string;
    standardPrompt: string;
    focusedPrompt?: string;
    defaultOrder: number;
    enabledByDefault?: boolean;
}

const CANONICAL_QUESTION_ORDER: Record<InquiryZone, number> = {
    setup: 0,
    pressure: 1,
    payoff: 2
};

const sortCanonicalQuestions = (
    left: InquiryCanonicalQuestionDefinition,
    right: InquiryCanonicalQuestionDefinition
): number => {
    const zoneDelta = CANONICAL_QUESTION_ORDER[left.zone] - CANONICAL_QUESTION_ORDER[right.zone];
    if (zoneDelta !== 0) return zoneDelta;
    return left.defaultOrder - right.defaultOrder;
};

const buildQuestion = (
    question: InquiryCanonicalQuestionDefinition
): InquiryCanonicalQuestionDefinition => Object.freeze({ ...question });

export const CORE_CANONICAL_QUESTIONS: readonly InquiryCanonicalQuestionDefinition[] = Object.freeze([
    buildQuestion({
        id: 'setup-core',
        version: 1,
        tier: 'core',
        zone: 'setup',
        label: 'Setup',
        standardPrompt: 'What must already be true in the material for the story to move smoothly?',
        defaultOrder: 10,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'setup-missing-foundations',
        version: 1,
        tier: 'core',
        zone: 'setup',
        label: 'Missing Foundations',
        standardPrompt: 'What information, relationships, or context does the material assume but never establishes?',
        defaultOrder: 20,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'setup-foreshadowing-gaps',
        version: 1,
        tier: 'core',
        zone: 'setup',
        label: 'Foreshadowing Gaps',
        standardPrompt: 'Where does later material rely on setups that are weak, absent, or too subtle?',
        defaultOrder: 30,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'setup-character-readiness',
        version: 1,
        tier: 'core',
        zone: 'setup',
        label: 'Character Readiness',
        standardPrompt: 'Which characters need to be more developed earlier for the story to function?',
        defaultOrder: 40,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-core',
        version: 1,
        tier: 'core',
        zone: 'pressure',
        label: 'Pressure',
        standardPrompt: 'Where does the material shift momentum most right now?',
        defaultOrder: 10,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-underwritten-beats',
        version: 1,
        tier: 'core',
        zone: 'pressure',
        label: 'Underwritten Beats',
        standardPrompt: 'Where does the material move too quickly, skipping emotional or causal weight?',
        focusedPrompt: 'Across these Target Scenes, where do transitions or developments move too quickly, skipping necessary emotional or causal weight between scenes?',
        defaultOrder: 20,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-over-explanation',
        version: 1,
        tier: 'core',
        zone: 'pressure',
        label: 'Over-Explanation',
        standardPrompt: 'Which parts of the material explain or repeat more than necessary, reducing momentum?',
        defaultOrder: 30,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-false-plateaus',
        version: 1,
        tier: 'core',
        zone: 'pressure',
        label: 'False Plateaus',
        standardPrompt: 'Where does the story appear to pause without adding tension or consequence?',
        defaultOrder: 40,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-core',
        version: 1,
        tier: 'core',
        zone: 'payoff',
        label: 'Payoff',
        standardPrompt: 'Across the material, where are promises paid off, deferred, dangling, or abandoned?',
        defaultOrder: 10,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-abandoned-threads',
        version: 1,
        tier: 'core',
        zone: 'payoff',
        label: 'Abandoned Threads',
        standardPrompt: 'Which narrative threads appear introduced but never meaningfully resolved or transformed?',
        focusedPrompt: 'In these Target Scenes, which narrative threads appear introduced but are not continued, reinforced, or connected to the broader story?',
        defaultOrder: 20,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-consequences-audit',
        version: 1,
        tier: 'core',
        zone: 'payoff',
        label: 'Consequences Audit',
        standardPrompt: 'Which major actions lack lasting consequences within the material?',
        defaultOrder: 30,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-premature-resolution',
        version: 1,
        tier: 'core',
        zone: 'payoff',
        label: 'Premature Resolution',
        standardPrompt: 'Where are problems resolved too cleanly, reducing long-term impact?',
        defaultOrder: 40,
        enabledByDefault: true
    })
]);

export const SIGNATURE_CANONICAL_QUESTIONS: readonly InquiryCanonicalQuestionDefinition[] = Object.freeze([
    buildQuestion({
        id: 'setup-unrealized-thread',
        version: 1,
        tier: 'signature',
        zone: 'setup',
        label: 'Unrealized Thread',
        standardPrompt: 'Is there a potential plot thread implied by the material that has not been developed or activated?',
        defaultOrder: 50,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'setup-world-logic-preconditions',
        version: 1,
        tier: 'signature',
        zone: 'setup',
        label: 'World Logic Preconditions',
        standardPrompt: 'What rules or constraints of the world must be true for later events to make sense?',
        defaultOrder: 60,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'setup-reader-orientation-risk',
        version: 1,
        tier: 'signature',
        zone: 'setup',
        label: 'Reader Orientation Risk',
        standardPrompt: 'Where might first-time readers feel disoriented because the material assumes too much shared context or familiarity?',
        defaultOrder: 70,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'setup-load-bearing',
        version: 1,
        tier: 'signature',
        zone: 'setup',
        label: 'Setup Load-Bearing',
        standardPrompt: 'Which early material must carry more weight for later events to feel inevitable?',
        defaultOrder: 80,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'setup-structural-assumptions',
        version: 1,
        tier: 'signature',
        zone: 'setup',
        label: 'Structural Assumptions',
        standardPrompt: 'What narrative assumptions does the material make that may not hold for a first-time reader?',
        defaultOrder: 90,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-escalation-consistency',
        version: 1,
        tier: 'signature',
        zone: 'pressure',
        label: 'Escalation Consistency',
        standardPrompt: 'Does pressure escalate logically across the material, or reset in places?',
        focusedPrompt: 'Across these Target Scenes, does pressure escalate logically from one scene to the next, or does it reset, fragment, or compete across the sequence?',
        defaultOrder: 50,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-conflict-density',
        version: 1,
        tier: 'signature',
        zone: 'pressure',
        label: 'Conflict Density',
        standardPrompt: 'Which sections carry too many competing tensions, and which carry too few?',
        focusedPrompt: 'Within these Target Scenes, are there too many competing tensions or concepts being introduced at once, and which should be simplified or removed?',
        defaultOrder: 60,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-scene-function-drift',
        version: 1,
        tier: 'signature',
        zone: 'pressure',
        label: 'Scene Function Drift',
        standardPrompt: 'Where do scenes lose clarity about what pressure they are meant to apply?',
        focusedPrompt: 'Across these Target Scenes, where do scenes lose clarity about the pressure or purpose they are meant to apply, and how do they fail to function as a coherent sequence?',
        defaultOrder: 70,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-tension-leakage',
        version: 1,
        tier: 'signature',
        zone: 'pressure',
        label: 'Tension Leakage',
        standardPrompt: 'Where does tension dissipate unintentionally through explanation, reassurance, or delay instead of being sustained or redirected?',
        defaultOrder: 80,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'pressure-irreversible-moves',
        version: 1,
        tier: 'signature',
        zone: 'pressure',
        label: 'Irreversible Moves',
        standardPrompt: 'Where does the material fail to force characters into choices they cannot undo?',
        defaultOrder: 90,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-emotional-payoff-balance',
        version: 1,
        tier: 'signature',
        zone: 'payoff',
        label: 'Emotional Payoff Balance',
        standardPrompt: 'Which emotional arcs receive strong payoff, and which feel incomplete or muted?',
        defaultOrder: 50,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-thematic-closure',
        version: 1,
        tier: 'signature',
        zone: 'payoff',
        label: 'Thematic Closure',
        standardPrompt: 'Do the story’s themes reach meaningful resolution, or simply stop being discussed?',
        defaultOrder: 60,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-ending-load-bearing',
        version: 1,
        tier: 'signature',
        zone: 'payoff',
        label: 'Ending Load-Bearing',
        standardPrompt: 'Does the ending carry too much unresolved weight that earlier material should support?',
        defaultOrder: 80,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-narrative-debt',
        version: 1,
        tier: 'signature',
        zone: 'payoff',
        label: 'Narrative Debt',
        standardPrompt: 'Which promises accumulate across the material without proportional payoff, creating unresolved narrative debt?',
        focusedPrompt: 'Within these Target Scenes, what promises or subplot elements are introduced but not developed or integrated, creating local narrative debt?',
        defaultOrder: 90,
        enabledByDefault: true
    }),
    buildQuestion({
        id: 'payoff-inevitable-payoff-test',
        version: 1,
        tier: 'signature',
        zone: 'payoff',
        label: 'Inevitable Payoff Test',
        standardPrompt: 'Do major outcomes feel inevitable from prior material, or do they feel introduced?',
        defaultOrder: 100,
        enabledByDefault: true
    })
]);

export const ALL_CANONICAL_QUESTIONS: readonly InquiryCanonicalQuestionDefinition[] = Object.freeze(
    [...CORE_CANONICAL_QUESTIONS, ...SIGNATURE_CANONICAL_QUESTIONS].sort(sortCanonicalQuestions)
);

export const getCanonicalQuestionsByTier = (
    tier: InquiryCanonicalQuestionTier
): InquiryCanonicalQuestionDefinition[] =>
    ALL_CANONICAL_QUESTIONS.filter(question => question.tier === tier);

export const groupCanonicalQuestionsByZone = (
    questions: readonly InquiryCanonicalQuestionDefinition[] = ALL_CANONICAL_QUESTIONS
): Record<InquiryZone, InquiryCanonicalQuestionDefinition[]> => {
    const grouped: Record<InquiryZone, InquiryCanonicalQuestionDefinition[]> = {
        setup: [],
        pressure: [],
        payoff: []
    };

    questions
        .slice()
        .sort(sortCanonicalQuestions)
        .forEach(question => {
            grouped[question.zone].push(question);
        });

    return grouped;
};

export const getCanonicalQuestionsByTierAndZone = (
    tier: InquiryCanonicalQuestionTier,
    zone: InquiryZone
): InquiryCanonicalQuestionDefinition[] =>
    getCanonicalQuestionsByTier(tier).filter(question => question.zone === zone);

const CANONICAL_QUESTION_MAP = new Map(
    ALL_CANONICAL_QUESTIONS.map(question => [question.id, question] as const)
);

export const getCanonicalQuestionById = (
    id?: string
): InquiryCanonicalQuestionDefinition | undefined => (id ? CANONICAL_QUESTION_MAP.get(id) : undefined);
