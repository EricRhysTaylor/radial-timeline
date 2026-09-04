/**
 * Radial Timeline Plugin for Obsidian — Layout Constants
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 * 
 * Central configuration for all timeline geometry and layout dimensions.
 * Adjust these values to tune the visual appearance and spacing of timeline elements.
 */

// =============================================================================
// SVG CANVAS
// =============================================================================

/** Total SVG canvas size (1600px = 800px radius) */
export const SVG_SIZE = 1600;

// =============================================================================
// TIMELINE STATUS ICONS - ICON-CENTERED POSITIONING
// =============================================================================
// 
// All positions define the CENTER of the 24x24 icon.
// This is the canonical reference point for alignment.
//
// Layout pattern for each indicator:
//   Group at (ICON_X, ICON_Y) ← icon center position
//   ├── Icon: translate(-12, -12) ← centers 24px icon at origin
//   └── Text: y = TEXT_ABOVE_ICON_OFFSET ← positioned above icon
//
// To add a new icon: define its center position, use the same pattern.
// =============================================================================

/** Standard icon size (px) */
export const STATUS_ICON_SIZE = 24;

/** Offset to center a 24px icon at origin: -12 */
export const STATUS_ICON_CENTER_OFFSET = -(STATUS_ICON_SIZE / 2);

/** Text baseline offset above icon center (negative = above) */
export const STATUS_TEXT_ABOVE_ICON = -22;

// -----------------------------------------------------------------------------
// BOTTOM-LEFT: Version/Bug Indicator
// -----------------------------------------------------------------------------

/** X position for Version/Bug icon CENTER */
export const VERSION_ICON_X = -750;

/** Y position for Version/Bug icon CENTER */
export const VERSION_ICON_Y = 756;

// -----------------------------------------------------------------------------
// BOTTOM-LEFT: APR Refresh Indicator (above Version)
// -----------------------------------------------------------------------------

/** Vertical gap between APR and Version icon centers */
export const APR_ABOVE_VERSION_GAP = 70;

/** X position for APR icon CENTER (same as Version for alignment) */
export const APR_ICON_X = VERSION_ICON_X;

/** Y position for APR icon CENTER */
export const APR_ICON_Y = VERSION_ICON_Y - APR_ABOVE_VERSION_GAP;

// -----------------------------------------------------------------------------
// BOTTOM-RIGHT: Help Icon
// -----------------------------------------------------------------------------

/** X position for Help icon CENTER */
export const HELP_ICON_X = 700;

/** Y position for Help icon CENTER */
export const HELP_ICON_Y = 756;

 // text baseline for backwards compat

// -----------------------------------------------------------------------------
// BOTTOM-RIGHT: Milestone Indicator (above Help)
// -----------------------------------------------------------------------------

/** Vertical gap between Milestone and Help icon centers */
export const MILESTONE_ABOVE_HELP_GAP = 70;

/** X position for Milestone icon CENTER (same as Help for alignment) */
export const MILESTONE_ICON_X = HELP_ICON_X;

/** Y position for Milestone icon CENTER */
export const MILESTONE_ICON_Y = HELP_ICON_Y - MILESTONE_ABOVE_HELP_GAP;

// =============================================================================
// RADII - CORE STRUCTURE
// =============================================================================

/** Where subplot rings start from center */
export const INNER_RADIUS = 200;

/** Where subplot rings end in Main Plot mode (more room since beats hidden) */
export const SUBPLOT_OUTER_RADIUS_MAINPLOT = 778;

/** Where subplot rings end in Narrative and Gossamer modes - by readability size */
export const SUBPLOT_OUTER_RADIUS_STANDARD = {
  normal: 766,
  large: 762
} as const;


// DRAG SCENE FEATURE //
// Positioned just inside the Act labels (ACT_LABEL_RADIUS = 790) to avoid overlap

/** Absolute radius for the outer tip of the drag tick (px) */
export const DRAG_DROP_TICK_OUTER_RADIUS = 785;

/** Absolute radius for the drag arc line (px) */
export const DRAG_DROP_ARC_RADIUS = 786;

/** Length of the drag drop tick marker (px) */
export const DRAG_DROP_TICK_LENGTH = 10;

/** Where subplot rings end in Chronologue mode (smaller for time details) */
export const SUBPLOT_OUTER_RADIUS_CHRONOLOGUE = 750;

// =============================================================================
// RADII - BACKDROP RING
// =============================================================================

/** Height (thickness) of the Backdrop Ring */
export const BACKDROP_RING_HEIGHT = 20;

/** Vertical offset for the backdrop segment labels relative to ring center */
export const BACKDROP_TITLE_RADIUS_OFFSET = -2;

// =============================================================================
// RADII - OUTER LABELS AND TICKS
// =============================================================================

/** Where month labels are positioned on outer edge */
export const MONTH_LABEL_RADIUS = 790;

/** Where chronologue boundary start/end dates are positioned */
export const CHRONOLOGUE_DATE_RADIUS = 792;

/** Outer edge of month tick marks */
export const MONTH_TICK_END = 799;

/** Inner edge of month tick marks */
export const MONTH_TICK_START = 764;

/** Where act labels are positioned (px from center) */
export const ACT_LABEL_RADIUS = 790;

/** Narrative-mode chapter marker badge radius; 792 keeps a 14px badge inside the 800px SVG edge. */
export const NARRATIVE_CHAPTER_MARKER_RADIUS = 792;

