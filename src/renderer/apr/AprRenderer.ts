/**
 * Dedicated APR renderer (small, clean form factor)
 * Keeps geometry simple and crisp for sharing, independent from the main renderer.
 */
import type { TimelineItem } from '../../types';
import { isBeatNote, sortScenes, sortByManuscriptOrder } from '../../utils/sceneHelpers';
import { computePositions } from '../utils/SceneLayout';
import { sceneArcPath } from '../components/SceneArcs';
import { APR_COLORS, APR_TEXT_COLORS } from './AprConstants';
import { computeAprLayout } from './aprLayout';
import { getAprPreset, type AprSize, type AprPreset } from './aprPresets';
import { renderDefs } from '../components/Defs';
import { getFillForScene } from '../utils/SceneFill';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { DEFAULT_BOOK_TITLE } from '../../utils/books';
import { renderAprBadges, renderAprBranding, renderAprCenterPercent } from './AprBranding';
import { STAGE_ORDER } from '../../utils/constants';
import { escapeXml } from '../../utils/svg';

export interface AprRenderOptions {
    size: AprSize;
    exportPreset?: AprPreset; // When provided, overrides size for resolution (export path)
    bookTitle: string;
    authorName?: string;
    progressPercent: number;
    showScenes?: boolean;           // When false, show solid progress ring (bar mode)
    showSubplots?: boolean;
    showActs?: boolean;
    showStatusColors?: boolean;     // Show status colors (Todo, In Progress, etc.)
    showStageColors?: boolean;      // Show publish stage colors (Zero, Author, House, Press)
    grayCompletedScenes?: boolean;  // For SCENES stage: gray out completed scenes
    grayscaleScenes?: boolean;      // Force grayscale rendering for scene colors
    showProgressPercent?: boolean;
    showBranding?: boolean;
    centerMark?: 'dot' | 'plus' | 'none';
    stageColors?: Record<string, string>; // optional override (publishStage map)
    actCount?: number; // optional explicit act count override
    backgroundColor?: string;
    transparentCenter?: boolean;
    bookAuthorColor?: string;
    authorColor?: string;
    engineColor?: string;
    percentNumberColor?: string; // Color for center percent number
    percentSymbolColor?: string; // Color for center % symbol
    theme?: 'dark' | 'light' | 'none';
    spokeColor?: string; // Custom spokes color (used when theme mode allows custom)
    // Typography settings
    bookTitleFontFamily?: string;
    bookTitleFontWeight?: number;
    bookTitleFontItalic?: boolean;
    bookTitleFontSize?: number;
    authorNameFontFamily?: string;
    authorNameFontWeight?: number;
    authorNameFontItalic?: boolean;
    authorNameFontSize?: number;
    percentNumberFontSize1Digit?: number;
    percentNumberFontSize2Digit?: number;
    percentNumberFontSize3Digit?: number;
    rtBadgeFontFamily?: string;
    rtBadgeFontWeight?: number;
    rtBadgeFontItalic?: boolean;
    rtBadgeFontSize?: number;
    publishStageLabel?: string;
    showRtAttribution?: boolean;
    teaserRevealEnabled?: boolean;
    debugLabel?: string;
    portableSvg?: boolean;  // When true, output standalone SVG without CSS vars (Figma/Illustrator safe)
    workingPatternId?: string; // Hero Patterns motif id for Working-status fills
    customWorkingPatterns?: readonly import('../components/HeroPatterns').HeroPattern[];
}

export interface AprRenderResult {
    svgString: string;
    width: number;
    height: number;
}

type RingData = {
    subplot: string;
    scenes: TimelineItem[];
    innerR: number;
    outerR: number;
};

const cssVar = (name: string, fallback: string) => `var(${name}-override, var(${name}, ${fallback}))`;
// Portable SVG helpers: bypass CSS vars for standalone exports (Figma, Illustrator, etc.)
const resolveColor = (portable: boolean) =>
    (name: string, fallback: string): string =>
        portable ? fallback : cssVar(name, fallback);

