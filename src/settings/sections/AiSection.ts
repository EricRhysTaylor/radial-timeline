import { Setting as Settings, Notice, DropdownComponent, TFile, setIcon, setTooltip } from 'obsidian';
import type { App, TextComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { fetchAnthropicModels } from '../../api/anthropicApi';
import { fetchOpenAiModels } from '../../api/openaiApi';
import { fetchGeminiModels as fetchGoogleModels } from '../../api/geminiApi';
import { AiContextModal } from '../AiContextModal';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { ERT_CLASSES } from '../../ui/classes';
import { IMPACT_FULL } from '../SettingImpact';
import { ANTHROPIC_REQUESTED_CACHE_TTL, buildDefaultAiSettings, DECLARABLE_LOCAL_CAPABILITIES } from '../../ai/settings/aiSettings';
import { formatProviderCacheWindowLabel } from '../../ai/settings/cacheWindows';
import { formatGossamerCacheClock, formatGossamerCacheCostHint } from '../../gossamer/cacheWindow';
import { validateAiSettings } from '../../ai/settings/validateAiSettings';
import { BUILTIN_MODELS } from '../../ai/registry/builtinModels';
import { getPickerModelsForProvider, PROVIDER_DISPLAY_LABELS, selectLatestModelByReleaseChannel } from '../../ai/registry/releaseChannels';
import { resolveCitationsEnabled } from '../../ai/caps/computeCaps';
import { getModelUiSignals } from '../../ai/caps/engineCapabilities';
import { getAIClient } from '../../ai/runtime/aiClient';
import { getLocalLlmClient } from '../../ai/localLlm/client';
import {
    getCredential,
    getCredentialSecretId,
    migrateLegacyKeysToSecretStorage,
    needsLegacyKeyMigration,
    setCredentialSecretId
} from '../../ai/credentials/credentials';
import { hasSecret, isSecretStorageAvailable, setSecret } from '../../ai/credentials/secretStorage';
import type { AccessTier, AIProviderId, Capability, LocalLlmConfigurationMode, LocalLlmSettings, ModelInfo, RTCorpusTokenBreakdown } from '../../ai/types';
import {
    getLocalLlmDiagnosticTimeoutMs,
    type LocalLlmDiagnosticsReport
} from '../../ai/localLlm/diagnostics';
import {
    buildCanonicalExecutionEstimate,
    estimateGossamerTokens
} from '../../ai/forecast/estimateTokensFromVault';
import {
    estimateCorpusCost,
    estimateUsageCost,
    formatExactUsdCost,
    formatUsdCost
} from '../../ai/cost/estimateCorpusCost';
import { getActivePricingMeta, getActivePromos, getPricingFreshnessLabel, getActivePricingTable } from '../../ai/cost/providerPricing';
import { buildOutputRulesText } from '../../ai/prompts/outputRules';
import { buildUnifiedBeatAnalysisPromptParts, getUnifiedBeatAnalysisJsonSchema } from '../../ai/prompts/unifiedBeatAnalysis';
import { resolveActiveRoleTemplate } from '../../ai/roleTemplate';
import { INQUIRY_CANONICAL_ESTIMATE_QUESTION } from '../../inquiry/constants';
import { buildInquiryJsonSchema } from '../../inquiry/jsonSchema';
import type { CorpusManifestEntry } from '../../inquiry/runner/types';
import { buildInquiryPromptParts, INQUIRY_ROLE_TEMPLATE_GUARDRAIL } from '../../inquiry/promptScaffold';
import { extractSummary, getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { cleanEvidenceBody } from '../../inquiry/utils/evidenceCleaning';
import { getSortedSceneFiles } from '../../utils/manuscript';
import { InquirySessionStore } from '../../inquiry/InquirySessionStore';
import { t } from '../../i18n';
import { extractBeatOrder } from '../../utils/gossamer';
import { resolveSelectedBeatModelFromSettings } from '../../utils/beatSystemState';
import { getSynopsisGenerationWordLimit, getSynopsisHoverLineLimit } from '../../utils/synopsisLimits';
import { getResolvedModelId } from '../../utils/modelResolver';
import {
    buildLocalLlmModelIdentity,
    buildLocalLlmServerKey,
    getLocalLlmSettings,
    LOCAL_LLM_BACKEND_LABELS,
    LOCAL_LLM_CAPABILITY_LABEL_KEYS,
    LOCAL_LLM_JSON_MODE_LABEL_KEYS,
    withDeclaredCapabilitiesForActiveModel,
    normalizeLocalLlmServerBaseUrl
} from '../../ai/localLlm/settings';
import { inferLocalLlmCapability } from '../../ai/localLlm/capabilityInference';
import type { LocalLlmCapabilityAssessment, LocalLlmFeatureSupport } from '../../ai/localLlm/capabilityInference';
import type { LocalLlmModelEntry } from '../../ai/localLlm/transport';
import { withTimeout } from '../../ai/localLlm/transport';
import type { LocalLlmBackendId, LocalLlmJsonMode } from '../../ai/types';
import {
    CACHE_ARMED_PILL_TEXT,
    estimateTokensFromChars,
    formatCorpusStructureSummary,
    formatCorpusTokenSummary,
    formatPreviewCacheObservedLabel,
    formatPreviewCacheRemaining,
    formatPreviewReasonLabel,
    mergePreviewCachePills,
    resolvePreviewSignals
} from './aiSettingsPreview';
import type { PreviewPill } from './aiSettingsPreview';
import {
    buildPanelViewModel,
    formatExpectedPassesLabel,
    formatProviderInputSummary,
    formatTokenRowText,
    formatTotalRowText,
    type FeatureForecastInput,
    type PanelTokenEstimate,
    type PanelViewModel
} from './aiPanelEstimate';
import { tokenEstimateFromMethod, formatTokenHeadline } from '../../ai/estimates';

type Provider = 'anthropic' | 'google' | 'openai' | 'ollama';
type CapacityItem = string | { text: string; dividerBefore?: boolean; extraCls?: string };
type PromptRequestBreakdown = {
    requestTokens: number | null;
    roleTemplateTokens: number | null;
    instructionTokens: number | null;
    outputContractTokens: number | null;
    transformTokens: number | null;
};
type DetectedLocalServer = {
    serverKey: string;
    label: string;
    backend: LocalLlmBackendId;
    baseUrl: string;
    models: LocalLlmModelEntry[];
    detectedAt: string;
};

export type AiSectionLifecycle = {
    dispose: () => void;
};

export function renderAiSection(params: {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    addAiRelatedElement: (el: HTMLElement) => void;
    toggleAiSettingsVisibility: (show: boolean) => void;
    refreshProviderDimming: () => void;
    scheduleKeyValidation: (provider: Provider) => void;
    setProviderSections: (sections: { anthropic?: HTMLElement; google?: HTMLElement; openai?: HTMLElement; ollama?: HTMLElement }) => void;
    setKeyInputRef: (provider: Provider, input: HTMLInputElement | undefined) => void;
    setOllamaConnectionInputs: (refs: { baseInput?: HTMLInputElement; modelInput?: HTMLInputElement }) => void;
    isAiTabActive: () => boolean;
    setAiTabActivationHandler: (handler: () => void) => void;
}): AiSectionLifecycle {
    const { app, plugin, containerEl } = params;
    containerEl.classList.add(ERT_CLASSES.STACK);

    const getResolvedRoleTemplate = () => resolveActiveRoleTemplate(
        plugin,
        validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings()).value
    );
    const getActiveTemplateName = (): string => getResolvedRoleTemplate().name;
    const getActiveTemplatePrompt = (): string => getResolvedRoleTemplate().prompt.trim();
    const splitLeadSentence = (text: string): { lead: string; remainder: string } => {
        const trimmed = text.trim();
        if (!trimmed) return { lead: '', remainder: '' };
        const punctuationIndex = trimmed.search(/[.!?](\s|$)/);
        if (punctuationIndex === -1) return { lead: trimmed, remainder: '' };
        const lead = trimmed.slice(0, punctuationIndex + 1).trim();
        const remainder = trimmed.slice(punctuationIndex + 1).trim();
        return { lead, remainder };
    };

    const aiHero = containerEl.createDiv({
        cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.CARD_HERO} ${ERT_CLASSES.STACK} ert-ai-hero-card`
    });
    const heroBadgeRow = aiHero.createDiv({ cls: 'ert-ai-hero-badge-row' });
    const badge = heroBadgeRow.createSpan({ cls: ERT_CLASSES.BADGE_PILL });
    const badgeIcon = badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
    setIcon(badgeIcon, 'cpu');
    badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: t('settings.ai.hero.badgeText') });
    const badgeWikiLink = badge.createEl('a', {
        href: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Settings-AI',
        cls: ERT_CLASSES.BADGE_PILL_WIKI,
        attr: {
            'aria-label': t('settings.ai.hero.wikiAriaLabel'),
            'target': '_blank',
            'rel': 'noopener'
        }
    });
    setIcon(badgeWikiLink, 'external-link');

    const heroToggleWrap = heroBadgeRow.createDiv({ cls: 'ert-toggle-item ert-ai-hero-toggle' });
    const heroToggleLabel = heroToggleWrap.createSpan({ cls: 'ert-toggle-label', text: t('settings.ai.hero.toggleInactive') });
    const heroToggleInput = heroToggleWrap.createEl('input', {
        cls: 'ert-toggle-input',
        attr: { type: 'checkbox', 'aria-label': t('settings.ai.hero.toggleAriaLabel') }
    });

    const heroTitle = aiHero.createEl('h3', {
        cls: `${ERT_CLASSES.SECTION_TITLE} ert-hero-title`,
        text: t('settings.ai.hero.titleActive')
    });
    const heroOnState = aiHero.createDiv({ cls: `${ERT_CLASSES.STACK} ert-ai-hero-state-on` });
    heroOnState.createEl('p', {
        cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle`,
        text: t('settings.ai.hero.descriptionActive')
    });
    const heroOnFeatures = heroOnState.createDiv({
        cls: `${ERT_CLASSES.HERO_FEATURES} ${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}`
    });
    heroOnFeatures.createEl('h5', { text: t('settings.ai.hero.highlightsKicker'), cls: 'ert-kicker' });
    const heroOnList = heroOnFeatures.createEl('ul', { cls: ERT_CLASSES.STACK });
    [
        { icon: 'waves', text: t('settings.ai.hero.featureInquiry') },
        { icon: 'activity', text: t('settings.ai.hero.featurePulse') },
        { icon: 'waypoints', text: t('settings.ai.hero.featureGossamer') },
        { icon: 'sparkles', text: t('settings.ai.hero.featureForceMultiplier') }
    ].forEach(item => {
        const li = heroOnList.createEl('li', { cls: `${ERT_CLASSES.INLINE} ert-feature-item` });
        const icon = li.createSpan({ cls: 'ert-feature-icon' });
        setIcon(icon, item.icon);
        li.createSpan({ text: item.text });
    });

    const heroOffState = aiHero.createDiv({ cls: `${ERT_CLASSES.STACK} ert-ai-hero-state-off` });
    heroOffState.createEl('p', {
        cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle`,
        text: t('settings.ai.heroOff.descriptionPrimary')
    });
    heroOffState.createEl('p', {
        cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle`,
        text: t('settings.ai.heroOff.descriptionSecondary')
    });
    const heroOffFeatures = heroOffState.createDiv({
        cls: `${ERT_CLASSES.HERO_FEATURES} ${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}`
    });
    heroOffFeatures.createEl('h5', { text: t('settings.ai.heroOff.toolsKicker'), cls: 'ert-kicker' });
    const heroOffList = heroOffFeatures.createEl('ul', { cls: ERT_CLASSES.STACK });
    [
        t('settings.ai.heroOff.featureInquiry'),
        t('settings.ai.heroOff.featurePulse'),
        t('settings.ai.heroOff.featureGossamer'),
        t('settings.ai.heroOff.featureEnhanced')
    ].forEach(text => {
        const li = heroOffList.createEl('li', { cls: `${ERT_CLASSES.INLINE} ert-feature-item` });
        const icon = li.createSpan({ cls: 'ert-feature-icon' });
        setIcon(icon, 'x-circle');
        li.createSpan({ text });
    });
    heroOffState.createDiv({
        cls: 'ert-ai-hero-muted',
        text: t('settings.ai.heroOff.muted')
    });

    const promoBannerContainer = containerEl.createDiv({ cls: 'ert-ai-promo-banners' });
    params.addAiRelatedElement(promoBannerContainer);

    const renderPromoBanners = (): void => {
        promoBannerContainer.empty();
        const activePromos = getActivePromos();
        if (!activePromos.length) return;

        for (const promo of activePromos) {
            const modelInfo = BUILTIN_MODELS.find(m => m.provider === promo.provider && m.id === promo.modelId);
            const modelLabel = modelInfo?.label ?? promo.modelId;
            const providerLabel = promo.provider !== 'none'
                ? PROVIDER_DISPLAY_LABELS[promo.provider]
                : promo.provider;
            const isFree = promo.inputPer1M === 0 && promo.outputPer1M === 0;
            const title = isFree
                ? `${modelLabel} — free to use`
                : `${modelLabel} — ${promo.promo.label}`;
            const expiry = promo.promo.expiresAt
                ? `Until ${new Date(promo.promo.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`
                : '';
            const body = isFree
                ? `${providerLabel} — no cost for Inquiry runs. ${expiry}`
                : `${providerLabel} — promotional pricing. ${expiry}`;

            const alertEl = promoBannerContainer.createDiv({
                cls: 'ert-refactor-alert ert-refactor-alert--promo'
            });
            const contentSide = alertEl.createDiv({ cls: 'ert-refactor-alert__content' });
            const heading = contentSide.createDiv({ cls: 'ert-refactor-alert__heading' });
            const iconWrapper = heading.createDiv({ cls: 'ert-refactor-alert__icon' });
            setIcon(iconWrapper, 'gift');
            heading.createSpan({ text: title, cls: 'ert-refactor-alert__title' });
            contentSide.createDiv({ cls: 'ert-refactor-alert__description', text: body });
        }
    };

    const aiStateContent = containerEl.createDiv({ cls: ERT_CLASSES.STACK });
    params.addAiRelatedElement(aiStateContent);

    const updateAiHeroState = (enabled: boolean): void => {
        heroToggleInput.checked = enabled;
        heroToggleLabel.setText(enabled ? t('settings.ai.hero.toggleActive') : t('settings.ai.hero.toggleInactive'));
        heroToggleLabel.toggleClass('is-active', enabled);
        heroTitle.setText(enabled
            ? t('settings.ai.hero.titleActive')
            : t('settings.ai.hero.titleInactive'));
        heroOnState.toggleClass('ert-settings-hidden', !enabled);
        heroOnState.toggleClass('ert-settings-visible', enabled);
        heroOffState.toggleClass('ert-settings-hidden', enabled);
        heroOffState.toggleClass('ert-settings-visible', !enabled);
    };

    const onAiToggleChanged = async (value: boolean): Promise<void> => {
        plugin.settings.enableAiSceneAnalysis = value;
        await plugin.saveSettings();
        params.toggleAiSettingsVisibility(value);
        plugin.setInquiryVisible(value);
        plugin.onSettingChanged(IMPACT_FULL); // Tier 3: number square colors + AI pulse elements
        updateAiHeroState(value);
    };

    heroToggleInput.checked = plugin.settings.enableAiSceneAnalysis ?? true;
    plugin.registerDomEvent(heroToggleInput, 'change', () => {
        void onAiToggleChanged(heroToggleInput.checked);
    });
    updateAiHeroState(plugin.settings.enableAiSceneAnalysis ?? true);

    const aiSettingsGroup = aiStateContent.createDiv({ cls: ERT_CLASSES.STACK });
    params.addAiRelatedElement(aiSettingsGroup);

    const quickSetupSection = aiSettingsGroup.createDiv({
        cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ert-ai-section-card`
    });
    quickSetupSection.createDiv({ cls: 'ert-section-title', text: t('settings.ai.strategy.title') });
    quickSetupSection.createDiv({
        cls: 'ert-section-desc',
        text: t('settings.ai.strategy.desc')
    });
    const quickSetupGrid = quickSetupSection.createDiv({
        cls: `${ERT_CLASSES.GRID_FORM} ${ERT_CLASSES.GRID_FORM_3} ert-ai-quick-grid`
    });
    const quickSetupPreviewSection = aiSettingsGroup.createDiv({
        cls: `${ERT_CLASSES.STACK} ert-ai-preview-section`
    });
    const costEstimateSection = aiSettingsGroup.createDiv({
        cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ert-ai-section-card`
    });
    costEstimateSection.createDiv({ cls: 'ert-section-title', text: t('settings.ai.costEstimate.title') });
    costEstimateSection.createDiv({
        cls: 'ert-section-desc',
        text: t('settings.ai.costEstimate.desc')
    });
    const costEstimateCorpusSummary = costEstimateSection.createDiv({ cls: `${ERT_CLASSES.STACK_TIGHT}` });
    const costEstimateCorpusSize = costEstimateCorpusSummary.createDiv({
        cls: 'ert-section-desc',
        text: t('settings.ai.costEstimate.corpusCalculating')
    });
    const costEstimateCorpusStructure = costEstimateCorpusSummary.createDiv({
        cls: 'ert-field-note',
        text: t('settings.ai.costEstimate.corpusScanning')
    });
    const costEstimateTable = costEstimateSection.createDiv({ cls: 'ert-ai-models-table' });
    const costEstimateFreshness = costEstimateSection.createDiv({ cls: 'ert-ai-cost-freshness' });
    const costEstimateFootnote = costEstimateSection.createDiv({ cls: 'ert-ai-cost-footnote' });
    costEstimateFootnote.appendText('* Based on published provider pricing. Actual charges may differ due to caching, credits, or account-level adjustments. ');
    costEstimateFootnote.createSpan({ text: 'See provider pricing: ' });
    [
        { label: 'OpenAI', href: 'https://openai.com/api/pricing/' },
        { label: 'Anthropic', href: 'https://platform.claude.com/docs/en/about-claude/pricing' },
        { label: 'Google', href: 'https://ai.google.dev/gemini-api/docs/pricing' }
    ].forEach((link, index, list) => {
        const anchor = costEstimateFootnote.createEl('a', {
            href: link.href,
            text: link.label,
            cls: 'ert-ai-cost-link',
            attr: {
                'target': '_blank',
                'rel': 'noopener'
            }
        });
        if (index < list.length - 1) {
            anchor.after(anchor.ownerDocument.createTextNode(' · '));
        }
    });
    costEstimateFootnote.appendText('. ');
    costEstimateFootnote.createEl('strong', { text: 'Local LLM' });
    costEstimateFootnote.appendText(' runs on your machine with no API charges.');
    costEstimateFootnote.createEl('br');
    costEstimateFootnote.createEl('strong', { text: '** Gemini cache note: ' });
    costEstimateFootnote.appendText(
        'explicit cache may add storage fees for cached corpus tokens during the active cache window; Gemini cache windows default to 15m, and cache usually only pays off when you run another question before the window expires.'
    );
    costEstimateFootnote.createEl('br');
    costEstimateFootnote.appendText(
        'Estimates assume a response size learned from your past runs (or a safe default until a few runs have completed). They get more accurate the more you use Inquiry.'
    );

    const ensureCanonicalAiSettings = () => {
        if (!plugin.settings.aiSettings) {
            plugin.settings.aiSettings = validateAiSettings(buildDefaultAiSettings()).value;
        }
        const validated = validateAiSettings(plugin.settings.aiSettings);
        Object.assign(plugin.settings.aiSettings, validated.value);
        return plugin.settings.aiSettings;
    };

    const getOllamaBaseUrl = (): string => {
        const configuredBaseUrl = getLocalLlmSettings(ensureCanonicalAiSettings()).baseUrl.trim();
        return configuredBaseUrl ? configuredBaseUrl : 'http://localhost:11434/v1';
    };
    const buildLocalServerOptionLabel = (backend: LocalLlmBackendId, baseUrl: string): string => {
        const normalizedUrl = normalizeLocalLlmServerBaseUrl(baseUrl);
        try {
            const parsed = new URL(normalizedUrl);
            return `${LOCAL_LLM_BACKEND_LABELS[backend]} · ${parsed.host}`;
        } catch {
            return `${LOCAL_LLM_BACKEND_LABELS[backend]} · ${normalizedUrl}`;
        }
    };
    const getConfiguredLocalServerKey = (): string => buildLocalLlmServerKey(getLocalLlmBackendId(), getOllamaBaseUrl());

    const getOllamaModelId = (): string => {
        const aiSettings = ensureCanonicalAiSettings();
        const configured = getLocalLlmSettings(aiSettings).defaultModelId.trim();
        if (configured) return configured;
        if (aiSettings.modelPolicy.type === 'pinned') {
            const pinnedAlias = aiSettings.modelPolicy.pinnedAlias;
            const pinned = BUILTIN_MODELS.find(model =>
                model.provider === 'ollama' && model.alias === pinnedAlias
            );
            if (pinned?.id) return pinned.id;
        }
        const stableModel = BUILTIN_MODELS.find(model => model.provider === 'ollama' && model.status === 'stable')?.id;
        return stableModel ? stableModel : 'llama3';
    };

    const setOllamaModelId = (modelId: string): void => {
        const aiSettings = ensureCanonicalAiSettings();
        const normalized = modelId.trim();
        aiSettings.localLlm = {
            ...getLocalLlmSettings(aiSettings),
            defaultModelId: normalized || getLocalLlmSettings(aiSettings).defaultModelId
        };
        const model = BUILTIN_MODELS.find(entry =>
            entry.provider === 'ollama' && (entry.id === normalized || entry.alias === normalized)
        );
        aiSettings.modelPolicy = model
            ? { type: 'pinned', pinnedAlias: model.alias }
            : { type: 'latestStable' };
    };
    const setLocalServerSelection = (backend: LocalLlmBackendId, baseUrl: string): void => {
        const aiSettings = ensureCanonicalAiSettings();
        aiSettings.localLlm = {
            ...getLocalLlmSettings(aiSettings),
            backend,
            baseUrl: normalizeLocalLlmServerBaseUrl(baseUrl)
        };
    };

    const getLocalLlmBackendId = (): LocalLlmBackendId => getLocalLlmSettings(ensureCanonicalAiSettings()).backend;
    const getLocalLlmConfigurationMode = (): LocalLlmConfigurationMode => getLocalLlmSettings(ensureCanonicalAiSettings()).configurationMode;
    const getLocalLlmUiTimeoutMs = (): number => (
        Math.max(4000, Math.min(getLocalLlmSettings(ensureCanonicalAiSettings()).timeoutMs, 10000))
    );
    const getLocalLlmValidationDeadlineMs = (): number => {
        const configured = getLocalLlmSettings(ensureCanonicalAiSettings()).timeoutMs;
        // Detect, load, and the diagnostics availability probe are each cheap but
        // separately bounded by the UI timeout. Diagnostics then performs one
        // generation with its cold-start allowance. The overall ceiling must be
        // larger than that complete sequential budget or it can abandon a healthy
        // in-flight generation.
        return getLocalLlmDiagnosticTimeoutMs(configured) + (3 * getLocalLlmUiTimeoutMs()) + 5_000;
    };
    const getLocalLlmUiOverrides = (): Partial<LocalLlmSettings> => ({
        timeoutMs: getLocalLlmUiTimeoutMs()
    });
    // LM Studio / MLX serve the model id as a full filesystem path
    // (…/Qwen3-30B-A3B-Instruct-2507-MLX-4bit). Show just the leaf name in the UI;
    // the full id is still the stored value used for API calls.
    const abbreviateLocalModelId = (id: string): string => {
        const trimmed = (id || '').trim(); // SAFE: an empty model id is the "nothing selected" state the caller checks for
        if (!trimmed) return trimmed;
        return trimmed.split(/[\\/]/).pop() || trimmed;
    };

    const getLocalStrategyModelOptions = (): Array<{ value: string; label: string }> => {
        const selectedModelId = getOllamaModelId().trim();
        const values = new Set<string>();
        const options: Array<{ value: string; label: string }> = [];

        localLlmLoadedModels.forEach(model => {
            const normalizedId = model.id.trim();
            if (!normalizedId || values.has(normalizedId)) return;
            values.add(normalizedId);
            options.push({ value: normalizedId, label: abbreviateLocalModelId(normalizedId) });
        });

        if (selectedModelId && !values.has(selectedModelId)) {
            options.unshift({
                value: selectedModelId,
                label: localLlmLoadedModels.length
                    ? `${abbreviateLocalModelId(selectedModelId)} (configured)`
                    : abbreviateLocalModelId(selectedModelId)
            });
        }

        if (!options.length) {
            options.push({
                value: selectedModelId ? selectedModelId : 'local-model',
                label: selectedModelId ? abbreviateLocalModelId(selectedModelId) : 'Local model'
            });
        }

        return options;
    };
    const formatLocalCapabilitySymbol = (support: LocalLlmFeatureSupport): string => {
        if (support === 'yes') return '✓';
        if (support === 'partial') return '~';
        return '✗';
    };
    const formatLocalCapabilitySupportLabel = (
        feature: 'summary' | 'pulses' | 'gossamer' | 'inquiry',
        support: LocalLlmFeatureSupport
    ): string => {
        if (feature === 'inquiry') {
            if (support === 'yes') return 'Eligible';
            if (support === 'partial') return 'Possibly eligible';
            return 'Not eligible';
        }
        if (support === 'yes') return 'Supported';
        if (support === 'partial') return 'Limited';
        return 'Not supported';
    };
    const buildLocalCapabilityTooltip = (assessment: LocalLlmCapabilityAssessment): string => [
        `${assessment.tierName} — ${assessment.tierSummary}`,
        `Summary — ${formatLocalCapabilitySymbol(assessment.featureSupport.summary)} ${formatLocalCapabilitySupportLabel('summary', assessment.featureSupport.summary)}`,
        `Pulses — ${formatLocalCapabilitySymbol(assessment.featureSupport.pulses)} ${formatLocalCapabilitySupportLabel('pulses', assessment.featureSupport.pulses)}`,
        `Gossamer — ${formatLocalCapabilitySymbol(assessment.featureSupport.gossamer)} ${formatLocalCapabilitySupportLabel('gossamer', assessment.featureSupport.gossamer)}`,
        `Inquiry — ${formatLocalCapabilitySymbol(assessment.featureSupport.inquiry)} ${formatLocalCapabilitySupportLabel('inquiry', assessment.featureSupport.inquiry)}`,
        assessment.explanation
    ].join('\n');
    const buildLocalFeatureSummary = (assessment: LocalLlmCapabilityAssessment): string => {
        const parts: string[] = [];
        if (assessment.featureSupport.summary === 'yes') parts.push('Summary');
        else if (assessment.featureSupport.summary === 'partial') parts.push('Summary (limited)');

        if (assessment.featureSupport.pulses === 'yes') parts.push('Pulses');
        else if (assessment.featureSupport.pulses === 'partial') parts.push('Pulses (limited)');

        if (assessment.featureSupport.gossamer === 'yes') parts.push('Gossamer');
        else if (assessment.featureSupport.gossamer === 'partial') parts.push('Gossamer (limited)');

        if (assessment.featureSupport.inquiry === 'yes') parts.push('Inquiry eligible');
        else if (assessment.featureSupport.inquiry === 'partial') parts.push('Inquiry (possibly eligible)');

        const summary = parts.join(' · ');
        return summary ? summary : 'Summary not supported';
    };
    const setLocalLlmConfigurationMode = (mode: LocalLlmConfigurationMode): void => {
        const aiSettings = ensureCanonicalAiSettings();
        aiSettings.localLlm = {
            ...getLocalLlmSettings(aiSettings),
            configurationMode: mode
        };
    };

    let isSyncingRoutingUi = false;

    const largeHandlingSection = aiSettingsGroup.createDiv({
        cls: `${ERT_CLASSES.STACK} ert-ai-large-handling`
    });
    largeHandlingSection.setAttr('data-ert-role', 'ai-setting:large-manuscript-handling');
    const largeHandlingHeader = new Settings(largeHandlingSection)
        .setName(t('settings.ai.largeHandling.name'))
        .setHeading();
    applyErtHeaderLayout(largeHandlingHeader);
    const capacityGrid = largeHandlingSection.createDiv({ cls: 'ert-ai-capacity-grid' });
    const createCapacityCell = (label: string): { cellEl: HTMLElement; valueEl: HTMLElement; labelEl: HTMLElement } => {
        const cell = capacityGrid.createDiv({ cls: 'ert-ai-capacity-cell' });
        const labelEl = cell.createDiv({ cls: 'ert-ai-capacity-label', text: label });
        const valueEl = cell.createDiv({ cls: 'ert-ai-capacity-value' });
        return { cellEl: cell, valueEl, labelEl };
    };
    const renderCapacitySections = (
        container: HTMLElement,
        sections: Array<{ title: string; items: CapacityItem[] }>
    ): void => {
        container.empty();
        sections.forEach(section => {
            const sectionEl = container.createDiv({ cls: 'ert-ai-capacity-block' });
            sectionEl.createDiv({ cls: 'ert-ai-capacity-block-title', text: section.title });
            const listEl = sectionEl.createEl('ul', { cls: 'ert-ai-capacity-list' });
            section.items.forEach(item => {
                const normalized = typeof item === 'string' ? { text: item } : item;
                if (normalized.dividerBefore) {
                    listEl.createEl('li', { cls: 'ert-ai-capacity-divider' });
                }
                const itemCls = ['ert-ai-capacity-item', normalized.extraCls].filter(Boolean).join(' ');
                listEl.createEl('li', { cls: itemCls, text: normalized.text });
            });
        });
    };
    /**
     * Render the panel's sections list from a typed view-model. The
     * view-model owns all label/visibility decisions (overhead row
     * presence, "Outline — none" wording, total-vs-headline alignment) so
     * this function is a thin DOM serializer.
     */
    const renderPanelViewModelSections = (
        container: HTMLElement,
        viewModel: PanelViewModel
    ): void => {
        container.empty();
        viewModel.sections.forEach(section => {
            const sectionEl = container.createDiv({ cls: 'ert-ai-capacity-block' });
            sectionEl.createDiv({ cls: 'ert-ai-capacity-block-title', text: section.title });
            const listEl = sectionEl.createEl('ul', { cls: 'ert-ai-capacity-list' });
            section.items.forEach(item => {
                if (item.kind === 'total_row') {
                    listEl.createEl('li', { cls: 'ert-ai-capacity-divider' });
                    listEl.createEl('li', {
                        cls: 'ert-ai-capacity-item',
                        text: formatTotalRowText(item.estimate)
                    });
                    return;
                }
                if (item.kind === 'plain_text') {
                    listEl.createEl('li', { cls: 'ert-ai-capacity-item', text: item.text });
                    return;
                }
                // token_row
                listEl.createEl('li', { cls: 'ert-ai-capacity-item', text: formatTokenRowText(item.row) });
            });
        });
    };
    /**
     * Render the panel header (token figure + provenance disclosure +
     * expected passes + provider input summary) from a view-model. Handles
     * the unavailable-source case by hiding the unit pill and showing
     * "Unavailable" instead of a misleading ~0k figure.
     */
    const renderPanelViewModelHeader = (params: {
        tokenEl: HTMLElement;
        expectedEl: HTMLElement;
        providerInputEl: HTMLElement;
        viewModel: PanelViewModel;
    }): void => {
        const { tokenEl, expectedEl, providerInputEl, viewModel } = params;
        const headlineFmt = formatTokenHeadline(viewModel.header.headline);
        tokenEl.empty();
        tokenEl.createSpan({ cls: 'ert-ai-token-value', text: headlineFmt.numericText });
        if (headlineFmt.unitText) {
            tokenEl.createSpan({ cls: 'ert-ai-token-unit', text: headlineFmt.unitText });
        }
        expectedEl.setText(formatExpectedPassesLabel(viewModel.header.expectedPasses));
        providerInputEl.setText(formatProviderInputSummary(viewModel.header.providerInputSummary));
        if (viewModel.header.headlineDisclosure) {
            setTooltip(tokenEl, viewModel.header.headlineDisclosure);
            setTooltip(providerInputEl, viewModel.header.headlineDisclosure);
        }
    };
    const toBreakdown = (sceneChars: number, outlineChars: number, referenceChars: number): RTCorpusTokenBreakdown => ({
        scenesTokens: estimateTokensFromChars(sceneChars),
        outlineTokens: estimateTokensFromChars(outlineChars),
        referenceTokens: estimateTokensFromChars(referenceChars)
    });
    const buildDisplayCorpusEstimateFromManifestEntries = async (entries: CorpusManifestEntry[]) => {
        let sceneCount = 0;
        let outlineCount = 0;
        let referenceCount = 0;
        let sceneChars = 0;
        let outlineChars = 0;
        let referenceChars = 0;

        for (const entry of entries) {
            if (entry.class === 'scene') {
                sceneCount += 1;
            } else if (entry.class === 'outline') {
                outlineCount += 1;
            } else {
                referenceCount += 1;
            }

            const file = app.vault.getAbstractFileByPath(entry.path);
            if (!(file instanceof TFile)) continue;

            let chars = 0;
            if (entry.mode === 'summary') {
                const cache = app.metadataCache.getFileCache(file);
                const rawFrontmatter = cache?.frontmatter;
                const frontmatter = rawFrontmatter
                    ? normalizeFrontmatterKeys(rawFrontmatter, getActiveFrontmatterMappings(plugin.settings))
                    : {};
                chars = extractSummary(frontmatter).length;
            } else if (entry.mode === 'full') {
                const raw = await app.vault.read(file);
                chars = cleanEvidenceBody(raw).length;
            }

            if (entry.class === 'scene') {
                sceneChars += chars;
            } else if (entry.class === 'outline') {
                outlineChars += chars;
            } else {
                referenceChars += chars;
            }
        }

        const breakdown = toBreakdown(sceneChars, outlineChars, referenceChars);
        return {
            sceneCount,
            outlineCount,
            referenceCount,
            evidenceChars: sceneChars + outlineChars + referenceChars,
            estimatedTokens: breakdown.scenesTokens + breakdown.outlineTokens + breakdown.referenceTokens,
            method: 'rt_chars_heuristic' as const,
            breakdown
        };
    };

    const capacityInquiry = createCapacityCell('Inquiry');
    capacityInquiry.labelEl.addClass('ert-ai-capacity-label--forecast');
    const capacityInquiryToken = capacityInquiry.valueEl.createDiv({
        cls: 'ert-ai-capacity-meta',
        text: 'Calculating...'
    });
    const capacityInquiryExpected = capacityInquiry.valueEl.createDiv({
        cls: 'ert-ai-capacity-meta',
        text: 'Calculating...'
    });
    const capacityInquiryProvider = capacityInquiry.valueEl.createDiv({
        cls: 'ert-ai-capacity-meta',
        text: 'Calculating...'
    });
    const capacityInquirySections = capacityInquiry.valueEl.createDiv({ cls: 'ert-ai-capacity-composition' });
    renderPanelViewModelSections(capacityInquirySections, buildPanelViewModel({
        feature: 'inquiry',
        forecast: { kind: 'pending', reason: 'Calculating…' }
    }));

    const capacityGossamer = createCapacityCell('Gossamer');
    capacityGossamer.labelEl.addClass('ert-ai-capacity-label--forecast');
    const capacityGossamerToken = capacityGossamer.valueEl.createDiv({
        cls: 'ert-ai-capacity-meta',
        text: 'Calculating...'
    });
    const capacityGossamerExpected = capacityGossamer.valueEl.createDiv({
        cls: 'ert-ai-capacity-meta',
        text: 'Calculating...'
    });
    const capacityGossamerProvider = capacityGossamer.valueEl.createDiv({
        cls: 'ert-ai-capacity-meta',
        text: 'Calculating...'
    });
    // Live cache-window line — hidden unless a prior Gossamer run armed a still-open
    // provider-cache window the remaining signals can reuse. Ticked by the preview interval.
    const capacityGossamerCache = capacityGossamer.valueEl.createDiv({
        cls: 'ert-ai-capacity-meta ert-ai-capacity-meta--cache ert-settings-hidden'
    });
    const capacityGossamerSections = capacityGossamer.valueEl.createDiv({ cls: 'ert-ai-capacity-composition' });
    renderPanelViewModelSections(capacityGossamerSections, buildPanelViewModel({
        feature: 'gossamer',
        forecast: { kind: 'pending', reason: 'Calculating…' }
    }));
    // ── Details link → modal ──
    const detailsBtn = aiSettingsGroup.createDiv({ cls: 'ert-ai-details-link' });
    detailsBtn.createSpan({ text: 'How analysis passes work \u2192' });
    detailsBtn.addEventListener('click', () => {
        void import('../../modals/AiPassStrategyDetailsModal').then(({ AiPassStrategyDetailsModal }) => {
            new AiPassStrategyDetailsModal(plugin.app).open();
        });
    });

    params.addAiRelatedElement(largeHandlingSection);
    params.addAiRelatedElement(detailsBtn);

    const roleContextSection = aiSettingsGroup.createDiv({
        cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ert-ai-section-card`
    });
    roleContextSection.createDiv({ cls: 'ert-section-title', text: t('settings.ai.roleContext.title') });
    roleContextSection.createDiv({
        cls: 'ert-section-desc',
        text: t('settings.ai.roleContext.desc')
    });

    const apiKeysFold = aiSettingsGroup.createDiv({
        cls: `${ERT_CLASSES.STACK} ert-ai-configuration`
    });
    const apiKeysHeader = new Settings(apiKeysFold)
        .setName(t('settings.ai.apiKeys.name'))
        .setHeading();
    addHeadingIcon(apiKeysHeader, 'key');
    addWikiLink(apiKeysHeader, 'Settings-AI#api-keys');
    applyErtHeaderLayout(apiKeysHeader);
    const configurationBody = apiKeysFold.createDiv({ cls: [ERT_CLASSES.SECTION_BODY, ERT_CLASSES.STACK] });

    const aiConfigFold = aiSettingsGroup.createDiv({
        cls: ERT_CLASSES.STACK
    });
    aiConfigFold.setAttr('data-ert-role', 'ai-setting:configuration');
    const aiConfigHeader = new Settings(aiConfigFold)
        .setName(t('settings.ai.configuration.name'))
        .setHeading();
    applyErtHeaderLayout(aiConfigHeader);
    const aiConfigBody = aiConfigFold.createDiv({ cls: [ERT_CLASSES.SECTION_BODY, ERT_CLASSES.STACK] });

    const contextTemplateSetting = new Settings(roleContextSection)
        .setName(t('settings.ai.contextTemplate.name'))
        .setDesc(`Active: ${getActiveTemplateName()}`)
        .addExtraButton(button => button
            .setIcon('gear')
            .setTooltip(t('settings.ai.contextTemplate.tooltip'))
            .onClick(() => {
                const modal = new AiContextModal(app, plugin, () => {
                    contextTemplateSetting.setDesc(`Active: ${getActiveTemplateName()}`);
                });
                modal.open();
            }));
    params.addAiRelatedElement(contextTemplateSetting.settingEl);

    const capabilityFloor: Capability[] = ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'];
    const providerLabel: Record<AIProviderId, string> = {
        anthropic: t('settings.ai.provider.optionAnthropic'),
        openai: t('settings.ai.provider.optionOpenai'),
        google: t('settings.ai.provider.optionGoogle'),
        ollama: t('settings.ai.provider.optionLocalLlm'),
        none: 'Disabled'
    };

    // formatApproxTokens, PreviewPill / PreviewSignal types,
    // CACHE_ARMED_PILL_TEXT, PREVIEW_SIGNAL_PRIORITY, and
    // MAX_PREVIEW_SIGNALS live in ./aiSettingsPreview.

    const resolvePreviewCitationSignal = (_model: ModelInfo): PreviewPill | null => {
        // Citation/sources/annotation pills are suppressed in the preview card
        // while inline provider citations are paused (see resolveCitationsEnabled
        // in computeCaps.ts). The pill would only confuse the user — every
        // model would show "Citations off" or a muted mechanism label that has
        // no operational meaning. Restoring this requires re-enabling the
        // resolver. Original implementation is preserved in git history.
        return null;
    };

    const resolvePreviewReuseSignal = (model: ModelInfo): PreviewPill | null => {
        const label = getModelUiSignals(model).reuseLabel;
        if (!label) return null;
        const cacheAvailable = /^Reuse\s*·\s*Provider cache$/i.test(label);
        const exclusiveWithCitations = model.constraints?.cacheVsCitationsExclusive === true;
        const citationsOn = resolveCitationsEnabled(
            model.provider,
            'inquiry',
            ensureCanonicalAiSettings().citationsEnabled !== false
        );
        if (exclusiveWithCitations && cacheAvailable) {
            return citationsOn
                ? { text: 'Cache off (exclusive of citations)', extraCls: 'ert-ai-pill--muted' }
                : { text: CACHE_ARMED_PILL_TEXT, extraCls: 'ert-ai-pill--active' };
        }
        return cacheAvailable
            ? { text: CACHE_ARMED_PILL_TEXT, extraCls: 'ert-ai-pill--active' }
            : { text: label, extraCls: 'ert-ai-pill--muted' };
    };

    // resolvePreviewSignals lives in ./aiSettingsPreview.

    const getProviderAllowedAliases = (provider: AIProviderId): string[] =>
        BUILTIN_MODELS
            .filter(model => model.provider === provider && model.status !== 'deprecated')
            .map(model => model.alias);

    const getProviderPickerModels = (provider: AIProviderId): ModelInfo[] =>
        getPickerModelsForProvider(BUILTIN_MODELS, provider);

    const getProviderPickerAliases = (provider: AIProviderId): string[] =>
        getProviderPickerModels(provider).map(model => model.alias);

    const isOpenAiInternalAlias = (alias: string): boolean =>
        !!alias
        && BUILTIN_MODELS.some(model => model.provider === 'openai' && model.alias === alias)
        && !getProviderPickerAliases('openai').includes(alias);

    const formatOpenAiInternalPinnedLabel = (alias: string): string => {
        const model = BUILTIN_MODELS.find(entry => entry.provider === 'openai' && entry.alias === alias);
        if (!model) return 'Pinned internal model';
        if (model.rollout?.datedVariantOf) {
            const canonical = BUILTIN_MODELS.find(entry => entry.alias === model.rollout?.datedVariantOf);
            const canonicalLabel = canonical?.label || model.label;
            const dated = model.id.match(/(\d{4}-\d{2}-\d{2})$/)?.[1];
            return dated
                ? `${canonicalLabel} Snapshot (${dated}, pinned)`
                : `${canonicalLabel} Snapshot (pinned)`;
        }
        return `${model.label} (Pinned internal)`;
    };

    const getProviderDefaultAlias = (provider: AIProviderId): string | undefined =>
        (provider === 'openai'
            ? selectLatestModelByReleaseChannel(BUILTIN_MODELS, 'openai', 'stable')?.alias
            : undefined)
        ?? getProviderPickerAliases(provider)[0]
        ?? BUILTIN_MODELS.find(model => model.provider === provider && model.status === 'stable')?.alias
        ?? BUILTIN_MODELS.find(model => model.provider === provider)?.alias;

    const resolveDisplayModelForLatestAlias = (models: ModelInfo[], selected: ModelInfo): {
        displayModel: ModelInfo;
        resolvedModelId: string | null;
        isPending: boolean;
    } => {
        const aliasId = selected.id.includes('latest')
            ? selected.id
            : (selected.alias.includes('latest') ? selected.alias : '');
        if (!aliasId) {
            return {
                displayModel: selected,
                resolvedModelId: selected.id,
                isPending: false
            };
        }

        const cachedResolvedId = getResolvedModelId(aliasId);
        if (cachedResolvedId) {
            const cached = models.find(model => model.id === cachedResolvedId || model.alias === cachedResolvedId);
            if (cached) {
                return {
                    displayModel: cached,
                    resolvedModelId: cached.id,
                    isPending: false
                };
            }
        }

        return {
            displayModel: selected,
            resolvedModelId: null,
            isPending: true
        };
    };

    const getAccessTier = (provider: AIProviderId): AccessTier => {
        const aiSettings = ensureCanonicalAiSettings();
        if (provider === 'anthropic') return aiSettings.aiAccessProfile.anthropicTier ?? 1;
        if (provider === 'openai') return aiSettings.aiAccessProfile.openaiTier ?? 1;
        if (provider === 'google') return aiSettings.aiAccessProfile.googleTier ?? 1;
        return 1;
    };

    const persistCanonical = async (): Promise<void> => {
        ensureCanonicalAiSettings();
        await plugin.saveSettings();
        params.refreshProviderDimming();
        plugin.getInquiryService().notifyAiSettingsChanged();
    };

    const providerKeyStates: Record<string, string> = {};
    /**
     * Re-check the selected provider's key when the author is actually looking.
     *
     * A verdict captured once, when Settings opened, goes stale: a check that
     * failed transiently (or was still in flight) would keep reporting an
     * unusable provider for the life of the pane, and switching providers would
     * repaint that old verdict as if it were current. These re-run the same
     * check on the moments that matter — opening the AI tab, and picking a
     * different provider — so the dropdown states what is true now.
     */
    const providerKeyRefreshers: Record<string, () => Promise<void>> = {};
    /** A verdict this recent is still current; re-asking would only burn a request. */
    const PROVIDER_KEY_STATE_FRESHNESS_MS = 10_000;
    /**
     * Credential state as WORDS, not just colour.
     *
     * The colour classes below are a redundant cue; they cannot be the only
     * one. Two reasons: colour alone fails WCAG 1.4.1 (use of colour), and an
     * author who cannot see why a provider is unusable has no way to act on
     * it. `ollama` is local — it needs a reachable server, never an API key —
     * so it gets connection wording rather than key wording.
     */
    const PROVIDER_KEY_SUFFIX: Record<string, string> = {
        ready: '',
        not_configured: ' (No key)',
        rejected: ' (Key rejected)',
        network_blocked: ' (Network blocked)',
        checking: ' (Checking…)'
    };
    const LOCAL_KEY_SUFFIX: Record<string, string> = {
        ready: '',
        not_configured: ' (Not connected)',
        rejected: ' (Not connected)',
        network_blocked: ' (Not reachable)',
        checking: ' (Checking…)'
    };
    const providerOptionBaseLabels: Record<string, string> = {
        anthropic: t('settings.ai.provider.optionAnthropic'),
        openai: t('settings.ai.provider.optionOpenai'),
        google: t('settings.ai.provider.optionGoogle'),
        ollama: t('settings.ai.provider.optionLocalLlm')
    };

    const describeProviderKeyState = (provider: string, state: string | undefined): string => {
        if (!state) return '';
        const table = provider === 'ollama' ? LOCAL_KEY_SUFFIX : PROVIDER_KEY_SUFFIX;
        return table[state] ?? '';
    };

    const refreshDropdownKeyIndicators = (): void => {
        if (!providerDropdown) return;
        const selectEl = providerDropdown.selectEl;
        const selectedState = providerKeyStates[selectEl.value];

        // Every option carries its own state, so the closed dropdown names the
        // active provider's state and the open list shows which alternatives
        // are actually usable — without opening Settings further.
        for (let i = 0; i < selectEl.options.length; i++) {
            const option = selectEl.options[i];
            const base = providerOptionBaseLabels[option.value];
            if (!base) continue;
            option.text = `${base}${describeProviderKeyState(option.value, providerKeyStates[option.value])}`;
        }

        selectEl.removeClass('is-ready', 'is-warning', 'is-muted');
        // The grid card flashes green on readiness; mirror the state onto it so
        // rt-ui.css needs no :has() lookup into the select.
        selectEl.closest('.ert-ai-grid-item')?.classList.toggle('is-strategy-ready', selectedState === 'ready');
        if (selectedState === 'ready') {
            selectEl.addClass('is-ready');
        } else if (selectedState === 'not_configured' || selectedState === 'rejected' || selectedState === 'network_blocked') {
            selectEl.addClass('is-warning');
        } else if (selectedState === 'checking') {
            selectEl.addClass('is-muted');
        }
    };

    const providerSetting = new Settings(quickSetupGrid)
        .setName(t('settings.ai.provider.name'))
        .setDesc(t('settings.ai.provider.desc'));
    providerSetting.settingEl.setAttr('data-ert-role', 'ai-setting:provider');

    /**
     * Say where the author's manuscript actually goes, on the control that
     * decides it.
     *
     * A local model is a different privacy fact from a hosted one, and the
     * dropdown is the only place that difference is chosen — so the sentence
     * follows the selection rather than sitting in a policy page nobody reads
     * at the moment it matters. The cloud wording names the PROVIDER'S terms
     * instead of promising anything on their behalf: manuscript text sent to
     * an API is governed by an agreement Radial Timeline is not a party to,
     * and a plugin that implied otherwise would be asserting a fact about
     * someone else's conduct.
     */
    const refreshProviderDisclosure = (provider: string): void => {
        const label = providerOptionBaseLabels[provider] ?? provider;
        providerSetting.setDesc(
            provider === 'ollama'
                ? t('settings.ai.provider.disclosureLocal')
                : t('settings.ai.provider.disclosureCloud', { provider: label })
        );
    };
    let providerDropdown: DropdownComponent | null = null;
    providerSetting.addDropdown(dropdown => {
        providerDropdown = dropdown;
        dropdown.selectEl.addClass('ert-input', 'ert-input--md', 'ert-ai-strategy-select');
        dropdown.addOption('anthropic', providerOptionBaseLabels.anthropic);
        dropdown.addOption('openai', providerOptionBaseLabels.openai);
        dropdown.addOption('google', providerOptionBaseLabels.google);
        dropdown.addOption('ollama', providerOptionBaseLabels.ollama);
        refreshDropdownKeyIndicators();
        dropdown.onChange(async value => {
            if (isSyncingRoutingUi) return;
            const aiSettings = ensureCanonicalAiSettings();
            const nextProvider = value as AIProviderId;
            aiSettings.provider = nextProvider;
            refreshProviderDisclosure(nextProvider);

            if (aiSettings.modelPolicy.type === 'pinned') {
                const allowed = new Set(getProviderAllowedAliases(nextProvider));
                if (!aiSettings.modelPolicy.pinnedAlias || !allowed.has(aiSettings.modelPolicy.pinnedAlias)) {
                    aiSettings.modelPolicy.pinnedAlias = getProviderDefaultAlias(nextProvider);
                }
            }

            await persistCanonical();
            void refreshRoutingUi();
            refreshDropdownKeyIndicators();
            if (nextProvider === 'ollama') {
                markLocalLlmConfigurationDirty();
                queueLocalLlmAutoValidation();
            } else {
                // The author just chose this provider — say whether its key
                // works now, rather than replaying the verdict from whenever
                // Settings happened to open.
                void providerKeyRefreshers[nextProvider]?.();
            }
        });
    });
    params.addAiRelatedElement(providerSetting.settingEl);

    const modelOverrideSetting = new Settings(quickSetupGrid)
        .setName(t('settings.ai.modelOverride.name'))
        .setDesc(t('settings.ai.modelOverride.desc'));
    modelOverrideSetting.settingEl.setAttr('data-ert-role', 'ai-setting:model-override');
    let modelOverrideDropdown: DropdownComponent | null = null;
    modelOverrideSetting.addDropdown(dropdown => {
        modelOverrideDropdown = dropdown;
        dropdown.selectEl.addClass('ert-input', 'ert-input--md', 'ert-ai-strategy-select');
        dropdown.onChange(async value => {
            if (isSyncingRoutingUi) return;
            const aiSettings = ensureCanonicalAiSettings();
            if (aiSettings.provider === 'ollama') {
                setOllamaModelId(value);
                if (localLlmModelText) localLlmModelText.setValue(value);
                clearLocalLlmValidationState();
                await persistCanonical();
                params.scheduleKeyValidation('ollama');
                renderLocalLlmModelList();
                renderLocalLlmStatus();
                queueLocalLlmAutoValidation();
                void refreshRoutingUi();
                return;
            }
            if (value === 'auto') {
                aiSettings.modelPolicy = { type: 'latestStable' };
            } else {
                aiSettings.modelPolicy = { type: 'pinned', pinnedAlias: value };
            }
            await persistCanonical();
            void refreshRoutingUi();
        });
    });
    params.addAiRelatedElement(modelOverrideSetting.settingEl);

    // Do not rewrite this copy as generic: it reflects limits specifically granted to the author/user by their provider.
    const ACCESS_TIER_COPY = t('settings.ai.accessTier.desc');
    const LOCAL_MODEL_STRATEGY_COPY = 'Select the active local model here. If discovery fails, use the manual fallback in Local LLM Configuration below.';
    const LOCAL_OVERRIDE_COPY = 'Use Auto for standard Local LLM setup. Switch to Custom only when you need to override backend or transport settings.';

    const accessTierSetting = new Settings(quickSetupGrid)
        .setName(t('settings.ai.accessTier.name'))
        .setDesc(ACCESS_TIER_COPY);
    accessTierSetting.settingEl.setAttr('data-ert-role', 'ai-setting:access-level');
    let accessTierDropdown: DropdownComponent | null = null;
    accessTierSetting.addDropdown(dropdown => {
        accessTierDropdown = dropdown;
        dropdown.selectEl.addClass('ert-input', 'ert-input--md', 'ert-ai-strategy-select');
        dropdown.addOption('1', t('settings.ai.accessTier.tier1'));
        dropdown.addOption('2', t('settings.ai.accessTier.tier2'));
        dropdown.addOption('3', t('settings.ai.accessTier.tier3'));
        dropdown.addOption('4', t('settings.ai.accessTier.tier4'));
        dropdown.onChange(async value => {
            if (isSyncingRoutingUi) return;
            const aiSettings = ensureCanonicalAiSettings();
            const provider = aiSettings.provider === 'none' ? 'openai' : aiSettings.provider;
            if (provider === 'ollama') {
                setLocalLlmConfigurationMode(value === 'custom' ? 'custom' : 'auto');
                await persistCanonical();
                renderLocalLlmModelList();
                renderLocalLlmStatus();
                void refreshRoutingUi();
                return;
            }
            const numTier = Number(value) as AccessTier;
            if (provider === 'anthropic') aiSettings.aiAccessProfile.anthropicTier = numTier;
            else if (provider === 'openai') aiSettings.aiAccessProfile.openaiTier = numTier;
            else if (provider === 'google') aiSettings.aiAccessProfile.googleTier = numTier;
            await persistCanonical();
            void refreshRoutingUi();
        });
    });
    params.addAiRelatedElement(accessTierSetting.settingEl);

    const applyQuickSetupLayoutOrder = (): void => {
        [providerSetting, modelOverrideSetting, accessTierSetting].forEach(setting => {
            quickSetupGrid.appendChild(setting.settingEl);
            setting.settingEl.addClass('ert-ai-grid-item');
        });
    };

    const applyStrategyRowCopyLayout = (setting: Settings, description: string): void => {
        setting.setDesc('');
        setting.settingEl.addClass('ert-ai-strategy-row', 'ert-setting-two-row');
        const nativeDesc = setting.settingEl.querySelector('.setting-item-description');
        if (nativeDesc) nativeDesc.remove();
        const existing = setting.settingEl.querySelector('.ert-ai-strategy-row__desc');
        if (!existing) {
            setting.settingEl.createDiv({ cls: 'ert-ai-strategy-row__desc', text: description });
        } else {
            existing.setText(description);
        }
    };

    const resolvedPreviewFrame = quickSetupPreviewSection.createDiv({
        cls: [ERT_CLASSES.PREVIEW_FRAME, ERT_CLASSES.STACK, 'ert-previewFrame--center', 'ert-previewFrame--flush', 'ert-ai-resolved-preview'],
        attr: { 'data-ert-role': 'ai-setting:resolved-model-preview' }
    });
    const resolvedPreviewKicker = resolvedPreviewFrame.createDiv({
        cls: 'ert-ai-resolved-preview-kicker',
        text: t('settings.ai.preview.kicker')
    });
    const resolvedPreviewModel = resolvedPreviewFrame.createDiv({
        cls: 'ert-ai-resolved-preview-model',
        text: t('settings.ai.preview.resolving')
    });
    const resolvedPreviewProvider = resolvedPreviewFrame.createDiv({
        cls: 'ert-ai-resolved-preview-provider',
        text: t('settings.ai.preview.providerPlaceholder')
    });
    /**
     * A heartbeat for checks the author cannot see.
     *
     * Resolving a local server takes ten seconds or more — a probe, a model
     * list, then real generations against the model. For that whole stretch
     * the card held one motionless line of text, which reads as a panel that
     * has hung rather than one that is working. These dots say "still going",
     * so the wait is legible as progress instead of breakage. Decorative:
     * the card's own copy already carries the meaning for screen readers.
     */
    const resolvedPreviewBusy = resolvedPreviewFrame.createDiv({
        cls: 'ert-ai-resolved-preview-busy ert-settings-hidden',
        attr: { 'aria-hidden': 'true' }
    });
    for (let dot = 0; dot < 3; dot += 1) {
        resolvedPreviewBusy.createSpan({ cls: 'ert-ai-resolved-preview-busy-dot' });
    }
    /** Depth, not a flag: overlapping resolves must not switch the dots off early. */
    let routingUiRunCount = 0;
    const refreshResolvedPreviewBusy = (): void => {
        const activeProvider = ensureCanonicalAiSettings().provider;
        // One source of truth with the provider dropdown: whatever makes an
        // option read "(Checking…)" is what makes this card pulse.
        const busy = routingUiRunCount > 0 || providerKeyStates[activeProvider] === 'checking';
        resolvedPreviewBusy.toggleClass('ert-settings-hidden', !busy);
        resolvedPreviewFrame.toggleClass('is-checking', busy);
    };

    const resolvedPreviewComparator = resolvedPreviewFrame.createDiv({
        cls: 'ert-ai-resolved-preview-comparator ert-settings-hidden'
    });
    const resolvedPreviewComparatorLabel = resolvedPreviewComparator.createDiv({
        cls: 'ert-ai-resolved-preview-comparator-label'
    });
    const resolvedPreviewComparatorValue = resolvedPreviewComparator.createDiv({
        cls: 'ert-ai-resolved-preview-comparator-value'
    });
    const resolvedPreviewStatus = resolvedPreviewFrame.createDiv({
        cls: 'ert-preview-status-line ert-preview-status-line--muted ert-ai-resolved-preview-status ert-settings-hidden'
    });
    const resolvedPreviewStatusIcon = resolvedPreviewStatus.createSpan({
        cls: 'ert-preview-status-icon'
    });
    const resolvedPreviewStatusText = resolvedPreviewStatus.createSpan({
        cls: 'ert-ai-resolved-preview-status-text'
    });
    const resolvedPreviewPills = resolvedPreviewFrame.createDiv({ cls: 'ert-ai-resolved-preview-pills' });
    const resolvedPreviewCacheMeter = resolvedPreviewFrame.createEl('progress', {
        cls: 'ert-ai-resolved-preview-cache-meter ert-settings-hidden'
    });
    resolvedPreviewCacheMeter.max = 1;
    resolvedPreviewCacheMeter.value = 0;
    const resolvedPreviewCacheMeterLabel = resolvedPreviewFrame.createDiv({
        cls: 'ert-ai-resolved-preview-cache-meter-label ert-settings-hidden'
    });
    // Gossamer cache-window pill — independent of the Inquiry cache certificate
    // above; shows a live countdown while a Gossamer run's manuscript cache is open.
    const resolvedPreviewGossamerCacheEl = resolvedPreviewFrame.createDiv({
        cls: 'ert-ai-resolved-preview-gossamer-cache ert-settings-hidden'
    });
    params.addAiRelatedElement(resolvedPreviewFrame);

    // Forward-declared; populated after credential helpers are defined.
    let localLlmConfigSectionEl: HTMLElement | null = null;
    let localLlmStatusSectionEl: HTMLElement | null = null;

    applyStrategyRowCopyLayout(providerSetting, 'Select the AI service or Local LLM runtime that powers structural analysis and editorial insight.');
    applyStrategyRowCopyLayout(modelOverrideSetting, 'Use Auto for deterministic latest-stable selection, or pin a specific model.');
    applyStrategyRowCopyLayout(accessTierSetting, ACCESS_TIER_COPY);

    applyQuickSetupLayoutOrder();

    const dropdownHasValue = (dropdown: DropdownComponent | null, value: string): boolean => {
        if (!dropdown) return false;
        return Array.from(dropdown.selectEl.options).some(option => option.value === value);
    };

    const setDropdownValueSafe = (dropdown: DropdownComponent | null, preferred: string, fallback?: string): void => {
        if (!dropdown) return;
        if (dropdownHasValue(dropdown, preferred)) {
            dropdown.setValue(preferred);
            return;
        }
        if (fallback && dropdownHasValue(dropdown, fallback)) {
            dropdown.setValue(fallback);
        }
    };

    interface ResolvedPreviewRenderState {
        provider: AIProviderId;
        modelId: string;
        modelLabel: string;
        modelAlias: string;
        idPending: boolean;
        contextWindow: number | null;
        maxInputTokens: number | null;
        maxOutputTokens: number | null;
        citationLabel: PreviewPill | null;
        reuseLabel: PreviewPill | null;
        passBehaviorLabel: PreviewPill | null;
        isPreview: boolean;
    }

    type PreviewCertificateContext = {
        provider: AIProviderId;
        modelId: string;
    };

    type PreviewCertificateState = {
        tone: 'default' | 'success' | 'warning' | 'error';
        comparatorLabel: string | null;
        comparatorValue: string | null;
        statusIcon: string | null;
        statusText: string | null;
        extraPills: PreviewPill[];
        cacheRatio?: number;
        cacheLabel?: string | null;
        /**
         * True when a prior run has primed/reused the provider cache for this
         * engine+corpus (warm or armed branch). Drives the single cache pill:
         * armed → "Cache armed"; otherwise → "Provider cache supported".
         */
        cacheArmed?: boolean;
    };

    let lastResolvedPreviewState: ResolvedPreviewRenderState | null = null;
    let lastPreviewCertificateContext: PreviewCertificateContext | null = null;

    /**
     * Local-engine preview certificate — the local analogue of the cloud
     * certificate state. Re-applied by the 1s certificate tick so the local
     * status line and pills survive the shared reset, exactly like cloud.
     */
    type LocalPreviewCertificate = {
        tone: 'success' | 'warning';
        statusIcon: string;
        statusText: string;
        pills: PreviewPill[];
    };
    let lastLocalPreviewCertificate: LocalPreviewCertificate | null = null;

    const getInquirySessionStoreSnapshot = (): InquirySessionStore => new InquirySessionStore(plugin);

    // formatPreviewReasonLabel + formatPreviewCacheRemaining live in ./aiSettingsPreview.

    const formatPreviewRunCompletedAt = (timestamp: number): string => {
        const formatted = new Date(timestamp).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return formatted.replace(/\s+(AM|PM)$/i, (_, meridiem: string) => meridiem.toLowerCase());
    };

    // formatPreviewCacheObservedLabel + mergePreviewCachePills live in ./aiSettingsPreview.

    const getPreviewCurrentCacheReuseFingerprint = (): string | null =>
        getCurrentCorpusContext()?.cacheReuseFingerprint?.trim() || null;

    const resetResolvedPreviewCertificateUi = (): void => {
        resolvedPreviewFrame.classList.remove(
            'ert-ai-resolved-preview-frame--success',
            'ert-ai-resolved-preview-frame--warning',
            'ert-ai-resolved-preview-frame--error'
        );
        resolvedPreviewComparatorLabel.setText('');
        resolvedPreviewComparatorValue.setText('');
        resolvedPreviewComparatorValue.toggleClass('ert-settings-hidden', false);
        resolvedPreviewComparator.toggleClass('ert-settings-hidden', true);
        resolvedPreviewStatus.classList.remove(
            'ert-preview-status-line--success',
            'ert-preview-status-line--warning',
            'ert-preview-status-line--muted'
        );
        resolvedPreviewStatus.classList.add('ert-preview-status-line--muted');
        resolvedPreviewStatus.toggleClass('ert-settings-hidden', true);
        resolvedPreviewStatusText.setText('');
        resolvedPreviewStatusIcon.empty();
        resolvedPreviewCacheMeter.toggleClass('ert-settings-hidden', true);
        resolvedPreviewCacheMeter.value = 0;
        resolvedPreviewCacheMeterLabel.toggleClass('ert-settings-hidden', true);
        resolvedPreviewCacheMeterLabel.setText('');
    };

    const resolvePreviewCertificateState = (
        context: PreviewCertificateContext | null
    ): PreviewCertificateState => {
        if (!context || !context.modelId) {
            return {
                tone: 'default',
                comparatorLabel: null,
                comparatorValue: null,
                statusIcon: null,
                statusText: null,
                extraPills: []
            };
        }
        if (context.provider === 'none' || context.provider === 'ollama') {
            return {
                tone: 'default',
                comparatorLabel: null,
                comparatorValue: null,
                statusIcon: null,
                statusText: null,
                extraPills: []
            };
        }

        const inquirySessionStore = getInquirySessionStoreSnapshot();
        const currentCorpus = getCurrentCorpusContext();
        const latestCurrentScopeSession = currentCorpus
            ? inquirySessionStore.getLatestSessionForEngineInScope(context.provider, context.modelId, currentCorpus.scope)
            : undefined;
        const latestSession = latestCurrentScopeSession
            ?? inquirySessionStore.getLatestSessionForEngine(context.provider, context.modelId);
        if (!latestSession) {
            return {
                tone: 'default',
                comparatorLabel: null,
                comparatorValue: null,
                statusIcon: null,
                statusText: null,
                extraPills: []
            };
        }

        const currentFingerprint = currentCorpus?.cacheReuseFingerprint?.trim() || getPreviewCurrentCacheReuseFingerprint();
        const activeCacheSession = inquirySessionStore.getLatestActiveCacheSessionForEngine(context.provider, context.modelId, {
            cacheReuseFingerprint: currentFingerprint ?? undefined,
            scope: currentCorpus?.scope
        });
        const cacheSession = activeCacheSession;
        const hasCurrentCorpusMatch = !!activeCacheSession;
        const latestScope = latestSession.scope ?? latestSession.result.scope;
        const latestScopeLabel = latestScope === 'saga' ? 'Saga' : 'Book';
        const resultStatus = latestSession.result.aiStatus;
        const reasonLabel = formatPreviewReasonLabel(resultStatus, latestSession.result.aiReason);
        const extraPills: PreviewPill[] = [];
        const hasUsagePricing = !!getActivePricingTable()[context.provider]?.[context.modelId];
        const latestUsageCost = hasUsagePricing
            ? estimateUsageCost(context.provider, context.modelId, latestSession.result.tokenUsage, latestSession.providerCacheStatus, ANTHROPIC_REQUESTED_CACHE_TTL)?.totalCostUSD
            : undefined;
        if (typeof latestUsageCost === 'number' && Number.isFinite(latestUsageCost)) {
            extraPills.push({
                text: `Last run cost · ${formatExactUsdCost(latestUsageCost)}`,
                extraCls: 'ert-ai-pill--active'
            });
        }
        if (latestSession.cacheWindowExpiresAt && latestSession.cacheWindowExpiresAt <= Date.now()) {
            extraPills.push({
                text: 'Cache window expired',
                extraCls: 'ert-ai-pill--muted'
            });
        }
        const cacheRemainingLabel = cacheSession?.cacheWindowExpiresAt && cacheSession.cacheWindowExpiresAt > Date.now()
            ? formatPreviewCacheRemaining(cacheSession.cacheWindowExpiresAt - Date.now())
            : null;
        // DOCTRINE (matches the AI Engine popover's TTL-pill gate): a numeric
        // countdown is only honest once the provider payload PROVES a cache
        // resource exists (cache_read or cache_creation tokens > 0). The
        // cacheWindowExpiresAt timestamp alone is setting-derived optimism —
        // OpenAI never reports cache-creation tokens, so a "primed/created"
        // run with cached_tokens=0 has no proof its cache exists and must NOT
        // show "23h 51m remaining". Such runs still show the armed state, just
        // without a fabricated countdown.
        const cacheUsage = cacheSession?.result.tokenUsage;
        const cacheProven = !!cacheUsage
            && (((cacheUsage.cacheReadInputTokens ?? 0) > 0)
                || ((cacheUsage.cacheCreationInputTokens ?? 0) > 0));
        const provenCacheRemainingLabel = cacheProven ? cacheRemainingLabel : null;
        const cacheRatio = typeof cacheSession?.cachedStableRatio === 'number' && Number.isFinite(cacheSession.cachedStableRatio)
            ? Math.max(0, Math.min(1, cacheSession.cachedStableRatio))
            : undefined;
        const cacheLabel = formatPreviewCacheObservedLabel(cacheRatio);

        if (resultStatus && resultStatus !== 'success') {
            const isWarning = resultStatus === 'degraded';
            const quotaFailure = latestSession.result.aiReason === 'quota_exceeded';
            return {
                tone: isWarning ? 'warning' : 'error',
                comparatorLabel: 'Last run',
                comparatorValue: isWarning ? `Degraded · ${reasonLabel}` : `Failed · ${reasonLabel}`,
                statusIcon: isWarning ? 'alert-triangle' : 'x-circle',
                statusText: isWarning
                    ? `Validation surfaced issues on the latest ${latestScopeLabel} Inquiry run.`
                    : quotaFailure
                        ? `Latest ${latestScopeLabel} Inquiry run failed because API quota was exceeded.`
                        : `Latest ${latestScopeLabel} Inquiry run failed and needs attention.`,
                extraPills
            };
        }

        // DOCTRINE (updated): there are now TWO honest proof states, not one.
        //
        //   1. WARM REUSE — `cacheReuseState === 'warm'`. A prior cache
        //      resource was reused on the last run. Provider payload
        //      confirmed it (cacheUsed=true from the cache manager). Show
        //      "Warm cache confirmed … • Xm remaining" + observed ratio.
        //
        //   2. ARMED — `providerCacheStatus === 'created'` with a live
        //      TTL window. The cache manager confirms a new resource
        //      was created and is ready for the NEXT run. This is not
        //      reuse; it's "primed." Honest to show a countdown because
        //      the manager (not optimism) proves the resource exists.
        //
        //   3. ELIGIBLE without created/hit status, or no TTL — falls
        //      through to the neutral "completed" default. A countdown
        //      here would still be optimism.
        if (
            cacheSession?.cacheReuseState === 'warm'
            && cacheSession.cacheWindowExpiresAt
            && cacheSession.cacheWindowExpiresAt > Date.now()
        ) {
            // Only append a numeric countdown when the provider proves the
            // cache exists. A warm reuse is itself proof for payload providers,
            // but providers that never report an expiry (OpenAI) show the
            // confirmed-reuse state without a fabricated remaining-time.
            const warmTimeSuffix = provenCacheRemainingLabel ? ` • ${provenCacheRemainingLabel}` : '';
            return {
                tone: 'success',
                comparatorLabel: null,
                comparatorValue: null,
                statusIcon: 'badge-check',
                statusText: hasCurrentCorpusMatch
                    ? `Warm cache confirmed for current corpus${warmTimeSuffix}`
                    : `Warm cache confirmed on last Inquiry corpus${warmTimeSuffix}`,
                extraPills,
                cacheArmed: true,
                cacheRatio,
                cacheLabel
            };
        }

        // ARMED state — cache was created this run, ready for next.
        // Matches the AI Engine popover's "Cache armed" + "Cache: 12m left"
        // pills so the two surfaces tell the same story.
        if (
            cacheSession?.providerCacheStatus === 'created'
            && cacheSession.cacheWindowExpiresAt
            && cacheSession.cacheWindowExpiresAt > Date.now()
        ) {
            // Countdown only when the cache is payload-proven. An unproven
            // "primed" run (e.g. OpenAI, which never reports cache-creation
            // tokens, so cached_tokens=0) shows the armed state WITHOUT a
            // fabricated remaining-time — the provider manages the real expiry.
            const armedTimeSuffix = provenCacheRemainingLabel ? ` • ${provenCacheRemainingLabel}` : '';
            return {
                tone: 'success',
                comparatorLabel: null,
                comparatorValue: null,
                statusIcon: 'shield-check',
                statusText: hasCurrentCorpusMatch
                    ? `Cache armed for next run on current corpus${armedTimeSuffix}`
                    : `Cache armed on last Inquiry corpus${armedTimeSuffix}`,
                // The single cache pill is shaped by the assembler from
                // `cacheArmed`; no per-branch pill injection here.
                extraPills,
                cacheArmed: true
            };
        }

        return {
            tone: 'default',
            comparatorLabel: null,
            comparatorValue: null,
            statusIcon: 'check-circle-2',
            statusText: `Latest ${latestScopeLabel} Inquiry run completed at ${formatPreviewRunCompletedAt(latestSession.createdAt || latestSession.lastAccessed)}.`,
            extraPills
        };
    };

    const applyResolvedPreviewCertificate = (): void => {
        resetResolvedPreviewCertificateUi();
        if (lastLocalPreviewCertificate) {
            const cert = lastLocalPreviewCertificate;
            renderResolvedPreviewPills(cert.pills);
            setIcon(resolvedPreviewStatusIcon, cert.statusIcon);
            resolvedPreviewStatusText.setText(cert.statusText);
            resolvedPreviewStatus.toggleClass('ert-settings-hidden', false);
            resolvedPreviewStatus.classList.remove('ert-preview-status-line--muted');
            if (cert.tone === 'success') {
                resolvedPreviewFrame.classList.add('ert-ai-resolved-preview-frame--success');
                resolvedPreviewStatus.classList.add('ert-preview-status-line--success');
            } else {
                resolvedPreviewFrame.classList.add('ert-ai-resolved-preview-frame--warning');
                resolvedPreviewStatus.classList.add('ert-preview-status-line--warning');
            }
            return;
        }
        if (!lastResolvedPreviewState) return;
        const certificate = resolvePreviewCertificateState(lastPreviewCertificateContext);
        const basePreviewPills = resolvePreviewSignals({
            citationLabel: lastResolvedPreviewState.citationLabel,
            reuseLabel: lastResolvedPreviewState.reuseLabel,
            passBehaviorLabel: lastResolvedPreviewState.passBehaviorLabel
        });
        const previewPills = mergePreviewCachePills((
            typeof certificate.cacheRatio === 'number' && certificate.cacheRatio > 0
                ? basePreviewPills.filter(pill => !/^Cache off\b/i.test(pill.text))
                : basePreviewPills
        ).concat(certificate.extraPills));

        // Author-priority ordering: cost first (what they care about most),
        // then exactly ONE cache pill, anything else (e.g. citations), and the
        // single/multi-pass context pill last. The cache pill collapses to one:
        //   - cache disabled            → keep the "Cache off …" pill verbatim
        //   - prior run primed/reused   → "Cache armed"   (certificate.cacheArmed)
        //   - otherwise (no prior run)  → "Provider cache supported"
        const isCostPill = (pill: PreviewPill): boolean => /^Last run cost\b/i.test(pill.text);
        const isPassPill = (pill: PreviewPill): boolean => /^Context\s*·/i.test(pill.text);
        const isCachePill = (pill: PreviewPill): boolean =>
            /^(Provider cache supported|Provider cache enabled|Cache armed|Cache enabled|Cache off)\b/i.test(pill.text);

        const costPill = previewPills.find(isCostPill) ?? null;
        const passPill = previewPills.find(isPassPill) ?? null;
        const existingCachePill = previewPills.find(isCachePill) ?? null;
        const cachePill: PreviewPill | null = existingCachePill
            ? (/^Cache off\b/i.test(existingCachePill.text)
                ? existingCachePill
                : { text: certificate.cacheArmed ? 'Cache armed' : CACHE_ARMED_PILL_TEXT, extraCls: 'ert-ai-pill--active' })
            : null;
        const otherPills = previewPills.filter(pill => !isCostPill(pill) && !isPassPill(pill) && !isCachePill(pill));

        const orderedPills = [costPill, cachePill, ...otherPills, passPill]
            .filter((pill): pill is PreviewPill => pill !== null);
        renderResolvedPreviewPills(orderedPills);

        if (certificate.comparatorLabel) {
            resolvedPreviewComparatorLabel.setText(certificate.comparatorLabel);
            resolvedPreviewComparatorValue.setText(certificate.comparatorValue ? certificate.comparatorValue : '');
            resolvedPreviewComparatorValue.toggleClass('ert-settings-hidden', !certificate.comparatorValue);
            resolvedPreviewComparator.toggleClass('ert-settings-hidden', false);
        }

        if (certificate.statusIcon && certificate.statusText) {
            setIcon(resolvedPreviewStatusIcon, certificate.statusIcon);
            resolvedPreviewStatusText.setText(certificate.statusText);
            resolvedPreviewStatus.toggleClass('ert-settings-hidden', false);
        }

        if (certificate.tone === 'success') {
            resolvedPreviewFrame.classList.add('ert-ai-resolved-preview-frame--success');
            resolvedPreviewStatus.classList.remove('ert-preview-status-line--muted', 'ert-preview-status-line--warning');
            resolvedPreviewStatus.classList.add('ert-preview-status-line--success');
        } else if (certificate.tone === 'warning') {
            resolvedPreviewFrame.classList.add('ert-ai-resolved-preview-frame--warning');
            resolvedPreviewStatus.classList.remove('ert-preview-status-line--muted', 'ert-preview-status-line--success');
            resolvedPreviewStatus.classList.add('ert-preview-status-line--warning');
        } else if (certificate.tone === 'error') {
            resolvedPreviewFrame.classList.add('ert-ai-resolved-preview-frame--error');
            resolvedPreviewStatus.classList.remove('ert-preview-status-line--muted', 'ert-preview-status-line--success');
            resolvedPreviewStatus.classList.add('ert-preview-status-line--warning');
        }

        if (typeof certificate.cacheRatio === 'number' && certificate.cacheRatio > 0 && certificate.cacheLabel) {
            resolvedPreviewCacheMeter.toggleClass('ert-settings-hidden', false);
            resolvedPreviewCacheMeter.value = Math.max(0, Math.min(1, certificate.cacheRatio));
            resolvedPreviewCacheMeterLabel.setText(certificate.cacheLabel);
            resolvedPreviewCacheMeterLabel.toggleClass('ert-settings-hidden', false);
        }
    };

    // Gossamer cache-window countdown — drives both the preview pill and the
    // capacity-table line from the plugin's live window. Hidden when no window
    // is open. Reuses the preview's existing 1s tick (no extra interval).
    const updateGossamerCacheSettingsUi = (): void => {
        const win = plugin.gossamerCacheWindow;
        const clock = formatGossamerCacheClock(win, Date.now());
        if (!clock || !win) {
            resolvedPreviewGossamerCacheEl.toggleClass('ert-settings-hidden', true);
            resolvedPreviewGossamerCacheEl.setText('');
            capacityGossamerCache.toggleClass('ert-settings-hidden', true);
            capacityGossamerCache.setText('');
            return;
        }
        const costHint = formatGossamerCacheCostHint(win);
        resolvedPreviewGossamerCacheEl.toggleClass('ert-settings-hidden', false);
        resolvedPreviewGossamerCacheEl.setText(costHint ? `Gossamer cache ${clock} · ${costHint}` : `Gossamer cache ${clock}`);
        capacityGossamerCache.toggleClass('ert-settings-hidden', false);
        capacityGossamerCache.setText(
            costHint
                ? `Cache window ${clock} (${win.provider}) — ${costHint}`
                : `Cache window ${clock} (${win.provider}) — reused by remaining signals`
        );
    };
    updateGossamerCacheSettingsUi();

    const previewCertificateIntervalId = window.setInterval(() => {
        applyResolvedPreviewCertificate();
        updateGossamerCacheSettingsUi();
        if (lastCostComparisonRows.length > 0) {
            renderCostComparisonRows(lastCostComparisonRows);
        }
    }, 1000);
    plugin.register(() => {
        window.clearInterval(previewCertificateIntervalId);
    });

    const renderLocalPreviewUnavailable = (title: string, detail: string): void => {
        lastResolvedPreviewState = null;
        lastPreviewCertificateContext = null;
        lastLocalPreviewCertificate = null;
        resolvedPreviewKicker.setText(t('settings.ai.preview.kicker'));
        resolvedPreviewModel.setText(title);
        resolvedPreviewProvider.setText(detail);
        renderResolvedPreviewPills([]);
        resetResolvedPreviewCertificateUi();
    };

    /**
     * Local engines get the same first-class preview card as cloud engines:
     * big model name, server line, validation status line, and capability
     * pills — sourced from the Local LLM detection/validation state instead
     * of the cloud capacity estimator (which cannot price local runs).
     */
    const renderLocalResolvedPreview = (): void => {
        lastResolvedPreviewState = null;
        lastPreviewCertificateContext = null;
        const localLlm = getLocalLlmSettings(ensureCanonicalAiSettings());
        const selectedModelId = getOllamaModelId().trim();
        const liveEntry = localLlmLoadedModels.find(model => model.id === selectedModelId) ?? null;
        const capability = getLocalCapabilityAssessment(selectedModelId, liveEntry);

        resolvedPreviewKicker.setText(t('settings.ai.preview.kicker'));
        resolvedPreviewModel.setText(abbreviateLocalModelId(selectedModelId) || 'Local model'); // SAFE: preview caption only — a model id that abbreviates to nothing still needs a readable label
        resolvedPreviewProvider.setText(`${LOCAL_LLM_BACKEND_LABELS[localLlm.backend]} · ${getOllamaBaseUrl()}`);

        const statusValue = buildLocalStatusValue();
        const statusStamp = localLlmValidationPending ? null : formatLocalTimestamp(localLlmLastValidatedAt);
        const validated = statusValue === 'Connected & validated';

        const pills: PreviewPill[] = [{
            text: `${capability.tierSummary} (${capability.tierName})`,
            extraCls: `ert-ai-pill--active ert-ai-local-model-pill--tier${capability.tier}`
        }];
        buildLocalFeatureSummary(capability)
            .split(' · ')
            .filter(Boolean)
            .forEach(feature => pills.push({ text: feature }));
        const contextWindow = liveEntry?.contextWindow;
        if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
            pills.push({ text: `Context · ${Math.round(contextWindow / 1000)}k tokens` });
        }
        pills.push({ text: 'On-device · no API cost' });

        lastLocalPreviewCertificate = {
            tone: validated ? 'success' : 'warning',
            statusIcon: validated ? 'shield-check' : 'alert-triangle',
            statusText: validated
                ? `Connected & validated${statusStamp ? ` · ${statusStamp}` : ''} — all checks passed`
                : `${statusValue}${statusStamp ? ` · ${statusStamp}` : ''}`,
            pills
        };
        applyResolvedPreviewCertificate();
    };

    const createResolvedPreviewPill = (container: HTMLElement, pill: PreviewPill): void => {
        const cls = [
            ERT_CLASSES.BADGE_PILL,
            ERT_CLASSES.BADGE_PILL_SM,
            'ert-ai-resolved-preview-pill',
            pill.extraCls
        ].filter(Boolean).join(' ');
        container.createSpan({ cls, text: pill.text });
    };

    const renderResolvedPreviewPills = (pills: PreviewPill[]): void => {
        resolvedPreviewPills.empty();
        if (!pills.length) return;

        const firstRowEl = resolvedPreviewPills.createDiv({ cls: 'ert-ai-resolved-preview-pill-row' });
        pills.forEach(pill => createResolvedPreviewPill(firstRowEl, pill));
    };

    const renderResolvedPreview = (state: ResolvedPreviewRenderState): void => {
        lastLocalPreviewCertificate = null;
        lastResolvedPreviewState = state;
        lastPreviewCertificateContext = {
            provider: state.provider,
            modelId: state.modelId
        };
        resolvedPreviewKicker.setText(t('settings.ai.preview.kicker'));
        const previewModelLabel = state.provider === 'ollama'
            ? state.modelLabel.replace(/^Local LLM:\s*/i, '').trim() || state.modelLabel
            : state.modelLabel;
        resolvedPreviewModel.setText(previewModelLabel);
        const labelAlreadySaysPreview = state.modelLabel.toLowerCase().includes('preview');
        const previewSuffix = state.isPreview && !labelAlreadySaysPreview ? ' (Preview)' : '';
        const providerDetail = state.provider === 'ollama'
            ? (state.idPending
                ? `ID pending (${state.modelAlias})`
                : `${state.modelId || previewModelLabel}${previewSuffix}`)
            : (state.idPending
                ? `${providerLabel[state.provider]} · ID pending (${state.modelAlias})`
                : `${providerLabel[state.provider]} · ${(state.modelId || state.modelLabel)}${previewSuffix}`);
        resolvedPreviewProvider.setText(providerDetail);
        applyResolvedPreviewCertificate();
    };

    type FeatureForecast = {
        available: boolean;
        corpusTokens: number;
        /**
         * Typed provider-count estimate carrying source provenance. When the
         * provider count succeeds, source is 'provider_count'; when it fails
         * (e.g. Gemini countTokens throws), source is 'unavailable' — NOT a
         * misleading 0. The panel view-model uses this to render honest
         * labels instead of conflating failure with zero tokens.
         */
        providerCount: PanelTokenEstimate;
        sceneCount: number;
        outlineCount: number;
        referenceCount: number;
        breakdown: RTCorpusTokenBreakdown;
        promptBreakdown: PromptRequestBreakdown;
        expectedPassCount?: number;
    };

    type CostComparisonModel = {
        provider: AIProviderId;
        modelId: string;
        providerLabel: string;
        modelLabel: string;
    };

    type CostComparisonRow = {
        model: CostComparisonModel;
        freshText: string;
        cachedText: string;
        passesText: string;
        promoLabel?: string;
    };

    const getCostComparisonRowKey = (provider: AIProviderId, modelId: string): string =>
        `${provider}::${modelId}`;

    const getProviderCacheWindowLabel = (provider: AIProviderId): string | null =>
        formatProviderCacheWindowLabel(provider, ensureCanonicalAiSettings());

    const COST_PROVIDER_ORDER: ReadonlyArray<Exclude<AIProviderId, 'none' | 'ollama'>> = ['anthropic', 'openai', 'google'];

    const supportsCostComparisonModel = (provider: AIProviderId, modelId: string): boolean => {
        if (provider === 'none' || provider === 'ollama') return false;
        return !!getActivePricingTable()[provider]?.[modelId];
    };

    const getCostComparisonModels = (registryModels?: ModelInfo[]): CostComparisonModel[] => {
        const models = registryModels?.length ? registryModels : BUILTIN_MODELS;
        const cloudModels: CostComparisonModel[] = COST_PROVIDER_ORDER.flatMap(provider => {
            const providerModels = getPickerModelsForProvider(models, provider)
                .filter(model => !model.id.endsWith('-latest'))
                .filter(model => supportsCostComparisonModel(provider, model.id));

            return providerModels.map(model => ({
                provider,
                modelId: model.id,
                providerLabel: PROVIDER_DISPLAY_LABELS[provider],
                modelLabel: model.label
            }));
        });

        return cloudModels;
    };

    const createCostTableCell = (rowEl: HTMLElement, text: string, extraCls?: string): HTMLDivElement => {
        return rowEl.createDiv({
            cls: ['ert-ai-models-cell', extraCls].filter(Boolean).join(' '),
            text
        });
    };

    // formatCorpusStructureSummary + formatCorpusTokenSummary live in ./aiSettingsPreview.

    const renderCostEstimateCorpusSummary = (options: {
        sizeText: string;
        structureText: string;
    }): void => {
        costEstimateCorpusSize.setText(options.sizeText);
        costEstimateCorpusStructure.setText(options.structureText);
    };
    const COST_ESTIMATE_CORPUS_UNAVAILABLE = 'Open Inquiry View to update cost estimates.';

    const renderCostComparisonFailure = (message: string): void => {
        lastCostComparisonRows = [];
        costEstimateTable.empty();
        const isCorpusUnavailable = message === COST_ESTIMATE_CORPUS_UNAVAILABLE;
        costEstimateTable.createDiv({
            cls: isCorpusUnavailable ? 'ert-completion-no-data' : 'ert-completion-error',
            text: isCorpusUnavailable ? message : `Cost estimate unavailable: ${message}`
        });
    };

    let activeCostComparisonRowKey: string | null = null;
    let activeCostRowCredentialState: string | null = null;
    let lastCostComparisonRows: CostComparisonRow[] = [];

    const getCurrentCorpusContext = () => plugin.getInquiryService().getCurrentCorpusContext();

    const getActiveCostComparisonCacheRowKey = (): string | null => {
        const currentFingerprint = getPreviewCurrentCacheReuseFingerprint();
        if (!currentFingerprint) return null;
        const activeEngine = lastPreviewCertificateContext;
        if (!activeEngine || !activeEngine.modelId) {
            return null;
        }
        if (activeEngine.provider === 'none' || activeEngine.provider === 'ollama') {
            return null;
        }
        const inquirySessionStore = getInquirySessionStoreSnapshot();
        const activeCacheSession = inquirySessionStore.getLatestActiveCacheSessionForEngine(
            activeEngine.provider,
            activeEngine.modelId,
            {
                cacheReuseFingerprint: currentFingerprint,
                scope: getCurrentCorpusContext()?.scope
            }
        );
        if (!activeCacheSession?.cacheWindowExpiresAt || activeCacheSession.cacheWindowExpiresAt <= Date.now()) {
            return null;
        }
        return getCostComparisonRowKey(activeEngine.provider, activeEngine.modelId);
    };

    const buildCurrentInquiryExecutionEstimate = async (params: {
        provider: AIProviderId;
        modelId: string;
        questionText: string;
    }) => {
        const currentCorpus = getCurrentCorpusContext();
        if (!currentCorpus) {
            throw new Error('Inquiry corpus is not available yet. Open Inquiry View to populate estimates.');
        }
        return await buildCanonicalExecutionEstimate({
            plugin,
            provider: params.provider,
            modelId: params.modelId,
            questionText: params.questionText,
            scope: currentCorpus.scope,
            activeBookId: currentCorpus.activeBookId,
            scopeLabel: currentCorpus.scopeLabel,
            manifestEntries: currentCorpus.manifestEntries,
            vault: app.vault,
            metadataCache: app.metadataCache,
            frontmatterMappings: getActiveFrontmatterMappings(plugin.settings),
            citationsEnabled: resolveCitationsEnabled(
                params.provider,
                'inquiry',
                ensureCanonicalAiSettings().citationsEnabled !== false
            )
        });
    };

    const renderCostComparisonRows = (rows: CostComparisonRow[]): void => {
        lastCostComparisonRows = rows;
        costEstimateTable.empty();
        const activeCacheRowKey = getActiveCostComparisonCacheRowKey();

        const headerRow = costEstimateTable.createDiv({ cls: 'ert-ai-models-row ert-ai-models-row--header' });
        ['Provider', 'Model', 'Fresh estimate*', 'Cached estimate**', 'Expected Passes'].forEach(text => {
            createCostTableCell(headerRow, text);
        });

        const sorted = [...rows].sort((a, b) => {
            const aPromo = a.promoLabel ? 0 : 1;
            const bPromo = b.promoLabel ? 0 : 1;
            return aPromo - bPromo;
        });

        sorted.forEach(row => {
            const rowEl = costEstimateTable.createDiv({ cls: 'ert-ai-models-row' });
            if (activeCostComparisonRowKey === getCostComparisonRowKey(row.model.provider, row.model.modelId)) {
                rowEl.addClass('ert-ai-models-row--active');
                if (activeCostRowCredentialState === 'ready') {
                    rowEl.addClass('ert-ai-models-row--ready');
                } else if (activeCostRowCredentialState === 'not_configured' || activeCostRowCredentialState === 'rejected') {
                    rowEl.addClass('ert-ai-models-row--warning');
                }
            }
            if (row.promoLabel) {
                rowEl.addClass('ert-ai-models-row--promo');
            }
            createCostTableCell(rowEl, row.model.providerLabel);
            const modelCell = rowEl.createDiv({
                cls: 'ert-ai-models-cell ert-ai-models-cell--model'
            });
            modelCell.createSpan({ text: row.model.modelLabel });
            if (row.promoLabel) {
                modelCell.createSpan({
                    cls: 'ert-ai-cost-promo-badge',
                    text: row.promoLabel
                });
            }
            createCostTableCell(rowEl, row.freshText);
            const cachedCell = createCostTableCell(rowEl, row.cachedText);
            if (activeCacheRowKey === getCostComparisonRowKey(row.model.provider, row.model.modelId)) {
                cachedCell.addClass('ert-ai-models-cell--cache-active');
            }
            createCostTableCell(rowEl, row.passesText);
        });
    };

    const setActiveCostComparisonRow = (provider: AIProviderId | null, modelId: string | null): void => {
        activeCostComparisonRowKey = provider && modelId
            ? getCostComparisonRowKey(provider, modelId)
            : null;
        activeCostRowCredentialState = provider ? (providerKeyStates[provider] ?? null) : null;
        if (lastCostComparisonRows.length > 0) {
            renderCostComparisonRows(lastCostComparisonRows);
        }
    };
    const refreshActiveCostComparisonRowState = (provider: AIProviderId, credentialState: string | null): void => {
        if (!activeCostComparisonRowKey?.startsWith(`${provider}::`)) return;
        activeCostRowCredentialState = credentialState;
        if (lastCostComparisonRows.length > 0) {
            renderCostComparisonRows(lastCostComparisonRows);
        }
    };

    const buildLoadingCostRows = (): CostComparisonRow[] => getCostComparisonModels().map(model => ({
        model,
        freshText: 'Calculating...',
        cachedText: 'Calculating...',
        passesText: 'Calculating...'
    }));

    let costComparisonRequestId = 0;

    const computeCostEstimateCorpusSummary = async (): Promise<{
        sizeText: string;
        structureText: string;
    }> => {
        const currentCorpus = getCurrentCorpusContext();
        if (!currentCorpus) {
            throw new Error(COST_ESTIMATE_CORPUS_UNAVAILABLE);
        }
        const activeModel = lastResolvedPreviewState;
        const citationsOn = activeModel
            ? resolveCitationsEnabled(
                activeModel.provider,
                'inquiry',
                ensureCanonicalAiSettings().citationsEnabled !== false
            )
            : false;
        const citationsSuffix = citationsOn ? ' (includes citation wrappers)' : '';
        // Three states for the Full Request label:
        //   1. requestTokens > 0 → provider/local count succeeded; show it.
        //   2. method === 'unavailable' → snapshot completed but the
        //      provider count call failed (e.g. Gemini countTokens threw).
        //      Show "unavailable" honestly — NOT "Estimating..." which
        //      misleadingly implies in-flight work. Per the no-fallback
        //      doctrine we do not silently substitute the corpus chars/4
        //      number here as if it were the request total.
        //   3. method is undefined → snapshot truly still building.
        //      "Estimating..." is the honest label.
        const requestText = currentCorpus.requestTokens > 0
            ? `Full Request: ${formatCorpusTokenSummary(currentCorpus.requestTokens)}${citationsSuffix}`
            : currentCorpus.requestEstimateMethod === 'unavailable'
                ? `Full Request: unavailable — provider token count failed${citationsSuffix}`
                : `Full Request: Estimating...${citationsSuffix}`;
        const corpusText = currentCorpus.corpus.estimatedTokens > 0
            ? `Corpus: ${formatCorpusTokenSummary(currentCorpus.corpus.estimatedTokens)}`
            : 'Corpus: Estimating...';
        return {
            sizeText: requestText,
            structureText: [
                corpusText,
                formatCorpusStructureSummary(
                    currentCorpus.corpus.sceneCount,
                    currentCorpus.corpus.outlineCount
                )
            ].filter(Boolean).join(' · ')
        };
    };

    const computeCostComparisonRows = async (registryModels?: ModelInfo[]): Promise<CostComparisonRow[]> => {
        const currentCorpus = getCurrentCorpusContext();
        const currentFingerprint = getPreviewCurrentCacheReuseFingerprint();
        const getBillableOutputTokensFromUsage = (
            provider: AIProviderId,
            usage: { outputTokens?: number; inputTokens?: number; totalTokens?: number } | undefined
        ): number | null => {
            if (!usage || typeof usage.outputTokens !== 'number') return null;
            if (!Number.isFinite(usage.outputTokens) || usage.outputTokens <= 0) return null;
            if (
                provider === 'google'
                && typeof usage.inputTokens === 'number'
                && Number.isFinite(usage.inputTokens)
                && typeof usage.totalTokens === 'number'
                && Number.isFinite(usage.totalTokens)
            ) {
                return Math.max(usage.outputTokens, usage.totalTokens - usage.inputTokens);
            }
            return Math.floor(usage.outputTokens);
        };
        const getLatestOutputSampleForModel = (model: CostComparisonModel): number | null => {
            if (!currentCorpus || model.provider === 'ollama' || model.provider === 'none') return null;
            const session = getInquirySessionStoreSnapshot().getLatestSessionForEngineInScope(
                model.provider,
                model.modelId,
                currentCorpus.scope
            );
            if (!session) return null;
            return getBillableOutputTokensFromUsage(model.provider, session.result.tokenUsage);
        };
        const getActiveCacheReuseRatioForModel = (model: CostComparisonModel): number | null => {
            if (!currentCorpus || !currentFingerprint) return null;
            if (model.provider === 'ollama' || model.provider === 'none') return null;
            const session = getInquirySessionStoreSnapshot().getLatestActiveCacheSessionForEngine(
                model.provider,
                model.modelId,
                {
                    cacheReuseFingerprint: currentFingerprint,
                    scope: currentCorpus.scope
                }
            );
            if (!session?.cacheWindowExpiresAt || session.cacheWindowExpiresAt <= Date.now()) return null;
            if (typeof session.cachedStableRatio !== 'number' || !Number.isFinite(session.cachedStableRatio) || session.cachedStableRatio <= 0) return null;
            return Math.min(1, Math.max(0, session.cachedStableRatio));
        };
        return await Promise.all(getCostComparisonModels(registryModels).map(async model => {
            const executionEstimate = await buildCurrentInquiryExecutionEstimate({
                provider: model.provider,
                modelId: model.modelId,
                questionText: INQUIRY_CANONICAL_ESTIMATE_QUESTION
            });
            if (!executionEstimate?.expectedPassCount || !executionEstimate.maxOutputTokens) {
                throw new Error(`Canonical execution estimate unavailable for ${model.modelLabel}.`);
            }
            const passLabel = `${executionEstimate.expectedPassCount} ${executionEstimate.expectedPassCount === 1 ? 'pass' : 'passes'}`;
            // Convert the runner's raw method+tokens into the typed
            // estimate. provider-count failure (e.g. Gemini countTokens
            // throws) becomes { source: 'unavailable' } — NOT a 0-token
            // count that would round to a fake "$0.01" via the pricing
            // math. This is the cross-surface contract from
            // src/ai/estimates.
            const inputEstimate = tokenEstimateFromMethod(
                executionEstimate.method,
                executionEstimate.estimatedTokens
            );
            if (inputEstimate.source === 'unavailable' || inputEstimate.source === 'pending') {
                // Refuse to compute cost from an unknown input. The user
                // sees "Unavailable" instead of a fabricated dollar value.
                return {
                    model,
                    freshText: 'Unavailable',
                    cachedText: 'Unavailable',
                    passesText: passLabel
                };
            }
            const learnedOutput = plugin.getOutputProfileStore().predictExpectedOutput(
                model.provider,
                model.modelId,
                inputEstimate.tokens
            );
            const latestOutput = learnedOutput !== null ? learnedOutput : getLatestOutputSampleForModel(model);
            if (latestOutput === null) {
                return {
                    model,
                    freshText: 'Output sample needed',
                    cachedText: 'Output sample needed',
                    passesText: passLabel
                };
            }
            const activeCacheReuseRatio = getActiveCacheReuseRatioForModel(model);
            const cacheReuseRatio = activeCacheReuseRatio !== null ? activeCacheReuseRatio : 0;
            const cost = estimateCorpusCost(
                model.provider,
                model.modelId,
                inputEstimate.tokens,
                Math.min(latestOutput, executionEstimate.maxOutputTokens),
                executionEstimate.expectedPassCount,
                // Anthropic Inquiry runs always request 1h cache (per
                // ANTHROPIC_REQUESTED_CACHE_TTL). Without this, the cost
                // panel would price the priming pass at the 5m rate and
                // under-estimate by ~33% on the first run.
                {
                    ...(model.provider === 'anthropic' ? { cacheWriteTtl: ANTHROPIC_REQUESTED_CACHE_TTL } : {}),
                    cacheReuseRatio
                }
            );
            const finalPassLabel = `${cost.expectedPasses} ${cost.expectedPasses === 1 ? 'pass' : 'passes'}`;
            const promoLabel = cost.promo?.label;
            const cacheWindowLabel = getProviderCacheWindowLabel(model.provider);
            const cachedSuffix = activeCacheReuseRatio !== null && cacheWindowLabel && typeof cost.cachedCostUSD === 'number' ? ` (${cacheWindowLabel})` : '';
            // Anthropic Inquiry primes the cache on the first run, so the
            // "Fresh Run" estimate includes the 1h cache-write surcharge.
            // Mirror the cached-run TTL suffix so the price label is honest
            // about what's baked in.
            const freshSuffix = model.provider === 'anthropic' && cacheWindowLabel ? ` (${cacheWindowLabel})` : '';
            const storageFootnote = model.provider === 'google' ? '**' : '';
            // Disclosure suffix when the input estimate came from a local
            // chars/4 heuristic instead of the authoritative provider
            // count. Keeps the user from mistaking "$1.24" for an exact
            // provider number when the count was a heuristic.
            const inputProvenanceSuffix = inputEstimate.source === 'local_estimate' ? ' (local input)' : '';
            return {
                model,
                freshText: `${formatUsdCost(cost.freshCostUSD)}${freshSuffix}${inputProvenanceSuffix}`,
                cachedText: activeCacheReuseRatio !== null && typeof cost.cachedCostUSD === 'number'
                    ? `${formatUsdCost(cost.cachedCostUSD)}${cachedSuffix}${storageFootnote}${inputProvenanceSuffix}`
                    : 'No active cache',
                passesText: finalPassLabel,
                promoLabel
            };
        }));
    };

    const refreshCostComparisonTable = async (): Promise<void> => {
        const requestId = ++costComparisonRequestId;
        renderCostEstimateCorpusSummary({
            sizeText: 'Full Request: Calculating...',
            structureText: 'Scanning corpus...'
        });
        setActiveCostComparisonRow(null, null);
        renderCostComparisonRows(buildLoadingCostRows());
        const aiClient = getAIClient(plugin);
        try {
            const [registryModels] = await Promise.all([
                aiClient.getRegistryModels(),
                aiClient.refreshPricing()
            ]);
            const [corpusSummary, rows] = await Promise.all([
                computeCostEstimateCorpusSummary(),
                computeCostComparisonRows(registryModels)
            ]);
            if (requestId !== costComparisonRequestId) return;
            renderCostEstimateCorpusSummary(corpusSummary);
            renderCostComparisonRows(rows);
            costEstimateFreshness.setText(getPricingFreshnessLabel(getActivePricingMeta()));
            renderPromoBanners();
        } catch (error) {
            if (requestId !== costComparisonRequestId) return;
            const message = error instanceof Error ? error.message : String(error);
            const isCorpusUnavailable = message === COST_ESTIMATE_CORPUS_UNAVAILABLE;
            renderCostEstimateCorpusSummary({
                sizeText: isCorpusUnavailable ? 'Cost estimates unavailable.' : 'Cost estimate unavailable.',
                structureText: isCorpusUnavailable ? COST_ESTIMATE_CORPUS_UNAVAILABLE : message
            });
            setActiveCostComparisonRow(null, null);
            renderCostComparisonFailure(message);
            costEstimateFreshness.setText(isCorpusUnavailable ? '' : 'Pricing load unavailable');
            promoBannerContainer.empty();
        }
    };

    const computeVaultForecasts = async (engine?: {
        provider: AIProviderId;
        modelId: string;
    }): Promise<{ inquiry: FeatureForecast; gossamer: FeatureForecast }> => {
        const currentCorpus = getCurrentCorpusContext();
        const roleTemplateTokens = estimateTokensFromChars(getActiveTemplatePrompt().length);
        const inquiryPromptParts = buildInquiryPromptParts('');
        const inquiryRequestTokens = estimateTokensFromChars(INQUIRY_CANONICAL_ESTIMATE_QUESTION.length);
        const inquiryInstructionTokens = estimateTokensFromChars(
            inquiryPromptParts.systemPrompt.length
            + inquiryPromptParts.instructionText.length
            + INQUIRY_ROLE_TEMPLATE_GUARDRAIL.length
        );
        const inquiryOutputContractTokens = estimateTokensFromChars(
            inquiryPromptParts.schemaText.length
            + buildOutputRulesText({
                returnType: 'json',
                responseSchema: buildInquiryJsonSchema()
            }).length
        );
        const inquiryCorpusTokens = currentCorpus?.corpus.estimatedTokens ?? 0;
        const inquiryExecutionEstimate = currentCorpus && engine
            ? await buildCurrentInquiryExecutionEstimate({
                provider: engine.provider,
                modelId: engine.modelId,
                questionText: INQUIRY_CANONICAL_ESTIMATE_QUESTION
            })
            : null;

        const sceneData = await plugin.getSceneData();
        const selectedBeatModel = resolveSelectedBeatModelFromSettings(plugin.settings);
        const beatOrder = extractBeatOrder(
            sceneData,
            selectedBeatModel
        );
        const gossamerEstimate = await estimateGossamerTokens({
            plugin,
            vault: app.vault,
            metadataCache: app.metadataCache,
            frontmatterMappings: getActiveFrontmatterMappings(plugin.settings),
            provider: engine?.provider,
            modelId: engine?.modelId,
            beatSystem: selectedBeatModel || 'Save The Cat',
            beats: beatOrder.map((beatName, index) => ({
                beatName,
                beatNumber: index + 1,
                idealRange: '0-100'
            }))
        });
        const { files: gossamerSceneFiles } = await getSortedSceneFiles(plugin);
        const gossamerPromptParts = beatOrder.length > 0
            ? buildUnifiedBeatAnalysisPromptParts(
                '',
                beatOrder.map((beatName, index) => ({
                    beatName,
                    beatNumber: index + 1,
                    idealRange: '0-100'
                })),
                selectedBeatModel || 'Save The Cat'
            )
            : { transformText: '', instructionText: '', prompt: '' };
        const gossamerPromptSplit = splitLeadSentence(gossamerPromptParts.instructionText);
        const gossamerRequestTokens = estimateTokensFromChars(gossamerPromptSplit.lead.length);
        const gossamerInstructionTokens = estimateTokensFromChars(gossamerPromptSplit.remainder.length);
        const gossamerTransformTokens = estimateTokensFromChars(gossamerPromptParts.transformText.length);
        const gossamerOutputContractTokens = estimateTokensFromChars(
            buildOutputRulesText({
                returnType: 'json',
                responseSchema: getUnifiedBeatAnalysisJsonSchema()
            }).length
        );
        const gossamerDisplayCorpus = await buildDisplayCorpusEstimateFromManifestEntries(
            gossamerSceneFiles.map(file => ({
                path: file.path,
                mtime: file.stat?.mtime ?? Date.now(),
                class: 'scene',
                mode: 'full',
                isTarget: false
            }))
        );
        const gossamerCorpusTokens = gossamerDisplayCorpus.estimatedTokens;
        const gossamerProviderTokens = gossamerEstimate.providerExecutionEstimate.estimatedTokens;
        const inquiryPromptBreakdown: PromptRequestBreakdown = {
            requestTokens: inquiryRequestTokens,
            roleTemplateTokens,
            instructionTokens: inquiryInstructionTokens,
            outputContractTokens: inquiryOutputContractTokens,
            transformTokens: 0
        };
        const gossamerPromptBreakdown: PromptRequestBreakdown = {
            requestTokens: gossamerRequestTokens,
            roleTemplateTokens,
            instructionTokens: gossamerInstructionTokens,
            outputContractTokens: gossamerOutputContractTokens,
            transformTokens: gossamerTransformTokens
        };

        const inquiryProviderCount = methodToPanelEstimate(
            inquiryExecutionEstimate?.method,
            inquiryExecutionEstimate?.estimatedTokens
        );
        const gossamerProviderCount = methodToPanelEstimate(
            gossamerEstimate.providerExecutionEstimate.method,
            gossamerProviderTokens
        );
        return {
            inquiry: {
                available: Boolean(currentCorpus),
                corpusTokens: inquiryCorpusTokens,
                providerCount: inquiryProviderCount,
                sceneCount: currentCorpus?.corpus.sceneCount ?? 0,
                outlineCount: currentCorpus?.corpus.outlineCount ?? 0,
                referenceCount: currentCorpus?.corpus.referenceCount ?? 0,
                breakdown: currentCorpus?.corpus.breakdown ?? {
                    scenesTokens: 0,
                    outlineTokens: 0,
                    referenceTokens: 0
                },
                promptBreakdown: inquiryPromptBreakdown,
                expectedPassCount: inquiryExecutionEstimate?.expectedPassCount ?? currentCorpus?.expectedPassCount ?? 1
            },
            gossamer: {
                available: true,
                corpusTokens: gossamerCorpusTokens,
                providerCount: gossamerProviderCount,
                sceneCount: gossamerDisplayCorpus.sceneCount,
                outlineCount: gossamerDisplayCorpus.outlineCount,
                referenceCount: gossamerDisplayCorpus.referenceCount,
                breakdown: gossamerDisplayCorpus.breakdown,
                promptBreakdown: gossamerPromptBreakdown
            },
        };
    };

    /**
     * Map the InputTokenEstimateMethod to a PanelTokenEstimate. Delegates
     * to the canonical `tokenEstimateFromMethod` in `src/ai/estimates` so
     * every surface (panel, cost table, inquiry HUD) uses the same shape.
     */
    const methodToPanelEstimate = (
        method: import('../../ai/tokens/inputTokenEstimate').TokenEstimateMethod | undefined,
        tokens: number | undefined
    ): PanelTokenEstimate => {
        return tokenEstimateFromMethod(method, tokens);
    };

    /**
     * Convert promptBreakdown's nullable fields into the non-null shape the
     * pure builder expects. Null entries (formatter convention for "not
     * counted") become 0 — that's safe because the builder only sums
     * positive token values when computing local estimates.
     */
    const toBuilderPromptBreakdown = (b: PromptRequestBreakdown) => ({
        requestTokens: b.requestTokens ?? 0,
        roleTemplateTokens: b.roleTemplateTokens ?? 0,
        instructionTokens: b.instructionTokens ?? 0,
        outputContractTokens: b.outputContractTokens ?? 0,
        transformTokens: b.transformTokens ?? 0
    });

    const runRefreshRoutingUi = async (): Promise<void> => {
        const aiSettings = ensureCanonicalAiSettings();
        const provider = aiSettings.provider === 'none' ? 'openai' : aiSettings.provider;
        const providerAllowedAliases = getProviderAllowedAliases(provider);
        const providerPickerAliases = getProviderPickerAliases(provider);

        if (aiSettings.modelPolicy.type === 'pinned') {
            const allowed = new Set(providerAllowedAliases);
            if (!aiSettings.modelPolicy.pinnedAlias || !allowed.has(aiSettings.modelPolicy.pinnedAlias)) {
                aiSettings.modelPolicy.pinnedAlias = getProviderDefaultAlias(provider);
            }
        }

        const policy = aiSettings.modelPolicy;

        const isOllama = provider === 'ollama';

        isSyncingRoutingUi = true;
        try {
            setDropdownValueSafe(providerDropdown, provider, 'openai');
            refreshProviderDisclosure(provider);

            if (modelOverrideDropdown) {
                modelOverrideDropdown.selectEl.empty();
                if (isOllama) {
                    modelOverrideDropdown.selectEl.disabled = false;
                    const localModelOptions = getLocalStrategyModelOptions();
                    localModelOptions.forEach(option => {
                        modelOverrideDropdown?.addOption(option.value, option.label);
                    });
                    const fallbackLocalModel = localModelOptions[0]?.value;
                    setDropdownValueSafe(modelOverrideDropdown, getOllamaModelId().trim(), fallbackLocalModel);
                } else {
                    modelOverrideDropdown.selectEl.disabled = false;
                    modelOverrideDropdown.addOption('auto', 'Auto');
                    getProviderPickerModels(provider).forEach(model => {
                        modelOverrideDropdown?.addOption(model.alias, model.label);
                    });
                    if (provider === 'openai'
                        && policy.type === 'pinned'
                        && policy.pinnedAlias
                        && isOpenAiInternalAlias(policy.pinnedAlias)
                        && !providerPickerAliases.includes(policy.pinnedAlias)) {
                        modelOverrideDropdown.addOption(
                            policy.pinnedAlias,
                            formatOpenAiInternalPinnedLabel(policy.pinnedAlias)
                        );
                    }
                    const overrideValue = policy.type === 'pinned'
                        ? policy.pinnedAlias || 'auto'
                        : 'auto';
                    setDropdownValueSafe(modelOverrideDropdown, overrideValue, 'auto');
                }
            }

            if (accessTierDropdown) {
                if (isOllama) {
                    accessTierDropdown.selectEl.empty();
                    accessTierDropdown.addOption('auto', 'Auto');
                    accessTierDropdown.addOption('custom', 'Custom');
                    accessTierDropdown.selectEl.disabled = false;
                    setDropdownValueSafe(accessTierDropdown, getLocalLlmConfigurationMode(), 'auto');
                } else {
                    accessTierDropdown.selectEl.disabled = false;
                    // Restore tier options if they were replaced by "—"
                    if (!Array.from(accessTierDropdown.selectEl.options).some(o => o.value === '1')) {
                        accessTierDropdown.selectEl.empty();
                        accessTierDropdown.addOption('1', 'Tier 1');
                        accessTierDropdown.addOption('2', 'Tier 2');
                        accessTierDropdown.addOption('3', 'Tier 3');
                        accessTierDropdown.addOption('4', 'Tier 4');
                    }
                }
            }

        } finally {
            isSyncingRoutingUi = false;
        }

        providerSetting.settingEl.toggleClass('ert-settings-hidden', false);
        providerSetting.settingEl.toggleClass('ert-settings-visible', true);
        // Model and Access Tier stay visible but show "—" when Local LLM is active.
        modelOverrideSetting.settingEl.toggleClass('ert-settings-hidden', false);
        modelOverrideSetting.settingEl.toggleClass('ert-settings-visible', true);
        accessTierSetting.settingEl.toggleClass('ert-settings-hidden', false);
        accessTierSetting.settingEl.toggleClass('ert-settings-visible', true);

        const modelStrategyDesc = modelOverrideSetting.settingEl.querySelector('.ert-ai-strategy-row__desc');
        if (modelStrategyDesc instanceof HTMLElement) {
            modelStrategyDesc.textContent = isOllama ? LOCAL_MODEL_STRATEGY_COPY : 'Use Auto for deterministic latest-stable selection, or pin a specific model.';
        }
        const accessTierDesc = accessTierSetting.settingEl.querySelector('.ert-ai-strategy-row__desc');
        if (accessTierDesc instanceof HTMLElement) {
            accessTierDesc.textContent = isOllama ? LOCAL_OVERRIDE_COPY : ACCESS_TIER_COPY;
        }
        const accessTierName = accessTierSetting.settingEl.querySelector('.setting-item-name');
        if (accessTierName instanceof HTMLElement) {
            accessTierName.textContent = isOllama ? 'Setup' : 'Access';
        }

        if (!isOllama) {
            const supportsAccessTier = provider === 'anthropic' || provider === 'openai' || provider === 'google';
            if (supportsAccessTier) {
                accessTierDropdown?.setValue(String(getAccessTier(provider)));
            } else {
                accessTierDropdown?.setValue('1');
            }
        }

        apiKeysFold.toggleClass('ert-settings-hidden', isOllama);
        apiKeysFold.toggleClass('ert-settings-visible', !isOllama);

        const showLocalLlmStatusDetails = isOllama;
        // Config card (raw transport controls) is Custom-only now; auto mode stays
        // a clean status line. A model mismatch self-heals via auto model selection.
        const showLocalLlmConfigDetails = isOllama && getLocalLlmConfigurationMode() === 'custom';

        if (localLlmConfigSectionEl) {
            localLlmConfigSectionEl.toggleClass('ert-settings-hidden', !showLocalLlmConfigDetails);
            localLlmConfigSectionEl.toggleClass('ert-settings-visible', showLocalLlmConfigDetails);
        }
        if (localLlmStatusSectionEl) {
            localLlmStatusSectionEl.toggleClass('ert-settings-hidden', !showLocalLlmStatusDetails);
            localLlmStatusSectionEl.toggleClass('ert-settings-visible', showLocalLlmStatusDetails);
        }
        largeHandlingSection.toggleClass('ert-settings-hidden', isOllama);
        largeHandlingSection.toggleClass('ert-settings-visible', !isOllama);

        capacityInquiryToken.setText('Calculating...');
        capacityInquiryExpected.setText('Calculating...');
        renderPanelViewModelSections(capacityInquirySections, buildPanelViewModel({
            feature: 'inquiry',
            forecast: { kind: 'pending', reason: 'Calculating…' }
        }));
        capacityGossamerToken.setText('Calculating...');
        capacityGossamerExpected.setText('Calculating...');
        renderPanelViewModelSections(capacityGossamerSections, buildPanelViewModel({
            feature: 'gossamer',
            forecast: { kind: 'pending', reason: 'Calculating…' }
        }));
        void refreshCostComparisonTable();

        if (isOllama) {
            if (localLlmServerDetectionPending || localLlmModelLoadPending) {
                renderLocalPreviewUnavailable('Checking Local Server...', 'Looking for a reachable local server and available models.');
                setActiveCostComparisonRow(null, null);
                return;
            }
            if (!localLlmDetectedServers.length) {
                renderLocalPreviewUnavailable('No Local Server Detected', 'Start a local server or switch Setup to Custom.');
                setActiveCostComparisonRow(null, null);
                return;
            }
        }

        try {
            const prepared = await getAIClient(plugin).prepareRunEstimate({
                feature: 'InquiryMode',
                task: 'SettingsCapacityPreview',
                requiredCapabilities: capabilityFloor,
                featureModeInstructions: 'Estimate Inquiry capacity for current settings.',
                userInput: 'Capacity preview request.',
                promptText: 'Capacity preview request.',
                returnType: 'json',
                responseSchema: { type: 'object' },
                providerOverride: provider,
                policyOverride: policy,
                overrides: aiSettings.overrides
            });
            if (!prepared.ok) {
                throw new Error(prepared.result.error || prepared.result.reason || 'Unable to resolve AI capacity.');
            }
            const estimate = prepared.estimate;
            const registryModels = await getAIClient(plugin).getRegistryModels();
            const latestResolution = resolveDisplayModelForLatestAlias(registryModels, estimate.model);
            const displayModel = latestResolution.displayModel;
            const safeBudgetTokens = Math.max(0, Math.floor(estimate.effectiveInputCeiling));
            const previewState: ResolvedPreviewRenderState = {
                provider,
                modelId: latestResolution.resolvedModelId ?? '',
                modelLabel: displayModel.label,
                modelAlias: estimate.model.alias,
                idPending: latestResolution.isPending,
                contextWindow: estimate.model.contextWindow,
                maxInputTokens: estimate.maxInputTokens,
                maxOutputTokens: estimate.maxOutputTokens,
                citationLabel: resolvePreviewCitationSignal(estimate.model),
                reuseLabel: resolvePreviewReuseSignal(estimate.model),
                passBehaviorLabel: null,
                isPreview: estimate.model.status === 'preview'
            };
            const currentCorpus = getCurrentCorpusContext();
            if (currentCorpus) {
                const executionEstimate = await buildCurrentInquiryExecutionEstimate({
                    provider,
                    modelId: estimate.model.id,
                    questionText: INQUIRY_CANONICAL_ESTIMATE_QUESTION
                });
                if (executionEstimate && executionEstimate.estimatedTokens > 0) {
                    const passes = executionEstimate.expectedPassCount ?? 1;
                    previewState.passBehaviorLabel = passes <= 1
                        ? { text: 'Context · Single-pass at this corpus' }
                        : { text: `Context · ${passes}-pass likely at this corpus` };
                }
            }
            if (isOllama) {
                // Local engines render from live detection/validation state so
                // the card matches the cloud presentation (status + capability).
                renderLocalResolvedPreview();
                setActiveCostComparisonRow(null, null);
            } else {
                renderResolvedPreview(previewState);
                setActiveCostComparisonRow(provider, displayModel.id);
            }
            const forecasts = await computeVaultForecasts({
                provider,
                modelId: estimate.model.id
            });
            const inquiryForecastInput: FeatureForecastInput = forecasts.inquiry.available
                ? {
                      kind: 'available',
                      providerCount: forecasts.inquiry.providerCount,
                      corpusBreakdown: forecasts.inquiry.breakdown,
                      promptBreakdown: toBuilderPromptBreakdown(forecasts.inquiry.promptBreakdown),
                      sceneCount: forecasts.inquiry.sceneCount,
                      outlineCount: forecasts.inquiry.outlineCount,
                      referenceCount: forecasts.inquiry.referenceCount,
                      safeInputBudget: safeBudgetTokens,
                      providerKnownPassCount: forecasts.inquiry.providerCount.source === 'provider_count'
                          ? forecasts.inquiry.expectedPassCount
                          : undefined
                  }
                : { kind: 'pending', reason: 'Open Inquiry View — corpus context is not loaded.' };
            const inquiryViewModel = buildPanelViewModel({
                feature: 'inquiry',
                provider,
                modelId: estimate.model.id,
                forecast: inquiryForecastInput
            });
            renderPanelViewModelHeader({
                tokenEl: capacityInquiryToken,
                expectedEl: capacityInquiryExpected,
                providerInputEl: capacityInquiryProvider,
                viewModel: inquiryViewModel
            });
            renderPanelViewModelSections(capacityInquirySections, inquiryViewModel);

            const gossamerForecastInput: FeatureForecastInput = {
                kind: 'available',
                providerCount: forecasts.gossamer.providerCount,
                corpusBreakdown: forecasts.gossamer.breakdown,
                promptBreakdown: toBuilderPromptBreakdown(forecasts.gossamer.promptBreakdown),
                sceneCount: forecasts.gossamer.sceneCount,
                outlineCount: forecasts.gossamer.outlineCount,
                referenceCount: forecasts.gossamer.referenceCount,
                safeInputBudget: safeBudgetTokens
                // No providerKnownPassCount — Gossamer is always single-pass.
            };
            const gossamerViewModel = buildPanelViewModel({
                feature: 'gossamer',
                provider,
                modelId: estimate.model.id,
                forecast: gossamerForecastInput
            });
            renderPanelViewModelHeader({
                tokenEl: capacityGossamerToken,
                expectedEl: capacityGossamerExpected,
                providerInputEl: capacityGossamerProvider,
                viewModel: gossamerViewModel
            });
            renderPanelViewModelSections(capacityGossamerSections, gossamerViewModel);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (isOllama) {
                // The cost/capacity forecast is cloud-oriented and can't resolve a
                // local model's path id, but the local state has everything the
                // card needs — render the same first-class local preview instead
                // of a false "No eligible model" contradiction.
                renderLocalResolvedPreview();
                setActiveCostComparisonRow(null, null);
                return;
            }
            renderResolvedPreview({
                provider,
                modelId: '',
                modelLabel: 'No eligible model',
                modelAlias: providerLabel[provider],
                idPending: false,
                contextWindow: null,
                maxInputTokens: null,
                maxOutputTokens: null,
                citationLabel: null,
                reuseLabel: null,
                passBehaviorLabel: null,
                isPreview: false
            });
            setActiveCostComparisonRow(null, null);
            capacityInquiryToken.setText('Failed');
            capacityInquiryExpected.setText('Forecast failed');
            capacityInquiryProvider.setText(message);
            renderCapacitySections(capacityInquirySections, [{
                title: 'Failure',
                items: [`Inquiry transparency forecast failed: ${message}`]
            }]);
            capacityGossamerToken.setText('Failed');
            capacityGossamerExpected.setText('Forecast failed');
            capacityGossamerProvider.setText(message);
            renderCapacitySections(capacityGossamerSections, [{
                title: 'Failure',
                items: [`Gossamer transparency forecast failed: ${message}`]
            }]);
        }

    };

    /**
     * The pulse belongs to the whole resolve, not to the repaints inside it.
     * Wrapping is what guarantees the dots stop on the failure path too.
     */
    const refreshRoutingUi = async (): Promise<void> => {
        routingUiRunCount += 1;
        refreshResolvedPreviewBusy();
        try {
            await runRefreshRoutingUi();
        } finally {
            routingUiRunCount -= 1;
            refreshResolvedPreviewBusy();
        }
    };

    // Provider sections
    const anthropicSection = configurationBody.createDiv({
        cls: ['ert-provider-section', 'ert-provider-anthropic', ERT_CLASSES.STACK]
    });
    const googleSection = configurationBody.createDiv({
        cls: ['ert-provider-section', 'ert-provider-google', ERT_CLASSES.STACK]
    });
    const openaiSection = configurationBody.createDiv({
        cls: ['ert-provider-section', 'ert-provider-openai', ERT_CLASSES.STACK]
    });
    params.setProviderSections({ anthropic: anthropicSection, google: googleSection, openai: openaiSection });
    params.addAiRelatedElement(anthropicSection);
    params.addAiRelatedElement(googleSection);
    params.addAiRelatedElement(openaiSection);

    const secretStorageAvailable = isSecretStorageAvailable(app);

    if (!secretStorageAvailable) {
        const warningSetting = new Settings(configurationBody)
            .setName(t('settings.ai.secureKey.unavailableName'))
            .setDesc(t('settings.ai.secureKey.unavailableDesc'));
        params.addAiRelatedElement(warningSetting.settingEl);
    }

    if (secretStorageAvailable && needsLegacyKeyMigration(plugin)) {
        const migrateKeysSetting = new Settings(configurationBody)
            .setName(t('settings.ai.secureKey.migrateName'))
            .setDesc(t('settings.ai.secureKey.migrateDesc'));
        migrateKeysSetting.addButton(button => button
            .setButtonText(t('settings.ai.secureKey.migrateButton'))
            .onClick(async () => {
                button.setDisabled(true);
                try {
                    const migration = await migrateLegacyKeysToSecretStorage(plugin);
                    if (migration.migratedProviders.length) {
                        new Notice(`Secured ${migration.migratedProviders.length} provider key(s).`);
                    } else {
                        new Notice(t('settings.ai.secureKey.noLegacyKeysNotice'));
                    }
                    if (migration.warnings.length) {
                        new Notice(migration.warnings[0]);
                    }
                    void refreshRoutingUi();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    new Notice(`Key migration failed: ${message}`);
                } finally {
                    button.setDisabled(false);
                }
            }));
        params.addAiRelatedElement(migrateKeysSetting.settingEl);
    }

    type ProviderKeyUiState = 'ready' | 'not_configured' | 'rejected' | 'network_blocked' | 'checking';
    const configureSensitiveInput = (inputEl: HTMLInputElement): void => {
        inputEl.type = 'password';
        inputEl.autocomplete = 'new-password';
        inputEl.spellcheck = false;
    };
    const extractStatusCodeFromError = (message: string): number | null => {
        const wrapped = message.match(/\((\d{1,3})\)/);
        if (wrapped) return Number(wrapped[1]);
        const direct = message.match(/\b(?:status|http)\s*(\d{1,3})\b/i);
        if (direct) return Number(direct[1]);
        return null;
    };
    const isAuthError = (message: string, statusCode: number | null): boolean => {
        if (statusCode === 400 || statusCode === 401 || statusCode === 403) return true;
        return /unauthorized|forbidden|invalid (?:api )?key|invalid auth|authentication/i.test(message);
    };
    const buildProviderValidationDetail = (message: string, statusCode: number | null): string => {
        if (statusCode === 429) return 'Provider rate limit reached (HTTP 429). Wait briefly and retry.';
        if (statusCode !== null && statusCode >= 500) return `Provider service error (HTTP ${statusCode}). Try again shortly.`;
        if (statusCode !== null) return `Provider returned HTTP ${statusCode} while validating the key.`;
        return `No HTTP status returned during validation (${message}).`;
    };
    interface ProviderKeyValidationResult {
        state: 'ready' | 'rejected' | 'network_blocked';
        detail: string;
    }
    const SAVED_KEY_ENTRY_COPY = 'Saved privately on this device. Paste a key, then click outside this field or press Enter/Return to save or replace it. Keys are never written to your settings file.';

    const validateProviderKeyQuick = async (
        provider: 'openai' | 'anthropic' | 'google',
        key: string
    ): Promise<ProviderKeyValidationResult> => {
        try {
            if (provider === 'anthropic') await fetchAnthropicModels(key);
                else if (provider === 'google') await fetchGoogleModels(key);
            else await fetchOpenAiModels(key);
            return {
                state: 'ready',
                detail: ''
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const statusCode = extractStatusCodeFromError(message);
            if (isAuthError(message, statusCode)) {
                return {
                    state: 'rejected',
                    detail: ''
                };
            }
            return {
                state: 'network_blocked',
                detail: buildProviderValidationDetail(message, statusCode)
            };
        }
    };

    const renderCredentialSettings = (options: {
        section: HTMLElement;
        provider: 'openai' | 'anthropic' | 'google';
        providerName: string;
        keyPlaceholder: string;
        docsUrl: string;
    }): void => {
        const doc = options.section.ownerDocument;
        const providerDesc = doc.win.createFragment();
        const span = doc.win.createSpan();
        span.textContent = `Choose a name to store your ${options.providerName} API key in this vault's secret storage. `;
        const link = doc.win.createEl('a');
        link.href = options.docsUrl;
        link.textContent = 'Get key';
        link.target = '_blank';
        link.rel = 'noopener';
        providerDesc.appendChild(span);
        providerDesc.appendChild(link);
        providerDesc.appendChild(doc.createTextNode(' Use a short name like "openai-main" so you can reuse it later. Note: saved Obsidian Secret Keys (distinct from Provider API keys) can only be used across the plugins you have installed in the same vault.'));

        const secretIdSetting = new Settings(options.section)
            .setName(`Vault secret name (${options.providerName})`)
            .setDesc(providerDesc);
        const keyStatusSetting = new Settings(options.section)
            .setName(`${options.providerName} API key status`)
            .setDesc('');
        keyStatusSetting.settingEl.addClass('ert-ai-provider-key-status-row');

        let providerState: ProviderKeyUiState = 'checking';
        let providerStateDetail = '';
        let replaceRequested = false;
        let revealSecretName = false;
        let secureKeySetting: Settings | null = null;
        let secureKeyInput: HTMLInputElement | null = null;
        const setSettingRowVisible = (setting: Settings, visible: boolean): void => {
            if (visible) {
                setting.settingEl.removeAttribute('hidden');
            } else {
                setting.settingEl.setAttribute('hidden', '');
            }
            setting.settingEl.toggleClass('ert-settings-hidden', !visible);
            setting.settingEl.toggleClass('ert-settings-visible', visible);
        };

        const setProviderState = (next: ProviderKeyUiState): void => {
            providerState = next;
            providerKeyStates[options.provider] = next;
            refreshDropdownKeyIndicators();
            refreshResolvedPreviewBusy();
            refreshActiveCostComparisonRowState(options.provider, next);
            const ai = ensureCanonicalAiSettings();
            const secretId = getCredentialSecretId(ai, options.provider).trim();
            const desc = doc.win.createFragment();

            const stateBlock = doc.win.createDiv();
            stateBlock.className = `ert-ai-provider-key-state is-${next}`;
            const icon = stateBlock.createSpan({ cls: 'ert-ai-provider-key-state__icon' });
            setIcon(icon, next === 'ready' ? 'shield-check' : 'shield-alert');
            const body = stateBlock.createSpan({ cls: 'ert-ai-provider-key-state__body' });
            const text = body.createSpan({ cls: 'ert-ai-provider-key-state__text' });
            if (next === 'ready') {
                providerStateDetail = '';
                text.setText(t('settings.ai.credential.statusReady'));
            } else if (next === 'rejected') {
                providerStateDetail = '';
                text.setText(t('settings.ai.credential.statusRejected'));
            } else if (next === 'network_blocked') {
                text.setText(t('settings.ai.credential.statusNetworkBlocked'));
            } else if (next === 'checking') {
                providerStateDetail = '';
                text.setText(t('settings.ai.credential.statusChecking'));
            } else {
                providerStateDetail = '';
                text.setText(t('settings.ai.credential.statusNotConfigured'));
            }
            desc.appendChild(stateBlock);

            const helper = body.createSpan({ cls: 'ert-ai-provider-key-state__helper' });
            if (next === 'not_configured') {
                helper.textContent = t('settings.ai.credential.helperNotConfigured');
            } else if (next === 'rejected') {
                helper.textContent = t('settings.ai.credential.helperRejected');
            } else if (next === 'network_blocked') {
                helper.textContent = providerStateDetail || t('settings.ai.credential.helperNetworkBlocked');
            } else if (next === 'checking') {
                helper.textContent = t('settings.ai.credential.helperChecking');
            }
            if (!helper.textContent) helper.remove();

            if ((next === 'ready' || next === 'network_blocked') && secretStorageAvailable) {
                const actions = body.createSpan({ cls: 'ert-ai-provider-key-actions' });

                const replaceBtn = doc.win.createEl('button');
                replaceBtn.className = 'ert-ai-provider-key-action';
                replaceBtn.type = 'button';
                replaceBtn.textContent = t('settings.ai.credential.replaceKeyButton');
                replaceBtn.addEventListener('click', () => {
                    replaceRequested = true;
                    setProviderState(providerState);
                    secureKeyInput?.focus();
                });
                actions.appendChild(replaceBtn);

                if (secretId) {
                    const copyBtn = doc.win.createEl('button');
                    copyBtn.className = 'ert-ai-provider-key-action';
                    copyBtn.type = 'button';
                    copyBtn.textContent = t('settings.ai.credential.copyKeyNameButton');
                    copyBtn.addEventListener('click', () => {
                        revealSecretName = true;
                        setProviderState(providerState);
                        secretIdSetting.settingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        void navigator.clipboard.writeText(secretId)
                            .then(() => new Notice(t('settings.ai.credential.keyNameCopiedNotice')))
                            .catch(() => new Notice(t('settings.ai.credential.keyNameCopyFailNotice')));
                    });
                    actions.appendChild(copyBtn);
                }
            }

            keyStatusSetting.setDesc(desc);

            const showSecretIdRow = !secretStorageAvailable
                || next !== 'ready'
                || revealSecretName;
            setSettingRowVisible(secretIdSetting, showSecretIdRow);

            if (secureKeySetting) {
                const shouldShowInput = replaceRequested || next === 'not_configured' || next === 'rejected';
                setSettingRowVisible(secureKeySetting, shouldShowInput);
                if (!shouldShowInput && secureKeyInput) secureKeyInput.value = '';
            }
            params.refreshProviderDimming();
        };

        let keyStateCheckedAt = 0;
        let keyStateInFlight: Promise<void> | null = null;
        const refreshProviderKeyState = async (): Promise<void> => {
            if (keyStateInFlight) return keyStateInFlight;
            keyStateInFlight = runProviderKeyStateCheck().finally(() => {
                keyStateInFlight = null;
                keyStateCheckedAt = Date.now();
            });
            return keyStateInFlight;
        };
        providerKeyRefreshers[options.provider] = async () => {
            if (!keyStateInFlight && Date.now() - keyStateCheckedAt < PROVIDER_KEY_STATE_FRESHNESS_MS) return;
            await refreshProviderKeyState();
        };

        async function runProviderKeyStateCheck(): Promise<void> {
            const ai = ensureCanonicalAiSettings();
            if (secretStorageAvailable) {
                const savedKeyName = getCredentialSecretId(ai, options.provider).trim();
                if (!savedKeyName || !(await hasSecret(app, savedKeyName))) {
                    replaceRequested = false;
                    revealSecretName = false;
                    setProviderState('not_configured');
                    return;
                }

                const key = await getCredential(plugin, options.provider);
                if (!key || key.length < 8) {
                    replaceRequested = false;
                    revealSecretName = false;
                    setProviderState('not_configured');
                    return;
                }

                setProviderState('checking');
                const validation = await validateProviderKeyQuick(options.provider, key);
                providerStateDetail = validation.detail;
                if (validation.state === 'ready') {
                    replaceRequested = false;
                    revealSecretName = false;
                }
                setProviderState(validation.state);
                return;
            }
            replaceRequested = false;
            revealSecretName = false;
            setProviderState('not_configured');
        }
        secretIdSetting.addText(text => {
            const aiSettings = ensureCanonicalAiSettings();
            text.inputEl.addClass('ert-input--full');
            text
                .setPlaceholder(`${options.provider}-main`)
                .setValue(getCredentialSecretId(aiSettings, options.provider));
            plugin.registerDomEvent(text.inputEl, 'blur', () => {
                void (async () => {
                    const ai = ensureCanonicalAiSettings();
                    const nextId = text.getValue().trim();
                    setCredentialSecretId(ai, options.provider, nextId);
                    await persistCanonical();
                    await refreshProviderKeyState();
                })();
            });
        });
        secretIdSetting.settingEl.addClass('ert-setting-full-width-input');
        if (secretStorageAvailable) {
            setSettingRowVisible(secretIdSetting, false);
        }

        if (secretStorageAvailable) {
            secureKeySetting = new Settings(options.section)
                .setName(`${options.providerName} API key`)
                .setDesc(SAVED_KEY_ENTRY_COPY);
            secureKeySetting.addText(text => {
                text.inputEl.addClass('ert-input--full');
                configureSensitiveInput(text.inputEl);
                text.setPlaceholder(options.keyPlaceholder);
                secureKeyInput = text.inputEl;
                params.setKeyInputRef(options.provider, text.inputEl);

                plugin.registerDomEvent(text.inputEl, 'keydown', (event: KeyboardEvent) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        text.inputEl.blur();
                    }
                });

                plugin.registerDomEvent(text.inputEl, 'blur', () => {
                    void (async () => {
                        const value = text.getValue().trim();
                        if (!value) return;
                        const ai = ensureCanonicalAiSettings();
                        const secretId = getCredentialSecretId(ai, options.provider);
                        if (!secretId) {
                            new Notice(`Set a ${options.providerName} saved key name first.`);
                            return;
                        }
                        const stored = await setSecret(app, secretId, value);
                        if (!stored) {
                            new Notice(`Unable to save ${options.providerName} key privately.`);
                            return;
                        }
                        text.setValue('');
                        setProviderState('checking');
                        const validation = await validateProviderKeyQuick(options.provider, value);
                        providerStateDetail = validation.detail;
                        if (validation.state === 'ready') {
                            replaceRequested = false;
                            revealSecretName = false;
                        }
                        setProviderState(validation.state);
                        // A real key now exists in secret storage — recompute
                        // credential presence so the engine flips out of Demo Mode
                        // (this also notifies Inquiry views to re-resolve).
                        await plugin.refreshCredentialPresence();
                    })();
                });
            });
            secureKeySetting.settingEl.addClass('ert-setting-full-width-input');
            setSettingRowVisible(secureKeySetting, false);
            setProviderState(providerState);
        }

        void refreshProviderKeyState();

        if (!secretStorageAvailable) {
            options.section.createDiv({
                cls: 'ert-field-note',
                text: `${options.providerName} requires Obsidian secret storage. Older plaintext key fields are no longer supported.`
            });
        }
    };

    renderCredentialSettings({
        section: anthropicSection,
        provider: 'anthropic',
        providerName: PROVIDER_DISPLAY_LABELS.anthropic,
        keyPlaceholder: t('settings.ai.credential.placeholderAnthropic'),
        docsUrl: 'https://platform.claude.com'
    });
    renderCredentialSettings({
        section: googleSection,
        provider: 'google',
        providerName: PROVIDER_DISPLAY_LABELS.google,
        keyPlaceholder: t('settings.ai.credential.placeholderGoogle'),
        docsUrl: 'https://aistudio.google.com'
    });
    renderCredentialSettings({
        section: openaiSection,
        provider: 'openai',
        providerName: PROVIDER_DISPLAY_LABELS.openai,
        keyPlaceholder: t('settings.ai.credential.placeholderOpenai'),
        docsUrl: 'https://platform.openai.com'
    });

    params.setProviderSections({ anthropic: anthropicSection, google: googleSection, openai: openaiSection });

    let localLlmModelText: TextComponent | null = null;
    let localLlmServerDropdown: DropdownComponent | null = null;
    let localLlmLoadedModels: LocalLlmModelEntry[] = [];
    let localLlmDetectedServers: DetectedLocalServer[] = [];
    let localLlmServerDetectionError: string | null = null;
    let localLlmServerDetectionPending = false;
    let localLlmServerDetectionPromise: Promise<void> | null = null;
    let localLlmModelLoadError: string | null = null;
    let localLlmLastLoadedAt: string | null = null;
    let localLlmModelLoadPending = false;
    let localLlmModelLoadPromise: Promise<void> | null = null;
    let localLlmValidationReport: LocalLlmDiagnosticsReport | null = null;
    let localLlmValidationError: string | null = null;
    let localLlmLastValidatedAt: string | null = null;
    let localLlmValidationPending = false;
    let localLlmValidationPromise: Promise<void> | null = null;
    let localLlmAutoValidationTimer: number | null = null;
    let aiSectionDisposed = false;

    const clearLocalLlmAutoValidation = (): void => {
        if (localLlmAutoValidationTimer !== null) {
            window.clearTimeout(localLlmAutoValidationTimer);
            localLlmAutoValidationTimer = null;
        }
    };

    const getDetectedLocalServerCandidates = (): Array<{ backend: LocalLlmBackendId; baseUrl: string; label: string }> => {
        const configured = getLocalLlmSettings(ensureCanonicalAiSettings());
        const candidates: Array<{ backend: LocalLlmBackendId; baseUrl: string; label: string }> = [
            { backend: 'ollama', baseUrl: 'http://localhost:11434/v1', label: buildLocalServerOptionLabel('ollama', 'http://localhost:11434/v1') },
            { backend: 'lmStudio', baseUrl: 'http://localhost:1234/v1', label: buildLocalServerOptionLabel('lmStudio', 'http://localhost:1234/v1') },
            // mlx_lm.server (Apple MLX) defaults to :8080 and is OpenAI-compatible.
            { backend: 'openaiCompatible', baseUrl: 'http://localhost:8080/v1', label: buildLocalServerOptionLabel('openaiCompatible', 'http://localhost:8080/v1') }
        ];
        if (configured.baseUrl.trim()) {
            candidates.push({
                backend: configured.backend,
                baseUrl: configured.baseUrl.trim(),
                label: buildLocalServerOptionLabel(configured.backend, configured.baseUrl)
            });
        }
        const seen = new Set<string>();
        return candidates.filter(candidate => {
            const serverKey = buildLocalLlmServerKey(candidate.backend, candidate.baseUrl);
            if (seen.has(serverKey)) return false;
            seen.add(serverKey);
            return true;
        });
    };
    const getDetectedLocalServerByKey = (serverKey: string): DetectedLocalServer | null =>
        localLlmDetectedServers.find(server => server.serverKey === serverKey) ?? null;

    const hasLocalLlmSelectedModelMismatch = (): boolean => {
        const selectedModelId = getOllamaModelId().trim();
        if (!selectedModelId || !localLlmLoadedModels.length) return false;
        const selectedModelKey = buildLocalLlmModelIdentity(getLocalLlmBackendId(), getOllamaBaseUrl(), selectedModelId);
        return !localLlmLoadedModels.some(model => buildLocalLlmModelIdentity(getLocalLlmBackendId(), getOllamaBaseUrl(), model.id) === selectedModelKey);
    };

    // The raw transport controls (backend / base URL / manual model / JSON mode)
    // are shown ONLY when the user explicitly opts into Custom ("Advanced") mode.
    // Previously they auto-revealed on any detection failure or unreachable server,
    // which dumped the whole config card exactly when the user least wanted it. Auto
    // mode now stays a simple status line + Re-check; switch to Custom to edit these.
    const shouldRevealLocalLlmTransportSettings = (): boolean => {
        return getLocalLlmConfigurationMode() === 'custom';
    };
    const shouldRevealLocalLlmActionRow = (): boolean => {
        if (getLocalLlmConfigurationMode() === 'custom') return true;
        if (!localLlmDetectedServers.length) return true;
        if (localLlmModelLoadError || localLlmValidationError) return true;
        if (!localLlmLoadedModels.length) return true;
        if (hasLocalLlmSelectedModelMismatch()) return true;
        if (!localLlmValidationReport) return false;
        return !localLlmValidationReport.reachable.ok
            || !localLlmValidationReport.modelAvailable.ok
            || !localLlmValidationReport.basicCompletion.ok
            || !localLlmValidationReport.structuredJson.ok;
    };
    const getLocalCapabilityAssessment = (
        modelId: string,
        liveEntry?: Partial<LocalLlmModelEntry> | null
    ): LocalLlmCapabilityAssessment => {
        const canonical = BUILTIN_MODELS.find(model =>
            model.provider === 'ollama' && (model.id === modelId || model.alias === modelId)
        );
        const diagnostics = localLlmValidationReport?.modelId === modelId
            ? localLlmValidationReport
            : null;
        return inferLocalLlmCapability({
            modelId,
            contextWindow: liveEntry?.contextWindow ?? canonical?.contextWindow ?? null,
            maxOutput: liveEntry?.maxOutput ?? canonical?.maxOutput ?? null,
            diagnostics,
            declaredCapabilities: getLocalLlmSettings(ensureCanonicalAiSettings()).declaredCapabilities
        });
    };

    // Auto-pick: the most capable loaded model (highest tier), tie-broken by the
    // larger context window. Drives hands-off model selection in auto mode.
    const pickBestLocalModel = (models: LocalLlmModelEntry[]): LocalLlmModelEntry | null => {
        if (!models.length) return null;
        return models.slice().sort((a, b) => {
            const tierDelta = getLocalCapabilityAssessment(b.id, b).tier - getLocalCapabilityAssessment(a.id, a).tier;
            if (tierDelta !== 0) return tierDelta;
            return (b.contextWindow ?? 0) - (a.contextWindow ?? 0); // SAFE: sort comparator — models with no published context window sort last
        })[0];
    };

    const localLlmConfigSection = quickSetupPreviewSection.createDiv({
        cls: [`${ERT_CLASSES.CARD}`, `${ERT_CLASSES.PANEL}`, `${ERT_CLASSES.STACK}`, 'ert-ai-local-llm-config', 'ert-settings-hidden']
    });
    localLlmConfigSectionEl = localLlmConfigSection;
    localLlmConfigSection.createDiv({ cls: 'ert-section-title', text: t('settings.ai.localLlm.configTitle') });
    localLlmConfigSection.createDiv({
        cls: 'ert-section-desc',
        text: t('settings.ai.localLlm.configDesc')
    });

    const localLlmStatusSection = quickSetupPreviewSection.createDiv({
        cls: [`${ERT_CLASSES.CARD}`, `${ERT_CLASSES.PANEL}`, `${ERT_CLASSES.STACK}`, 'ert-ai-local-llm-status', 'ert-settings-hidden']
    });
    localLlmStatusSectionEl = localLlmStatusSection;
    // Header row doubles as the collapse control: when everything is healthy
    // the card folds down to this one line (the preview card above already
    // carries the full story) and expands on click or on any problem.
    const localLlmStatusHeader = localLlmStatusSection.createDiv({ cls: 'ert-ai-local-llm-status-header' });
    localLlmStatusHeader.createDiv({ cls: 'ert-section-title', text: t('settings.ai.localLlm.statusTitle') });
    const localLlmStatusHeaderSummary = localLlmStatusHeader.createDiv({ cls: 'ert-ai-local-llm-status-header-summary' });
    const localLlmStatusChevron = localLlmStatusHeader.createEl('button', {
        cls: 'clickable-icon ert-ai-local-llm-status-chevron',
        attr: { type: 'button', 'aria-label': 'Toggle local LLM status details' }
    });
    let localLlmStatusManuallyExpanded = false;
    plugin.registerDomEvent(localLlmStatusHeader, 'click', () => {
        if (!localLlmStatusSection.hasClass('is-collapsible')) return;
        localLlmStatusManuallyExpanded = !localLlmStatusManuallyExpanded;
        renderLocalLlmStatus();
    });
    localLlmStatusSection.createDiv({
        cls: 'ert-section-desc',
        text: t('settings.ai.localLlm.statusDesc')
    });
    const localLlmServerSetting = new Settings(localLlmStatusSection)
        .setName(t('settings.ai.localLlm.serverName'))
        .setDesc(t('settings.ai.localLlm.serverDesc'))
        .addDropdown(dropdown => {
            localLlmServerDropdown = dropdown;
            dropdown.onChange((value) => {
                const server = getDetectedLocalServerByKey(value);
                if (!server) return;
                void (async () => {
                    setLocalServerSelection(server.backend, server.baseUrl);
                    localLlmLoadedModels = [...server.models].sort((left, right) => left.id.localeCompare(right.id));
                    localLlmLastLoadedAt = server.detectedAt;
                    clearLocalLlmValidationState();
                    await persistCanonical();
                    renderLocalLlmModelList();
                    renderLocalLlmStatus();
                    queueLocalLlmAutoValidation();
                    void refreshRoutingUi();
                })();
            });
        });
    localLlmServerSetting.settingEl.addClass(ERT_CLASSES.ROW, 'ert-settings-hidden');
    const localLlmStatusGrid = localLlmStatusSection.createDiv({ cls: 'ert-ai-local-llm-status-grid' });
    const localLlmStatusSummaryCol = localLlmStatusGrid.createDiv({ cls: `${ERT_CLASSES.STACK_TIGHT} ert-ai-local-llm-status-column` });
    const localLlmStatusServerCol = localLlmStatusGrid.createDiv({ cls: `${ERT_CLASSES.STACK_TIGHT} ert-ai-local-llm-status-column` });
    const localLlmStatusCapabilityCol = localLlmStatusGrid.createDiv({ cls: `${ERT_CLASSES.STACK_TIGHT} ert-ai-local-llm-status-column` });
    const localLlmChecksDetail = localLlmStatusSection.createDiv({ cls: 'ert-ai-local-llm-status-grid ert-ai-local-llm-checks-detail' });
    const localLlmModelsSummary = localLlmStatusSection.createDiv({ cls: 'ert-field-note ert-ai-local-llm-model-summary' });
    const localLlmModelsList = localLlmStatusSection.createDiv({ cls: `${ERT_CLASSES.INLINE} ert-ai-local-llm-model-list` });
    const localLlmModelsLegend = localLlmStatusSection.createDiv({ cls: 'ert-field-note ert-ai-local-llm-model-legend' });
    const localLlmActionsRow = localLlmStatusSection.createDiv({
        cls: `${ERT_CLASSES.STACK_TIGHT} ert-card-subtle ert-ai-local-llm-actions-row ert-settings-hidden`
    });

    function clearLocalLlmModelLoadState(): void {
        localLlmLoadedModels = [];
        localLlmModelLoadError = null;
        localLlmLastLoadedAt = null;
    }

    function clearLocalLlmDetectedServerState(): void {
        localLlmDetectedServers = [];
        localLlmServerDetectionError = null;
    }

    function clearLocalLlmValidationState(): void {
        localLlmValidationReport = null;
        localLlmValidationError = null;
        localLlmLastValidatedAt = null;
    }

    function markLocalLlmConfigurationDirty(): void {
        clearLocalLlmDetectedServerState();
        clearLocalLlmModelLoadState();
        clearLocalLlmValidationState();
        renderLocalLlmModelList();
        renderLocalLlmStatus();
    }

    async function detectLocalLlmServers(options: { quiet?: boolean } = {}): Promise<void> {
        if (localLlmServerDetectionPromise) return localLlmServerDetectionPromise;
        localLlmServerDetectionPending = true;
        localLlmServerDetectionError = null;
        renderLocalLlmModelList();
        renderLocalLlmStatus();
        // Bounded like the validation chain. This one matters more: the auto-validation
        // timer calls it directly, so a detection that never settles leaves
        // localLlmServerDetectionPending true forever -- the busy UI reads that flag,
        // not the validation one -- and the guard above then hands the same stuck
        // promise to every later caller, wedging the panel until Settings is reopened.
        localLlmServerDetectionPromise = withTimeout((async () => {
            const candidates = getDetectedLocalServerCandidates();
            const settled = await Promise.allSettled(candidates.map(async candidate => {
                const models = await getLocalLlmClient(plugin).listModels({
                    backend: candidate.backend,
                    baseUrl: candidate.baseUrl,
                    timeoutMs: getLocalLlmUiTimeoutMs()
                });
                if (!models.length) {
                    throw new Error('No models reported by this local server.');
                }
                return {
                    serverKey: buildLocalLlmServerKey(candidate.backend, candidate.baseUrl),
                    label: candidate.label,
                    backend: candidate.backend,
                    baseUrl: normalizeLocalLlmServerBaseUrl(candidate.baseUrl),
                    models: [...models].sort((left, right) => left.id.localeCompare(right.id)),
                    detectedAt: new Date().toISOString()
                } satisfies DetectedLocalServer;
            }));
            localLlmDetectedServers = settled
                .flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
            localLlmServerDetectionError = localLlmDetectedServers.length
                ? null
                : 'No healthy local servers were detected automatically.';

            if (!localLlmDetectedServers.length) {
                clearLocalLlmModelLoadState();
                clearLocalLlmValidationState();
            }

            if (getLocalLlmConfigurationMode() === 'auto') {
                const configuredServerKey = getConfiguredLocalServerKey();
                const selectedServer = localLlmDetectedServers.length === 1
                    ? localLlmDetectedServers[0]
                    : (getDetectedLocalServerByKey(configuredServerKey) ?? localLlmDetectedServers[0] ?? null);
                if (selectedServer) {
                    const current = getLocalLlmSettings(ensureCanonicalAiSettings());
                    const serverChanged = current.backend !== selectedServer.backend
                        || buildLocalLlmServerKey(current.backend, current.baseUrl) !== selectedServer.serverKey;
                    localLlmLoadedModels = [...selectedServer.models];
                    localLlmModelLoadError = null;
                    localLlmLastLoadedAt = selectedServer.detectedAt;
                    // Auto-select a model when the saved one isn't among the loaded
                    // models (or none is set) — the hands-off half of the 1-click flow.
                    let modelChanged = false;
                    const currentModelId = getOllamaModelId().trim();
                    const hasCurrentModel = currentModelId.length > 0
                        && selectedServer.models.some(model => model.id === currentModelId);
                    if (!hasCurrentModel) {
                        const best = pickBestLocalModel(selectedServer.models);
                        if (best && best.id !== currentModelId) {
                            setOllamaModelId(best.id);
                            modelChanged = true;
                        }
                    }
                    if (serverChanged) {
                        setLocalServerSelection(selectedServer.backend, selectedServer.baseUrl);
                    }
                    if (serverChanged || modelChanged) {
                        await persistCanonical();
                    }
                }
            }

            if (!options.quiet) {
                new Notice(
                    localLlmDetectedServers.length
                        ? `Detected ${localLlmDetectedServers.length} healthy local server${localLlmDetectedServers.length === 1 ? '' : 's'}.`
                        : 'No healthy local servers detected automatically.'
                );
            }
        })(), LOCAL_LLM_GUARD_DEADLINE_MS, t('settings.ai.localLlm.validationDeadline')).catch((error: unknown) => {
            localLlmServerDetectionError = error instanceof Error ? error.message : String(error);
            localLlmDetectedServers = [];
        }).finally(() => {
            localLlmServerDetectionPending = false;
            localLlmServerDetectionPromise = null;
            renderLocalLlmModelList();
            renderLocalLlmStatus();
            // Only the local provider's card is waiting on this. If the author
            // has since switched to a cloud provider, their preview is already
            // resolved — recomputing it here would throw it back to
            // "Calculating…" long after they moved on.
            if (ensureCanonicalAiSettings().provider === 'ollama') void refreshRoutingUi();
        });
        return localLlmServerDetectionPromise;
    }

    function queueLocalLlmAutoValidation(): void {
        if (aiSectionDisposed) return;
        const aiSettings = ensureCanonicalAiSettings();
        if (aiSettings.provider !== 'ollama' || !getLocalLlmSettings(aiSettings).enabled) return;
        if (localLlmAutoValidationTimer !== null) {
            window.clearTimeout(localLlmAutoValidationTimer);
        }
        localLlmAutoValidationTimer = window.setTimeout(() => {
            localLlmAutoValidationTimer = null;
            if (aiSectionDisposed || ensureCanonicalAiSettings().provider !== 'ollama') return;
            // validateLocalLlm owns the complete detect -> load -> diagnose chain.
            void validateLocalLlm({ quiet: true });
        }, 150);
    }

    const localLlmBackendSetting = new Settings(localLlmConfigSection)
        .setName(t('settings.ai.localLlmConfig.serverName'))
        .setDesc(t('settings.ai.localLlmConfig.serverDesc'))
        .addDropdown(dropdown => {
            dropdown
                .addOption('ollama', t('settings.ai.localLlmConfig.optionOllama'))
                .addOption('lmStudio', t('settings.ai.localLlmConfig.optionLmStudio'))
                .addOption('openaiCompatible', t('settings.ai.localLlmConfig.optionOpenaiCompat'))
                .setValue(getLocalLlmBackendId())
                .onChange(async (value) => {
                    const aiSettings = ensureCanonicalAiSettings();
                    aiSettings.localLlm = {
                        ...getLocalLlmSettings(aiSettings),
                        backend: value as LocalLlmBackendId
                    };
                    markLocalLlmConfigurationDirty();
                    await persistCanonical();
                    params.scheduleKeyValidation('ollama');
                    queueLocalLlmAutoValidation();
                    void refreshRoutingUi();
                });
        });
    localLlmBackendSetting.settingEl.addClass(ERT_CLASSES.ROW);

    const localLlmBaseUrlSetting = new Settings(localLlmConfigSection)
        .setName(t('settings.ai.localLlmConfig.baseUrlName'))
        .setDesc(t('settings.ai.localLlmConfig.baseUrlDesc'))
        .addText(text => {
            text.inputEl.addClass('ert-input--full');
            text
                .setPlaceholder('http://localhost:11434/v1')
                .setValue(getOllamaBaseUrl());
            text.onChange(() => {
                text.inputEl.removeClass('ert-setting-input-success');
                text.inputEl.removeClass('ert-setting-input-error');
            });
            plugin.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    text.inputEl.blur();
                }
            });
            plugin.registerDomEvent(text.inputEl, 'blur', () => {
                void (async () => {
                    const aiSettings = ensureCanonicalAiSettings();
                    aiSettings.localLlm = {
                        ...getLocalLlmSettings(aiSettings),
                        baseUrl: text.getValue().trim() || 'http://localhost:11434/v1'
                    };
                    markLocalLlmConfigurationDirty();
                    await persistCanonical();
                    params.scheduleKeyValidation('ollama');
                    queueLocalLlmAutoValidation();
                })();
            });
            params.setOllamaConnectionInputs({ baseInput: text.inputEl });
        });
    localLlmBaseUrlSetting.settingEl.addClass('ert-setting-full-width-input');

    const localLlmModelSetting = new Settings(localLlmConfigSection)
        .setName(t('settings.ai.localLlmConfig.manualModelName'))
        .setDesc(t('settings.ai.localLlmConfig.manualModelDesc'))
        .addText(text => {
            text.inputEl.addClass('ert-input--lg');
            localLlmModelText = text;
            text
                .setPlaceholder('llama3')
                .setValue(getOllamaModelId());
            text.onChange(() => {
                text.inputEl.removeClass('ert-setting-input-success');
                text.inputEl.removeClass('ert-setting-input-error');
            });
            plugin.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    text.inputEl.blur();
                }
            });
            plugin.registerDomEvent(text.inputEl, 'blur', () => {
                void (async () => {
                    setOllamaModelId(text.getValue());
                    markLocalLlmConfigurationDirty();
                    await persistCanonical();
                    params.scheduleKeyValidation('ollama');
                    queueLocalLlmAutoValidation();
                    void refreshRoutingUi();
                })();
            });
            params.setOllamaConnectionInputs({ modelInput: text.inputEl });
        });
    localLlmModelSetting.settingEl.addClass(ERT_CLASSES.ROW);

    const localLlmJsonModeSetting = new Settings(localLlmConfigSection)
        .setName(t('settings.ai.localLlmConfig.jsonModeName'))
        .setDesc(t('settings.ai.localLlmConfig.jsonModeDesc'))
        .addDropdown(dropdown => {
            for (const [mode, labelKey] of Object.entries(LOCAL_LLM_JSON_MODE_LABEL_KEYS)) {
                dropdown.addOption(mode, t(labelKey));
            }
            dropdown
                .setValue(getLocalLlmSettings(ensureCanonicalAiSettings()).jsonMode)
                .onChange(async (value) => {
                    const aiSettings = ensureCanonicalAiSettings();
                    aiSettings.localLlm = {
                        ...getLocalLlmSettings(aiSettings),
                        jsonMode: value as LocalLlmJsonMode
                    };
                    markLocalLlmConfigurationDirty();
                    await persistCanonical();
                    params.scheduleKeyValidation('ollama');
                    queueLocalLlmAutoValidation();
                });
        });
    localLlmJsonModeSetting.settingEl.addClass(ERT_CLASSES.ROW);

    // Model capabilities. Local backends publish no capability manifest, so RT
    // treats every local model as `jsonStrict`-only until the author says
    // otherwise. Features with a higher floor (Summary refresh, Pulse, Runtime,
    // Timeline audit, Gossamer) refuse to dispatch to a local model that has not
    // declared what they need — these toggles are how that declaration is made.
    localLlmConfigSection.createDiv({
        cls: 'ert-section-title',
        text: t('settings.ai.localLlmConfig.capabilitiesTitle')
    });
    localLlmConfigSection.createDiv({
        cls: 'ert-section-desc',
        text: t('settings.ai.localLlmConfig.capabilitiesDesc')
    });

    // One toggle per capability, deliberately NOT collapsed. longContext and
    // highOutputCap look interchangeable in the requiredCapabilities gates, but
    // longContext has independent runtime consumers that read it alone:
    // ConceptSearchService.chunkBudgetFor() doubles the per-chunk input budget on
    // it, and engineCapabilities grades an engine 'standard' on it. Combining the
    // two would force an author who only wants larger concept-search chunks to
    // also declare an output ceiling they may not have verified.
    for (const capability of DECLARABLE_LOCAL_CAPABILITIES) {
        const capabilitySetting = new Settings(localLlmConfigSection)
            .setName(t(LOCAL_LLM_CAPABILITY_LABEL_KEYS[capability].name))
            .setDesc(t(LOCAL_LLM_CAPABILITY_LABEL_KEYS[capability].desc))
            .addToggle(toggle => toggle
                .setValue(getLocalLlmSettings(ensureCanonicalAiSettings()).declaredCapabilities.includes(capability))
                .onChange(async (value) => {
                    const aiSettings = ensureCanonicalAiSettings();
                    const current = getLocalLlmSettings(aiSettings);
                    const next = new Set(current.declaredCapabilities);
                    if (value) next.add(capability); else next.delete(capability);
                    // Scoped to the active model: reads resolve from capabilitiesByModel,
                    // so assigning declaredCapabilities directly would be discarded.
                    aiSettings.localLlm = withDeclaredCapabilitiesForActiveModel(
                        current,
                        DECLARABLE_LOCAL_CAPABILITIES.filter(entry => next.has(entry))
                    );
                    await persistCanonical();
                    // The tier pills and their feature tooltips report what RT
                    // will actually run, so they have to re-read the declaration.
                    renderLocalLlmModelList();
                    renderLocalLlmStatus();
                    void refreshRoutingUi();
                }));
        capabilitySetting.settingEl.addClass(ERT_CLASSES.ROW);
    }

    const formatLocalTimestamp = (iso: string | null): string | null => {
        if (!iso) return null;
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };

    const renderLocalLlmModelList = (): void => {
        const selectedModelId = getOllamaModelId().trim();
        const selectedModelKey = buildLocalLlmModelIdentity(getLocalLlmBackendId(), getOllamaBaseUrl(), selectedModelId);
        const selectedExists = localLlmLoadedModels.some(model =>
            buildLocalLlmModelIdentity(getLocalLlmBackendId(), getOllamaBaseUrl(), model.id) === selectedModelKey
        );
        const showTransportSettings = shouldRevealLocalLlmTransportSettings();
        const showManualModelFallback = getLocalLlmConfigurationMode() === 'custom'
            || !!localLlmModelLoadError
            || (!!localLlmLastLoadedAt && !selectedExists);

        localLlmBackendSetting.settingEl.toggleClass('ert-settings-hidden', !showTransportSettings);
        localLlmBackendSetting.settingEl.toggleClass('ert-settings-visible', showTransportSettings);
        localLlmBaseUrlSetting.settingEl.toggleClass('ert-settings-hidden', !showTransportSettings);
        localLlmBaseUrlSetting.settingEl.toggleClass('ert-settings-visible', showTransportSettings);

        localLlmModelSetting.settingEl.toggleClass('ert-settings-hidden', !showManualModelFallback);
        localLlmModelSetting.settingEl.toggleClass('ert-settings-visible', showManualModelFallback);

        localLlmModelsList.empty();
        localLlmModelsLegend.empty();
        localLlmModelsSummary.toggleClass('ert-settings-hidden', false);
        if (localLlmModelLoadPending) {
            localLlmModelsSummary.setText(t('settings.ai.localLlm.modelsLoading'));
            return;
        }

        if (localLlmModelLoadError) {
            localLlmModelsSummary.setText(`Local model list unavailable. ${formatLocalLlmUiError(localLlmModelLoadError)}`);
            return;
        }

        if (!localLlmLoadedModels.length) {
            localLlmModelsSummary.setText(
                getLocalLlmConfigurationMode() === 'auto'
                    ? t('settings.ai.localLlm.noModelsAuto')
                    : t('settings.ai.localLlm.noModelsCustom')
            );
            return;
        }

        // The healthy state is already covered by the status grid and the pills; only surface the mismatch warning.
        localLlmModelsSummary.setText(selectedExists ? '' : 'Selected model is missing from the loaded list.');
        localLlmModelsSummary.toggleClass('ert-settings-hidden', selectedExists);
        const appendLegendItem = (tier: 0 | 1 | 3 | 4, label: string): void => {
            const item = localLlmModelsLegend.createSpan({ cls: 'ert-ai-local-llm-legend-item' });
            item.createSpan({ cls: `ert-ai-local-llm-legend-swatch ert-ai-local-llm-legend-swatch--tier${tier}` });
            item.createSpan({ text: label });
        };
        appendLegendItem(0, t('settings.ai.localLlm.legendNotUsable'));
        appendLegendItem(1, t('settings.ai.localLlm.legendLimited'));
        appendLegendItem(3, t('settings.ai.localLlm.legendStrong'));
        appendLegendItem(4, t('settings.ai.localLlm.legendInquiryEligible'));

        localLlmLoadedModels.forEach(model => {
            const pill = localLlmModelsList.createSpan({
                cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ert-ai-resolved-preview-pill ert-ai-local-model-pill`
            });
            const capability = getLocalCapabilityAssessment(model.id, model);
            pill.addClass(`ert-ai-local-model-pill--tier${capability.tier}`);
            const isActiveModel = model.id === selectedModelId;
            if (isActiveModel) {
                pill.addClass(ERT_CLASSES.IS_ACTIVE);
            }
            pill.createSpan({ cls: 'ert-ai-local-model-pill-label', text: abbreviateLocalModelId(model.id) });
            if (isActiveModel) {
                pill.createSpan({ cls: 'ert-ai-local-model-pill-active', text: t('settings.ai.localLlm.modelActive') });
            }
            pill.setAttribute('role', 'button');
            pill.setAttribute('tabindex', '0');
            pill.setAttribute('aria-label', `Use local model ${model.id}. ${capability.tierName} ${capability.tierSummary}.`);
            setTooltip(pill, buildLocalCapabilityTooltip(capability), { placement: 'top' });
            const applyModel = async (): Promise<void> => {
                setOllamaModelId(model.id);
                if (localLlmModelText) localLlmModelText.setValue(model.id);
                clearLocalLlmValidationState();
                await persistCanonical();
                params.scheduleKeyValidation('ollama');
                renderLocalLlmModelList();
                renderLocalLlmStatus();
                queueLocalLlmAutoValidation();
                void refreshRoutingUi();
            };
            plugin.registerDomEvent(pill, 'click', () => { void applyModel(); });
            plugin.registerDomEvent(pill, 'keydown', (event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void applyModel();
                }
            });
        });
    };

    const formatLocalLlmUiError = (message: string | null | undefined): string => {
        const normalized = (message ?? '').trim();
        if (!normalized) return 'Unknown local server error.';
        if (/ERR_CONNECTION_REFUSED/i.test(normalized)) return 'Connection refused. The local server is not running.';
        if (/timed?\s*out/i.test(normalized)) return 'Timed out while contacting the local server.';
        if (/No models reported by this local server/i.test(normalized)) return 'A local server responded, but no models are loaded.';
        return normalized;
    };

    const buildLocalStatusValue = (): string => {
        const currentLocalLlm = getLocalLlmSettings(ensureCanonicalAiSettings());
        if (!currentLocalLlm.enabled) return 'Local LLM disabled';
        if (localLlmServerDetectionPending || localLlmModelLoadPending) return 'Checking local server';
        if (localLlmValidationPending) return 'Validating';
        if (!localLlmDetectedServers.length) return 'No local server detected';
        if (localLlmValidationError) return 'Needs review';
        if (localLlmValidationReport?.reachable.ok
            && localLlmValidationReport.modelAvailable.ok
            && localLlmValidationReport.basicCompletion.ok
            && localLlmValidationReport.structuredJson.ok) {
            return 'Connected & validated';
        }
        if (localLlmValidationReport?.reachable.ok) return 'Connected';
        if (localLlmValidationReport && !localLlmValidationReport.reachable.ok) return 'Local server offline';
        return 'Connected';
    };

    /**
     * The same branches as {@link buildLocalStatusValue}, as a dropdown state.
     *
     * Without this the Local LLM option was the one entry that never said
     * anything: while its (slow) server check ran, the three cloud providers
     * each read "(Checking…)" and local read as plain text, so the open list
     * looked like nothing was available except the provider that was silent.
     * Kept adjacent to, and branch-for-branch with, the status copy so the two
     * cannot drift into disagreeing about the same server.
     */
    const buildLocalProviderKeyState = (): string => {
        const currentLocalLlm = getLocalLlmSettings(ensureCanonicalAiSettings());
        if (!currentLocalLlm.enabled) return 'not_configured';
        if (localLlmServerDetectionPending || localLlmModelLoadPending) return 'checking';
        if (localLlmValidationPending) return 'checking';
        // Nothing has been asked of the server yet (the panel only probes when
        // local is the active provider). Say nothing rather than claim it is
        // unreachable — an unchecked server is not a failed one.
        if (!localLlmDetectedServers.length) return localLlmServerDetectionError ? 'network_blocked' : '';
        if (localLlmValidationError) return 'rejected';
        if (localLlmValidationReport && !localLlmValidationReport.reachable.ok) return 'network_blocked';
        return 'ready';
    };

    const buildLocalCheckValue = (
        label: 'Connection' | 'Model availability' | 'Basic validation' | 'Structured validation',
        check: { ok: boolean; message: string } | null,
        selectedExists: boolean
    ): string => {
        const hasHealthyServer = localLlmDetectedServers.length > 0;
        if (localLlmValidationPending) {
            if (label === 'Connection') return 'Checking local server...';
            return 'Validation in progress.';
        }
        if (!hasHealthyServer) {
            if (label === 'Connection') return 'No local server detected.';
            return 'Waiting for a local server.';
        }
        if (label === 'Model availability') {
            if (localLlmModelLoadPending) return 'Loading available models...';
            if (localLlmModelLoadError) return formatLocalLlmUiError(localLlmModelLoadError);
            if (!localLlmLoadedModels.length) return 'No models are loaded on this local server.';
            if (!getOllamaModelId().trim()) return 'Choose a local model.';
            return selectedExists ? 'Selected model is ready.' : 'Selected model is unavailable on this local server.';
        }
        if (!check) {
            if (label === 'Basic validation' || label === 'Structured validation') {
                return selectedExists ? 'Not checked yet.' : 'Waiting for an available model.';
            }
            return 'Not checked yet.';
        }
        if (label === 'Connection') {
            return check.ok ? 'Connected.' : formatLocalLlmUiError(check.message);
        }
        if (!check.ok) {
            return formatLocalLlmUiError(check.message);
        }
        return 'Passed.';
    };

    const renderLocalLlmStatus = (): void => {
        providerKeyStates.ollama = buildLocalProviderKeyState();
        refreshDropdownKeyIndicators();
        refreshResolvedPreviewBusy();
        const localLlm = getLocalLlmSettings(ensureCanonicalAiSettings());
        const selectedModelId = localLlm.defaultModelId.trim();
        const selectedExists = localLlmLoadedModels.some(model =>
            buildLocalLlmModelIdentity(localLlm.backend, localLlm.baseUrl, model.id)
                === buildLocalLlmModelIdentity(localLlm.backend, localLlm.baseUrl, selectedModelId)
        );
        const selectedCapability = getLocalCapabilityAssessment(selectedModelId, localLlmLoadedModels.find(model => model.id === selectedModelId) ?? null);
        const multipleDetectedServers = getLocalLlmConfigurationMode() === 'auto' && localLlmDetectedServers.length > 1;

        localLlmStatusSummaryCol.empty();
        localLlmStatusServerCol.empty();
        localLlmStatusCapabilityCol.empty();
        localLlmChecksDetail.empty();
        if (localLlmServerDropdown) {
            localLlmServerDropdown.selectEl.empty();
            localLlmDetectedServers.forEach(server => {
                localLlmServerDropdown?.addOption(server.serverKey, server.label);
            });
            if (localLlmDetectedServers.length) {
                localLlmServerDropdown.setValue(getConfiguredLocalServerKey());
            }
        }
        localLlmServerSetting.settingEl.toggleClass('ert-settings-hidden', !multipleDetectedServers);
        localLlmServerSetting.settingEl.toggleClass('ert-settings-visible', multipleDetectedServers);

        const statusValue = buildLocalStatusValue();
        const statusStamp = localLlmValidationPending ? null : formatLocalTimestamp(localLlmLastValidatedAt);

        const appendStatusItem = (container: HTMLElement, label: string, value: string): void => {
            const item = container.createDiv({ cls: 'ert-ai-local-llm-status-item' });
            item.createDiv({ cls: 'ert-ai-local-llm-status-label', text: label });
            item.createDiv({ cls: 'ert-ai-local-llm-status-value', text: value });
        };

        appendStatusItem(localLlmStatusSummaryCol, 'Status', statusStamp ? `${statusValue} · ${statusStamp}` : statusValue);
        appendStatusItem(localLlmStatusServerCol, 'Local server', localLlmDetectedServers.length
            ? `${LOCAL_LLM_BACKEND_LABELS[localLlm.backend]} · ${getOllamaBaseUrl()}`
            : 'No local server detected');
        appendStatusItem(localLlmStatusCapabilityCol, 'Capability', selectedModelId
            ? `${selectedCapability.tierSummary} (${selectedCapability.tierName})${selectedCapability.confidence === 'heuristic' ? ' (heuristic)' : ''} — ${buildLocalFeatureSummary(selectedCapability)}`
            : 'No local model selected');

        const checks: Array<[string, { ok: boolean; message: string } | null]> = [
            ['Connection', localLlmValidationReport?.reachable ?? null],
            ['Model availability', localLlmValidationReport?.modelAvailable ?? null],
            ['Basic validation', localLlmValidationReport?.basicCompletion ?? null],
            ['Structured validation', localLlmValidationReport?.structuredJson ?? null]
        ];
        const hasHealthyServer = localLlmDetectedServers.length > 0;
        const modelReady = !localLlmModelLoadPending && !localLlmModelLoadError
            && localLlmLoadedModels.length > 0 && !!selectedModelId && selectedExists;
        const allChecksPassed = modelReady
            && checks.every(([, check]) => check?.ok)
            && !localLlmValidationError
            && !localLlmServerDetectionError;
        const appendChecksRollup = (text: string, busy = false): void => {
            const rollup = localLlmChecksDetail.createDiv({ cls: 'ert-field-note ert-ai-local-llm-checks-rollup' });
            rollup.createSpan({ text });
            if (!busy) return;
            const dots = rollup.createSpan({
                cls: 'ert-ai-local-validation-dots',
                attr: { 'aria-hidden': 'true' }
            });
            for (let dot = 0; dot < 3; dot += 1) {
                dots.createSpan({ cls: 'ert-ai-local-validation-dot' });
            }
        };

        if (localLlmValidationPending) {
            appendChecksRollup('Running validation checks...', true);
        } else if (allChecksPassed) {
            appendChecksRollup('All checks passed — connection · model availability · basic · structured.');
            // The one finding that matters BECAUSE nothing is broken. Collapsing
            // it with the rest of the detail would hide the only actionable
            // result of a green run.
            const timing = localLlmValidationReport?.jsonModeTiming;
            if (timing) {
                const note = localLlmChecksDetail.createDiv({
                    cls: 'ert-field-note ert-ai-local-llm-checks-rollup is-actionable'
                });
                note.setText(
                    `Structured JSON mode: ${timing.label} took ${(timing.ms / 1000).toFixed(1)}s here. `
                    + `${timing.alternateLabel} is usually much faster on local servers, and Radial Timeline `
                    + 'validates every reply either way — worth trying if runs feel slow.'
                );
            }
        } else if (!hasHealthyServer) {
            appendChecksRollup(localLlmServerDetectionError
                ? 'No healthy local servers were detected automatically.'
                : 'Checks run once a local server is detected.');
        } else {
            checks.forEach(([label, check]) => {
                const value = buildLocalCheckValue(label as 'Connection' | 'Model availability' | 'Basic validation' | 'Structured validation', check, selectedExists);
                appendStatusItem(localLlmChecksDetail, label, value);
            });
            if (localLlmValidationError) {
                appendStatusItem(localLlmChecksDetail, 'Validation', formatLocalLlmUiError(localLlmValidationError));
            }
            if (localLlmServerDetectionError) {
                appendStatusItem(localLlmChecksDetail, 'Server detection', 'No healthy local servers were detected automatically.');
            }
        }
        const showActions = shouldRevealLocalLlmActionRow();
        localLlmActionsRow.toggleClass('ert-settings-hidden', !showActions);
        localLlmActionsRow.toggleClass('ert-settings-visible', showActions);

        // Collapse to the header line when fully healthy — the preview card
        // above already tells the whole story. Any pending or problem state
        // force-expands so issues are never hidden behind a fold.
        const statusHealthy = allChecksPassed && !localLlmValidationPending;
        if (!statusHealthy) localLlmStatusManuallyExpanded = false;
        const statusCollapsed = statusHealthy && !localLlmStatusManuallyExpanded;
        localLlmStatusSection.toggleClass('is-collapsible', statusHealthy);
        localLlmStatusSection.toggleClass('is-collapsed', statusCollapsed);
        localLlmStatusChevron.toggleClass('ert-settings-hidden', !statusHealthy);
        setIcon(localLlmStatusChevron, statusCollapsed ? 'chevron-right' : 'chevron-down');
        localLlmStatusHeaderSummary.setText(statusCollapsed
            ? [statusValue, statusStamp, abbreviateLocalModelId(selectedModelId)].filter(Boolean).join(' · ')
            : '');
    };

    async function loadLocalLlmModels(options: { quiet?: boolean } = {}): Promise<void> {
        if (localLlmModelLoadPromise) return localLlmModelLoadPromise;
        localLlmModelLoadPending = true;
        localLlmModelLoadError = null;
        renderLocalLlmModelList();
        renderLocalLlmStatus();
        localLlmModelLoadPromise = withTimeout((async () => {
            try {
                const detectedServer = getDetectedLocalServerByKey(getConfiguredLocalServerKey());
                if (detectedServer) {
                    localLlmLoadedModels = [...detectedServer.models];
                    localLlmModelLoadError = null;
                    localLlmLastLoadedAt = detectedServer.detectedAt;
                    if (!options.quiet) {
                        new Notice(`Loaded ${localLlmLoadedModels.length} local model${localLlmLoadedModels.length === 1 ? '' : 's'} from ${detectedServer.label}.`);
                    }
                    return;
                }
                const models = await getLocalLlmClient(plugin).listModels(getLocalLlmUiOverrides());
                localLlmLoadedModels = [...models].sort((left, right) => left.id.localeCompare(right.id));
                localLlmModelLoadError = null;
                localLlmLastLoadedAt = new Date().toISOString();
                if (!options.quiet) {
                    new Notice(localLlmLoadedModels.length
                        ? `Loaded ${localLlmLoadedModels.length} local model${localLlmLoadedModels.length === 1 ? '' : 's'}.`
                        : 'No models reported by the Local LLM backend.');
                }
            } catch (error) {
                localLlmLoadedModels = [];
                localLlmModelLoadError = error instanceof Error ? error.message : String(error);
                if (!options.quiet) {
                    new Notice(`Unable to load local models: ${localLlmModelLoadError}`);
                }
            }
        })(), LOCAL_LLM_GUARD_DEADLINE_MS, t('settings.ai.localLlm.validationDeadline')).catch((error: unknown) => {
            localLlmLoadedModels = [];
            localLlmModelLoadError = error instanceof Error ? error.message : String(error);
        }).finally(() => {
            localLlmModelLoadPending = false;
            localLlmModelLoadPromise = null;
            renderLocalLlmModelList();
            renderLocalLlmStatus();
            void refreshRoutingUi();
        });
        return localLlmModelLoadPromise;
    }

    // Safety ceiling for the separately guarded detection and model-list calls.
    // Their transports have shorter deadlines; this guarantees the UI guard also
    // settles if a lower layer regresses or never resolves.
    const LOCAL_LLM_GUARD_DEADLINE_MS = 60_000;

    async function validateLocalLlm(options: { quiet?: boolean } = {}): Promise<void> {
        if (aiSectionDisposed) return;
        if (localLlmValidationPromise) return localLlmValidationPromise;
        localLlmValidationPending = true;
        localLlmValidationError = null;
        renderLocalLlmStatus();
        localLlmValidationPromise = (async () => {
            try {
                // Keep an aggregate ceiling above the individually bounded steps so
                // the UI always reaches a terminal state even if a lower layer stops
                // settling its promise.
                localLlmValidationReport = await withTimeout(
                    (async () => {
                        await detectLocalLlmServers({ quiet: true });
                        await loadLocalLlmModels({ quiet: true });
                        return getLocalLlmClient(plugin).runDiagnostics(getLocalLlmUiOverrides());
                    })(),
                    getLocalLlmValidationDeadlineMs(),
                    t('settings.ai.localLlm.validationDeadline')
                );
                localLlmValidationError = null;
                localLlmLastValidatedAt = new Date().toISOString();
                if (!options.quiet) {
                    new Notice('Local LLM validation complete.');
                }
            } catch (error) {
                localLlmValidationReport = null;
                localLlmValidationError = error instanceof Error ? error.message : String(error);
                localLlmLastValidatedAt = new Date().toISOString();
                if (!options.quiet) {
                    new Notice(`Local LLM validation failed: ${localLlmValidationError}`);
                }
            } finally {
                localLlmValidationPending = false;
                localLlmValidationPromise = null;
                if (!aiSectionDisposed) {
                    renderLocalLlmStatus();
                    // The preview card mirrors validation state — refresh it so
                    // "Connected & validated" lands there too, not only in the
                    // panel. Only while local is still the active provider: a late
                    // finish must not reset a cloud preview the author moved to.
                    if (ensureCanonicalAiSettings().provider === 'ollama') void refreshRoutingUi();
                }
            }
        })();
        return localLlmValidationPromise;
    }

    localLlmModelSetting.addExtraButton(button => {
        button
            .setIcon('refresh-ccw')
            .setTooltip(t('settings.ai.localLlm.loadModelsTooltip'))
            .onClick(async () => {
                button.setDisabled(true);
                button.setIcon('loader-2');
                try {
                    await loadLocalLlmModels();
                } finally {
                    button.setDisabled(false);
                    button.setIcon('refresh-ccw');
                }
            });
    });

    // One action: "Re-check" runs the whole chain (detect servers -> load models ->
    // validate). The former separate "Load Servers" / "Load Models" buttons only
    // re-triggered steps this already performs, so they are collapsed into this.
    const localLlmActionsSetting = new Settings(localLlmActionsRow)
        .setName(t('settings.ai.localLlm.actionsName'))
        .setDesc(t('settings.ai.localLlm.actionsDesc'));
    localLlmActionsSetting.addButton(button => button
        .setButtonText(t('settings.ai.localLlm.validateButton'))
        .setCta()
        .onClick(() => {
            button.setDisabled(true);
            void validateLocalLlm().finally(() => {
                // Obsidian ButtonComponent is thenable and setDisabled() returns
                // the component. Returning it from finally() creates an endless
                // self-resolution microtask loop that freezes the renderer.
                button.setDisabled(false);
            });
        }));

    renderLocalLlmModelList();
    renderLocalLlmStatus();

    // ── AI Configuration settings (moved from Core) ───────────────────────
    const aiConfigCreateRow = (
        parent: HTMLElement,
        options: {
            title: string;
            description: string;
            control: (setting: Settings) => void;
        }
    ): Settings => {
        const row = new Settings(parent)
            .setName(options.title)
            .setDesc(options.description);
        row.settingEl.addClass('ert-settingRow');
        options.control(row);
        return row;
    };
    const aiConfigCreateNumberInput = (
        setting: Settings,
        options: {
            value: number;
            min: number;
            max: number;
            step: number;
            invalidNotice: string;
            onSave: (value: number) => Promise<void> | void;
        }
    ): void => {
        setting.addText(text => {
            text.setValue(String(options.value));
            text.inputEl.type = 'number';
            text.inputEl.min = String(options.min);
            text.inputEl.max = String(options.max);
            text.inputEl.step = String(options.step);
            text.inputEl.addClass('ert-input--xs');

            plugin.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    text.inputEl.blur();
                }
            });

            const handleBlur = async () => {
                const parsed = parseInt(text.getValue().trim(), 10);
                if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max) {
                    new Notice(options.invalidNotice);
                    text.setValue(String(options.value));
                    return;
                }
                await options.onSave(Math.round(parsed));
                text.setValue(String(Math.round(parsed)));
            };

            plugin.registerDomEvent(text.inputEl, 'blur', () => { void handleBlur(); });
        });
    };

    const inquiryGroup = aiConfigBody.createDiv({ cls: 'ert-config-group' });
    inquiryGroup.createDiv({ cls: 'ert-config-group-title', text: t('settings.ai.config.inquiryTitle') });

    const citationsRow = aiConfigCreateRow(inquiryGroup, {
        title: t('settings.ai.config.citationsName'),
        description: t('settings.ai.config.citationsDesc'),
        control: (setting) => {
            // Provider-level inline citations are temporarily disabled across all
            // providers — they're structurally incompatible with strict-JSON output.
            // Toggle stays present so the persisted setting remains visible, but
            // it's locked off; per-finding evidence_quote field still surfaces a
            // verbatim quote per finding in the Sources block.
            setting.addToggle(toggle => {
                toggle.setValue(false).setDisabled(true);
                toggle.toggleEl.setAttr(
                    'title',
                    'Temporarily disabled — provider citations conflict with strict-JSON output across all providers. Findings still surface verbatim quotes via the per-finding evidence_quote field.'
                );
            });
        }
    });
    // Visually mute the entire row (title, description, toggle) so it reads
    // as "feature paused" at a glance, not "active setting you might want
    // to flip". Removed alongside the resolver flip when citations are restored.
    citationsRow.settingEl.addClass('ert-settingRow--disabled-feature');

    const aiDisplayGroup = aiConfigBody.createDiv({ cls: 'ert-config-group' });
    aiDisplayGroup.createDiv({ cls: 'ert-config-group-title', text: t('settings.ai.config.timelineDisplayTitle') });

    aiConfigCreateRow(aiDisplayGroup, {
        title: t('settings.ai.config.pulseContextName'),
        description: t('settings.ai.config.pulseContextDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.showFullTripletAnalysis ?? true)
                .onChange(async (value) => {
                    plugin.settings.showFullTripletAnalysis = value;
                    await plugin.saveSettings();
                }));
        }
    });

    aiConfigCreateRow(aiDisplayGroup, {
        title: t('settings.ai.config.synopsisMaxWordsName'),
        description: t('settings.ai.config.synopsisMaxWordsDesc'),
        control: (setting) => {
            aiConfigCreateNumberInput(setting, {
                value: getSynopsisGenerationWordLimit(plugin.settings),
                min: 10,
                max: 300,
                step: 5,
                invalidNotice: t('settings.ai.config.synopsisMaxWordsInvalid'),
                onSave: async (value) => {
                    plugin.settings.synopsisGenerationMaxWords = value;
                    plugin.settings.synopsisHoverMaxLines = getSynopsisHoverLineLimit(plugin.settings);
                    await plugin.saveSettings();
                }
            });
        }
    });

    const summaryRefreshGroup = aiConfigBody.createDiv({ cls: 'ert-config-group' });
    const summaryRefreshHeading = summaryRefreshGroup.createDiv({ cls: 'ert-config-group-heading' });
    summaryRefreshHeading.createSpan({ cls: 'ert-config-group-title', text: t('settings.ai.config.summaryRefreshTitle') });
    const summaryRefreshOpenButton = summaryRefreshHeading.createEl('button', {
        cls: 'ert-config-group-modal-link',
        attr: {
            type: 'button',
            'aria-label': 'Open summary refresh modal'
        }
    });
    setIcon(summaryRefreshOpenButton, 'panel-top-open');
    setTooltip(summaryRefreshOpenButton, 'Open summary refresh modal');
    plugin.registerDomEvent(summaryRefreshOpenButton, 'click', (evt: MouseEvent) => {
        evt.preventDefault();
        const commandManager = (plugin.app as unknown as { commands?: { executeCommandById?: (id: string) => void } }).commands;
        if (!commandManager?.executeCommandById) {
            new Notice('Summary refresh command is not available.');
            return;
        }
        commandManager.executeCommandById('radial-timeline:refresh-scene-synopses-ai');
    });

    aiConfigCreateRow(summaryRefreshGroup, {
        title: t('settings.ai.config.targetSummaryName'),
        description: t('settings.ai.config.targetSummaryDesc'),
        control: (setting) => {
            aiConfigCreateNumberInput(setting, {
                value: plugin.settings.synopsisTargetWords ?? 200,
                min: 75,
                max: 500,
                step: 25,
                invalidNotice: t('settings.ai.config.targetSummaryInvalid'),
                onSave: async (value) => {
                    plugin.settings.synopsisTargetWords = value;
                    await plugin.saveSettings();
                }
            });
        }
    });

    aiConfigCreateRow(summaryRefreshGroup, {
        title: t('settings.ai.config.weakThresholdName'),
        description: t('settings.ai.config.weakThresholdDesc'),
        control: (setting) => {
            aiConfigCreateNumberInput(setting, {
                value: plugin.settings.synopsisWeakThreshold ?? 75,
                min: 10,
                max: 300,
                step: 5,
                invalidNotice: t('settings.ai.config.weakThresholdInvalid'),
                onSave: async (value) => {
                    plugin.settings.synopsisWeakThreshold = value;
                    await plugin.saveSettings();
                }
            });
        }
    });

    aiConfigCreateRow(summaryRefreshGroup, {
        title: t('settings.ai.config.alsoUpdateSynopsisName'),
        description: t('settings.ai.config.alsoUpdateSynopsisDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.alsoUpdateSynopsis ?? false)
                .onChange(async (value) => {
                    plugin.settings.alsoUpdateSynopsis = value;
                    await plugin.saveSettings();
                }));
        }
    });

    // Final section order in AI tab:
    // 1) AI Strategy
    // 2) Preview (Active Model)
    // 3) Local LLM Configuration
    // 4) Local LLM Status / Validation
    // 5) AI Cost Estimate
    // 6) AI transparency (What gets sent to the AI)
    // 7) Role context
    // 8) API Keys
    // 9) Configuration
    [
        quickSetupSection,
        quickSetupPreviewSection,
        costEstimateSection,
        largeHandlingSection,
        detailsBtn,
        roleContextSection,
        apiKeysFold,
        aiConfigFold
    ].forEach(section => aiSettingsGroup.appendChild(section));

    // Apply provider dimming on first render
    params.refreshProviderDimming();
    const onAiTabActivated = (): void => {
        // Both halves of the panel re-check on arrival: the local server (when
        // it is the active provider) and every cloud key. Whichever the author
        // is about to switch to, the dropdown they read is current.
        if (ensureCanonicalAiSettings().provider === 'ollama') {
            queueLocalLlmAutoValidation();
        }
        Object.values(providerKeyRefreshers).forEach(refresh => { void refresh(); });
    };
    params.setAiTabActivationHandler(onAiTabActivated);
    void refreshRoutingUi().then(() => {
        if (params.isAiTabActive()) onAiTabActivated();
    });

    // Set initial visibility state
    params.toggleAiSettingsVisibility(plugin.settings.enableAiSceneAnalysis ?? true);

    return {
        dispose: () => {
            aiSectionDisposed = true;
            clearLocalLlmAutoValidation();
        }
    };
}
