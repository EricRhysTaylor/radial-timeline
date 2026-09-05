// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.
const LEGACY_WARNING_PREFIX = '[AI Legacy Access]';

export function warnLegacyAccess(apiName: string, internalAdapterAccess?: boolean): void {
    if (internalAdapterAccess) return;
    console.warn(
        `${LEGACY_WARNING_PREFIX} ${apiName} is deprecated and should only be reached through src/ai/providers adapters.`
    );
}

