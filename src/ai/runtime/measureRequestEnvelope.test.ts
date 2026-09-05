import { describe, it, expect } from 'vitest';
import { measureRequestEnvelopeChars, buildRequestEnvelope } from './aiClient';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import type { AIRunRequest } from '../types';

/**
 * Review round 3 noted this had no direct test while carrying the forecast's
 * per-call overhead. These assert the properties the forecast depends on.
 */
const plugin = {
    settings: { aiSettings: buildDefaultAiSettings() },
    getActiveBookTitle: () => 'The Odyssey'
} as never;

const req = (instructions: string): AIRunRequest => ({
    feature: 'Onboarding',
    task: 'OnboardingScene',
    featureModeInstructions: instructions,
    returnType: 'json'
} as AIRunRequest);

describe('measureRequestEnvelopeChars', () => {
    it('counts more than the instruction block alone', () => {
        const instructions = 'x'.repeat(500);
        const measured = measureRequestEnvelopeChars(plugin, req(instructions));
        // Role template, project context, output rules and headings all ride
        // along. Counting only instructions is the defect this exists to stop.
        expect(measured).toBeGreaterThan(instructions.length);
    });

    it('grows with the instruction block', () => {
        const small = measureRequestEnvelopeChars(plugin, req('x'.repeat(100)));
        const large = measureRequestEnvelopeChars(plugin, req('x'.repeat(2_000)));
        expect(large - small).toBeGreaterThanOrEqual(1_900);
    });

    it('is non-zero even with empty instructions — the envelope is never free', () => {
        expect(measureRequestEnvelopeChars(plugin, req(''))).toBeGreaterThan(0);
    });

    it('emits no cache-break delimiter for a request with no user question', () => {
        // composeEnvelope only inserts one when a question is placed last.
        // Revision 3 wrongly listed it as counted overhead.
        const envelope = buildRequestEnvelope(plugin, buildDefaultAiSettings(), req('abc'), {
            featureModeInstructions: 'abc',
            userInput: '',
            placeUserQuestionLast: false
        });
        expect(envelope.finalPrompt).not.toContain('<<<CACHE_BREAK>>>');
    });

    it('measures fixed overhead only — payload is excluded by construction', () => {
        const withPayload = buildRequestEnvelope(plugin, buildDefaultAiSettings(), req('abc'), {
            featureModeInstructions: 'abc',
            userInput: 'y'.repeat(5_000),
            placeUserQuestionLast: false
        });
        const measured = measureRequestEnvelopeChars(plugin, req('abc'));
        expect(withPayload.finalPrompt.length).toBeGreaterThan(measured + 4_000);
    });
});
