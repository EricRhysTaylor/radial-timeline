/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { InquirySessionStatus } from '../sessionTypes';

/**
 * Visual state hints applied to the briefing artifact button.
 *
 * The button shows three mutually-exclusive moods:
 *   • pulse  — there is an unsaved active session
 *   • saved  — the active session has a saved brief
 *   • error  — the active session ended in error
 *
 * Any other status (or no active session) clears all three.
 */
export type BriefingArtifactClassFlags = {
    'is-briefing-pulse': boolean;
    'is-briefing-saved': boolean;
    'is-briefing-error': boolean;
};

export function deriveBriefingArtifactClassFlags(
    status: InquirySessionStatus | null | undefined
): BriefingArtifactClassFlags {
    return {
        'is-briefing-pulse': status === 'unsaved',
        'is-briefing-saved': status === 'saved',
        'is-briefing-error': status === 'error',
    };
}
