import type { RadialTimelineSettings } from '../types/settings';

/**
 * AI content logging became opt-in for new installs (defaults.ts,
 * logApiInteractions: false). Installs from before that change kept whatever
 * they had stored, which may be on. This one-time reset turns content logging
 * off once for every install and stamps the settings so it never runs again —
 * an author who turns logging back on in Settings keeps it on.
 */
export const CONTENT_LOGGING_RESET_VERSION = 1;

/** Returns true when settings changed and should be saved. */
export function resetContentLoggingOnce(settings: RadialTimelineSettings): boolean {
    const stamp = settings.contentLoggingResetVersion;
    if (typeof stamp === 'number' && stamp >= CONTENT_LOGGING_RESET_VERSION) return false;
    settings.logApiInteractions = false;
    settings.contentLoggingResetVersion = CONTENT_LOGGING_RESET_VERSION;
    return true;
}
