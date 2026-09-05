import type { InquiryResult, InquiryScope, InquiryZone } from './state';

export type InquirySessionStatus = 'saved' | 'unsaved' | 'error' | 'simulated';

export interface InquirySession {
    key: string;
    baseKey: string;
    result: InquiryResult;
    createdAt: number;
    lastAccessed: number;
    stale?: boolean;
    status?: InquirySessionStatus;
    briefPath?: string;
    logPath?: string;
    targetSceneIds: string[];
    activeBookId?: string;
    scope?: InquiryScope;
    questionZone?: InquiryZone;
    pendingEditsApplied?: boolean;
    pendingEditsEmpty?: boolean;
    cacheWindowExpiresAt?: number;
    cacheReuseFingerprint?: string;
    cacheReuseState?: 'idle' | 'eligible' | 'warm';
    providerCacheStatus?: 'hit' | 'created';
    cachedStableRatio?: number;
    cachedStableTokens?: number;
    totalInputTokens?: number;
}

export interface InquirySessionCache {
    sessions: InquirySession[];
    max: number;
}
