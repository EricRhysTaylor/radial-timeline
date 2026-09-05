// Single source of truth for status colors as raw hex.
// Mirrors --rt-color-* in src/styles/variables.css. APR (canvas/PNG, standalone SVG embed) reads
// these directly; the timeline reads STATUS_COLORS below, which uses the same hex as the var fallback.
// Keep the values here and the CSS vars in lockstep.
export const STATUS_HEX = {
    Working: '#f3b3ef',
    Todo: '#f6d8f3',
    Empty: '#ffffff',
    Due: '#d05e5e',
    Complete: '#22c55e',
} as const;

export const STATUS_COLORS = {
    Working: `var(--rt-color-working, ${STATUS_HEX.Working})`,
    Todo: `var(--rt-color-todo, ${STATUS_HEX.Todo})`,
    Empty: `var(--rt-color-empty, ${STATUS_HEX.Empty})`,
    Due: `var(--rt-color-due, ${STATUS_HEX.Due})`,
    Complete: `var(--rt-color-complete, ${STATUS_HEX.Complete})`,
} as const;

// Scene number info interface used across renderer, view, and main
export interface SceneNumberInfo {
    number: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

// Stage and status orderings
export const STAGE_ORDER = ["Zero", "Author", "House", "Press"] as const;
export const STAGES_FOR_GRID = ["Zero", "Author", "House", "Press"] as const;
export const STATUSES_FOR_GRID = ["Todo", "Working", "Due", "Completed"] as const;

export type Stage = typeof STAGE_ORDER[number];
export type Status = typeof STATUSES_FOR_GRID[number];
