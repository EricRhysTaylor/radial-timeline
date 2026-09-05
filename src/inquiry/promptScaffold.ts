import { INQUIRY_SCHEMA_VERSION } from './constants';
import type { InquiryLens, InquiryScope, InquirySelectionMode } from './state';

export const INQUIRY_ROLE_TEMPLATE_GUARDRAIL =
    "Do not reinterpret or expand the user's question. Answer it directly. The role template provides tonal and contextual framing only.";

export type InquiryPromptScaffoldInput = {
    task: string;
    scope?: InquiryScope;
    lens: InquiryLens;
    selectionMode: InquirySelectionMode;
    targetSceneIds: string[];
    corpusManifestLines: string[];
    evidenceText: string;
};

function normalizePromptInput(input: string | InquiryPromptScaffoldInput): InquiryPromptScaffoldInput {
    if (typeof input === 'string') {
        return {
            task: '',
            scope: 'book',
            lens: 'flow',
            selectionMode: 'discover',
            targetSceneIds: [],
            corpusManifestLines: [],
            evidenceText: input
        };
    }
    return {
        task: input.task,
        scope: input.scope === 'saga' ? 'saga' : 'book',
        lens: input.lens,
        selectionMode: input.selectionMode,
        targetSceneIds: Array.isArray(input.targetSceneIds) ? input.targetSceneIds : [],
        corpusManifestLines: Array.isArray(input.corpusManifestLines) ? input.corpusManifestLines : [],
        evidenceText: input.evidenceText
    };
}

