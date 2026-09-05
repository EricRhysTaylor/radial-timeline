import type { ModelInfo } from '../types';

export type RecommendationIntentId = 'inquiry' | 'gossamer' | 'quick' | 'local';

function trimToMaxWords(text: string, maxWords = 14): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return text.trim();
    return words.slice(0, maxWords).join(' ');
}

export function formatRecommendationWhy(input: {
    intentId: RecommendationIntentId;
    model: ModelInfo | null;
    routerReason?: string;
}): string {
    if (!input.model) {
        return 'No eligible model available for current provider and capability requirements.';
    }

    if (input.intentId === 'inquiry') {
        return 'Uses the current deterministic auto selection for cross-scene structural analysis.';
    }

    if (input.intentId === 'gossamer') {
        return 'Uses the current deterministic auto selection for beat-level momentum analysis.';
    }

    if (input.intentId === 'quick') {
        return 'Uses the current deterministic auto selection for general JSON-capable tasks.';
    }

    if (input.intentId === 'local') {
        return 'Uses the current deterministic auto selection for local/private runs.';
    }

    return trimToMaxWords(
        input.routerReason?.trim() || 'Model selected from current provider and capability requirements.'
    );
}
