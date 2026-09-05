/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem } from '../types';
import { STAGE_ORDER } from './constants';

/**
 * Gets the color for the most advanced progress stage across all scenes.
 * 
 * This is the single source of truth for determining the dominant project color.
 * It's used consistently across many UI elements that should reflect the overall 
 * project's most advanced progress-stage state:
 * 
 * - Act labels (ACT 1, ACT 2, etc.)
 * - Subplot arcing headline labels (top-left quadrant, all subplot rings)
 * - Gossamer ideal range lines and text
 * - Gossamer min/max band background
 * - Gossamer dot colors
 * - Plaid patterns for Working/Todo scenes (stroke color)
 * - CSS custom property: --rt-max-publish-stage-color
 * 
 * @param scenes - Array of scenes to analyze
 * @param publishStageColors - Map of stage names to their colors (Zero, Author, House, Press)
 * @returns The hex color of the most advanced progress stage found, or the Zero stage color as fallback
 */
export function getMostAdvancedStageColor(
  scenes: TimelineItem[],
  publishStageColors: Record<string, string>
): string {
  const stageOrder = [...STAGE_ORDER];
  let maxStageIndex = 0; // Default to Zero index
  
  scenes.forEach(scene => {
    const rawStage = scene["Publish Stage"];
    const stage = (STAGE_ORDER as readonly string[]).includes(rawStage as string) 
      ? (rawStage as typeof STAGE_ORDER[number]) 
      : 'Zero';
    const currentIndex = stageOrder.indexOf(stage);
    if (currentIndex > maxStageIndex) {
      maxStageIndex = currentIndex;
    }
  });
  
  const maxStageName = stageOrder[maxStageIndex];
  return publishStageColors[maxStageName as keyof typeof publishStageColors] || publishStageColors.Zero;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16)
  };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function desaturateColor(hexColor: string, amount: number): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return hexColor;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  hsl.s = Math.max(0, hsl.s * (1 - amount));
  const desatRgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return rgbToHex(desatRgb.r, desatRgb.g, desatRgb.b);
}

export function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.max((num >> 16) - amt, 0);
  const g = Math.max(((num >> 8) & 0x00ff) - amt, 0);
  const b = Math.max((num & 0x0000ff) - amt, 0);
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

export function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = num >> 16;
  const g = (num >> 8) & 0x00ff;
  const b = num & 0x0000ff;
  const mixRatio = Math.min(1, percent / 100);
  const newR = Math.min(255, Math.round(r + (255 - r) * mixRatio));
  const newG = Math.min(255, Math.round(g + (255 - g) * mixRatio));
  const newB = Math.min(255, Math.round(b + (255 - b) * mixRatio));
  return `#${(1 << 24 | newR << 16 | newG << 8 | newB).toString(16).slice(1)}`;
}

/**
 * Adjusts the saturation of a hex color to an absolute level.
 * @param hex - The hex color to adjust
 * @param saturationLevel - Target saturation level (0.0 = fully desaturated/gray, 1.0 = original saturation)
 * @returns The adjusted hex color
 */
export function adjustSaturation(hex: string, saturationLevel: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // Scale the original saturation by the saturation level
  hsl.s = hsl.s * Math.max(0, Math.min(1, saturationLevel));
  const adjustedRgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return rgbToHex(adjustedRgb.r, adjustedRgb.g, adjustedRgb.b);
}

/**
 * Calculates the color for a Gossamer run based on its position within a stage.
 * Uses saturation gradations: older runs are more muted, newer runs are more vibrant.
 * 
 * @param stageColor - The base hex color for the stage (e.g., purple for Zero)
 * @param runIndexInStage - 0-based index of this run within its stage group (0 = oldest in stage)
 * @param totalRunsInStage - Total number of runs in this stage
 * @returns Hex color with adjusted saturation
 */
export function getRunColorWithSaturation(
  stageColor: string,
  runIndexInStage: number,
  totalRunsInStage: number
): string {
  // Saturation range: 40% (oldest) to 100% (newest)
  const minSaturation = 0.4;
  const maxSaturation = 1.0;
  
  // If only one run in stage, use full saturation
  if (totalRunsInStage <= 1) {
    return stageColor;
  }
  
  // Calculate position (0 = oldest, 1 = newest)
  const position = runIndexInStage / (totalRunsInStage - 1);
  const saturationLevel = minSaturation + position * (maxSaturation - minSaturation);
  
  return adjustSaturation(stageColor, saturationLevel);
}

