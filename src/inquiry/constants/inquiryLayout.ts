import type { InquiryFinding } from '../state';

export const INQUIRY_GLYPH_LAYOUT = {
    placeholderFlow: 0.75,
    placeholderDepth: 0.30,
    emptyStateStub: 0.125,
    offsetY: 0
} as const;

export const INQUIRY_DEBUG_FLAGS = {
    svgOverlay: false
} as const;

export const INQUIRY_VIEWBOX = {
    min: -800,
    max: 800,
    size: 1600
} as const;

export const INQUIRY_PREVIEW_LAYOUT = {
    panelWidth: 640,
    panelY: -390,
    minimapGap: 60,
    paddingX: 32,
    paddingY: 20,
    runningContentOffsetY: -3,
    heroLineHeight: 30,
    heroMaxLines: 4,
    resultsHeroMaxWidth: 1440,
    resultsHeroMaxLines: Number.MAX_SAFE_INTEGER,
    metaGap: 6,
    metaLineHeight: 22,
    detailGap: 16,
    pillHeight: 26,
    pillPaddingX: 16,
    pillGapX: 20,
    pillGapY: 14,
    footerGap: 12,
    footerHeight: 22,
    resultsFooterOffset: 30,
    shimmerWidth: 120,
    shimmerOverhang: 110
} as const;

export const INQUIRY_MODE_ICON_LAYOUT = {
    viewBox: 2048,
    offsetY: -330
} as const;

export const INQUIRY_SCENE_DOSSIER_LAYOUT = {
    canvasY: 6,
    textGroupY: 0,
    centerY: 0,
    braceBaselineOffset: 22,
    width: 980,
    minHeight: 0,
    sidePadding: 136,
    titleMaxWidth: 760,
    textMaxWidth: 700,
    anchorMaxWidth: 620,
    paddingY: 30,
    headerYOffset: -47,
    headerSize: 60,
    headerLineHeight: 64,
    anchorLineHeight: 22,
    bodyPrimaryLineHeight: 24,
    bodySecondaryLineHeight: 24,
    footerYOffset: -12,
    sourceYOffset: -12,
    footerSize: 14,
    footerLineHeight: 18,
    sourceLineHeight: 18,
    unboundedWrapLines: Number.MAX_SAFE_INTEGER,
    titleAnchorGap: -4,
    anchorBodyGap: 16,
    bodyRowGap: 30,
    footerGap: 16,
    sourceGap: 6,
    secondaryDividerGap: 16,
    secondaryDividerWidthRatio: 0.3,
    hoverDelayMs: 150,
    hideDelayMs: 160,
    focusRadius: 470,
    braceSize: 580,
    braceInset: 88
} as const;

export const INQUIRY_CORPUS_CC_LAYOUT = {
    cellSize: 20,
    pageBaseSize: 16,
    pageMinSize: 7,
    headerIconSize: 12,
    headerIconGap: 2,
    headerIconOffset: 1,
    columnGapExtra: 4,
    cellIconOffset: -1,
    labelHintSize: 18,
    rightMargin: 50,
    bottomMargin: 50
} as const;

export const INQUIRY_GUIDANCE_LAYOUT = {
    textY: 360,
    lineHeight: 18,
    alertLineHeight: 26
} as const;

export const INQUIRY_FINDING_ORDER = {
    flow: ['thread', 'arc', 'escalation', 'conflict', 'payoff', 'structure', 'continuity', 'loose_end', 'unclear', 'error', 'none'] as InquiryFinding['kind'][],
    depth: ['arc', 'thread', 'continuity', 'payoff', 'structure', 'loose_end', 'conflict', 'escalation', 'unclear', 'error', 'none'] as InquiryFinding['kind'][]
} as const;

