import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AI client resolved-model caching', () => {
    it('records live provider resolved models back into the alias cache', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
        expect(source.includes('cacheResolvedModel')).toBe(true);
        expect(source.includes('recordResolvedAlias(execution.aiModelRequested, execution.aiModelResolved)')).toBe(true);
        expect(source.includes('recordResolvedAlias(retry.aiModelRequested, retry.aiModelResolved)')).toBe(true);
        expect(source.includes('recordResolvedAlias(cached.modelRequested, cached.modelResolved)')).toBe(true);
    });

    it('treats Anthropic Inquiry cache state as eligible until the provider confirms a hit', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
        expect(source.includes("userQuestion: request.userQuestion")).toBe(true);
        // Volatile-last layout defaults to Inquiry but any feature can opt in
        // (Gossamer) so its stable corpus is reused across prompt-cache windows.
        expect(source.includes("const placeUserQuestionLast = (request.placeUserQuestionLast ?? isInquiry) && hasUserQuestion;")).toBe(true);
        expect(source.includes("placeUserQuestionLast,")).toBe(true);
        expect(source.includes('const cacheDelimiterUsed = userPrompt.includes(CACHE_BREAK_DELIMITER);')).toBe(true);
        expect(source.includes("reuseState = cacheAttempted ? 'eligible' : 'idle';")).toBe(true);
        expect(source.includes("} else if (provider === 'openai') {")).toBe(true);
        expect(source.includes("reuseState = cacheDelimiterUsed ? 'eligible' : 'idle';")).toBe(true);
        expect(source.includes("(provider === 'openai' && advancedContext.reuseState !== 'idle')")).toBe(true);
        expect(source.includes("if (provider === 'google' && typeof cachedStableRatio === 'number') {")).toBe(true);
        expect(source.includes("if (provider === 'google' && typeof cachedStableTokens === 'number') {")).toBe(true);
        expect(source.includes("if (!bypassProviderReuse && provider === 'openai') {")).toBe(true);
    });

    it('builds the shared result cache key from the full prepared request contract', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
        expect(source.includes('modelId: initialSelection.model.id')).toBe(true);
        expect(source.includes('responseSchema: request.responseSchema')).toBe(true);
        expect(source.includes('citationsEnabled: caps.citationsEnabled')).toBe(true);
        expect(source.includes('useDocumentBlocks')).toBe(true);
        expect(source.includes('evidenceDocuments')).toBe(true);
    });

    it('stamps shared timing fields on live provider runs and marks in-memory cache hits explicitly', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
        expect(source.includes('function withRunTiming')).toBe(true);
        expect(source.includes('function withRunValidation')).toBe(true);
        expect(source.includes('servedFromCache: true')).toBe(true);
        expect(source.includes("warnings: [...cached.warnings, 'Served from in-memory cache.']")).toBe(true);
        expect(source.includes('submittedAt: submittedAt.toISOString()')).toBe(true);
        expect(source.includes('returnedAt: returnedAt.toISOString()')).toBe(true);
        expect(source.includes('durationMs: Math.max(0, returnedAt.getTime() - submittedAt.getTime())')).toBe(true);
    });

    it('lets callers bypass both shared result caching and provider reuse explicitly', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
        expect(source.includes('const bypassProviderReuse = request.bypassProviderReuse === true;')).toBe(true);
        expect(source.includes('const bypassInMemoryCache = request.bypassInMemoryCache === true || bypassProviderReuse;')).toBe(true);
        expect(source.includes('if (!bypassInMemoryCache) {')).toBe(true);
        expect(source.includes('bypassProviderReuse,')).toBe(true);
        expect(source.includes("promptCacheKey: !bypassProviderReuse ? estimate.providerReuseKey : undefined,")).toBe(true);
        expect(source.includes("(provider === 'openai' && advancedContext.reuseState !== 'idle')")).toBe(true);
    });
});

