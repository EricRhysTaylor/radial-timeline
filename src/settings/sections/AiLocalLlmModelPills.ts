import { Component, setTooltip } from 'obsidian';
import type { LocalLlmCapabilityAssessment, LocalLlmFeatureSupport } from '../../ai/localLlm/capabilityInference';
import { ERT_CLASSES } from '../../ui/classes';
import { t } from '../../i18n';

// LM Studio / MLX serve the model id as a full filesystem path
// (…/Qwen3-30B-A3B-Instruct-2507-MLX-4bit). Show just the leaf name in the UI;
// the full id is still the stored value used for API calls.
export const abbreviateLocalModelId = (id: string): string => {
    const trimmed = (id || '').trim(); // SAFE: an empty model id is the "nothing selected" state the caller checks for
    if (!trimmed) return trimmed;
    return trimmed.split(/[\\/]/).pop() || trimmed;
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
export const buildLocalFeatureSummary = (assessment: LocalLlmCapabilityAssessment): string => {
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

/** Renders model choices; each redraw releases the previous pills' listeners. */
export function createLocalLlmModelPills(
    list: HTMLElement,
    legend: HTMLElement,
    scope: Component,
    onSelect: (modelId: string) => Promise<void>
) {
    const renderScope = scope.addChild(new Component());
    let disposed = false;
    scope.register(() => { disposed = true; });
    function clear(): void {
        renderScope.unload();
        list.empty();
        legend.empty();
    }
    function render(models: ReadonlyArray<{ id: string; capability: LocalLlmCapabilityAssessment }>, selectedModelId: string): void {
        if (disposed) return;
        clear();
        renderScope.load();
        if (!models.length) return;
        const appendLegendItem = (tier: 0 | 1 | 3 | 4, label: string): void => {
            const item = legend.createSpan({ cls: 'ert-ai-local-llm-legend-item' });
            item.createSpan({ cls: `ert-ai-local-llm-legend-swatch ert-ai-local-llm-legend-swatch--tier${tier}` });
            item.createSpan({ text: label });
        };
        appendLegendItem(0, t('settings.ai.localLlm.legendNotUsable'));
        appendLegendItem(1, t('settings.ai.localLlm.legendLimited'));
        appendLegendItem(3, t('settings.ai.localLlm.legendStrong'));
        appendLegendItem(4, t('settings.ai.localLlm.legendInquiryEligible'));

        models.forEach(model => {
            const pill = list.createSpan({
                cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ert-ai-resolved-preview-pill ert-ai-local-model-pill`
            });
            const capability = model.capability;
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
            const applyModel = (): void => { void onSelect(model.id); };
            renderScope.registerDomEvent(pill, 'click', applyModel);
            renderScope.registerDomEvent(pill, 'keydown', (event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    applyModel();
                }
            });
        });
    }
    return { render, clear };
}