export const GLYPH_PLACEHOLDER_FLOW = INQUIRY_GLYPH_LAYOUT.placeholderFlow;
export const GLYPH_PLACEHOLDER_DEPTH = INQUIRY_GLYPH_LAYOUT.placeholderDepth;
export const GLYPH_EMPTY_STATE_STUB = INQUIRY_GLYPH_LAYOUT.emptyStateStub;
export const GLYPH_OFFSET_Y = INQUIRY_GLYPH_LAYOUT.offsetY;
export const DEBUG_SVG_OVERLAY = INQUIRY_DEBUG_FLAGS.svgOverlay;
export const VIEWBOX_MIN = INQUIRY_VIEWBOX.min;
export const VIEWBOX_MAX = INQUIRY_VIEWBOX.max;
export const VIEWBOX_SIZE = INQUIRY_VIEWBOX.size;
export const PREVIEW_PANEL_WIDTH = INQUIRY_PREVIEW_LAYOUT.panelWidth;
export const PREVIEW_PANEL_Y = INQUIRY_PREVIEW_LAYOUT.panelY;
export const PREVIEW_PANEL_MINIMAP_GAP = INQUIRY_PREVIEW_LAYOUT.minimapGap;
export const PREVIEW_PANEL_PADDING_X = INQUIRY_PREVIEW_LAYOUT.paddingX;
export const PREVIEW_PANEL_PADDING_Y = INQUIRY_PREVIEW_LAYOUT.paddingY;
export const PREVIEW_RUNNING_CONTENT_OFFSET_Y = INQUIRY_PREVIEW_LAYOUT.runningContentOffsetY;
export const PREVIEW_HERO_LINE_HEIGHT = INQUIRY_PREVIEW_LAYOUT.heroLineHeight;
export const PREVIEW_HERO_MAX_LINES = INQUIRY_PREVIEW_LAYOUT.heroMaxLines;
export const PREVIEW_RESULTS_HERO_MAX_WIDTH = INQUIRY_PREVIEW_LAYOUT.resultsHeroMaxWidth;
export const PREVIEW_RESULTS_HERO_MAX_LINES = INQUIRY_PREVIEW_LAYOUT.resultsHeroMaxLines;
export const PREVIEW_META_GAP = INQUIRY_PREVIEW_LAYOUT.metaGap;
export const PREVIEW_META_LINE_HEIGHT = INQUIRY_PREVIEW_LAYOUT.metaLineHeight;
export const PREVIEW_DETAIL_GAP = INQUIRY_PREVIEW_LAYOUT.detailGap;
export const PREVIEW_PILL_HEIGHT = INQUIRY_PREVIEW_LAYOUT.pillHeight;
export const PREVIEW_PILL_PADDING_X = INQUIRY_PREVIEW_LAYOUT.pillPaddingX;
export const PREVIEW_PILL_GAP_X = INQUIRY_PREVIEW_LAYOUT.pillGapX;
export const PREVIEW_PILL_GAP_Y = INQUIRY_PREVIEW_LAYOUT.pillGapY;
export const PREVIEW_FOOTER_GAP = INQUIRY_PREVIEW_LAYOUT.footerGap;
export const PREVIEW_FOOTER_HEIGHT = INQUIRY_PREVIEW_LAYOUT.footerHeight;
export const PREVIEW_RESULTS_FOOTER_OFFSET = INQUIRY_PREVIEW_LAYOUT.resultsFooterOffset;
export const PREVIEW_SHIMMER_WIDTH = INQUIRY_PREVIEW_LAYOUT.shimmerWidth;
export const PREVIEW_SHIMMER_OVERHANG = INQUIRY_PREVIEW_LAYOUT.shimmerOverhang;
export const MODE_ICON_VIEWBOX = INQUIRY_MODE_ICON_LAYOUT.viewBox;
export const MODE_ICON_OFFSET_Y = INQUIRY_MODE_ICON_LAYOUT.offsetY;
export const SCENE_DOSSIER_CANVAS_Y = INQUIRY_SCENE_DOSSIER_LAYOUT.canvasY;
export const SCENE_DOSSIER_TEXT_GROUP_Y = INQUIRY_SCENE_DOSSIER_LAYOUT.textGroupY;
export const SCENE_DOSSIER_CENTER_Y = INQUIRY_SCENE_DOSSIER_LAYOUT.centerY;
export const SCENE_DOSSIER_BRACE_BASELINE_OFFSET = INQUIRY_SCENE_DOSSIER_LAYOUT.braceBaselineOffset;
export const SCENE_DOSSIER_WIDTH = INQUIRY_SCENE_DOSSIER_LAYOUT.width;
export const SCENE_DOSSIER_MIN_HEIGHT = INQUIRY_SCENE_DOSSIER_LAYOUT.minHeight;
export const SCENE_DOSSIER_SIDE_PADDING = INQUIRY_SCENE_DOSSIER_LAYOUT.sidePadding;
export const SCENE_DOSSIER_TITLE_MAX_WIDTH = INQUIRY_SCENE_DOSSIER_LAYOUT.titleMaxWidth;
export const SCENE_DOSSIER_TEXT_MAX_WIDTH = INQUIRY_SCENE_DOSSIER_LAYOUT.textMaxWidth;
export const SCENE_DOSSIER_ANCHOR_MAX_WIDTH = INQUIRY_SCENE_DOSSIER_LAYOUT.anchorMaxWidth;
export const SCENE_DOSSIER_PADDING_Y = INQUIRY_SCENE_DOSSIER_LAYOUT.paddingY;
export const SCENE_DOSSIER_HEADER_Y_OFFSET = INQUIRY_SCENE_DOSSIER_LAYOUT.headerYOffset;
export const SCENE_DOSSIER_HEADER_SIZE = INQUIRY_SCENE_DOSSIER_LAYOUT.headerSize;
export const SCENE_DOSSIER_HEADER_LINE_HEIGHT = INQUIRY_SCENE_DOSSIER_LAYOUT.headerLineHeight;
export const SCENE_DOSSIER_ANCHOR_LINE_HEIGHT = INQUIRY_SCENE_DOSSIER_LAYOUT.anchorLineHeight;
export const SCENE_DOSSIER_BODY_PRIMARY_LINE_HEIGHT = INQUIRY_SCENE_DOSSIER_LAYOUT.bodyPrimaryLineHeight;
export const SCENE_DOSSIER_BODY_SECONDARY_LINE_HEIGHT = INQUIRY_SCENE_DOSSIER_LAYOUT.bodySecondaryLineHeight;
export const SCENE_DOSSIER_FOOTER_Y_OFFSET = INQUIRY_SCENE_DOSSIER_LAYOUT.footerYOffset;
export const SCENE_DOSSIER_SOURCE_Y_OFFSET = INQUIRY_SCENE_DOSSIER_LAYOUT.sourceYOffset;
export const SCENE_DOSSIER_FOOTER_SIZE = INQUIRY_SCENE_DOSSIER_LAYOUT.footerSize;
export const SCENE_DOSSIER_FOOTER_LINE_HEIGHT = INQUIRY_SCENE_DOSSIER_LAYOUT.footerLineHeight;
export const SCENE_DOSSIER_SOURCE_LINE_HEIGHT = INQUIRY_SCENE_DOSSIER_LAYOUT.sourceLineHeight;
export const SCENE_DOSSIER_TITLE_ANCHOR_GAP = INQUIRY_SCENE_DOSSIER_LAYOUT.titleAnchorGap;
export const SCENE_DOSSIER_ANCHOR_BODY_GAP = INQUIRY_SCENE_DOSSIER_LAYOUT.anchorBodyGap;
export const SCENE_DOSSIER_BODY_ROW_GAP = INQUIRY_SCENE_DOSSIER_LAYOUT.bodyRowGap;
export const SCENE_DOSSIER_FOOTER_GAP = INQUIRY_SCENE_DOSSIER_LAYOUT.footerGap;
export const SCENE_DOSSIER_SOURCE_GAP = INQUIRY_SCENE_DOSSIER_LAYOUT.sourceGap;
export const SCENE_DOSSIER_SECONDARY_DIVIDER_WIDTH_RATIO = INQUIRY_SCENE_DOSSIER_LAYOUT.secondaryDividerWidthRatio;
export const SCENE_DOSSIER_HOVER_DELAY_MS = INQUIRY_SCENE_DOSSIER_LAYOUT.hoverDelayMs;
export const SCENE_DOSSIER_HIDE_DELAY_MS = INQUIRY_SCENE_DOSSIER_LAYOUT.hideDelayMs;
export const SCENE_DOSSIER_FOCUS_RADIUS = INQUIRY_SCENE_DOSSIER_LAYOUT.focusRadius;
export const SCENE_DOSSIER_BRACE_SIZE = INQUIRY_SCENE_DOSSIER_LAYOUT.braceSize;
export const SCENE_DOSSIER_BRACE_INSET = INQUIRY_SCENE_DOSSIER_LAYOUT.braceInset;
export const CC_PAGE_BASE_SIZE = INQUIRY_CORPUS_CC_LAYOUT.pageBaseSize;
export const CC_PAGE_MIN_SIZE = INQUIRY_CORPUS_CC_LAYOUT.pageMinSize;
export const CC_HEADER_ICON_SIZE = INQUIRY_CORPUS_CC_LAYOUT.headerIconSize;
export const CC_HEADER_ICON_GAP = INQUIRY_CORPUS_CC_LAYOUT.headerIconGap;
export const CC_HEADER_ICON_OFFSET = INQUIRY_CORPUS_CC_LAYOUT.headerIconOffset;
export const CC_COLUMN_GAP_EXTRA = INQUIRY_CORPUS_CC_LAYOUT.columnGapExtra;
export const CC_CELL_ICON_OFFSET = INQUIRY_CORPUS_CC_LAYOUT.cellIconOffset;
export const CC_RIGHT_MARGIN = INQUIRY_CORPUS_CC_LAYOUT.rightMargin;
export const CC_BOTTOM_MARGIN = INQUIRY_CORPUS_CC_LAYOUT.bottomMargin;
export const GUIDANCE_TEXT_Y = INQUIRY_GUIDANCE_LAYOUT.textY;
export const GUIDANCE_LINE_HEIGHT = INQUIRY_GUIDANCE_LAYOUT.lineHeight;
export const GUIDANCE_ALERT_LINE_HEIGHT = INQUIRY_GUIDANCE_LAYOUT.alertLineHeight;
export const FLOW_FINDING_ORDER = [...INQUIRY_FINDING_ORDER.flow];
export const DEPTH_FINDING_ORDER = [...INQUIRY_FINDING_ORDER.depth];