/**
 * Privacy-flag wiring (regression guard added 2026-05-23).
 *
 * The aiSettings.privacy block is the user's authoritative consent for outbound
 * model-data calls. AIClient previously hard-coded provider-snapshot enabled:
 * true in loader construction, making the settings UI toggle decorative. These
 * source-grep tests pin the rule that every loader must read its consent flag
 * from settings — not from a literal.
 */
describe('AI client privacy-flag wiring', () => {
    const rawSource = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
    // Strip comments before grepping so docstring mentions of the forbidden
    // patterns (e.g. explaining what was previously hard-coded) don't fire.
    const code = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('reads allowProviderSnapshot from privacy settings on every snapshot fetch', () => {
        expect(code).toContain('isProviderSnapshotAllowed()');
        expect(code).toContain('enabled: this.isProviderSnapshotAllowed()');
        expect(code).toContain('getAiSettings(this.plugin.settings).privacy.allowProviderSnapshot');
    });

    it('never hard-codes enabled: true on the provider-snapshot loader', () => {
        // Constrain the search to the loadProviderSnapshot call so legitimate
        // enabled:true elsewhere (e.g. unrelated boolean fields) doesn't trip.
        const loaderBlockMatch = code.match(/loadProviderSnapshot\(\{[\s\S]*?\}\)/);
        expect(loaderBlockMatch).not.toBeNull();
        if (loaderBlockMatch) {
            expect(loaderBlockMatch[0]).not.toMatch(/enabled:\s*true\b/);
        }
    });
});

/**
 * Pre-dispatch availability gate (regression guard added 2026-05-23).
 *
 * The provider snapshot is a global model catalog (not keyed to the user's
 * account/tier) used to catch dispatching an unknown model id. Previously,
 * availabilityStatus was recorded on advancedContext but the run dispatched
 * anyway — burning the user's API quota on a guaranteed 404/400. This guard
 * pins that the not_visible status hard-fails before this.execute() is
 * called. Curated BUILTIN_MODELS are exempt from not_visible (snapshot lag
 * must not block a model RT ships); see the curated-exemption guard below.
 */
