import { isOverdueDateString } from '../../utils/date';
import { normalizeStatus } from '../../utils/text';

export type CorpusSceneStatus = 'todo' | 'working' | 'complete' | 'overdue';
export type CorpusSubstanceTier = 'empty' | 'sketchy' | 'medium' | 'substantive';

export function resolveCorpusSceneStatus(input: {
    status?: unknown;
    due?: unknown;
    today?: Date;
}): CorpusSceneStatus {
    const normalized = normalizeStatus(input.status);
    const due = typeof input.due === 'string' ? input.due.trim() : '';
    const isComplete = normalized === 'Completed';

    if (!isComplete && due && isOverdueDateString(due, input.today)) {
        return 'overdue';
    }
    if (normalized === 'Working') {
        return 'working';
    }
    if (isComplete) {
        return 'complete';
    }
    return 'todo';
}

export function isLowSubstanceTier(tier: CorpusSubstanceTier): boolean {
    return tier === 'empty' || tier === 'sketchy';
}
