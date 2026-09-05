import type { AIProviderId } from '../ai/types';
import type { ParsedSceneAnalysis } from './types';

export const LOCAL_LLM_REVIEW_WARNING = 'Local LLM result needs review. See logs.';

export type SceneAnalysisWriteRoute = 'write' | 'warning' | 'skip';

export async function applySceneAnalysisSafeWrite(input: {
    provider: AIProviderId | null | undefined;
    parsedAnalysis: ParsedSceneAnalysis | null | undefined;
    writeAnalysis: (parsed: ParsedSceneAnalysis) => Promise<boolean>;
    writeWarning: (message: string) => Promise<boolean>;
}): Promise<{ route: SceneAnalysisWriteRoute; success: boolean }> {
    if (input.parsedAnalysis) {
        const wrote = await input.writeAnalysis(input.parsedAnalysis);
        if (wrote) {
            return { route: 'write', success: true };
        }
        return { route: 'write', success: false };
    }

    if (input.provider === 'ollama') {
        const warned = await input.writeWarning(LOCAL_LLM_REVIEW_WARNING);
        return { route: 'warning', success: warned };
    }

    return { route: 'skip', success: false };
}
