import { renderProgressRingGradients } from '../components/Defs';
import { renderCompletionEstimateLayer, type CompletionEstimate } from './Estimation';

interface ProgressRingBaseOptions {
    progressRadius: number;
    estimateResult: CompletionEstimate | null;
}

export function renderProgressRingBaseLayer({
    progressRadius,
    estimateResult
}: ProgressRingBaseOptions): string {
    let svg = '';
    svg += renderProgressRingGradients(progressRadius);
    svg += `
        <circle
            cx="0"
            cy="0"
            r="${progressRadius}"
            class="progress-ring-base"
        />
    `;
    svg += renderCompletionEstimateLayer({ estimateResult, progressRadius });
    return svg;
}
