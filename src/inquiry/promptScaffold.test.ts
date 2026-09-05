import { describe, expect, it } from 'vitest';
import { buildInquiryPromptParts, buildInquiryPromptScaffold, INQUIRY_ROLE_TEMPLATE_GUARDRAIL } from './promptScaffold';

describe('buildInquiryPromptParts', () => {
    it('recombines into the canonical inquiry scaffold and isolates the schema block', () => {
        const input = {
            task: 'Assess setup coherence.',
            scope: 'book' as const,
            lens: 'flow' as const,
            selectionMode: 'focused' as const,
            targetSceneIds: ['scn_target_01'],
            corpusManifestLines: ['scn_target_01 | class=scene | mode=full | isTarget=true'],
            evidenceText: 'Evidence body'
        };
        const parts = buildInquiryPromptParts(input);
        const scaffold = buildInquiryPromptScaffold(input);

        expect(parts.userPrompt).toBe(scaffold.userPrompt);
        expect(parts.schemaText.includes('"schema_version"')).toBe(true);
        expect(parts.schemaText.includes('"recommended_action"')).toBe(true);
        expect(parts.instructionText.includes('Answer the editorial question using the evidence.')).toBe(true);
        expect(parts.instructionText.includes('A finding may be an evidence-bearing observation, not only a revision problem.')).toBe(true);
        expect(parts.instructionText.includes('include the strongest scene observations that support that conclusion')).toBe(true);
        expect(parts.instructionText.includes('do not repeat or lightly rephrase the headline')).toBe(true);
        expect(parts.instructionText.includes('Never emit a placeholder finding with an empty headline and empty bullets.')).toBe(true);
        // Regression guard: verdict must be FLAT (verdictFlow/verdictDepth),
        // never a nested object — Opus 4.8 leaks tool-call XML
        // (<parameter name="flow">) into the nested shape, corrupting it to
        // Flow 0 / Depth 0. And the score must be a non-copyable shape hint,
        // not a numeric placeholder (which models echo verbatim).
        expect(parts.schemaText.includes('"verdict":')).toBe(false);
        expect(/"verdictFlow":\s*\d/.test(parts.schemaText)).toBe(false);
        expect(/"verdictDepth":\s*\d/.test(parts.schemaText)).toBe(false);
        expect(parts.schemaText.includes('"verdictFlow": <computed integer 0-100>')).toBe(true);
        expect(parts.instructionText.includes('do not nest them inside a "verdict" object')).toBe(true);
        expect(parts.instructionText.includes('never emit the literal placeholder text')).toBe(true);
        // Coverage: findings must cover every scene the summary names, not just one example.
        expect(parts.instructionText.includes('Be exhaustive, not illustrative')).toBe(true);
        // Context-sensitivity: orientation risk judged against genre/period/audience, not a modern general reader.
        expect(parts.instructionText.includes('Account for genre, period, intended audience, and world-context.')).toBe(true);
        expect(parts.instructionText.includes('prefer light-touch grounding over explanatory flattening')).toBe(true);
        expect(parts.instructionText.includes('Before recommending added explanation, ask whether the target reader is expected to infer this')).toBe(true);
        expect(parts.userPrompt.includes('SELECTION MODE')).toBe(false);
        expect(parts.userPrompt.includes('TARGET SCENES:\n- scn_target_01')).toBe(true);
        expect(INQUIRY_ROLE_TEMPLATE_GUARDRAIL.includes('role template')).toBe(true);
    });

    it('keeps book scope scene-anchored and makes saga scope book-anchored', () => {
        const book = buildInquiryPromptParts({
            task: 'Find continuity issues.',
            scope: 'book',
            lens: 'depth',
            selectionMode: 'discover',
            targetSceneIds: [],
            corpusManifestLines: ['ref_id=scn_a1b2c3d4 | ref_label=1.md | ref_path=Book 1/1.md | class=scene | mode=summary | isTarget=false'],
            evidenceText: 'Evidence'
        });
        const saga = buildInquiryPromptParts({
            task: 'Find series thread issues.',
            scope: 'saga',
            lens: 'depth',
            selectionMode: 'discover',
            targetSceneIds: [],
            corpusManifestLines: [
                'ref_id=book_aaaaaaaa | ref_label=B1 | ref_path=Book 1 | class=book | mode=excluded | isTarget=false',
                'ref_id=scn_a1b2c3d4 | ref_label=1.md | ref_path=Book 1/1.md | class=scene | mode=summary | isTarget=false'
            ],
            evidenceText: 'Evidence'
        });

        expect(book.instructionText).toContain('All findings must be anchored to specific scenes.');
        expect(saga.instructionText).toContain('Saga findings must be big-picture observations anchored to books');
        expect(saga.instructionText).toContain('Primary ref_id/ref_label/ref_path must come from a class=book manifest row');
        expect(saga.manifestText).toContain('Primary Saga findings MUST cite class=book rows');
    });
});
