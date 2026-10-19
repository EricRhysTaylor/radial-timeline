import { describe, expect, it } from 'vitest';
import { buildSynopsisRunRequest, parseSynopsisReply, parseSummaryReply } from './summaryRefresh';
import { buildSynopsisPrompt, getSynopsisJsonSchema } from '../ai/prompts/synopsis';
import { getOnboardingSceneInstructions, getOnboardingSceneJsonSchema, ONBOARDING_CANONICAL_PROMPT } from '../ai/prompts/onboarding';
import { deterministicExtraction, parseSceneExtraction } from '../onboarding/extraction';
import { SYNOPSIS_CONTENT_RULE } from '../utils/synopsisContent';
import type { SceneData } from './types';

describe('AI-generated Synopsis scheduling boundary', () => {
    it.each([
        'Friday. Shail repairs Char.',
        'Shail repairs Char on tuesday.',
        'Fri. Shail repairs Char.',
        'March 31, 2085. Shail repairs Char.',
        '31st of March. Shail repairs Char.',
        'April 1st. Shail repairs Char.',
        'Shail repairs Char on 2085-03-31.',
        'Shail repairs Char on 03/31/2085.',
        'Shail repairs Char on 31-03-2085.',
        'In 2085, Shail repairs Char.',
        '2085. Shail repairs Char.',
        'Shail repairs Char in 1184 BCE.',
        'Shail repairs Char at 7PM.',
        'Shail repairs Char at 7 p.m.',
        'Shail repairs Char at seven pm.',
        'Shail repairs Char at 19:40.',
        'Shail repairs Char at 7:40 AM.',
        'Shail repairs Char at seven o’clock.',
        'Shail repairs Char at seven in the evening.',
        'Shail repairs Char at noon.',
        'Shail repairs Char at midnight.',
    ])('rejects scheduling in refreshes and AI onboarding: %s', synopsis => {
        const refresh = parseSynopsisReply(JSON.stringify({ synopsis }), 30);
        expect(refresh.ok).toBe(false);
        if (!refresh.ok) expect(refresh.problem).toContain('YAML scheduling fields');
        const onboarding = parseSceneExtraction(JSON.stringify({ synopsis }));
        expect(onboarding.ok).toBe(false);
        if (!onboarding.ok) expect(onboarding.error).toContain('YAML scheduling fields');
    });

    it('rejects scheduling before truncation can conceal the invalid answer', () => {
        expect(parseSynopsisReply(JSON.stringify({ synopsis: 'Shail saves Char on Friday.' }), 3).ok).toBe(false);
    });

    it.each([
        'May confronts the intruder and rescues Char.',
        'Shail watches the sun fail and abandons the race.',
        'Shail climbs 2085 feet and finds shelter.',
        'After repairing Char, Trisan faces the consequences.',
        'Shail races to save Char before the deadline.',
    ])('keeps plot details and non-calendar numbers: %s', synopsis => {
        expect(parseSynopsisReply(JSON.stringify({ synopsis }), 30)).toEqual({ ok: true, text: synopsis });
        const result = parseSceneExtraction(JSON.stringify({ synopsis, when: '2085-03-31', duration: '75 minutes' }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.synopsis).toBe(synopsis);
            expect(result.value.when).toBe('2085-03-31');
            expect(result.value.duration).toBe('75 minutes');
        }
    });

    it('leaves extended summaries and author-imported synopses unchanged', () => {
        const text = 'Friday at 7PM, Shail repairs Char.';
        expect(parseSummaryReply(JSON.stringify({ summary: text }))).toEqual({ ok: true, text });
        expect(deterministicExtraction({ knownSynopsis: text, knownMetadata: {} }).synopsis).toBe(text);
    });

    it('instructs refresh requests and onboarding to exclude scheduling even when present in the source', () => {
        const source = 'Friday at 7PM, Shail repairs Char.';
        const prompt = buildSynopsisPrompt(source, '2', 30);
        expect(prompt).toContain(source);
        expect(prompt).toContain(SYNOPSIS_CONTENT_RULE);
        expect(getOnboardingSceneInstructions()).toContain(SYNOPSIS_CONTENT_RULE);
        expect(ONBOARDING_CANONICAL_PROMPT).toContain(SYNOPSIS_CONTENT_RULE);
        expect(getSynopsisJsonSchema().properties.synopsis.description).toContain(SYNOPSIS_CONTENT_RULE);
        const properties = getOnboardingSceneJsonSchema().properties as Record<string, { description: string }>;
        expect(properties.synopsis.description).toContain(SYNOPSIS_CONTENT_RULE);
        expect(buildSynopsisRunRequest({ sceneNumber: 2 } as SceneData, source, 30).userInput).toContain(SYNOPSIS_CONTENT_RULE);
    });
});
