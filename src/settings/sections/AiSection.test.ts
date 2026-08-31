import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_MODELS } from '../../ai/registry/builtinModels';

describe('AI settings models table', () => {
    it('does not render a manual AI model update control in advanced diagnostics', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("setName('AI model updates')")).toBe(false);
        expect(source.includes("setButtonText('Update AI models')")).toBe(false);
        expect(source.includes('Last updated:')).toBe(false);
        expect(source.includes('Refresh availability')).toBe(false);
        expect(source.includes('Remote model registry')).toBe(false);
        expect(source.includes("text: 'Models'")).toBe(false);
        expect(source.includes('computeRecommendedPicks')).toBe(false);
    });

    it('keeps AI Strategy to provider, model, and access controls', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("setName(t('settings.ai.provider.name'))")).toBe(true);
        expect(source.includes("setName(t('settings.ai.modelOverride.name'))")).toBe(true);
        expect(source.includes("setName(t('settings.ai.accessTier.name'))")).toBe(true);
        expect(source.includes(".setName('Thinking Style')")).toBe(false);
    });

    it('does not render duplicate AI Features container beneath AI Strategy', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('AI Features in Radial Timeline')).toBe(false);
        expect(source.includes('ert-ai-features-section')).toBe(false);
    });

    it('keeps AI configuration focused on display and summary defaults without an empty advanced fold', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("text: 'Advanced & Diagnostics'")).toBe(false);
        expect(source.includes("text: t('settings.ai.config.timelineDisplayTitle')")).toBe(true);
        expect(source.includes("text: t('settings.ai.config.summaryRefreshTitle')")).toBe(true);
        expect(source.includes("title: t('settings.ai.config.pulseContextName')")).toBe(true);
        expect(source.includes("title: t('settings.ai.config.synopsisMaxWordsName')")).toBe(true);
        expect(source.includes("title: t('settings.ai.config.targetSummaryName')")).toBe(true);
        expect(source.includes("title: t('settings.ai.config.weakThresholdName')")).toBe(true);
        expect(source.includes("title: t('settings.ai.config.alsoUpdateSynopsisName')")).toBe(true);
    });

    it('locks gossamer to bodies-only with no evidence mode dropdown', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        const previewSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/aiSettingsPreview.ts'), 'utf8');
        // No gossamer evidence mode dropdown exists
        expect(source.includes('gossamerEvidenceDropdown')).toBe(false);
        expect(source.includes('GossamerEvidencePreference')).toBe(false);
        expect(source.includes('getGossamerEvidencePreference')).toBe(false);
        // Composition copy confirms bodies-only (helpers extracted to aiSettingsPreview.ts)
        expect(previewSource.includes('Scenes (${formatInquiryCount(sceneCount)}) — full text')).toBe(true);
        expect(previewSource.includes("'Outline — none'")).toBe(true);
        expect(previewSource.includes("'References — none'")).toBe(true);
    });

    it('pulses the preview card for exactly as long as a check is in flight', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        const css = readFileSync(resolve(process.cwd(), 'src/styles/rt-ui.css'), 'utf8');

        // A ten-second local probe with no motion reads as a hung panel.
        expect(source.includes("cls: 'ert-ai-resolved-preview-busy ert-settings-hidden'")).toBe(true);
        expect(source.includes("const busy = routingUiRunCount > 0 || providerKeyStates[activeProvider] === 'checking';")).toBe(true);
        // Wrapped so the dots stop on the failure path, not only on success.
        expect(source.includes('await runRefreshRoutingUi();')).toBe(true);
        expect(source.includes('routingUiRunCount -= 1;')).toBe(true);
        // The hidden utility shares this rule's specificity and is declared
        // first, so an unqualified display would strand the dots on screen.
        expect(css.includes('.ert-ai-resolved-preview-busy:not(.ert-settings-hidden)')).toBe(true);
        expect(css.includes('@keyframes ert-ai-preview-busy-pulse')).toBe(true);
        expect(css.includes('@media (prefers-reduced-motion: reduce)')).toBe(true);
    });

    it('renders active model preview with author-facing pill signals only', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("t('settings.ai.preview.kicker')")).toBe(true);
        expect(source.includes('resolvePreviewSignals')).toBe(true);
        expect(source.includes('resolveDisplayModelForLatestAlias')).toBe(true);
        expect(source.includes('displayModel: selected')).toBe(true);
        expect(source.includes('getResolvedModelId')).toBe(true);
        expect(source.includes('ID pending')).toBe(true);
        expect(source.includes('Context · Single-pass at this corpus')).toBe(true);
        expect(source.includes('Automatic Packaging')).toBe(false);
        expect(source.includes('Manual Selection')).toBe(false);
        expect(source.includes('Availability ·')).toBe(false);
        expect(source.includes('API lane ·')).toBe(false);
        expect(source.includes('provider-supported, not integrated')).toBe(false);
        expect(source.includes('Grounded/tool attribution')).toBe(false);
        expect(source.includes('Best for')).toBe(false);
    });

    it('keeps the model preview session certificate scoped and freshly read', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('const getInquirySessionStoreSnapshot = (): InquirySessionStore => new InquirySessionStore(plugin);')).toBe(true);
        expect(source.includes('getLatestSessionForEngineInScope(context.provider, context.modelId, currentCorpus.scope)')).toBe(true);
        expect(source.includes('scope: currentCorpus?.scope')).toBe(true);
        expect(source.includes('Latest ${latestScopeLabel} Inquiry run completed at')).toBe(true);
        expect(source.includes('Latest Inquiry run completed at')).toBe(false);
    });

    it('the catalog has no "*-latest" alias entries after the 2026-05-22 trim', () => {
        // The latest-alias display fallback in modelResolver.ts still
        // handles "*-latest" strings if a provider returns one, but no
        // BUILTIN_MODELS entry currently carries that shape. When a
        // future model is promoted via the deliberate promotion process
        // (see docs/engineering/standards/model-promotion.md), update
        // this assertion to enumerate the latest aliases it adds.
        const latestAliases = BUILTIN_MODELS
            .filter(model => model.id.includes('latest') || model.alias.includes('latest'))
            .map(model => model.alias);
        expect(latestAliases).toEqual([]);
    });

    it('does not carry forward legacy reasoning-depth comparator copy', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('resolveReasoningDepthComparator')).toBe(false);
        expect(source.includes('Reasoning depth')).toBe(false);
        expect(source.includes('GPT-5.4 < GPT-5.4 Pro')).toBe(false);
    });

    it('does not carry forward legacy context-window comparison copy', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('OPENAI_CONTEXT_WINDOW = 1_050_000')).toBe(false);
        expect(source.includes('GOOGLE_CONTEXT_WINDOW = 1_048_576')).toBe(false);
        expect(source.includes('Context compare · OpenAI')).toBe(false);
    });

    it('does not render inquiry advisory UI in AI Strategy settings', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('presentInquiryAdvisory')).toBe(false);
        expect(source.includes('renderInquiryAdvisoryReasonLine')).toBe(false);
        expect(source.includes('renderInquiryAdvisoryExampleLines')).toBe(false);
        expect(source.includes('Inquiry Advisor')).toBe(false);
        expect(source.includes('Suggested engine ·')).toBe(false);
        expect(source.includes('Current engine:')).toBe(false);
        expect(source.includes('Corpus estimate:')).toBe(false);
        expect(source.includes('Snapshot captured:')).toBe(false);
    });

    it('removes inquiry advisory handoff plumbing from settings rendering', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('renderInquiryAdvisoryBanner(')).toBe(false);
        expect(source.includes('consumeInquiryAdvisoryHandoffContext')).toBe(false);
        expect(source.includes('clearInquiryAdvisoryHandoffContext')).toBe(false);
        expect(source.includes('params.addAiRelatedElement(inquiryAdvisoryFrame);')).toBe(false);
    });

    it('keeps Local LLM configuration conditional while Local status stays visible for the Local provider', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('const showLocalLlmStatusDetails = isOllama;')).toBe(true);
        expect(source.includes("const showLocalLlmConfigDetails = isOllama && getLocalLlmConfigurationMode() === 'custom';")).toBe(true);
        expect(source.includes("localLlmConfigSectionEl.toggleClass('ert-settings-hidden', !showLocalLlmConfigDetails);")).toBe(true);
        expect(source.includes("localLlmStatusSectionEl.toggleClass('ert-settings-hidden', !showLocalLlmStatusDetails);")).toBe(true);
        expect(source.includes("largeHandlingSection.toggleClass('ert-settings-hidden', isOllama);")).toBe(true);
    });

    it('uses medium dropdown sizing for all AI Strategy controls', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('providerDropdown = dropdown;')).toBe(true);
        expect(source.includes('modelOverrideDropdown = dropdown;')).toBe(true);
        expect(source.includes('accessTierDropdown = dropdown;')).toBe(true);
        expect(source.includes("dropdown.selectEl.addClass('ert-input', 'ert-input--md', 'ert-ai-strategy-select');")).toBe(true);
    });

    it('curates OpenAI model picker to canonical public aliases', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('getPickerModelsForProvider')).toBe(true);
        expect(source.includes("selectLatestModelByReleaseChannel(BUILTIN_MODELS, 'openai', 'stable')")).toBe(true);
        expect(source.includes('formatOpenAiInternalPinnedLabel')).toBe(true);
        expect(source.includes("addOption('gpt-5.5'")).toBe(false);
        expect(source.includes("addOption('gpt-5.5'")).toBe(false);
    });

    it('renders cloud transparency sections while hiding them for the Local provider path', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("setName(t('settings.ai.largeHandling.name'))")).toBe(true);
        expect(source.includes('Fresh estimate*')).toBe(true);
        expect(source.includes('Cached estimate**')).toBe(true);
        expect(source.includes('* Based on published provider pricing. Actual charges may differ due to caching, credits, or account-level adjustments.')).toBe(true);
        expect(source.includes("createSpan({ text: 'See provider pricing: ' })")).toBe(true);
        expect(source.includes("appendText(' runs on your machine with no API charges.')")).toBe(true);
        expect(source.includes("createEl('strong', { text: '** Gemini cache note: ' })")).toBe(true);
        expect(source.includes('explicit cache may add storage fees for cached corpus tokens during the active cache window')).toBe(true);
        expect(source.includes('Gemini cache windows default to 15m')).toBe(true);
        expect(source.includes('cache usually only pays off when you run another question before the window expires')).toBe(true);
        expect(source.includes('https://openai.com/api/pricing/')).toBe(true);
        expect(source.includes('https://platform.claude.com/docs/en/about-claude/pricing')).toBe(true);
        expect(source.includes('https://ai.google.dev/gemini-api/docs/pricing')).toBe(true);
        expect(source.includes('Google Gemini')).toBe(false);
        expect(source.includes("t('settings.ai.localLlm.configTitle')")).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.statusTitle')")).toBe(true);
        expect(source.includes("rowEl.addClass('ert-ai-models-row--active')")).toBe(true);
        expect(source.includes('setActiveCostComparisonRow(provider, displayModel.id)')).toBe(true);
        expect(source.includes('return cloudModels;')).toBe(true);
        expect(source.includes('return cloudModels.concat')).toBe(false);
        expect(source.includes("freshText: 'Local compute'")).toBe(false);
        expect(source.includes("cachedText: 'Local compute'")).toBe(false);
        expect(source.includes('Request composition')).toBe(false);
        expect(source.includes("createEl('details', { cls: 'ert-ai-fold ert-ai-large-handling' }")).toBe(false);
        expect(source.includes('attachAiCollapseButton(largeHandling')).toBe(false);
        expect(source.includes('ert-ai-capacity-grid')).toBe(true);
        expect(source.includes('Expected Passes')).toBe(true);
        // 'Estimated provider input' moved into the pure panel view-model.
        const panelEstimateSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/aiPanelEstimate.ts'), 'utf8');
        expect(panelEstimateSource.includes('Estimated provider input')).toBe(true);
        expect(source.includes("largeHandlingSection.toggleClass('ert-settings-hidden', isOllama);")).toBe(true);
    });

    it('clarifies that Pulse context only affects hover reveal', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("t('settings.ai.config.pulseContextDesc')")).toBe(true);
    });

    it('renders structured Inquiry and Gossamer request composition strings', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        const panelSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/aiPanelEstimate.ts'), 'utf8');
        // Section titles now live in the pure view-model builder.
        expect(panelSource.includes("title: 'Corpus'")).toBe(true);
        expect(panelSource.includes("title: 'Transform'")).toBe(true);
        expect(panelSource.includes("title: 'Prompt'")).toBe(true);
        expect(panelSource.includes("title: 'Output'")).toBe(true);
        expect(panelSource.includes("title: 'Processing'")).toBe(true);
        // Row labels live in the pure module.
        expect(panelSource.includes('Editorial analysis instructions')).toBe(true);
        expect(panelSource.includes('Strict JSON structure')).toBe(true);
        expect(panelSource.includes('AI role template (author-defined)')).toBe(true);
        expect(panelSource.includes('Beat overlay (ordered sequence)')).toBe(true);
        expect(panelSource.includes('Beat scoring instructions')).toBe(true);
        expect(panelSource.includes('Per-beat scores')).toBe(true);
        // 'Scenes (' literal moved into aiSettingsPreview.ts (legacy formatter).
        const previewSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/aiSettingsPreview.ts'), 'utf8');
        expect(previewSource.includes('Scenes (')).toBe(true);
        // AiSection.ts now wires the typed view-model through the renderer
        // and uses the typed providerCount estimate (not raw ExecutionTokens).
        expect(source.includes('buildPanelViewModel')).toBe(true);
        expect(source.includes('renderPanelViewModelHeader')).toBe(true);
        expect(source.includes('renderPanelViewModelSections')).toBe(true);
        expect(source.includes('providerCount: forecasts.inquiry.providerCount')).toBe(true);
        expect(source.includes('providerCount: forecasts.gossamer.providerCount')).toBe(true);
        // Legacy false-zero / em-dash / duplicate-header behaviors are gone.
        expect(source.includes('buildInquiryCapacitySections')).toBe(false);
        expect(source.includes('buildGossamerCapacitySections')).toBe(false);
        expect(source.includes('Cleaned manuscript ·')).toBe(false);
        // Legacy local closure `formatExpectedPasses(...)` is gone (passes
        // disclosure now flows through the typed view-model). The pure
        // helper `formatExpectedPassesLabel` is allowed and intentionally
        // imported from aiPanelEstimate.
        expect(source.includes('formatExpectedPasses(')).toBe(false);
        expect(source.includes('formatExpectedPassesLabel')).toBe(true);
        // Other legacy negatives we still want to enforce.
        expect(source.includes('Multi-pass (if required)')).toBe(false);
        expect(source.includes('Fixed result fields')).toBe(false);
        expect(source.includes('Strict JSON shape')).toBe(false);
        expect(source.includes('Full manuscript (Scene bodies)')).toBe(false);
        expect(source.includes('Book ·')).toBe(false);
        expect(source.includes('response_format')).toBe(false);
        expect(source.includes('tool_choice')).toBe(false);
        expect(source.includes('providerRouter')).toBe(false);
        expect(source.includes('document blocks')).toBe(false);
        expect(source.includes('buildDisplayCorpusEstimateFromManifestEntries(currentCorpus.manifestEntries)')).toBe(false);
        expect(source.includes('sceneCount: currentCorpus?.corpus.sceneCount ?? 0')).toBe(true);
        expect(source.includes('resolveActiveRoleTemplate')).toBe(true);
        expect(source.includes('buildOutputRulesText')).toBe(true);
    });

    it('renders provider key status states without saved-not-tested phrasing', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("t('settings.ai.credential.statusReady')")).toBe(true);
        expect(source.includes("t('settings.ai.credential.statusNotConfigured')")).toBe(true);
        expect(source.includes("t('settings.ai.credential.statusRejected')")).toBe(true);
        expect(source.includes("t('settings.ai.credential.statusNetworkBlocked')")).toBe(true);
        expect(source.includes("t('settings.ai.credential.replaceKeyButton')")).toBe(true);
        expect(source.includes("t('settings.ai.credential.copyKeyNameButton')")).toBe(true);
        expect(source.includes('Saved (not tested)')).toBe(false);
    });

    it('keeps the active cost row in sync with provider credential state changes', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('const refreshActiveCostComparisonRowState = (provider: AIProviderId, credentialState: string | null): void => {')).toBe(true);
        expect(source.includes('if (!activeCostComparisonRowKey?.startsWith(`${provider}::`)) return;')).toBe(true);
        expect(source.includes('refreshActiveCostComparisonRowState(options.provider, next);')).toBe(true);
    });

    it('notifies open Inquiry views when a saved provider key changes', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('const stored = await setSecret(app, secretId, value);')).toBe(true);
        expect(source.includes('plugin.getInquiryService().notifyAiSettingsChanged();')).toBe(true);
    });

    it('uses configured cache-window settings for context-run labels instead of hardcoded provider defaults', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        const cacheWindowSource = readFileSync(resolve(process.cwd(), 'src/ai/settings/cacheWindows.ts'), 'utf8');
        expect(source.includes("import { formatProviderCacheWindowLabel } from '../../ai/settings/cacheWindows';")).toBe(true);
        expect(source.includes('formatProviderCacheWindowLabel(provider, ensureCanonicalAiSettings())')).toBe(true);
        expect(cacheWindowSource.includes('export function formatProviderCacheWindowLabel')).toBe(true);
        expect(cacheWindowSource.includes('normalizeGeminiCacheTtlSeconds(windows.googleTtlSeconds)')).toBe(true);
        expect(source.includes("'Fresh estimate*', 'Cached estimate**'")).toBe(true);
    });

    it('shows pending Inquiry corpus estimates as estimating instead of a real zero-token request', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('const requestText = currentCorpus.requestTokens > 0')).toBe(true);
        expect(source.includes("`Full Request: Estimating...${citationsSuffix}`")).toBe(true);
        expect(source.includes('const corpusText = currentCorpus.corpus.estimatedTokens > 0')).toBe(true);
        expect(source.includes("'Corpus: Estimating...'")).toBe(true);
        expect(source.includes('sizeText: requestText')).toBe(true);
        // Distinct "unavailable" branch protects against the stall bug
        // where provider count failure (e.g. Gemini countTokens throws)
        // left the Cost Estimate header on "Estimating..." forever. We
        // surface failure honestly instead.
        expect(source.includes("currentCorpus.requestEstimateMethod === 'unavailable'")).toBe(true);
        expect(source.includes("`Full Request: unavailable — provider token count failed${citationsSuffix}`")).toBe(true);
    });

    it('cost comparison rows route through the canonical TokenEstimate contract (no false-zero cost fabrication)', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        // Pin: cost rows convert raw method+tokens to a typed TokenEstimate
        // BEFORE doing any cost math. This prevents the original bug
        // (Gemini countTokens fails → tokens = 0 → cost rounds to fake
        // "$0.01" via the pricing math).
        expect(source.includes("tokenEstimateFromMethod(\n                executionEstimate.method")).toBe(true);
        // Pin: when the input estimate is unavailable/pending, the row
        // refuses to compute and renders "Unavailable" instead of a fake
        // dollar value.
        expect(source.includes("if (inputEstimate.source === 'unavailable' || inputEstimate.source === 'pending')")).toBe(true);
        // Pin: the cost label discloses when the input came from a local
        // chars/4 heuristic rather than the authoritative provider count.
        expect(source.includes("inputProvenanceSuffix")).toBe(true);
        // Pin: the canonical contract is imported from src/ai/estimates,
        // not re-implemented per surface.
        expect(source.includes("from '../../ai/estimates'")).toBe(true);
        // Pin: the local methodToPanelEstimate wrapper now delegates to
        // the shared converter (no per-surface mapping divergence).
        expect(source.includes('return tokenEstimateFromMethod(method, tokens);')).toBe(true);
    });

    it('renders OpenAI quota failures as quota exceeded in the preview card', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        // formatPreviewReasonLabel quota branch moved into aiSettingsPreview.ts.
        const previewSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/aiSettingsPreview.ts'), 'utf8');
        expect(previewSource.includes("if (reason === 'quota_exceeded') return 'Quota exceeded';")).toBe(true);
        expect(source.includes("const quotaFailure = latestSession.result.aiReason === 'quota_exceeded';")).toBe(true);
        expect(source.includes('Latest ${latestScopeLabel} Inquiry run failed because API quota was exceeded.')).toBe(true);
    });

    it('lets observed provider cache hits override static cache-off preview copy', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        // When an observed cache hit exists (cacheRatio > 0), the static
        // "Cache off" base pill is dropped before merge so it cannot
        // contradict the realized hit.
        expect(source.includes("typeof certificate.cacheRatio === 'number' && certificate.cacheRatio > 0")).toBe(true);
        expect(source.includes("basePreviewPills.filter(pill => !/^Cache off\\b/i.test(pill.text))")).toBe(true);
        // The warm/armed branches flag cacheArmed; the assembler turns that
        // into the single "Cache armed" pill (vs "Provider cache supported").
        expect(source.includes('cacheArmed: true')).toBe(true);
    });

    it('orders preview pills author-first: cost, single cache pill, then context/pass last', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        // Cost is what the author cares about most → first.
        expect(source.includes('const costPill = previewPills.find(isCostPill)')).toBe(true);
        // Exactly one cache pill, labelled by prior-run state.
        expect(source.includes("certificate.cacheArmed ? 'Cache armed' : CACHE_ARMED_PILL_TEXT")).toBe(true);
        // Single/multi-pass context pill goes last.
        expect(source.includes('const orderedPills = [costPill, cachePill, ...otherPills, passPill]')).toBe(true);
    });

    it('surfaces provider usage cost in the AI model preview when exact usage pricing is available', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('estimateUsageCost(context.provider, context.modelId, latestSession.result.tokenUsage, latestSession.providerCacheStatus)')).toBe(true);
        expect(source.includes('text: `Last run cost · ${formatExactUsdCost(latestUsageCost)}`')).toBe(true);
        expect(source.includes('extraPills')).toBe(true);
    });

    it('does not substitute same-engine cache sessions when the current fingerprint is not active', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('const cacheSession = activeCacheSession;')).toBe(true);
        expect(source.includes('fallbackCacheSession')).toBe(false);
        expect(source.includes("cachedText: 'Output sample needed'")).toBe(true);
        expect(source.includes("'No active cache'")).toBe(true);
    });

    it('distinguishes static cache capability from an expired cache window in the preview card', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        // CACHE_ARMED_PILL_TEXT + mergePreviewCachePills body moved into aiSettingsPreview.ts.
        const previewSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/aiSettingsPreview.ts'), 'utf8');
        // DOCTRINE: capability pill must not promise a realized benefit.
        expect(previewSource.includes("export const CACHE_ARMED_PILL_TEXT = 'Provider cache supported';")).toBe(true);
        expect(source.includes('Cache armed — second run benefits')).toBe(false);
        expect(previewSource.includes('Cache armed — second run benefits')).toBe(false);
        expect(source.includes("text: CACHE_ARMED_PILL_TEXT")).toBe(true);
        expect(source.includes("text: 'Cache window expired'")).toBe(true);
        expect(previewSource.includes('export const mergePreviewCachePills = (pills: PreviewPill[]): PreviewPill[] => {')).toBe(true);
        expect(previewSource.includes("cacheSegments.push('window expired');")).toBe(true);
        expect(previewSource.includes("const mergedText = [baseText, ...cacheSegments].join(' — ');")).toBe(true);
        expect(source.includes('mergePreviewCachePills((')).toBe(true);
    });

    it('routes disabled provider citations through the operational resolver so Gemini cache is not locked off', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        const capsSource = readFileSync(resolve(process.cwd(), 'src/ai/caps/computeCaps.ts'), 'utf8');
        const settingsSource = readFileSync(resolve(process.cwd(), 'src/ai/settings/aiSettings.ts'), 'utf8');
        const validateSource = readFileSync(resolve(process.cwd(), 'src/ai/settings/validateAiSettings.ts'), 'utf8');
        expect(source.includes('import { resolveCitationsEnabled }')).toBe(true);
        expect(source.includes('const citationsOn = resolveCitationsEnabled(')).toBe(true);
        expect(source.includes('citationsEnabled: resolveCitationsEnabled(')).toBe(true);
        expect(capsSource.includes('export function resolveCitationsEnabled(')).toBe(true);
        expect(settingsSource.includes('citationsEnabled: false')).toBe(true);
        expect(validateSource.includes('forcing cache-compatible citation setting off')).toBe(true);
    });

    it('uses Local LLM as the provider label and keeps backend names inside the Local LLM section only', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        // The option label now flows through providerOptionBaseLabels so the
        // credential-state suffix ("(No key)" / "(Not connected)") can be
        // appended without losing the i18n base string.
        expect(source.includes("dropdown.addOption('ollama', providerOptionBaseLabels.ollama)")).toBe(true);
        expect(source.includes("addOption('ollama', t('settings.ai.localLlmConfig.optionOllama'))")).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.configTitle')")).toBe(true);
        expect(source.includes("setName(t('settings.ai.localLlm.serverName'))")).toBe(true);
        expect(source.includes("ollama: t('settings.ai.provider.optionLocalLlm')")).toBe(true);
        expect(source.includes('Ollama API key')).toBe(false);
        expect(source.includes('Advanced: Ollama saved key (optional)')).toBe(false);
        expect(source.includes('Ollama saved key name')).toBe(false);
        expect(source.includes('Ollama key status')).toBe(false);
        expect(source.includes('Local API key')).toBe(false);
        expect(source.includes('ert-provider-local')).toBe(false);
        expect(source.includes('ert-provider-gemini')).toBe(false);
        expect(source.includes('Advisory Note')).toBe(false);
        expect(source.includes('ert-ollama-advisory')).toBe(false);
        expect(source.includes('Custom instructions')).toBe(false);
    });

    it('shows Local LLM model loading and persistent validation messaging in the primary flow', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("t('settings.ai.localLlm.loadServersButton')")).toBe(false);
        expect(source.includes("t('settings.ai.localLlm.loadModelsButton')")).toBe(false);
        expect(source.includes("t('settings.ai.localLlm.loadModelsTooltip')")).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.validateButton')")).toBe(true);
        expect(source.includes('Troubleshooting')).toBe(false);
        expect(source.includes("t('settings.ai.localLlm.actionsName')")).toBe(true);
        expect(source.includes('detectLocalLlmServers')).toBe(true);
        expect(source.includes("const localLlmServerSetting = new Settings(localLlmStatusSection)")).toBe(true);
        expect(source.includes("setName(t('settings.ai.localLlm.serverName'))")).toBe(true);
        expect(source.includes('shouldRevealLocalLlmActionRow')).toBe(true);
        expect(source.includes('All checks passed — connection · model availability · basic · structured · repair.')).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.legendNotUsable')")).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.legendLimited')")).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.legendStrong')")).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.legendInquiryEligible')")).toBe(true);
        expect(source.includes('getLocalStrategyModelOptions')).toBe(true);
        expect(source.includes("appendStatusItem(localLlmStatusCapabilityCol, 'Capability', selectedModelId")).toBe(true);
        expect(source.includes(' — ${buildLocalFeatureSummary(selectedCapability)}')).toBe(true);
        expect(source.includes('Likely fit for Radial Timeline tasks.')).toBe(false);
        expect(source.includes('const allChecksPassed = modelReady')).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.statusDesc')")).toBe(true);
        expect(source.includes('Summary —')).toBe(true);
        expect(source.includes('Inquiry —')).toBe(true);
        expect(source.includes('buildLocalCapabilityTooltip')).toBe(true);
        expect(source.includes('buildLocalFeatureSummary')).toBe(true);
        expect(source.includes('ert-ai-local-model-pill--tier')).toBe(true);
        expect(source.includes("pill.createSpan({ cls: 'ert-ai-local-model-pill-active', text: t('settings.ai.localLlm.modelActive') })")).toBe(true);
        expect(source.includes('if (localLlmModelText) localLlmModelText.setValue(value);')).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.modelsLoading')")).toBe(true);
        expect(source.includes('Selected model is missing from the loaded list.')).toBe(true);
        expect(source.includes('No healthy local servers were detected automatically.')).toBe(true);
        expect(source.includes('No Local Server Detected')).toBe(true);
        expect(source.includes('Checking Local Server...')).toBe(true);
        expect(source.includes('No local server detected')).toBe(true);
        expect(source.includes("t('settings.ai.localLlm.noModelsAuto')")).toBe(true);
        expect(source.includes("['Connection', localLlmValidationReport?.reachable ?? null]")).toBe(true);
        expect(source.includes("['Model availability', localLlmValidationReport?.modelAvailable ?? null]")).toBe(true);
        expect(source.includes("['Basic validation', localLlmValidationReport?.basicCompletion ?? null]")).toBe(true);
        expect(source.includes("['Structured validation', localLlmValidationReport?.structuredJson ?? null]")).toBe(true);
        expect(source.includes("['Repair validation', localLlmValidationReport?.repairPath ?? null]")).toBe(true);
        expect(source.includes("const localLlmStatusGrid = localLlmStatusSection.createDiv({ cls: 'ert-ai-local-llm-status-grid' });")).toBe(true);
        expect(source.includes('const buildLocalStatusValue = (): string => {')).toBe(true);
        expect(source.includes('const buildLocalCheckValue = (')).toBe(true);
        expect(source.includes('const formatLocalLlmUiError = (message: string | null | undefined): string => {')).toBe(true);
        expect(source.includes("const appendStatusItem = (container: HTMLElement, label: string, value: string): void => {")).toBe(true);
        expect(source.includes("appendStatusItem(localLlmStatusSummaryCol, 'Status', statusStamp ? `${statusValue} · ${statusStamp}` : statusValue);")).toBe(true);
        expect(source.includes("'Connected & validated'")).toBe(true);
        expect(source.includes("'Waiting for a local server.'")).toBe(true);
    });

    it('auto-runs guarded Local LLM checks when Local LLM is selected or reconfigured', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('queueLocalLlmAutoValidation();')).toBe(true);
        expect(source.includes('markLocalLlmConfigurationDirty();')).toBe(true);
        expect(source.includes('getLocalLlmUiOverrides()')).toBe(true);
        expect(source.includes('Math.max(4000, Math.min(getLocalLlmSettings(ensureCanonicalAiSettings()).timeoutMs, 10000))')).toBe(true);
    });

    // Every one of the three Local LLM operations keeps a module-level promise as a
    // re-entrancy guard (`if (xPromise) return xPromise`). A promise that never
    // settles therefore wedges that operation for the life of the settings tab, and
    // the busy UI reads the detection/model-load flags -- not the validation one --
    // so bounding only the validation chain left the spinner running forever.
    it('bounds all three Local LLM guarded operations so none can wedge the panel', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes('localLlmServerDetectionPromise = withTimeout(')).toBe(true);
        expect(source.includes('localLlmModelLoadPromise = withTimeout(')).toBe(true);
        expect(source.includes('localLlmValidationReport = await withTimeout(')).toBe(true);
        // Each bounded chain must also clear its guard, or the ceiling buys nothing.
        expect(source.includes('localLlmServerDetectionPromise = null;')).toBe(true);
        expect(source.includes('localLlmModelLoadPromise = null;')).toBe(true);
        expect(source.includes('localLlmValidationPromise = null;')).toBe(true);
    });

    it('uses the AI Strategy model dropdown as the active Local LLM model selector', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("modelOverrideDropdown.addOption('—', '—');")).toBe(false);
        expect(source.includes("modelOverrideDropdown.setValue('—');")).toBe(false);
        expect(source.includes("modelOverrideDropdown.selectEl.disabled = true;")).toBe(false);
        expect(source.includes('setOllamaModelId(value);')).toBe(true);
        expect(source.includes("t('settings.ai.localLlmConfig.manualModelName')")).toBe(true);
        expect(source.includes("t('settings.ai.localLlmConfig.manualModelDesc')")).toBe(true);
    });

    it('repurposes the third Local LLM strategy card into Auto vs Custom setup mode', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("accessTierDropdown.addOption('auto', 'Auto');")).toBe(true);
        expect(source.includes("accessTierDropdown.addOption('custom', 'Custom');")).toBe(true);
        expect(source.includes("accessTierName.textContent = isOllama ? 'Setup' : 'Access';")).toBe(true);
        expect(source.includes('Use Auto for standard Local LLM setup. Switch to Custom only when you need to override backend or transport settings.')).toBe(true);
        expect(source.includes('shouldRevealLocalLlmTransportSettings')).toBe(true);
    });

    it('removes the local write bypass toggle from the AI settings UI', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes(".setName('Bypass scene hover writes')")).toBe(false);
        expect(source.includes('sendPulseToAiReport')).toBe(false);
        expect(source.includes("'ert-ai-local-llm-warning-label'")).toBe(false);
    });
});
