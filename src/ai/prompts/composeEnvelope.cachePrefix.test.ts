import { describe, expect, it } from 'vitest';
import { composeEnvelope, CACHE_BREAK_DELIMITER } from './composeEnvelope';

/**
 * Audit 3 — OpenAI cache-miss root cause.
 *
 * Doctrine: provider payload is the only truth; this test does NOT touch
 * cache UI semantics. It locks the ONE property OpenAI prompt caching
 * actually requires: across two runs on the same corpus with different
 * questions, the request prefix up to the cache break must be
 * byte-identical (OpenAI caches the longest common prefix).
 *
 * Finding this test encodes: the inquiry OpenAI path composes the prompt
 * with placeUserQuestionLast + cacheBreakDelimiter, so the volatile
 * question is genuinely LAST. Ordering is correct. Therefore any real
 * cache miss must come from an UNSTABLE stable-prefix input (corpus
 * manifest order, evidence block order, output rules, role template) —
 * not message ordering. These cases pin composeEnvelope itself as stable
 * so the investigation can focus upstream.
 */
describe('Audit 3: OpenAI cacheable prefix stability', () => {
    const STABLE_USER_INPUT = [
        'INSTRUCTIONS: answer the editorial question using the evidence.',
        '',
        '{ "schema_version": 9 }',
        '',
        'CORPUS MANIFEST:',
        '- ref_id=S1 | ref_label=1 A.md | ref_path=Book/1 A.md | class=scene',
        '- ref_id=S2 | ref_label=2 B.md | ref_path=Book/2 B.md | class=scene',
        '',
        'EVIDENCE:',
        '## 1 A\n' + 'lorem ipsum '.repeat(4000),
        '## 2 B\n' + 'dolor sit amet '.repeat(4000)
    ].join('\n');

    const compose = (question: string) => composeEnvelope({
        roleTemplateName: 'Inquiry',
        roleTemplateText: 'Editorial analysis engine. Return JSON only.',
        projectContext: '',
        featureModeInstructions: 'You are an editorial analysis engine.\nReturn JSON only.',
        userInput: STABLE_USER_INPUT,
        userQuestion: question,
        outputRules: 'Return JSON only using the exact schema.',
        placeUserQuestionLast: true,
        cacheBreakDelimiter: CACHE_BREAK_DELIMITER
    });

    const stablePrefix = (userPrompt: string): string => {
        const idx = userPrompt.indexOf(CACHE_BREAK_DELIMITER);
        expect(idx).toBeGreaterThan(0);
        return userPrompt.slice(0, idx);
    };

    it('places the volatile question AFTER the cache break (ordering is correct)', () => {
        const { userPrompt } = compose('Pres8: Tension Leakage');
        const breakIdx = userPrompt.indexOf(CACHE_BREAK_DELIMITER);
        const questionIdx = userPrompt.indexOf('Pres8: Tension Leakage');
        const evidenceIdx = userPrompt.indexOf('EVIDENCE:');
        expect(evidenceIdx).toBeGreaterThan(-1);
        expect(evidenceIdx).toBeLessThan(breakIdx); // evidence is in the stable prefix
        expect(questionIdx).toBeGreaterThan(breakIdx); // question is volatile, last
    });

    it('stable prefix is byte-identical for two different questions on the same corpus', () => {
        const a = stablePrefix(compose('Pres8: Tension Leakage').userPrompt);
        const b = stablePrefix(compose('Pres4: False Plateaus').userPrompt);
        expect(a).toBe(b);
        // The evidence corpus must live inside that identical prefix —
        // otherwise OpenAI can never reuse it across questions.
        expect(a.includes('lorem ipsum')).toBe(true);
        expect(a.includes('dolor sit amet')).toBe(true);
    });

    it('system prompt is identical across questions (cached input includes the system message)', () => {
        const a = compose('Q one');
        const b = compose('Q two');
        expect(a.systemPrompt).toBe(b.systemPrompt);
    });

    it('the ONLY difference between the two requests is the post-break question', () => {
        const a = compose('Q ONE').userPrompt;
        const b = compose('Q TWO').userPrompt;
        const aPre = a.slice(0, a.indexOf(CACHE_BREAK_DELIMITER));
        const bPre = b.slice(0, b.indexOf(CACHE_BREAK_DELIMITER));
        expect(aPre).toBe(bPre);
        const aPost = a.slice(a.indexOf(CACHE_BREAK_DELIMITER));
        const bPost = b.slice(b.indexOf(CACHE_BREAK_DELIMITER));
        expect(aPost).not.toBe(bPost);
    });
});