const resolveOpacity = (portable: boolean) =>
    (varExpr: string, fallback: string): string =>
        portable ? fallback : varExpr;

const normalizeOptionalColor = (value?: string): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

/**
 * Normalize a stage color map so every key (Zero/Author/House/Press) is a non-empty string.
 * Any missing or whitespace-only value is replaced by the corresponding DEFAULT_SETTINGS entry.
 * Once normalized, downstream code can trust every stageColorMap[Stage] without further fallbacks.
 */
const resolveStageColors = (
    stageColors: Record<string, string> | undefined
): typeof DEFAULT_SETTINGS.publishStageColors => {
    const defaults = DEFAULT_SETTINGS.publishStageColors;
    if (!stageColors) return defaults;
    return {
        Zero: normalizeOptionalColor(stageColors.Zero) ?? defaults.Zero,
        Author: normalizeOptionalColor(stageColors.Author) ?? defaults.Author,
        House: normalizeOptionalColor(stageColors.House) ?? defaults.House,
        Press: normalizeOptionalColor(stageColors.Press) ?? defaults.Press
    };
};

export function createAprSVG(scenes: TimelineItem[], opts: AprRenderOptions): AprRenderResult {
    const {
        size,
        // Typography options
        bookTitleFontFamily, bookTitleFontWeight, bookTitleFontItalic, bookTitleFontSize,
        authorNameFontFamily, authorNameFontWeight, authorNameFontItalic, authorNameFontSize,
        percentNumberFontSize1Digit, percentNumberFontSize2Digit, percentNumberFontSize3Digit,
        rtBadgeFontFamily, rtBadgeFontWeight, rtBadgeFontItalic, rtBadgeFontSize,
        publishStageLabel,
        showRtAttribution,
        teaserRevealEnabled,
        bookTitle,
        authorName,
        progressPercent,
        showScenes = true,      // New: when false, shows ring-only mode
        showSubplots = true,
        showActs = true,
        showStatusColors = true,
        showStageColors = true,
        grayCompletedScenes = false,
        grayscaleScenes = false,
        showProgressPercent = true,
        showBranding = true,
        centerMark = 'none',
        stageColors,
        actCount,
        backgroundColor,
        transparentCenter,
        bookAuthorColor,
        authorColor,
        engineColor,
        percentNumberColor,
        percentSymbolColor,
        theme = 'dark',
        spokeColor,
        debugLabel,
        portableSvg = false
    } = opts;

    // Create bound color/opacity resolvers for portable vs CSS-var mode
    const color = resolveColor(portableSvg);
    const opacity = resolveOpacity(portableSvg);

    const preset = opts.exportPreset ?? getAprPreset(size);
    const layout = computeAprLayout(preset, { percent: progressPercent });
    const svgSize = layout.outerPx;
    const innerRadius = layout.ringInnerR;
    const outerRadius = layout.ringOuterR;
    const borderWidth = layout.strokes.ring;
    const actSpokeWidth = layout.strokes.actSpoke;
    const patternScale = layout.patternScale;
    const half = svgSize / 2;

    // Unique pattern-id prefix per render. SVG <defs> IDs are document-scoped, and the timeline
    // view defines patterns with the same base names (`plaidWorkingZero` etc.) at its own scale.
    // Without a unique prefix, an APR preview injected via innerHTML alongside the timeline pane
    // would have its scene fills resolved to the timeline's pattern defs — making any APR-side
    // patternScale tweaks invisible. Hex char set so it's a valid SVG id.
    const aprIdPrefix = `apr-${Math.random().toString(36).slice(2, 9)}-`;

    // Structural palette based on theme (with optional custom spokes color)
    const structural = resolveStructuralColors(theme, spokeColor);

    // Normalize stage colors so each key is guaranteed non-empty (blanks fall through to DEFAULT_SETTINGS).
    // Downstream code can trust stageColorMap.Press et al. without further checks.
    const stageColorMap = resolveStageColors(stageColors);
    const stageColorLookup = stageColorMap as Record<string, string>;
    const showScenesFinal = showScenes;
    const showProgressPercentFinal = layout.centerLabel.enabled && showProgressPercent;
    const showBrandingFinal = layout.preset.enableText && showBranding;
    const centerMarkFinal = layout.centerLabel.enabled ? centerMark : 'none';

    const stageInfo = resolveStageLabel(publishStageLabel);
    const stageBadgeColor = normalizeOptionalColor(stageColorLookup[stageInfo.key])
        ?? stageColorMap.Press;
    const revealCountdownDays = resolveRevealCountdownDays(teaserRevealEnabled);
    const showRtAttributionFinal = (showRtAttribution ?? true) && layout.preset.enableText;
    const structuralBorderColor = structural.border;
    const centerStrokeW = layout.strokes.centerRing;

    // Filter scenes (exclude beat notes always)
    const filteredScenes = scenes.filter(s => !isBeatNote(s));
    const safeScenes = sortScenes(filteredScenes, false, false); // manuscript order equivalent
    if (safeScenes.length === 0) {
        return {
            svgString: emptySvg(svgSize, half),
            width: svgSize,
            height: svgSize
        };
    }

    // Determine acts from data (fallback to 1 if missing), allow override
    const numActs = actCount && actCount > 0
        ? actCount
        : Math.max(...safeScenes.map(s => Number(s.actNumber ?? s.act ?? 1)), 1);

    // Determine subplot rings
    const scenesBySubplot: Record<string, TimelineItem[]> = {};
    safeScenes.forEach(scene => {
        const subplot = scene.subplot?.trim() || 'Main Plot';
        if (!scenesBySubplot[subplot]) {
            scenesBySubplot[subplot] = [];
        }
        scenesBySubplot[subplot].push(scene);
    });

    // Match timeline subplot ordering logic exactly (outer -> inner):
    // Main Plot first, then by scene count desc, then subplot name asc (tie-break).
    const subplotCounts = Object.entries(scenesBySubplot).map(([subplot, items]) => ({
        subplot,
        count: items.length
    }));
    subplotCounts.sort((a, b) => {
        if (a.subplot === 'Main Plot' || !a.subplot) return -1;
        if (b.subplot === 'Main Plot' || !b.subplot) return 1;
        if (a.count !== b.count) return b.count - a.count;
        return a.subplot.localeCompare(b.subplot);
    });

    // APR ring layout is built from inner -> outer.
    // Convert timeline order (outer -> inner) to APR order (inner -> outer).
    const subplotOrder = subplotCounts.map(item => item.subplot).reverse();

    const ringsToRender: RingData[] = [];
    if (showSubplots) {
        const ringThickness = (outerRadius - innerRadius) / subplotOrder.length;
        subplotOrder.forEach((subplot, idx) => {
            ringsToRender.push({
                subplot,
                scenes: scenesBySubplot[subplot],
                innerR: innerRadius + idx * ringThickness,
                outerR: innerRadius + (idx + 1) * ringThickness
            });
        });
    } else {
        ringsToRender.push({
            subplot: 'Main Plot',
            scenes: safeScenes,
            innerR: innerRadius,
            outerR: outerRadius
        });
    }

    const backgroundColorResolved = normalizeOptionalColor(backgroundColor);
    const bookAuthorColorResolved = normalizeOptionalColor(bookAuthorColor);
    const authorColorResolvedInput = normalizeOptionalColor(authorColor);
    const engineColorResolvedInput = normalizeOptionalColor(engineColor);
    const percentNumberColorResolvedInput = normalizeOptionalColor(percentNumberColor);
    const percentSymbolColorResolvedInput = normalizeOptionalColor(percentSymbolColor);
    const pressStageColor = stageColorMap.Press;
    const wantsTransparent = transparentCenter || backgroundColorResolved === 'transparent';
    const bgFill = wantsTransparent ? 'none' : (backgroundColorResolved ?? structural.background);
    // Center hole must use the same transparency check as the outer rect. Otherwise, in ring/bar mode
    // (where the center hole is the dominant visible area), the dark structural.centerHole bleeds
    // through and the export reads as "black background" even with bg set to transparent.
    const holeFill = wantsTransparent ? 'none' : (backgroundColorResolved ?? structural.centerHole);
    const bookTitleColorResolved = bookAuthorColorResolved ?? pressStageColor;
    const authorColorResolved = authorColorResolvedInput ?? bookTitleColorResolved;
    const engineColorResolved = engineColorResolvedInput ?? APR_TEXT_COLORS.primary;
    const stageBadgeColorResolved = stageBadgeColor;
    const rtAttributionColorResolved = stageBadgeColorResolved;
    const percentNumberColorResolved = percentNumberColorResolvedInput ?? bookTitleColorResolved;
    const percentSymbolColorResolved = percentSymbolColorResolvedInput ?? bookTitleColorResolved;
    const progressColor = stageColorMap.Press;
    const progressGhostColor = structural.border;
    const progressGhostOpacity = 0.25;
    const svgStyle = [
        `--apr-bg: ${bgFill}`,
        `--apr-center-fill: ${holeFill}`,
        `--apr-struct-border: ${structuralBorderColor}`,
        `--apr-struct-act-spoke: ${structural.actSpoke}`,
        `--apr-scene-void: ${APR_COLORS.void}`,
        `--apr-scene-neutral: ${APR_COLORS.sceneNeutral}`,
        `--apr-book-title-color: ${bookTitleColorResolved}`,
        `--apr-author-color: ${authorColorResolved}`,
        `--apr-engine-color: ${engineColorResolved}`,
        `--apr-percent-number-color: ${percentNumberColorResolved}`,
        `--apr-percent-symbol-color: ${percentSymbolColorResolved}`,
        `--apr-stage-badge-color: ${stageBadgeColorResolved}`,
        `--apr-countdown-color: ${stageBadgeColorResolved}`,
        `--apr-rt-attrib-color: ${rtAttributionColorResolved}`,
        `--apr-progress-color: ${progressColor}`,
        `--apr-progress-ghost-color: ${progressGhostColor}`,
        `--apr-progress-ghost-opacity: ${progressGhostOpacity}`,
        `--apr-center-mark-color: ${progressColor}`
    ];

    const svgStyleString = svgStyle.join('; ');
    const svgStyleAttr = portableSvg ? '' : ` style="${svgStyleString}"`; // SAFE: inline style used for CSS variable surface in SVG (omitted in portable mode)

    const portableClass = portableSvg ? ' apr-portable' : '';
    let svg = `<svg width="${svgSize}" height="${svgSize}" viewBox="-${half} -${half} ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" class="apr-svg apr-${size}${portableClass}"${svgStyleAttr}>`;
    svg += `<rect x="-${half}" y="-${half}" width="${svgSize}" height="${svgSize}" fill="${color('--apr-bg', bgFill)}" />`;

    // Progress-mode defs (plaid patterns) + filters. patternScale densifies plaid at small sizes.
    // Chromium renders filters and patternTransform fine in both canvas rasterization and direct SVG embed.
    const percentShadow = `
        <filter id="aprPercentShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#000" flood-opacity="0.45"/>
        </filter>
    `;
    const grayscaleFilter = grayscaleScenes ? `
        <filter id="aprGrayscale" color-interpolation-filters="sRGB">
            <feColorMatrix type="saturate" values="0" />
        </filter>
    ` : '';
    svg += `<defs>${renderDefs(stageColorMap, patternScale, portableSvg, opts.workingPatternId, opts.customWorkingPatterns, aprIdPrefix)}${percentShadow}${grayscaleFilter}</defs>`;

    // ─────────────────────────────────────────────────────────────────────────
    // RING-ONLY MODE (Teaser): Solid progress ring, no scene details
    // ─────────────────────────────────────────────────────────────────────────
    if (!showScenesFinal) {
        svg += renderProgressRing(innerRadius, outerRadius, progressPercent, structural, stageColorMap, color, opacity, {
            borderWidth: centerStrokeW
        });
    } else {
        const ringFilter = grayscaleScenes ? ' filter="url(#aprGrayscale)"' : '';
        svg += `<g class="apr-rings"${ringFilter}>`;
        ringsToRender.forEach(ring => {
            svg += renderRing(ring, safeScenes, borderWidth, showStatusColors, showStageColors, grayCompletedScenes, stageColorMap, numActs, structural, color, opacity, portableSvg, aprIdPrefix);
        });
        svg += `</g>`;

        // Act spokes (only when scenes are shown)
        if (showActs) {
            svg += renderActSpokes(numActs, innerRadius, outerRadius, actSpokeWidth, structural, color);
        }
    }

    // Center hole — inner radius stroke uses publish stage color (matches RT logo + AUTHOR label).
    svg += `<circle cx="0" cy="0" r="${innerRadius}" fill="${color('--apr-center-fill', holeFill)}" stroke="${color('--apr-stage-badge-color', stageBadgeColor)}" stroke-width="${centerStrokeW}" />`;

    if (centerMarkFinal !== 'none') {
        svg += renderCenterMark(innerRadius, centerMarkFinal, progressColor, color);
    }

    // Center percent (optional)
    if (showProgressPercentFinal) {
        svg += renderAprCenterPercent(progressPercent, layout, percentNumberColorResolved, percentSymbolColorResolved, {
            percentNumberFontSize1Digit,
            percentNumberFontSize2Digit,
            percentNumberFontSize3Digit,
            portableSvg
        });
    }

    if (showBrandingFinal) {
        // Branding on the perimeter (sanitize placeholder/dummy URLs)
        svg += renderAprBranding({
            bookTitle: bookTitle || DEFAULT_BOOK_TITLE,
            authorName,
            size,
            layout,
            bookAuthorColor: bookTitleColorResolved,
            authorColor: authorColorResolved,
            bookTitleFontFamily,
            bookTitleFontWeight,
            bookTitleFontItalic,
            bookTitleFontSize,
            authorNameFontFamily,
            authorNameFontWeight,
            authorNameFontItalic,
            authorNameFontSize,
            portableSvg
        });
    }

    svg += renderAprBadges({
        size,
        layout,
        stageLabel: stageInfo.label,
        showStageBadge: true,
        showRtAttribution: showRtAttributionFinal,
        revealCountdownDays,
        rtBadgeFontFamily,
        rtBadgeFontWeight,
        rtBadgeFontItalic,
        rtBadgeFontSize,
        badgeColor: stageBadgeColorResolved,
        countdownColor: stageBadgeColorResolved,
        rtAttributionColor: rtAttributionColorResolved,
        portableSvg
    });

    if (debugLabel) {
        svg += `<text x="${half - 10}" y="${half - 10}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#ef4444" font-weight="bold">${escapeXml(debugLabel)}</text>`;
    }

    svg += `</svg>`;

    return { svgString: svg, width: svgSize, height: svgSize };
}

