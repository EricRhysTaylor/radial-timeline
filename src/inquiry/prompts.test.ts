import { describe, expect, it } from 'vitest';
import type { InquiryPromptConfig, InquiryPromptSlot } from '../types/settings';
import {
    buildDefaultInquiryPromptConfig,
    buildInquiryPromptConfigFromLoadout,
    getInquiryPromptSlotState,
    normalizeInquiryPromptConfig,
    replaceCanonicalPromptSlots,
    syncCanonicalPromptSlot
} from './prompts';

describe('Inquiry prompt helpers', () => {
    it('builds the default config from the starter canonical set', () => {
        const config = buildDefaultInquiryPromptConfig();
        expect(config.setup.map(slot => slot.id)).toEqual(['setup-core']);
        expect(config.pressure.map(slot => slot.id)).toEqual(['pressure-core']);
        expect(config.payoff.map(slot => slot.id)).toEqual(['payoff-core']);
    });

    it('builds the full core loadout with four canonical questions per zone', () => {
        const config = buildInquiryPromptConfigFromLoadout('core');
        expect(config.setup.map(slot => slot.id)).toEqual([
            'setup-core',
            'setup-missing-foundations',
            'setup-foreshadowing-gaps',
            'setup-character-readiness'
        ]);
        expect(config.pressure.map(slot => slot.id)).toEqual([
            'pressure-core',
            'pressure-underwritten-beats',
            'pressure-over-explanation',
            'pressure-false-plateaus'
        ]);
        expect(config.payoff.map(slot => slot.id)).toEqual([
            'payoff-core',
            'payoff-abandoned-threads',
            'payoff-consequences-audit',
            'payoff-premature-resolution'
        ]);
    });

    it('builds the full signature loadout with nine canonical questions per zone', () => {
        const config = buildInquiryPromptConfigFromLoadout('full-signature');
        expect(config.setup).toHaveLength(9);
        expect(config.pressure).toHaveLength(9);
        expect(config.payoff).toHaveLength(9);
        expect(config.payoff[8]?.canonical?.state).toBe('loaded');
    });

    it('replaces all slots with the selected canonical loadout', () => {
        const starting: InquiryPromptConfig = {
            setup: [
                ...buildDefaultInquiryPromptConfig().setup,
                {
                    id: 'custom-setup-1',
                    label: 'My setup',
                    question: 'What setup thread needs more emphasis?',
                    enabled: true,
                    builtIn: false
                }
            ],
            pressure: [
                ...buildDefaultInquiryPromptConfig().pressure,
                {
                    id: 'custom-pressure-1',
                    label: 'My pressure',
                    question: 'Where does urgency flatten out?',
                    enabled: true,
                    builtIn: false
                }
            ],
            payoff: buildDefaultInquiryPromptConfig().payoff
        };

        const next = replaceCanonicalPromptSlots(starting, 'full-signature');

        expect(next.setup.map(slot => slot.id)).toEqual([
            'setup-core',
            'setup-missing-foundations',
            'setup-foreshadowing-gaps',
            'setup-character-readiness',
            'setup-unrealized-thread',
            'setup-world-logic-preconditions',
            'setup-reader-orientation-risk',
            'setup-load-bearing',
            'setup-structural-assumptions'
        ]);
        expect(next.pressure.map(slot => slot.id)).toEqual([
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
        expect(next.setup).toHaveLength(9);
        expect(next.pressure).toHaveLength(9);
        expect(next.payoff).toHaveLength(9);
    });

    it('marks edited canonical slots as customized', () => {
        const original = buildInquiryPromptConfigFromLoadout('core').setup[0] as InquiryPromptSlot;
        const edited = syncCanonicalPromptSlot({
            ...original,
            question: `${original.question} Revised.`
        });

        expect(edited.id).toBe('custom-setup-setup-core-converted');
        expect(edited.builtIn).toBe(false);
        expect(edited.canonical).toBeUndefined();
    });

    it('classifies slot state as empty, canonical-loaded, or customized', () => {
        const canonicalSlot = buildDefaultInquiryPromptConfig().setup[0] as InquiryPromptSlot;
        const customizedCanonical = syncCanonicalPromptSlot({
            ...canonicalSlot,
            question: `${canonicalSlot.question} Revised.`
        });

        expect(getInquiryPromptSlotState({
            id: 'empty-slot',
            label: '',
            question: '',
            enabled: false,
            builtIn: false
        })).toBe('empty');
        expect(getInquiryPromptSlotState(canonicalSlot)).toBe('canonical-loaded');
        expect(getInquiryPromptSlotState(customizedCanonical)).toBe('customized');
        expect(getInquiryPromptSlotState({
            id: 'custom-slot',
            label: 'Custom',
            question: 'Where does the scene lose clarity?',
            enabled: true,
            builtIn: false
        })).toBe('customized');
    });

    it('ignores legacy flow/depth prompt shapes and keeps canonical zones only', () => {
        const normalized = normalizeInquiryPromptConfig({
            flow: {
                setup: [{
                    id: 'legacy-flow-setup',
                    label: 'Legacy flow',
                    question: 'Legacy flow prompt',
                    enabled: true,
                    builtIn: false
                }]
            }
        } as any);

        expect(normalized.setup.map(slot => slot.id)).toEqual(['setup-core']);
        expect(normalized.setup.some(slot => slot.id === 'legacy-flow-setup')).toBe(false);
        expect(normalized.pressure.map(slot => slot.id)).toEqual(['pressure-core']);
        expect(normalized.payoff.map(slot => slot.id)).toEqual(['payoff-core']);
    });
});