export function buildInquiryPromptParts(input: string | InquiryPromptScaffoldInput): {
    systemPrompt: string;
    instructionText: string;
    schemaText: string;
    manifestText: string;
    userPrompt: string;
} {
    const normalized = normalizePromptInput(input);

    const systemPrompt = [
        'You are an editorial analysis engine.',
        'Scores are corpus-level diagnostics, not answer quality.',
        'Return JSON only. No prose outside JSON.'
    ].join('\n');

    const schemaText = [
        '{',
        `  "schema_version": ${INQUIRY_SCHEMA_VERSION},`,
        '  "summaryFlow": "1-2 sentence flow summary (pacing, momentum, compression, timing, pressure phrasing).",',
        '  "summaryDepth": "1-2 sentence depth summary (coherence, subtext, logic, alignment, implication phrasing).",',
        '  "verdictFlow": <computed integer 0-100>,',
        '  "verdictDepth": <computed integer 0-100>,',
        '  "findings": [',
        '    {',
        '      "ref_id": "scn_a1b2c3d4",',
        '      "ref_label": "3 Turning Point.md",',
        '      "ref_path": "Book 1 Example Novel/3 Turning Point.md",',
        '      "kind": "thread|arc|payoff|structure|loose_end|continuity|escalation|conflict|unclear|strength",',
        '      "lens": "flow|depth|both|",',
        '      "headline": "short line",',
        '      "bullets": ["specific", "supporting points"],',
        '      "recommended_action": "concrete author edit/check, phrased as an imperative; empty string if the finding needs no separate action",',
        '      "subject": "thread, arc, or big-picture subject (empty string if not needed)",',
        '      "span": "book span such as B1-B3 or B2 (empty string if not needed)",',
        '      "evidence_quote": "verbatim sentence or phrase from the cited or supporting evidence that grounds this finding (empty string if no quotable prose)",',
        '      "supporting_refs": [{ "ref_id": "scn_a1b2c3d4", "ref_label": "3 Turning Point.md", "ref_path": "Book 1 Example Novel/3 Turning Point.md", "quote": "short verbatim support quote" }],',
        '      "role": "target|context|"',
        '    }',
        '  ]',
        '}'
    ].join('\n');

    const instructionText = [
        'Answer the editorial question using the evidence.',
        'Independently assign corpus-level diagnostics (0-100):',
        '- Flow: momentum/causality/pressure progression across the evaluated corpus.',
        '- Depth: coherence/implication/structural integrity across the evaluated corpus.',
        'Scores reflect the corpus, not the quality of your answer.',
        'verdictFlow and verdictDepth are REQUIRED top-level integer fields (0-100) you MUST compute from the corpus — never return 0 unless the corpus genuinely scores at the floor. Emit them as flat number fields, exactly like summaryFlow/summaryDepth; do not nest them inside a "verdict" object.',
        'Use the same evidence for both lenses; interpretation changes, not evidence.',
        'Use flow summary phrasing that emphasizes compression, timing, and pressure.',
        'Use depth summary phrasing that emphasizes alignment, implication, and consistency.',
        'If conclusions align, still phrase summaries to match the active lens emphasis.',
        ...(normalized.scope === 'saga'
            ? [
                'Saga scope: analyze series-level threads, arcs, continuity chains, setup/payoff movement, escalation, and structural pressure across books.',
                'Saga findings must be big-picture observations anchored to books, not scene-level repair tickets.',
                'Every primary finding MUST anchor to the most relevant book row in the CORPUS MANIFEST where class=book.',
                'Primary ref_id/ref_label/ref_path must come from a class=book manifest row. Do not use scene ids as primary refs in Saga scope.',
                'Use supporting_refs for scene or book evidence that substantiates the book-level finding.',
                'Prefer fewer, larger findings over many local scene observations.',
                'Set subject to the thread, arc, relationship, world-rule, promise/payoff chain, or structural concern being assessed.',
                'Set span to the relevant book range, such as B1-B3, B2, or B1-B4.',
                'Book anchor rows are placement anchors for the Saga minimap; they may be cited as primary refs even if their mode is excluded.'
            ]
            : [
                'All findings must be anchored to specific scenes.',
                'Every finding must map to a concrete scene from the CORPUS MANIFEST.'
            ]),
        'Citation fidelity is mandatory. Every finding MUST include ref_id, ref_label, and ref_path, copied VERBATIM from a single entry in the CORPUS MANIFEST.',
        'Do not invent, shorten, rename, translate, paraphrase, or infer references. Copy all three fields character-for-character from the manifest line you selected.',
        'If no matching corpus entry exists for a reference you would like to cite, do NOT cite it. Omit the finding rather than fabricate a reference.',
        'The three fields must be consistent: ref_id, ref_label, and ref_path must come from the SAME manifest row. Do not mix fields across rows.',
        'Canonical scene ids are YAML IDs in the form scn_<hash> and must match ^scn_[a-f0-9]{8,10}$.',
        'When identifying absences (e.g. missing setup, weak foreshadowing, underdeveloped elements): reference the scene where the absence is most visible to the reader, or the scene where the missing element should have been established.',
        'Avoid abstract identifiers such as gap_001 or similar constructs.',
        'Never invent scene refs like scn_s38_jump, scn_s44_long_road_up, or title/slug variants.',
        'Never derive ref_id from a scene number: the scene labelled "(S16)" is NOT scn_16. Copy the exact scn_<hash> ref_id from the CORPUS MANIFEST row; the S-number is a display label, never an id.',
        'Evidence headings include "(Summary)" or "(Full)".',
        'Treat "(Summary)" entries as compressed evidence, not full scene prose; avoid claims requiring missing fine-grain details.',
        'Return findings for scenes/moments that materially answer the question. A finding may be an evidence-bearing observation, not only a revision problem.',
        'Be exhaustive, not illustrative: return a SEPARATE finding (each with its own citation) for EVERY scene or moment that materially answers the question — not just the single strongest example. Any specific scene you name in summaryFlow or summaryDepth MUST have a corresponding finding; do not let the summary mention scenes the findings array omits.',
        'When the manuscript is working well, include the strongest scene observations that support that conclusion so the answer has a verifiable evidence trail.',
        'Account for genre, period, intended audience, and world-context. A detail is not an orientation or setup failure merely because a modern general reader may not know it. Treat assumed knowledge as a risk only when it materially disrupts comprehension for the manuscript\'s likely audience or weakens the scene\'s intended effect. Preserve the work\'s voice, era, genre contract, and narrative strategy; prefer light-touch grounding over explanatory flattening.',
        'Never emit a placeholder finding with an empty headline and empty bullets. If you have no concrete finding text for a scene, omit that finding entirely.',
        'Use kind: "strength" only for an evidence-bearing structural observation that directly answers the question. Strength findings are informational and will not generate action items.',
        'For findings that do identify a deficit, gap, or revision opportunity, make the revision opportunity explicit in the headline/bullets and, when credible, recommended_action.',
        'Return at most ONE finding per scene reference. If multiple issues exist for the same scene, combine them into a single headline and bullet list.',
        'For recommended_action: do not repeat or lightly rephrase the headline. Translate the finding into one concrete author move: add, clarify, seed, compress, check, reconcile, cut, or move a specific beat/detail. Use an empty string when the finding is a structural observation with no credible edit action.',
        'Before recommending added explanation, ask whether the target reader is expected to infer this from genre, period, social context, or surrounding scenes. If the assumption is appropriate for the likely audience, frame the finding as a contextual observation or an acceptable tradeoff (empty recommended_action) rather than a required edit — do not flatten period or genre material into beginner exposition.',
        'Use role: "target" for author-selected target scenes and role: "context" for supporting context when helpful. Use an empty string when role is not needed.',
        'Set lens to flow, depth, or both when helpful. Use an empty string when no lens tag is needed.',
        'Always return bullets as an array. Use [] when one short headline is sufficient.',
        'Always return recommended_action as a string. Use "" rather than a vague task such as "review this issue."',
        'Always return subject and span as strings. Use an empty string when not needed.',
        'Always return supporting_refs as an array. Use [] when there are no secondary citations.',
        'evidence_quote is REQUIRED for every finding and MUST be a verbatim sentence or phrase copied character-for-character from the cited or supporting evidence. Do not paraphrase, summarize, translate, or compose new prose. Pick the exact span that most directly grounds your headline. Keep it short (one or two sentences). evidence_quote may only be the empty string when no cited/supporting evidence has quotable prose. If you cannot produce a verbatim quote because no quotable prose exists, omit the finding instead of returning an empty quote — the Sources block exists to surface verifiable spans, not commentary.',
        ...(normalized.selectionMode === 'focused'
            ? [
                'Focused selection mode: treat target scenes as the primary subject of analysis.',
                'Use the full manuscript as context, not as the main object of critique.',
                'Include outside scenes only when they are necessary to support a target-scene finding.',
                'Avoid drifting into broad global critique when the target scenes already answer the task.'
            ]
            : []),
        'Return JSON only with summaryFlow, summaryDepth, verdictFlow, verdictDepth, and findings.',
        'Match the response shape below. It shows field names and types only — angle-bracket hints like <computed integer 0-100> mark values you must compute; never emit the literal placeholder text.'
    ].join('\n');

    const targetSceneBlock = normalized.selectionMode === 'focused' && normalized.targetSceneIds.length
        ? [
            '',
            'TARGET SCENES:',
            ...normalized.targetSceneIds.map(sceneId => `- ${sceneId}`)
        ]
        : [];

    const manifestText = normalized.corpusManifestLines.length
        ? [
            'CORPUS MANIFEST:',
            normalized.scope === 'saga'
                ? 'Primary Saga findings MUST cite class=book rows. Supporting refs may cite scene/book rows. Copy ref_id, ref_label, and ref_path verbatim from one row.'
                : 'Every cited scene MUST come from this list. Copy ref_id, ref_label, and ref_path verbatim from one row.',
            ...normalized.corpusManifestLines.map(line => `- ${line}`)
        ].join('\n')
        : '';

    const userPrompt = [
        instructionText,
        '',
        schemaText,
        ...(manifestText ? ['', manifestText] : []),
        '',
        'TASK:',
        normalized.task || '(not provided)',
        ...targetSceneBlock,
        '',
        'EVIDENCE:',
        normalized.evidenceText
    ].join('\n');

    return { systemPrompt, instructionText, schemaText, manifestText, userPrompt };
}

export function buildInquiryPromptScaffold(input: string | InquiryPromptScaffoldInput): {
    systemPrompt: string;
    userPrompt: string;
} {
    const { systemPrompt, userPrompt } = buildInquiryPromptParts(input);
    return { systemPrompt, userPrompt };
}