// Helpers

function emptySvg(svgSize: number, half: number): string {
    return `<svg width="${svgSize}" height="${svgSize}" viewBox="-${half} -${half} ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg"></svg>`;
}

function renderRing(
    ring: RingData,
    allScenes: TimelineItem[],
    borderWidth: number,
    showStatusColors: boolean,
    showStageColors: boolean,
    grayCompletedScenes: boolean,
    stageColors: Record<string, string>,
    numActs: number,
    structural: ReturnType<typeof resolveStructuralColors>,
    color: (name: string, fallback: string) => string,
    opacity: (varExpr: string, fallback: string) => string,
    portableSvg: boolean,
    aprIdPrefix: string
): string {
    const ringScenes = ring.scenes;
    const actScenes: TimelineItem[][] = [];
    for (let i = 0; i < numActs; i++) actScenes.push([]);

    // Bucket by act (1-based in data)
    ringScenes.forEach(scene => {
        const actIdx = Math.max(0, Number(scene.actNumber ?? scene.act ?? 1) - 1);
        actScenes[Math.min(actIdx, numActs - 1)].push(scene);
    });

    // Pass 1: Fills only (no stroke) — scene wedges, voids
    let svg = '';
    const borderPaths: string[] = [];
    const borderColor = color('--apr-struct-border', structural.border);

    for (let act = 0; act < numActs; act++) {
        const actStart = -Math.PI / 2 + (act * 2 * Math.PI) / numActs;
        const actEnd = -Math.PI / 2 + ((act + 1) * 2 * Math.PI) / numActs;
        const scenesInAct = actScenes[act];

        // Keep consistent manuscript ordering with timeline sorting
        scenesInAct.sort(sortByManuscriptOrder);

        if (scenesInAct.length === 0) {
            const voidPath = sceneArcPath(ring.innerR, ring.outerR, actStart, actEnd);
            const voidOpacity = opacity('var(--apr-scene-void-opacity, 0.85)', '0.85');
            svg += `<path d="${voidPath}" fill="${color('--apr-scene-void', APR_COLORS.void)}" fill-opacity="${voidOpacity}" stroke="none" />`;
            borderPaths.push(voidPath);
            continue;
        }

        const positions = computePositions(ring.innerR, ring.outerR, actStart, actEnd, scenesInAct);
        let used = 0;
        scenesInAct.forEach((scene, idx) => {
            const pos = positions.get(idx);
            if (!pos) return;
            used += pos.endAngle - pos.startAngle;
            const rawSceneColor = resolveSceneColor(scene, showStatusColors, showStageColors, grayCompletedScenes, stageColors, portableSvg);
            // Rewrite plaid url refs to use this render's unique id prefix so the fills point at
            // the APR's <defs>, not the timeline view's identically-named patterns elsewhere in the DOM.
            const sceneColor = rawSceneColor.replace(/url\(#plaid/g, `url(#${aprIdPrefix}plaid`);
            const path = sceneArcPath(ring.innerR, ring.outerR, pos.startAngle, pos.endAngle);
            svg += `<path d="${path}" fill="${sceneColor}" stroke="none" />`;
            borderPaths.push(path);
        });

        const span = actEnd - actStart;
        const remaining = span - used;
        if (remaining > 0.0001) {
            const voidStart = actEnd - remaining;
            const voidPath = sceneArcPath(ring.innerR, ring.outerR, voidStart, actEnd);
            const voidOpacity = opacity('var(--apr-scene-void-opacity, 0.85)', '0.85');
            svg += `<path d="${voidPath}" fill="${color('--apr-scene-void', APR_COLORS.void)}" fill-opacity="${voidOpacity}" stroke="none" />`;
            borderPaths.push(voidPath);
        }
    }

    // Pass 2: Borders on top — fully opaque, above all fills
    for (const d of borderPaths) {
        svg += `<path d="${d}" fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" />`;
    }
    svg += `<circle r="${ring.outerR}" fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" />`;
    svg += `<circle r="${ring.innerR}" fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" />`;

    return svg;
}

function renderActSpokes(
    numActs: number,
    innerR: number,
    outerR: number,
    spokeWidth: number,
    structural: ReturnType<typeof resolveStructuralColors>,
    color: (name: string, fallback: string) => string
): string {
    if (numActs <= 1) return '';
    let svg = `<g class="apr-act-spokes">`;
    for (let i = 0; i < numActs; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / numActs;
        const x1 = innerR * Math.cos(angle);
        const y1 = innerR * Math.sin(angle);
        const x2 = outerR * Math.cos(angle);
        const y2 = outerR * Math.sin(angle);
        svg += `<line x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}" stroke="${color('--apr-struct-act-spoke', structural.actSpoke)}" stroke-width="${spokeWidth}" />`;
    }
    svg += `</g>`;
    return svg;
}

/**
 * Resolve the fill color for a scene based on teaser reveal settings
 * 
 * @param scene - The scene to color
 * @param showStatusColors - Show Todo/In Progress/Done/Overdue colors
 * @param showStageColors - Show Zero/Author/House/Press colors  
 * @param grayCompletedScenes - Gray out completed scenes (for SCENES stage)
 * @param stageColors - Color map from settings
 * @param portableSvg - When true, return direct colors without CSS vars
 */
function resolveSceneColor(
    scene: TimelineItem,
    showStatusColors: boolean,
    showStageColors: boolean,
    grayCompletedScenes: boolean,
    stageColors: Record<string, string>,
    portableSvg: boolean
): string {
    const color = resolveColor(portableSvg);

    // When no colors at all, use neutral gray
    if (!showStatusColors && !showStageColors) return color('--apr-scene-neutral', APR_COLORS.sceneNeutral);

    // Check if scene is "completed" (has a publish stage set)
    // Use bracket notation since 'Publish Stage' has a space
    const rawStageValue = scene['Publish Stage'];
    const rawStage: unknown = Array.isArray(rawStageValue) ? rawStageValue[0] : rawStageValue;
    const stage = (typeof rawStage === 'string' ? rawStage : '').trim().toLowerCase();
    const isCompleted = stage !== '' && stage !== 'zero';

    // SCENES stage: gray out completed scenes to hide publishing progress
    if (grayCompletedScenes && isCompleted) {
        return color('--apr-scene-neutral', APR_COLORS.sceneNeutral);
    }

    // When only status colors (not stage colors), show active work but not publish stages
    if (showStatusColors && !showStageColors) {
        // For completed scenes, use neutral (we don't want to show Zero/Author/House/Press)
        if (isCompleted) return color('--apr-scene-neutral', APR_COLORS.sceneNeutral);
        // For active work, use getFillForScene which respects status
        // Pass portableSvg to get direct hex colors instead of CSS vars
        return getFillForScene(scene, stageColors, undefined, undefined, undefined, portableSvg);
    }

    // Full colors: use getFillForScene for everything
    return getFillForScene(scene, stageColors, undefined, undefined, undefined, portableSvg);
}

function resolveStageLabel(stageLabel?: string): { label: string; key: string } {
    const raw = (stageLabel ?? 'Zero').toString().trim();
    const match = STAGE_ORDER.find(stage => stage.toLowerCase() === raw.toLowerCase());
    const resolved = (match ?? raw) || 'Zero';
    return { label: resolved.toUpperCase(), key: resolved };
}

function resolveRevealCountdownDays(_enabled?: boolean): number | undefined {
    return undefined;
}

function resolveStructuralColors(theme: 'dark' | 'light' | 'none', customSpokeColor?: string) {
    // If custom color provided, apply it to all structural elements (spokes, borders, act spokes)
    if (customSpokeColor) {
        return {
            spoke: customSpokeColor,
            actSpoke: customSpokeColor,
            border: customSpokeColor,
            centerHole: theme === 'light' ? '#ffffff' : '#0a0a0a',
            background: theme === 'light' ? '#ffffff' : 'transparent'
        };
    }

    if (theme === 'light') {
        return {
            spoke: '#000000',
            actSpoke: '#000000',
            border: '#000000',
            centerHole: '#ffffff',
            background: '#ffffff'
        };
    }
    if (theme === 'none') {
        // No strokes at all - shapes touch each other
        return {
            spoke: 'none',
            actSpoke: 'none',
            border: 'none',
            centerHole: 'transparent',
            background: 'transparent'
        };
    }
    // Default: dark theme — white borders
    return {
        spoke: '#ffffff',
        actSpoke: '#ffffff',
        border: '#ffffff',
        centerHole: '#0a0a0a',
        background: 'transparent'
    };
}

/**
 * Render a solid progress ring (ring-only mode / teaser mode)
 * Shows a single ring with progress filled as an arc
 */
function renderProgressRing(
    innerR: number,
    outerR: number,
    progressPercent: number,
    structural: ReturnType<typeof resolveStructuralColors>,
    stageColors: Record<string, string>,
    color: (name: string, fallback: string) => string,
    opacity: (varExpr: string, fallback: string) => string,
    options?: {
        ghostColor?: string;
        ghostOpacity?: number;
        ghostWidth?: number;
        showBorders?: boolean;
        borderWidth?: number;
    }
): string {
    const midR = (innerR + outerR) / 2;
    const ringWidth = outerR - innerR;
    const progressWidth = ringWidth * 0.78;
    const progressColor = stageColors.Press;
    const ghostColor = options?.ghostColor ?? structural.border;
    const ghostOpacity = options?.ghostOpacity ?? 0.25;
    const ghostWidth = options?.ghostWidth ?? ringWidth;
    const showBorders = options?.showBorders ?? true;
    const borderStrokeWidth = options?.borderWidth ?? 1.5;

    // Track (empty ring)
    let svg = `<g class="apr-progress-ring">`;
    const ghostOpacityResolved = opacity('var(--apr-progress-ghost-opacity, ' + ghostOpacity + ')', String(ghostOpacity));
    svg += `<circle cx="0" cy="0" r="${midR}" fill="none" stroke="${color('--apr-progress-ghost-color', ghostColor)}" stroke-width="${ghostWidth}" stroke-opacity="${ghostOpacityResolved}" />`;

    // Progress arc
    if (progressPercent > 0) {
        const clampedPercent = Math.min(100, Math.max(0, progressPercent));

        if (clampedPercent >= 100) {
            // Full circle
            svg += `<circle cx="0" cy="0" r="${midR}" fill="none" stroke="${color('--apr-progress-color', progressColor)}" stroke-width="${progressWidth}" />`;
        } else {
            // Arc from top (-90°) clockwise
            const angle = (clampedPercent / 100) * 2 * Math.PI;
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + angle;

            const x1 = midR * Math.cos(startAngle);
            const y1 = midR * Math.sin(startAngle);
            const x2 = midR * Math.cos(endAngle);
            const y2 = midR * Math.sin(endAngle);

            const largeArcFlag = angle > Math.PI ? 1 : 0;

            svg += `<path d="M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${midR} ${midR} 0 ${largeArcFlag} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}" fill="none" stroke="${color('--apr-progress-color', progressColor)}" stroke-width="${progressWidth}" stroke-linecap="round" />`;
        }
    }

    // Outer and inner border circles
    if (showBorders) {
        svg += `<circle cx="0" cy="0" r="${outerR}" fill="none" stroke="${color('--apr-struct-border', structural.border)}" stroke-width="${borderStrokeWidth}" />`;
        svg += `<circle cx="0" cy="0" r="${innerR}" fill="none" stroke="${color('--apr-struct-border', structural.border)}" stroke-width="${borderStrokeWidth}" />`;
    }

    svg += `</g>`;
    return svg;
}

function renderCenterMark(
    innerR: number,
    mode: 'dot' | 'plus',
    markColor: string,
    color: (name: string, fallback: string) => string
): string {
    if (mode === 'dot') {
        const markerRadius = Math.max(2, innerR * 0.1);
        return `<circle cx="0" cy="0" r="${markerRadius}" fill="${color('--apr-center-mark-color', markColor)}" fill-opacity="0.6" />`;
    }

    const size = Math.max(6, innerR * 0.6);
    const half = size / 2;
    const strokeWidth = Math.max(1, innerR * 0.08);
    return `
        <g class="apr-center-plus" stroke="${color('--apr-center-mark-color', markColor)}" stroke-opacity="0.7" stroke-width="${strokeWidth}" stroke-linecap="round">
            <line x1="0" y1="${-half}" x2="0" y2="${half}" />
            <line x1="${-half}" y1="0" x2="${half}" y2="0" />
        </g>
    `;
}
