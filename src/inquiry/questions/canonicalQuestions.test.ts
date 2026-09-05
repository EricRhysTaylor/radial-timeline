import { describe, expect, it } from 'vitest';
import {
    ALL_CANONICAL_QUESTIONS,
    CORE_CANONICAL_QUESTIONS,
    SIGNATURE_CANONICAL_QUESTIONS,
    getCanonicalQuestionsByTierAndZone,
    groupCanonicalQuestionsByZone
} from './canonicalQuestions';

describe('canonical Inquiry questions', () => {
    it('exports the curated core, signature, and combined libraries', () => {
        expect(CORE_CANONICAL_QUESTIONS).toHaveLength(12);
        expect(SIGNATURE_CANONICAL_QUESTIONS).toHaveLength(15);
        expect(ALL_CANONICAL_QUESTIONS).toHaveLength(27);
    });

    it('groups the combined library into nine questions per zone', () => {
        const grouped = groupCanonicalQuestionsByZone();
        expect(grouped.setup.map(question => question.id)).toEqual([
            'setup-core',
            'setup-missing-foundations',
            'setup-foreshadowing-gaps',
            'setup-character-readiness',
            'setup-unrealized-thread',
            'setup-world-logic-preconditions',
            'setup-reader-orientation-risk',
            'setup-load-bearing',
            'setup-structural-assumptions',
        ]);
        expect(grouped.pressure.map(question => question.id)).toEqual([
            'pressure-core',
            'pressure-underwritten-beats',
            'pressure-over-explanation',
            'pressure-false-plateaus',
            'pressure-escalation-consistency',
            'pressure-conflict-density',
            'pressure-scene-function-drift',
            'pressure-tension-leakage',
            'pressure-irreversible-moves'
        ]);
        expect(grouped.payoff.map(question => question.id)).toEqual([
            'payoff-core',
            'payoff-abandoned-threads',
            'payoff-consequences-audit',
            'payoff-premature-resolution',
            'payoff-emotional-payoff-balance',
            'payoff-thematic-closure',
            'payoff-ending-load-bearing',
            'payoff-narrative-debt',
            'payoff-inevitable-payoff-test'
        ]);
    });

    it('filters by tier and zone without losing registry order', () => {
        expect(getCanonicalQuestionsByTierAndZone('signature', 'pressure').map(question => question.id)).toEqual([
            'pressure-escalation-consistency',
            'pressure-conflict-density',
            'pressure-scene-function-drift',
            'pressure-tension-leakage',
            'pressure-irreversible-moves'
        ]);
    });

    it('defines focused variants only for the focused execution subset', () => {
        expect(ALL_CANONICAL_QUESTIONS.filter(question => question.focusedPrompt).map(question => question.id)).toEqual([
            'pressure-underwritten-beats',
            'pressure-escalation-consistency',
            'pressure-conflict-density',
            'pressure-scene-function-drift',
            'payoff-abandoned-threads',
            'payoff-narrative-debt'
        ]);
    });
});
