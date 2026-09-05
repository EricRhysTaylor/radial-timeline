/**
 * Radial Timeline Plugin for Obsidian — Setting Impact Model
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Classifies the visual impact of each settings change to avoid
 * unnecessary full re-renders that cause compositor flicker.
 *
 *   Tier 1 ("none")  — No visible timeline change; just save.
 *   Tier 2 ("selective") — Visual but non-structural; uses the selective DOM-mutation path.
 *   Tier 3 ("full")  — Structural layout change; requires a full SVG rebuild.
 */

import { ChangeType } from '../renderer/ChangeDetection';

// ── Impact descriptor ────────────────────────────────────────────────
export type SettingImpact =
    | { kind: 'none' }
    | { kind: 'selective'; changeTypes: ChangeType[] }
    | { kind: 'full' };

/** Tier 3 — setting changes SVG layout and requires a full rebuild */
export const IMPACT_FULL: SettingImpact = { kind: 'full' };

export const IMPACT_PROGRESS_TICKS: SettingImpact = {
    kind: 'selective',
    changeTypes: [ChangeType.TARGET_DATES],
};