// =============================================================================
// RADII - CHRONOLOGUE ARCS
// =============================================================================

/** Absolute radius for chronologue duration arcs (750 + 8px offset) */
export const CHRONOLOGUE_DURATION_ARC_RADIUS = 758;

/** Absolute radius for elapsed time arc (SHIFT mode) - based on standard outer radius */
export const ELAPSED_ARC_RADIUS = 766;

/** Length of elapsed time arc endpoint markers (px) */
export const ELAPSED_TICK_LENGTH = 14;

// =============================================================================
// RADII - CHRONOLOGUE MICRO RINGS
// =============================================================================

/** Width of backdrop micro rings (px) */
export const MICRO_RING_WIDTH = 6;

/** Gap between micro ring lanes (px) */
export const MICRO_RING_GAP = 2;


/** Default progress ring radius offset (px, relative to lineInnerRadius) */
export const PROGRESS_RING_RADIUS_OFFSET = 13;

/** Progress ring base stroke width (px) */
export const PROGRESS_RING_BASE_WIDTH = 11;

/** Width of the active writing-session timer ring (px) */
export const SESSION_TIMER_RING_WIDTH = 5;

/** Progress-ring width used to keep the writing-session timer ring anchored while the visual progress ring can grow. */
export const SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR = 8;

/** Progress-ring radius offset used to keep the writing-session timer ring anchored while the visual progress ring can move. */
export const SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR = 10;

/** Gap between the progress ring outer edge and the writing-session timer ring (px) */
export const SESSION_TIMER_RING_GAP = 2;

// =============================================================================
// INSETS AND OFFSETS
// =============================================================================

/** Fixed pixels inward from scene's outer boundary for title path */
export const SCENE_TITLE_INSET = 22;

/** Pixels inward from subplot outer radius for synopsis text positioning */
export const SYNOPSIS_INSET = 0;

/** Fixed radius for story beat label text path (independent of subplot outer radius) */
export const BEAT_TEXT_RADIUS = {
  normal: 769,
  large: 765
} as const;

/** Small start nudge for text paths (radians) */
export const TEXTPATH_START_NUDGE_RAD = 0.02;

// =============================================================================
// SIZING
// =============================================================================

/** Maximum text width for synopsis text (px) */
export const MAX_TEXT_WIDTH = 500;

/** Width of plot beat slices at a given radius (px, converted to radians via PLOT_PIXEL_WIDTH / middleRadius) */
export const PLOT_PIXEL_WIDTH = 18;

// =============================================================================
// TEXT RENDERING - BEAT LABELS
// =============================================================================
// Note: Font sizes and styling should be defined in styles.css (.rt-storybeat-title)
// These constants are for geometric calculations only

/** Beat label font size in px - must match .rt-storybeat-title in CSS */
export const BEAT_FONT_PX = 9;

/** Generous multiplier for initial render estimation */
export const ESTIMATE_FUDGE_RENDER = 1.35;

/** Extra pixels added to estimated beat label width */
export const PADDING_RENDER_PX = 24;

/** Extra breathing room between beat labels when they stack (px) */
export const BEAT_LABEL_BREATHING_ROOM_PX = 10;

// =============================================================================
// READABILITY SCALING
// =============================================================================
// All base values below are multiplied by the readability scale factor.
// Adjust these to tune the Normal and Large size presets.

/** Scale multipliers for readability presets */
export const READABILITY_SCALES = {
  normal: 1.0,   // 100% - baseline size
  large: 1.3    // 140% - for low-res or low-vision viewing
} as const;

// --- Number Squares ---

/** Base font size for number square text (px) */
export const NUMBER_SQUARE_FONT_SIZE_PX = 13;

/** Base height of number squares (px) */
export const NUMBER_SQUARE_HEIGHT_PX = 18;

/** Total horizontal padding inside number squares (px) - split evenly left/right */
export const NUMBER_SQUARE_PADDING_PX = 7;

/** Letter spacing for number square text (em) */
export const NUMBER_SQUARE_LETTER_SPACING_EM = 0.03;

// --- Beat Labels ---

/** Base font size for beat labels (px) - must match .rt-storybeat-title in CSS */
export const BEAT_LABEL_FONT_SIZE_PX = 12;

/** Letter spacing for beat labels (em) */
export const BEAT_LABEL_LETTER_SPACING_EM = 0.07;

/** Initial horizontal position for mode title text (overwritten dynamically to track the leftmost button) */
export const MODE_TITLE_POS_X = 598;

/** Vertical position for mode title text */
export const MODE_TITLE_POS_Y = -755;

/** Horizontal center position for mode selector buttons */
export const MODE_SELECTOR_POS_X = 658;

/** Vertical position for mode selector buttons */
export const MODE_SELECTOR_POS_Y = -740;

/** Horizontal position for chronologue shift button */
export const SHIFT_BUTTON_POS_X = -700;

/** Vertical position for chronologue shift button */
export const SHIFT_BUTTON_POS_Y = -740;

// =============================================================================
// GRID MODE
// =============================================================================

export const GRID_CELL_BASE = 22;
export const GRID_CELL_WIDTH_EXTRA = 9; // width = round(base*1.5) + extra
export const GRID_CELL_GAP_X = 2;
export const GRID_CELL_GAP_Y = 4;
export const GRID_HEADER_OFFSET_Y = 12;
