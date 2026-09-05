import type { InputTokenEstimateMethod, RTCorpusEstimateMethod } from '../types';

export interface CountingForensicsRecord {
    path: 'inquiry' | 'gossamer';
    phase: string;
    scope?: string;
    filesIncluded: string[];
    sceneCount: number;
    outlineCount: number;
    referenceCount: number;
    totalEvidenceChars: number;
    promptEnvelopeCharsAdded: number;
    tokenMethodUsed: InputTokenEstimateMethod | RTCorpusEstimateMethod;
    finalTokenEstimate: number;
}

const FORENSIC_ENV_FLAG = 'RT_COUNT_FORENSICS';

export function isCountingForensicsEnabled(): boolean {
    const fromEnv = typeof process !== 'undefined' && process.env?.[FORENSIC_ENV_FLAG] === '1';
    const fromGlobal = (window as { __RT_COUNT_FORENSICS__?: unknown }).__RT_COUNT_FORENSICS__ === true;
    return fromEnv || fromGlobal;
}

export function logCountingForensics(record: CountingForensicsRecord): void {
    if (!isCountingForensicsEnabled()) return;
    console.warn(`[RT Count Forensics][${record.path}:${record.phase}]`, {
        ...record,
        filesIncluded: [...record.filesIncluded]
    });
}
