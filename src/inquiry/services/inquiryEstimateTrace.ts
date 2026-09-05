import type { CorpusManifest, InquiryRunTrace, InquiryRunnerInput } from '../runner/types';
import type { InquiryRunnerService } from '../runner/InquiryRunnerService';
import { isStableSceneId } from '../../ai/references/sceneRefNormalizer';
import { fnv1a32Hex } from '../../utils/hash';

function buildDeterministicEstimateSceneId(path: string): string {
    return `scn_${fnv1a32Hex(path)}`;
}

function buildEstimateManifest(manifest: CorpusManifest): CorpusManifest {
    return {
        ...manifest,
        entries: manifest.entries.map(entry => {
            if (entry.class !== 'scene') return entry;
            if (isStableSceneId(entry.sceneId)) return entry;
            return {
                ...entry,
                sceneId: buildDeterministicEstimateSceneId(entry.path)
            };
        })
    };
}

export async function buildInquiryEstimateTrace(
    runner: InquiryRunnerService,
    input: InquiryRunnerInput
): Promise<InquiryRunTrace> {
    return await runner.buildTrace({
        ...input,
        corpus: buildEstimateManifest(input.corpus)
    });
}