describe('AI client model-availability gate', () => {
    const rawSource = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
    const code = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('throws before dispatch when availabilityStatus is not_visible', () => {
        expect(code).toMatch(/if\s*\(\s*availabilityStatus\s*===\s*['"]not_visible['"]\s*\)\s*\{[\s\S]*?throw new Error/);
    });

    it('only throws after advancedContext is set so the UI/logs see the not_visible status', () => {
        const setLastIndex = code.indexOf('setLastRunAdvanced(this.plugin, request.feature, advancedContext)');
        const gateIndex = code.search(/if\s*\(\s*availabilityStatus\s*===\s*['"]not_visible['"]\s*\)/);
        const executeIndex = code.indexOf('this.execute(providerClient');
        expect(setLastIndex).toBeGreaterThan(-1);
        expect(gateIndex).toBeGreaterThan(-1);
        expect(executeIndex).toBeGreaterThan(-1);
        expect(gateIndex).toBeGreaterThan(setLastIndex);
        expect(gateIndex).toBeLessThan(executeIndex);
    });

    it('exempts curated BUILTIN_MODELS from not_visible so snapshot lag cannot block a shipped model', () => {
        // A newly promoted model can be missing from the global, lagging
        // provider snapshot for days. The availability computation must check
        // BUILTIN_MODELS membership and downgrade absence to 'unknown' for
        // curated models rather than fabricating a not_visible tier reason.
        expect(code).toMatch(/isCuratedBuiltinModel/);
        expect(code).toMatch(/BUILTIN_MODELS\.some\(/);
    });
});

/**
 * Local-LLM capability floor (regression guard added 2026-05-23).
 *
 * Cloud providers go through selectModel's capability filter; the Ollama
 * path bypassed it by resolving from live backend probes. That meant a
 * feature requiring longContext / reasoningStrong / highOutputCap could
 * dispatch to a local model declaring only ['jsonStrict'] and silently
 * produce degraded results. This guard pins the post-selection capability
 * check that throws when the local model lacks any required capability.
 */
describe('AI client local LLM capability floor', () => {
    const rawSource = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
    const code = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it("checks requiredCapabilities against the local model's declared capabilities", () => {
        expect(code).toMatch(/if\s*\(\s*provider\s*===\s*['"]ollama['"]\s*&&\s*requiredCapabilities\.length\s*>\s*0\s*\)/);
        expect(code).toContain('initialSelection.model.capabilities');
        expect(code).toContain('requiredCapabilities.filter');
    });

    it('throws with a remediation message when a required capability is missing', () => {
        expect(code).toMatch(/Local model[\s\S]{0,80}lacks required capabilit/);
        // Both remediations must be reachable. Pointing only at cloud providers
        // made the local path a dead end: local models carry a fixed
        // ['jsonStrict'] baseline, so nothing the author could do would satisfy
        // a reasoningStrong floor. The settings path is that missing door.
        expect(code).toContain('Settings → AI → Local LLM → Model capabilities');
        expect(code).toContain('switch to a cloud provider');
    });
});

/**
 * Role-template bypass (regression guard added 2026-05-23).
 *
 * Technical scoring features should not inherit the user's active role
 * template (e.g. "literary fiction editor") because that persona biases a
 * structural scoring pass. The bypassRoleTemplate flag lets a feature opt
 * out and use a feature-named neutral scoring role instead.
 */
describe('AI client role-template bypass', () => {
    const rawSource = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
    const code = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('swaps in a neutral role template when bypassRoleTemplate is set', () => {
        expect(code).toContain('request.bypassRoleTemplate');
        expect(code).toContain('buildNeutralRoleTemplate(request.feature)');
        expect(code).toContain('resolveActiveRoleTemplate(this.plugin, aiSettings)');
    });
});

/**
 * Runtime structured-output normalization (regression guard added 2026-05-24).
 *
 * Gossamer has a feature-level unwrap for Opus 4.7's valid-but-wrapped
 * responses, but AIClient validates required schema keys before returning
 * control to feature code. This pins the shared runtime fix: normalize an
 * accepted single-key envelope before the malformed-JSON rejection path, then
 * return the normalized content so downstream feature validators see the
 * canonical object.
 */
describe('AI client structured-output normalization', () => {
    const rawSource = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');
    const code = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('uses normalized validator content on initial and retry success paths', () => {
        expect(code).toContain('validation.normalizedRaw');
        expect(code).toContain('retryValidation.normalizedRaw');
        expect(code).toContain('execution.content = validation.normalizedRaw');
        expect(code).toContain('const acceptedRetryContent = retryValidation.normalizedRaw ?? retry.content');
    });

    it('records normalization warnings in the returned run notes', () => {
        expect(code).toContain('validation.normalizationWarnings');
        expect(code).toContain('retryValidation.normalizationWarnings');
        expect(code).toContain('warnings.push(...validationNotes)');
        expect(code).toContain('...retryValidationNotes');
    });

    it('normalizes after validation succeeds and before building the final result', () => {
        const validationIndex = code.indexOf('const validation = validateJsonResponse');
        const rejectedIndex = code.indexOf("aiStatus: 'rejected'", validationIndex);
        const normalizedIndex = code.indexOf('execution.content = validation.normalizedRaw', validationIndex);
        const resultIndex = code.indexOf('const result = withRunValidation', normalizedIndex);
        expect(validationIndex).toBeGreaterThan(-1);
        expect(rejectedIndex).toBeGreaterThan(-1);
        expect(normalizedIndex).toBeGreaterThan(rejectedIndex);
        expect(resultIndex).toBeGreaterThan(normalizedIndex);
    });
});
