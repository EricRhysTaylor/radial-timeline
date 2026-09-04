import { STATUS_HEX } from '../../utils/constants';
import { getHeroPattern, heroPatternShapesToSvgString, type HeroPattern } from './HeroPatterns';

/**
 * Render SVG defs (patterns, icons, filters)
 * @param PUBLISH_STAGE_COLORS - Color map for publish stages
 * @param patternScale - Optional scale for patterns (1.0 = default, smaller = denser). Used by APR.
 * @param portableSvg - When true, output standalone SVG with hex-baked colors (no CSS vars).
 *                     Needed for canvas rasterization (no DOM CSS context) and standalone embed
 *                     (e.g., author's website where RT's CSS vars aren't defined).
 * @param workingPatternId - Hero Patterns motif id for the Working-status fill (user-selectable).
 * @param customPatterns - Optional user-defined patterns to consider alongside built-ins.
 */
export function renderDefs(
  PUBLISH_STAGE_COLORS: Record<string, string>,
  patternScale = 1.0,
  portableSvg = false,
  workingPatternId?: string,
  customPatterns?: readonly HeroPattern[],
  idPrefix = ''
): string {
  const workingPattern = getHeroPattern(workingPatternId, customPatterns);
  // Pattern dimensions - scale for APR density control
  const workingW = workingPattern.tileW * patternScale;
  const workingH = workingPattern.tileH * patternScale;
  const todoSize = 10 * patternScale;

  // Portable mode bakes hex (canvas / standalone embed has no CSS var context); CSS mode uses vars
  // with the same hex as fallback — STATUS_HEX is the single source of truth.
  const workingFill = portableSvg ? STATUS_HEX.Working : `var(--rt-color-working, ${STATUS_HEX.Working})`;
  const todoFill = portableSvg ? STATUS_HEX.Todo : `var(--rt-color-todo, ${STATUS_HEX.Todo})`;
  const plaidOpacity = portableSvg ? '0.82' : 'var(--rt-color-plaid-opacity, 0.82)';

  const fillRuleAttr = workingPattern.fillRule ? ` fill-rule="${workingPattern.fillRule}"` : '';
  const plaid = Object.entries(PUBLISH_STAGE_COLORS).map(([stage, color]) => {
    // Working pattern: Hero Patterns motif (https://heropatterns.com, CC BY 4.0)
    // by Steve Schoger. Motif chosen via `settings.workingPatternId`.
    const workingPath = `
      <pattern id="${idPrefix}plaidWorking${stage}" patternUnits="userSpaceOnUse" width="${workingW}" height="${workingH}">
        <rect width="${workingW}" height="${workingH}" fill="${workingFill}" opacity="${plaidOpacity}"/>
        <g transform="scale(${patternScale})">
          <g fill="${color}" fill-opacity="${workingPattern.fillOpacity}"${fillRuleAttr}>
            ${heroPatternShapesToSvgString(workingPattern)}
          </g>
        </g>
      </pattern>`;

    // Todo is intentionally quiet; Working carries the visual activity.
    const todoPath = `
      <pattern id="${idPrefix}plaidTodo${stage}" patternUnits="userSpaceOnUse" width="${todoSize}" height="${todoSize}">
        <rect width="${todoSize}" height="${todoSize}" fill="${todoFill}" opacity="${plaidOpacity}"/>
      </pattern>`;

    return workingPath + todoPath;
  }).join('');

  // Icons use currentColor which won't work in portable mode - use fallback stroke color
  // These icons are not used in APR exports, but we handle them for completeness
  const iconStroke = portableSvg ? '#000000' : 'currentColor';
  
  const icons = `
    <symbol id="icon-circle-slash" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="9" x2="15" y1="15" y2="9" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </symbol>
    <symbol id="icon-smile" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="${iconStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" fill="none" stroke="${iconStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="9" x2="9.01" y1="9" y2="9" fill="none" stroke="${iconStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="15" x2="15.01" y1="9" y2="9" fill="none" stroke="${iconStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    </symbol>
    <symbol id="icon-house" viewBox="0 0 24 24">
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </symbol>
    <symbol id="icon-printer" viewBox="0 0 24 24">
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="6" y="14" width="12" height="8" rx="1" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </symbol>
    <symbol id="icon-arrow-right-dash" viewBox="0 0 24 24">
      <path d="M11 9a1 1 0 0 0 1-1V5.061a1 1 0 0 1 1.811-.75l6.836 6.836a1.207 1.207 0 0 1 0 1.707l-6.836 6.835a1 1 0 0 1-1.811-.75V16a1 1 0 0 0-1-1H9a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 9v6" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-arrow-down" viewBox="0 0 24 24">
      <path d="M15 11a1 1 0 0 0 1 1h2.939a1 1 0 0 1 .75 1.811l-6.835 6.836a1.207 1.207 0 0 1-1.707 0L4.31 13.81a1 1 0 0 1 .75-1.811H8a1 1 0 0 0 1-1V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1z" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-bookmark-check" viewBox="0 0 24 24">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m9 10 2 2 4-4" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <!-- Arrow Up/Down From Line (toggle rotation) -->
    <symbol id="icon-arrow-up-from-line" viewBox="0 0 24 24">
      <path d="m18 9-6-6-6 6" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12 3v14" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M5 21h14" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </symbol>
    <symbol id="icon-arrow-down-from-line" viewBox="0 0 24 24">
      <path d="M19 3H5" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12 21V7" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="m6 15 6 6 6-6" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </symbol>
  `;

  return plaid + icons;
}


export function renderProgressRingGradients(radius: number): string {
  // Rainbow colors for 6 segments going clockwise from 12 o'clock
  const colors = [
    ['#FF0000', '#FF7F00'], // Red to Orange
    ['#FF7F00', '#FFFF00'], // Orange to Yellow
    ['#FFFF00', '#00FF00'], // Yellow to Green
    ['#00FF00', '#0000FF'], // Green to Blue
    ['#0000FF', '#4B0082'], // Blue to Indigo
    ['#4B0082', '#8F00FF'], // Indigo to Violet
  ];
  
  const segmentCount = 6;
  const segmentAngle = (2 * Math.PI) / segmentCount;
  const startAngle = -Math.PI / 2; // 12 o'clock
  
  let gradients = '<defs>';
  
  for (let i = 0; i < segmentCount; i++) {
    const segStart = startAngle + i * segmentAngle;
    const segEnd = startAngle + (i + 1) * segmentAngle;
    
    // Calculate gradient endpoints along the arc direction
    const x1 = radius * Math.cos(segStart);
    const y1 = radius * Math.sin(segStart);
    const x2 = radius * Math.cos(segEnd);
    const y2 = radius * Math.sin(segEnd);
    
    gradients += `
      <linearGradient id="linearColors${i + 1}" gradientUnits="userSpaceOnUse" 
        x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" 
        x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}">
        <stop offset="0%" stop-color="${colors[i][0]}"></stop>
        <stop offset="100%" stop-color="${colors[i][1]}"></stop>
      </linearGradient>`;
  }
  
  gradients += '</defs>';
  return gradients;
}
