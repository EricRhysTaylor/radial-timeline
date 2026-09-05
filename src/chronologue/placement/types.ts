/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Chronologue Placement — Core Types
 *
 * Chronologue angular position IS the When date, so dropping a scene resolves
 * to a concrete timestamp. These types describe the interval a drop lands in
 * and the verdict on a candidate timestamp for it.
 */

/** A dated scene bounding one side of the drop interval. */
export interface PlacementNeighbor {
    path: string;
    title: string;
    when: Date;
    /** Parsed `Duration` in milliseconds; null when the scene declares none. */
    durationMs: number | null;
}

/**
 * The open interval a dropped scene must land strictly inside.
 *
 * `lowerMs` / `upperMs` are always concrete. When a side has no neighbour
 * (dropping before the first scene or after the last), that side is extended by
 * the sequence's median inter-scene gap so the generators still have room to
 * work in — `lowerNeighbor` / `upperNeighbor` is null to mark it open.
 */
export interface PlacementInterval {
    /** Exclusive lower bound, ms since epoch. */
    lowerMs: number;
    /** Exclusive upper bound, ms since epoch. */
    upperMs: number;
    lowerNeighbor: PlacementNeighbor | null;
    upperNeighbor: PlacementNeighbor | null;
}

/**
 * A Duration collision the author should see but is free to accept — deliberate
 * overlaps (simultaneous action, intercut scenes) are legitimate.
 */
export interface OverlapWarning {
    kind: 'previous_runs_past' | 'dragged_runs_past';
    neighborTitle: string;
    overlapMs: number;
}

export type PlacementRejection =
    /** Not a date, or a date the When parser will not read back. */
    | 'unparsable'
    /** Lands on or outside a bound once written at minute precision. */
    | 'outside_bounds'
    /** The interval is too narrow to hold a distinct minute-precision value. */
    | 'no_room';

export type PlacementVerdict =
    | {
        kind: 'ok';
        /** Exactly what will be written to frontmatter. */
        storedWhen: string;
        /** The stored value read back — what the sort will actually see. */
        when: Date;
        overlapWarning: OverlapWarning | null;
    }
    | { kind: 'rejected'; reason: PlacementRejection; message: string };

/** A validated timestamp offered to the author in the placement modal. */
export interface PlacementCandidate {
    id: string;
    label: string;
    /** The stored value read back — identical to what the sort will see. */
    when: Date;
    storedWhen: string;
    overlapWarning: OverlapWarning | null;
}

/** Which end of the circular seam a first-scene drop meant. */
export type SeamChoice = 'before-first' | 'after-last';
