import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('InquiryRunnerService output-truncation recovery', () => {
    it('requests the output ceiling on the first pass, with chunking as the only truncation fallback', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        // The precheck estimate (which drives the first pass's output cap) and
        // the first pass itself both force the ceiling — no wasted truncated
        // call followed by a retry.
        expect(source.includes('forceMaxOutputCeiling: true')).toBe(true);
        // Truncation even at the ceiling falls back to chunk+synthesize.
        const ceilingIdx = source.indexOf('forceMaxOutputCeiling: true');
        const fallbackChunkIdx = source.indexOf('runChunkedInquiry', ceilingIdx);
        expect(ceilingIdx).toBeGreaterThan(0);
        expect(fallbackChunkIdx).toBeGreaterThan(ceilingIdx);
        // The redundant intermediate "retry at ceiling" path is gone.
        expect(source.includes('maxTokens: this.getOutputTokenCap(ai.provider)')).toBe(false);
    });
});

describe('InquiryRunnerService execution integrity', () => {
    it('uses scene ids for inquiry evidence citation references', () => {
        const runnerSource = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        const scaffoldSource = readFileSync(resolve(process.cwd(), 'src/inquiry/promptScaffold.ts'), 'utf8');
        expect(runnerSource.includes('"ref_id": "scn_a1b2c3d4"')).toBe(true);
        expect(scaffoldSource.includes('copied VERBATIM from a single entry in the CORPUS MANIFEST')).toBe(true);
        expect(scaffoldSource.includes('Do not invent, shorten, rename')).toBe(true);
        expect(scaffoldSource.includes('If no matching corpus entry exists')).toBe(true);
        expect(runnerSource.includes('(${scene.sceneId})')).toBe(true);
    });

    it('readFileContent delegates stripping to cleanEvidenceBody', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        expect(source).toContain('cleanEvidenceBody(raw)');
        expect(source).toContain("from '../utils/evidenceCleaning'");
    });

    it('threads userQuestion into trace token estimates so Anthropic document-block estimates include evidence', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        expect(source).toMatch(/this\.buildTokenEstimate\([\s\S]*this\.getJsonSchema\(\),[\s\S]*input\.questionText/);
        expect(source).toMatch(/this\.buildTokenEstimate\([\s\S]*this\.getOmnibusJsonSchema\(\),[\s\S]*input\.questions\.map\(question => question\.questionText\)\.join\('\\n'\)/);
        expect(source).toMatch(/this\.prepareInquiryRunEstimate\([\s\S]*userQuestion,[\s\S]*ai,/);
    });

    it('pins prepared Inquiry estimates to the resolved engine model instead of re-resolving from settings', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        expect(source).toContain('private resolvePolicyOverrideForAi(');
        expect(source).toContain("entry.provider === ai.provider && entry.id === ai.modelId");
        expect(source).toContain("return { type: 'pinned', pinnedAlias: model.alias };");
        expect(source).toContain('policyOverride: this.resolvePolicyOverrideForAi(options.ai),');
    });

    it('uses instructionPrompt only for Anthropic attachment runs', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        expect(source).toContain("provider === 'anthropic'");
        expect(source).toContain('private shouldUseInstructionPrompt(');
    });

    it('uses cacheable user input and provider reuse keys for OpenAI inquiry caching', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        expect(source).toContain('private resolveProviderUserInput(');
        expect(source).toContain("(provider === 'openai' || provider === 'google') && cacheableUserInput");
        expect(source).toContain('providerReuseKey: input.corpus.cacheReuseFingerprint');
        expect(source).toContain('providerReuseKey: options.providerReuseKey,');
    });

    it('keeps cacheable prefixes free of TASK and target-scene selection so they survive question changes', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        expect(source).toContain('Deliberately omits TASK *and* the target-scene block so the volatile');
        expect(source).toContain("'EVIDENCE:',");
        expect(source).toContain("'(Evidence provided as document attachments.)'");
        // Target selection is question-dependent: it must be folded into the
        // volatile question, never the cacheable prefix or the corpus manifest.
        expect(source).toContain('private buildVolatileTargetScenes(');
        expect(source).toContain('this.appendVolatileTargetScenes(input.questionText, input.targetSceneIds)');
        // The corpus manifest line must not carry isTarget any more.
        expect(source).not.toContain('| isTarget=${isTarget}`');
    });

    it('uses planning-budget wording for single-pass rejection while preserving legacy detection', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        const enLocale = readFileSync(resolve(process.cwd(), 'src/i18n/locales/en.ts'), 'utf8');
        // The user-visible single-pass rejection wording lives in the i18n catalog,
        // and the legacy substring detection lives in the runner module itself.
        expect(enLocale).toContain('This request exceeds the single-pass planning budget.');
        expect(source).toContain("normalized.includes('single-pass planning budget')");
        expect(source).toContain("normalized.includes('safe limit for a single pass')");
    });

    it('buildTokenEstimate throws on failure instead of falling back to heuristic', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        // Per RT Engineering Doctrine: "Fail clearly instead of falling back."
        // buildTokenEstimate must NOT have try/catch around prepareInquiryRunEstimate.
        // If the estimate fails, the error propagates to the service layer which
        // returns null — the UI shows "Estimate unavailable", never fabricated numbers.
        const buildTokenEstimateBlock = source.slice(
            source.indexOf('private async buildTokenEstimate('),
            source.indexOf('private getOutputTokenCap(')
        );
        expect(buildTokenEstimateBlock).toBeTruthy();
        // Must call prepareInquiryRunEstimate without try/catch wrapping
        expect(buildTokenEstimateBlock).toContain('prepareInquiryRunEstimate');
        // Must NOT contain heuristic fallback via estimateTokensFromChars
        expect(buildTokenEstimateBlock).not.toContain('estimateTokensFromChars');
        // Must throw when prepared is null (i18n key resolves to "Token estimate unavailable…")
        expect(buildTokenEstimateBlock).toContain("throw new Error(t('inquiry.runner.tokenEstimateUnavailable'))");
    });

    it('buildTokenEstimate reads all fields from prepared estimate without defaults', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        // Per RT Engineering Doctrine: "No fabricated numbers."
        // Token estimate fields must come directly from the prepared estimate —
        // no ?? 0, no ?? 'heuristic_chars', no substitute values.
        const buildTokenEstimateBlock = source.slice(
            source.indexOf('private async buildTokenEstimate('),
            source.indexOf('private getOutputTokenCap(')
        );
        expect(buildTokenEstimateBlock).toBeTruthy();
        // All fields sourced from prepared.*
        expect(buildTokenEstimateBlock).toContain('prepared.tokenEstimateInput');
        expect(buildTokenEstimateBlock).toContain('prepared.tokenEstimateMethod');
        expect(buildTokenEstimateBlock).toContain('prepared.tokenEstimateUncertainty');
        expect(buildTokenEstimateBlock).toContain('prepared.effectiveInputCeiling');
        expect(buildTokenEstimateBlock).toContain('prepared.expectedPassCount');
        // No fabricated token defaults (string length ?? 0 guards are fine)
        expect(buildTokenEstimateBlock).not.toContain("?? 'heuristic_chars'");
        expect(buildTokenEstimateBlock).not.toContain('estimateTokensFromChars');
    });

    it('does not fabricate scores or findings for failed provider results', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        const enLocale = readFileSync(resolve(process.cwd(), 'src/i18n/locales/en.ts'), 'utf8');
        const stubBlock = source.slice(
            source.indexOf('private buildStubResult('),
            source.indexOf('private getAiMetaFromResponse(')
        );
        expect(stubBlock).toBeTruthy();
        expect(stubBlock).toContain("kind: isFailure ? 'error' : 'unclear'");
        expect(stubBlock).toContain('flow: isFailure ? 0 : 0.6');
        expect(stubBlock).toContain('depth: isFailure ? 0 : 0.55');
        expect(enLocale).toContain('AI response unavailable; no findings were produced.');
        expect(enLocale).toContain('Inquiry run failed.');
        expect(enLocale).not.toContain('Stub result returned (AI unavailable).');
    });
});
