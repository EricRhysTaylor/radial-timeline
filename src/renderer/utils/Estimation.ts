import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { renderEstimationArc } from '../components/Progress';

export type CompletionEstimate = ReturnType<PluginRendererFacade['calculateCompletionEstimate']>;

type EstimationLayerOptions = {
    estimateResult: CompletionEstimate | null;
    progressRadius: number;
};

export function renderCompletionEstimateLayer({
    estimateResult,
    progressRadius
}: EstimationLayerOptions): string {
    if (!estimateResult || !estimateResult.date) {
        return '';
    }

    const estimatedCompletionDate = estimateResult.date;
    const now = new Date();
    const yearsDiff = estimatedCompletionDate.getFullYear() - now.getFullYear();

    if (yearsDiff > 0) {
        return '';
    }

    return renderEstimationArc({ estimateDate: estimatedCompletionDate, progressRadius });
}
