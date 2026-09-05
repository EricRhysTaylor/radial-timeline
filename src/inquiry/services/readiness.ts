export type InquiryReadinessState = 'ready' | 'large' | 'blocked';
export type InquiryPressureTone = 'normal' | 'amber' | 'red';
export type InquiryReadinessCause =
    | 'ok'
    | 'multi_pass_expected'
    | 'capability_floor'
    | 'missing_key';

export interface EvaluateInquiryReadinessInput {
    hasEligibleModel: boolean;
    hasCredential: boolean;
    estimatedInputTokens: number;
    safeInputBudget: number;
    estimateUncertaintyTokens?: number;
}

export interface InquiryReadinessResult {
    state: InquiryReadinessState;
    cause: InquiryReadinessCause;
    pressureRatio: number;
    pressureTone: InquiryPressureTone;
    exceedsBudget: boolean;
    materiallyExceedsBudget: boolean;
}

export interface PassIndicatorResult {
    visible: boolean;
    marks: string;
    visibleCount: number;
    totalPassCount: number | null;
    extraPassCount: number | null;
    exactCount: number | null;
    expectedOnly: boolean;
}

function toPressureTone(ratio: number): InquiryPressureTone {
    if (!Number.isFinite(ratio) || ratio >= 0.9) return 'red';
    if (ratio >= 0.7) return 'amber';
    return 'normal';
}

export function evaluateInquiryReadiness(input: EvaluateInquiryReadinessInput): InquiryReadinessResult {
    const safeInputBudget = Number.isFinite(input.safeInputBudget) ? Math.max(0, input.safeInputBudget) : 0;
    const estimatedInputTokens = Number.isFinite(input.estimatedInputTokens) ? Math.max(0, input.estimatedInputTokens) : 0;
    const uncertaintyTokens = Number.isFinite(input.estimateUncertaintyTokens)
        ? Math.max(0, Math.floor(input.estimateUncertaintyTokens as number))
        : 0;
    const pressureRatio = safeInputBudget > 0 ? (estimatedInputTokens / safeInputBudget) : Number.POSITIVE_INFINITY;
    const exceedsBudget = safeInputBudget > 0 ? estimatedInputTokens > safeInputBudget : true;
    const materiallyExceedsBudget = safeInputBudget > 0
        ? estimatedInputTokens > (safeInputBudget + uncertaintyTokens)
        : true;

    if (!input.hasCredential) {
        return {
            state: 'blocked',
            cause: 'missing_key',
            pressureRatio,
            pressureTone: toPressureTone(pressureRatio),
            exceedsBudget,
            materiallyExceedsBudget
        };
    }

    if (!input.hasEligibleModel || safeInputBudget <= 0) {
        return {
            state: 'blocked',
            cause: 'capability_floor',
            pressureRatio,
            pressureTone: toPressureTone(pressureRatio),
            exceedsBudget,
            materiallyExceedsBudget
        };
    }

    if (exceedsBudget) {
        return {
            state: 'large',
            cause: 'multi_pass_expected',
            pressureRatio,
            pressureTone: toPressureTone(pressureRatio),
            exceedsBudget,
            materiallyExceedsBudget
        };
    }

    return {
        state: 'ready',
        cause: 'ok',
        pressureRatio,
        pressureTone: toPressureTone(pressureRatio),
        exceedsBudget,
        materiallyExceedsBudget
    };
}

export function buildPassIndicator(
    passCount?: number,
    multiPassExpected?: boolean,
    estimatedPassCount?: number
): PassIndicatorResult {
    const normalizedPassCount = Number.isFinite(passCount) ? Math.max(0, Math.round(passCount as number)) : 0;
    if (normalizedPassCount > 1) {
        const extraPassCount = normalizedPassCount - 1;
        const visibleCount = Math.min(5, normalizedPassCount);
        return {
            visible: true,
            marks: '+'.repeat(visibleCount),
            visibleCount,
            totalPassCount: normalizedPassCount,
            extraPassCount,
            exactCount: normalizedPassCount,
            expectedOnly: false
        };
    }

    if (multiPassExpected) {
        const normalizedEstimate = Number.isFinite(estimatedPassCount)
            ? Math.max(2, Math.round(estimatedPassCount as number))
            : 2;
        const extraPassCount = normalizedEstimate - 1;
        // Predicted multi-pass is not an exact observed pass count. Keep the
        // glyph to a single marker so it reads as "multi-pass expected"
        // instead of implying a confirmed number of passes.
        const visibleCount = 1;
        return {
            visible: true,
            marks: '+',
            visibleCount,
            totalPassCount: normalizedEstimate,
            extraPassCount,
            exactCount: null,
            expectedOnly: true
        };
    }

    return {
        visible: false,
        marks: '',
        visibleCount: 0,
        totalPassCount: null,
        extraPassCount: null,
        exactCount: null,
        expectedOnly: false
    };
}
