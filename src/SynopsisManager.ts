import { appendSynopsisInline } from './utils/synopsisInline';
/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { readSubplotColor } from './renderer/utils/subplotColors';
import type RadialTimelinePlugin from './main';
import type { TimelineItem } from './types';
import type { HoverMetadataField } from './types/settings';
import {
  resolveHoverMetadataFields,
  readFrontmatterFieldValue,
  formatHoverMetadataValue,
  formatDateForDisplay
} from './utils/hoverMetadata';
import { decodeHtmlEntities, parseSceneTitleComponents } from './utils/text';
import { getPublishStageStyle, splitSynopsisLines, decodeContentLines, isOverdueAndIncomplete } from './synopsis/SynopsisData';
import { createSynopsisContainer, createTextGroup, createText } from './synopsis/SynopsisView';
import { convertFromEarth, getActivePlanetaryProfile } from './utils/planetaryTime';
import { t } from './i18n';
import {
  SUBPLOT_OUTER_RADIUS_MAINPLOT,
  SUBPLOT_OUTER_RADIUS_STANDARD,
  SUBPLOT_OUTER_RADIUS_CHRONOLOGUE,
  SYNOPSIS_INSET,
  MAX_TEXT_WIDTH,
  INNER_RADIUS
} from './renderer/layout/LayoutConstants';
import { sortScenes, isBeatNote, shouldDisplayMissingWhenWarning } from './utils/sceneHelpers';
import { parseWhenField } from './utils/date';
import { getReadabilityMultiplier, getReadabilityScale } from './utils/readability';
import { applySearchTermHighlightsInRoot, clearSearchHighlightsInRoot } from './view/interactions/SearchInteractions';
import { shouldHighlightMetadataTerm } from './services/searchState';
import { getIcon } from 'obsidian';
import { getSynopsisHoverLineLimit } from './utils/synopsisLimits';

/**
 * Handles generating synopsis SVG/HTML blocks and positioning logic.
 * (This is the class you formerly had inside main.ts, unchanged.)
 */
export default class SynopsisManager {
  private plugin: RadialTimelinePlugin;

  /** Vertical offset for planetary time dashed border rect (higher = further up) */
  private static readonly PLANETARY_RECT_Y_OFFSET = 16;
  private static readonly WRAP_OVERFLOW_TOLERANCE = 12;

  constructor(plugin: RadialTimelinePlugin) {
    this.plugin = plugin;
  }

  private getReadabilityScale(): number {
    return getReadabilityMultiplier(this.plugin.settings);
  }

  private getLineInnerRadius(svg: SVGSVGElement | null): number {
    if (!svg) return INNER_RADIUS;
    const attr = svg.getAttribute('data-line-inner-radius');
    if (attr) {
      const parsed = parseFloat(attr);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    // Fallback: derive from inner calendar spokes (lineInnerRadius - 5)
    const spoke = svg.querySelector('.rt-inner-calendar-spoke');
    if (spoke) {
      const x1 = Number(spoke.getAttribute('x1') || '0');
      const y1 = Number(spoke.getAttribute('y1') || '0');
      const innerSpokeStart = Math.hypot(x1, y1);
      const derived = innerSpokeStart + 5;
      if (Number.isFinite(derived) && derived > 0) return derived;
    }

    return INNER_RADIUS;
  }

  private measureTextWidthForWrap(textEl: SVGTextElement, text: string): number {
    const prev = textEl.textContent ?? '';
    textEl.textContent = text;
    const width = this.measureTextWidth(textEl);
    textEl.textContent = prev;
    return width;
  }

  private wrapTextToMeasuredWidth(
    text: string,
    maxWidth: number,
    measure: (value: string) => number,
    options?: { firstLinePrefix?: string }
  ): string[] {
    if (!text || typeof text !== 'string') return [''];
    const trimmed = text.trim();
    if (!trimmed) return [''];

    const words = trimmed.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    const firstLinePrefix = options?.firstLinePrefix ?? '';

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      const probe = lines.length === 0 ? `${firstLinePrefix}${next}` : next;
      if (current && measure(probe) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) lines.push(current);
    return lines.length > 0 ? lines : [trimmed];
  }

  private getWrappedListData(textEl: SVGTextElement): {
    kind: 'subplot' | 'character';
    items: Array<{ text: string; color: string; povLabel?: string }>;
  } | null {
    const kindAttr = textEl.getAttribute('data-list-wrap-kind');
    const itemsAttr = textEl.getAttribute('data-list-wrap-items');
    if (!kindAttr || !itemsAttr) return null;
    if (kindAttr !== 'subplot' && kindAttr !== 'character') return null;

    try {
      const parsed: unknown = JSON.parse(itemsAttr);
      if (!Array.isArray(parsed)) return null;
      const items = parsed
        .filter((item: unknown): item is { text: string; color: string; povLabel?: string } =>
          !!item && typeof item === 'object' && 'text' in item && 'color' in item && typeof item.text === 'string' && typeof item.color === 'string'
        )
        .map(item => ({
          text: item.text,
          color: item.color,
          povLabel: typeof item.povLabel === 'string' && item.povLabel.trim() ? item.povLabel.trim() : undefined
        }));
      if (items.length === 0) return null;
      return { kind: kindAttr, items };
    } catch {
      return null;
    }
  }

  private setWrappedListLineContent(
    textEl: SVGTextElement,
    kind: 'subplot' | 'character',
    items: Array<{ text: string; color: string; povLabel?: string }>
  ): void {
    const doc = textEl.ownerDocument;
    while (textEl.firstChild) {
      textEl.removeChild(textEl.firstChild);
    }

    items.forEach((item, index) => {
      if (kind === 'subplot') {
        const tspan = doc.win.createSvg('tspan');
        tspan.setAttribute('data-item-type', 'subplot');
        tspan.style.setProperty('--rt-dynamic-color', item.color);
        tspan.textContent = item.text;
        textEl.appendChild(tspan);
      } else {
        let baselineRaised = false;
        const tspan = doc.win.createSvg('tspan');
        tspan.setAttribute('data-item-type', 'character');
        tspan.style.setProperty('--rt-dynamic-color', item.color);
        if (item.povLabel) {
          tspan.classList.add('rt-pov-character');
        }
        tspan.textContent = item.text;
        textEl.appendChild(tspan);

        if (item.povLabel) {
          const povTspan = doc.win.createSvg('tspan');
          povTspan.setAttribute('class', 'rt-pov-marker');
          povTspan.setAttribute('dy', '-8px');
          povTspan.style.setProperty('--rt-dynamic-color', item.color);
          povTspan.textContent = item.povLabel;
          textEl.appendChild(povTspan);
          baselineRaised = true;
        }

        if (index < items.length - 1) {
          const comma = doc.win.createSvg('tspan');
          comma.setAttribute('fill', 'var(--text-muted)');
          if (baselineRaised) {
            comma.setAttribute('dy', '8px');
          }
          comma.textContent = ', ';
          textEl.appendChild(comma);
        } else if (baselineRaised) {
          const resetTspan = doc.win.createSvg('tspan');
          resetTspan.setAttribute('dy', '8px');
          resetTspan.textContent = '';
          textEl.appendChild(resetTspan);
        }
      }

      if (kind === 'subplot' && index < items.length - 1) {
        const comma = doc.win.createSvg('tspan');
        comma.setAttribute('fill', 'var(--text-muted)');
        comma.textContent = ', ';
        textEl.appendChild(comma);
      }
    });
  }

  private measureWrappedListWidth(
    textEl: SVGTextElement,
    kind: 'subplot' | 'character',
    items: Array<{ text: string; color: string; povLabel?: string }>
  ): number {
    const existingChildren = textEl.ownerDocument.win.createFragment();
    while (textEl.firstChild) {
      existingChildren.appendChild(textEl.firstChild);
    }

    this.setWrappedListLineContent(textEl, kind, items);
    const width = this.measureTextWidth(textEl);

    while (textEl.firstChild) {
      textEl.removeChild(textEl.firstChild);
    }
    textEl.appendChild(existingChildren);

    return width;
  }

  private wrapWrappedListItems(
    textEl: SVGTextElement,
    kind: 'subplot' | 'character',
    items: Array<{ text: string; color: string; povLabel?: string }>,
    maxWidth: number
  ): Array<Array<{ text: string; color: string; povLabel?: string }>> {
    const lines: Array<Array<{ text: string; color: string; povLabel?: string }>> = [];
    let current: Array<{ text: string; color: string; povLabel?: string }> = [];

    items.forEach(item => {
      const candidate = [...current, item];
      const candidateWidth = this.measureWrappedListWidth(textEl, kind, candidate);
      if (current.length > 0 && candidateWidth > maxWidth) {
        lines.push(current);
        current = [item];
      } else {
        current = candidate;
      }
    });

    if (current.length > 0) {
      lines.push(current);
    }

    return lines;
  }

  private resetAdvancedYamlWrap(synopsis: Element): void {
    const lineGroups = Array.from(synopsis.querySelectorAll('.rt-hover-metadata-line'));
    lineGroups.forEach(group => {
      const textEls = Array.from(group.querySelectorAll('.rt-hover-metadata-text'));
      if (textEls.length === 0) return;

      // Remove any previously wrapped continuation lines
      textEls.slice(1).forEach(el => {
        if (el.getAttribute('data-advanced-wrap') === 'true') {
          el.remove();
        }
      });

      const primary = textEls[0];
      const raw = primary.getAttribute('data-advanced-raw');
      if (raw !== null) {
        primary.textContent = raw;
      }
    });
  }

  private resetMainSynopsisWrap(synopsis: Element): void {
    const wrapped = Array.from(synopsis.querySelectorAll('[data-synopsis-wrap="true"]'));
    wrapped.forEach(el => el.remove());

    const lines = Array.from(synopsis.querySelectorAll<SVGTextElement>('[data-synopsis-line="true"]'));
    lines.forEach(line => {
      const raw = line.getAttribute('data-synopsis-raw');
      if (raw !== null) {
        line.textContent = raw;
      }
    });
  }

  private resetPendingEditsWrap(synopsis: Element): void {
    const wrapped = Array.from(synopsis.querySelectorAll('[data-pending-wrap="true"]'));
    wrapped.forEach(el => el.remove());

    const lines = Array.from(synopsis.querySelectorAll<SVGTextElement>('[data-pending-line="true"]'));
    lines.forEach(line => {
      const raw = line.getAttribute('data-pending-raw');
      const prefix = line.getAttribute('data-pending-prefix') ?? '';
      if (raw !== null) {
        line.textContent = `${prefix}${raw}`;
      }
    });
  }

  private resetWrappedListLines(synopsis: Element): void {
    const wrapped = Array.from(synopsis.querySelectorAll('[data-list-wrap="true"]'));
    wrapped.forEach(el => el.remove());

    const lines = Array.from(synopsis.querySelectorAll<SVGTextElement>('[data-list-wrap-kind]'));
    lines.forEach(line => {
      const listData = this.getWrappedListData(line);
      if (!listData) return;
      this.setWrappedListLineContent(line, listData.kind, listData.items);
    });
  }

  private applyMainSynopsisWrap(params: {
    textRows: SVGTextElement[][];
    baseY: number;
    radius: number;
    isRightAligned: boolean;
    isTopHalf: boolean;
    fontScale: number;
    pulseLineHeight: number;
    lineInnerRadius: number;
  }): boolean {
    const {
      textRows,
      baseY,
      radius,
      isRightAligned,
      isTopHalf,
      fontScale,
      pulseLineHeight,
      lineInnerRadius
    } = params;

    let didWrap = false;
    let yOffset = 0;
    const titleLineHeight = 32 * fontScale;
    const synopsisLineHeight = 22 * fontScale;
    const scorePreGap = 46 * fontScale;
    const defaultMaxWidth = MAX_TEXT_WIDTH * fontScale;

    for (let rowIndex = 0; rowIndex < textRows.length; rowIndex++) {
      const rowElements = textRows[rowIndex];
      const primaryEl = rowElements[0];
      if (!primaryEl) continue;

      // Match row spacing logic used during layout
      if (rowIndex > 0) {
        const currentEl = rowElements[0];
        const isGossamerLine = currentEl.classList.contains('ert-gossamer-score-line');
        const isBeatsText = currentEl.classList.contains('pulse-text');
        const prevEl = textRows[rowIndex - 1][0];
        const isPrevLineSynopsis = prevEl.classList.contains('rt-title-text-secondary');
        const isPrevLineBeats = prevEl.classList.contains('pulse-text');

        if (rowIndex === 1) {
          yOffset += titleLineHeight;
        } else if (isGossamerLine && isPrevLineSynopsis) {
          yOffset += scorePreGap;
        } else if (isBeatsText || isPrevLineBeats) {
          yOffset += pulseLineHeight;
        } else {
          yOffset += synopsisLineHeight;
        }
      }

      if (primaryEl.getAttribute('data-synopsis-line') !== 'true') {
        continue;
      }

      const raw = primaryEl.getAttribute('data-synopsis-raw') ?? primaryEl.textContent ?? '';
      if (!raw.trim()) continue;

      const anchorY = baseY + yOffset;
      const radiusDiff = radius * radius - anchorY * anchorY;
      if (radiusDiff <= 0) continue;

      const circleX = Math.sqrt(radiusDiff);
      const direction = isRightAligned ? 1 : -1;

      let inset = 0;
      if (isTopHalf) {
        const style = window.getComputedStyle(primaryEl);
        const fontSize = parseFloat(style.fontSize) || 16;
        const ratio = rowIndex <= 1 ? 0.5 : SynopsisManager.TEXT_HEIGHT_INSET_RATIO;
        inset = fontSize * ratio;
      }

      const anchorAbsoluteX = (circleX - inset) * direction;
      const rightEdge = anchorAbsoluteX - SYNOPSIS_INSET;

      let maxWidth = defaultMaxWidth;
      let boundaryX = 0;
      if (lineInnerRadius > 0 && Math.abs(anchorY) < lineInnerRadius) {
        const innerDiff = lineInnerRadius * lineInnerRadius - anchorY * anchorY;
        if (innerDiff > 0) {
          boundaryX = Math.sqrt(innerDiff);
        }
      }
      if (isRightAligned) {
        maxWidth = rightEdge - boundaryX;
      } else {
        const leftEdge = anchorAbsoluteX + SYNOPSIS_INSET;
        const leftBoundary = boundaryX > 0 ? -boundaryX : 0;
        maxWidth = leftBoundary - leftEdge;
      }

      maxWidth += SynopsisManager.WRAP_OVERFLOW_TOLERANCE * fontScale;

      if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
        continue;
      }

      const wrapped = this.wrapTextToMeasuredWidth(raw, maxWidth, value => this.measureTextWidthForWrap(primaryEl, value));
      if (wrapped.length === 0) continue;

      primaryEl.textContent = wrapped[0];
      primaryEl.setAttribute('data-synopsis-line', 'true');
      const insertParent = primaryEl.parentNode;
      let insertBefore = primaryEl.nextSibling;
      for (let i = 1; i < wrapped.length; i++) {
        const cont = primaryEl.cloneNode(false) as SVGTextElement;
        cont.setAttribute('data-synopsis-wrap', 'true');
        cont.setAttribute('data-synopsis-line', 'true');
        cont.textContent = wrapped[i];
        insertParent?.insertBefore(cont, insertBefore);
        insertBefore = cont.nextSibling;
      }

      if (wrapped.length > 1) didWrap = true;
    }

    return didWrap;
  }

  private applyPendingEditsWrap(params: {
    textRows: SVGTextElement[][];
    baseY: number;
    radius: number;
    isRightAligned: boolean;
    isTopHalf: boolean;
    fontScale: number;
    pulseLineHeight: number;
    lineInnerRadius: number;
  }): boolean {
    const {
      textRows,
      baseY,
      radius,
      isRightAligned,
      isTopHalf,
      fontScale,
      pulseLineHeight,
      lineInnerRadius
    } = params;

    let didWrap = false;
    let yOffset = 0;
    const titleLineHeight = 32 * fontScale;
    const synopsisLineHeight = 22 * fontScale;
    const scorePreGap = 46 * fontScale;
    const defaultMaxWidth = MAX_TEXT_WIDTH * fontScale;

    for (let rowIndex = 0; rowIndex < textRows.length; rowIndex++) {
      const rowElements = textRows[rowIndex];
      const primaryEl = rowElements[0];
      if (!primaryEl) continue;

      if (rowIndex > 0) {
        const currentEl = rowElements[0];
        const isGossamerLine = currentEl.classList.contains('ert-gossamer-score-line');
        const isBeatsText = currentEl.classList.contains('pulse-text');
        const prevEl = textRows[rowIndex - 1][0];
        const isPrevLineSynopsis = prevEl.classList.contains('rt-title-text-secondary');
        const isPrevLineBeats = prevEl.classList.contains('pulse-text');

        if (rowIndex === 1) {
          yOffset += titleLineHeight;
        } else if (isGossamerLine && isPrevLineSynopsis) {
          yOffset += scorePreGap;
        } else if (isBeatsText || isPrevLineBeats) {
          yOffset += pulseLineHeight;
        } else {
          yOffset += synopsisLineHeight;
        }
      }

      if (primaryEl.getAttribute('data-pending-line') !== 'true') {
        continue;
      }

      const raw = primaryEl.getAttribute('data-pending-raw') ?? '';
      const prefix = primaryEl.getAttribute('data-pending-prefix') ?? '';
      if (!raw.trim()) continue;

      const anchorY = baseY + yOffset;
      const radiusDiff = radius * radius - anchorY * anchorY;
      if (radiusDiff <= 0) continue;

      const circleX = Math.sqrt(radiusDiff);
      const direction = isRightAligned ? 1 : -1;

      let inset = 0;
      if (isTopHalf) {
        const style = window.getComputedStyle(primaryEl);
        const fontSize = parseFloat(style.fontSize) || 16;
        const ratio = rowIndex <= 1 ? 0.5 : SynopsisManager.TEXT_HEIGHT_INSET_RATIO;
        inset = fontSize * ratio;
      }

      const anchorAbsoluteX = (circleX - inset) * direction;
      const rightEdge = anchorAbsoluteX - SYNOPSIS_INSET;

      let maxWidth = defaultMaxWidth;
      let boundaryX = 0;
      if (lineInnerRadius > 0 && Math.abs(anchorY) < lineInnerRadius) {
        const innerDiff = lineInnerRadius * lineInnerRadius - anchorY * anchorY;
        if (innerDiff > 0) {
          boundaryX = Math.sqrt(innerDiff);
        }
      }
      if (isRightAligned) {
        maxWidth = rightEdge - boundaryX;
      } else {
        const leftEdge = anchorAbsoluteX + SYNOPSIS_INSET;
        const leftBoundary = boundaryX > 0 ? -boundaryX : 0;
        maxWidth = leftBoundary - leftEdge;
      }

      maxWidth += SynopsisManager.WRAP_OVERFLOW_TOLERANCE * fontScale;

      if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
        continue;
      }

      const wrapped = this.wrapTextToMeasuredWidth(
        raw,
        maxWidth,
        value => this.measureTextWidthForWrap(primaryEl, value),
        { firstLinePrefix: prefix }
      );
      if (wrapped.length === 0) continue;

      primaryEl.textContent = `${prefix}${wrapped[0]}`;
      const insertParent = primaryEl.parentNode;
      let insertBefore = primaryEl.nextSibling;
      for (let i = 1; i < wrapped.length; i++) {
        const cont = primaryEl.cloneNode(false) as SVGTextElement;
        cont.setAttribute('data-pending-wrap', 'true');
        cont.setAttribute('data-pending-line', 'true');
        cont.textContent = wrapped[i];
        insertParent?.insertBefore(cont, insertBefore);
        insertBefore = cont.nextSibling;
      }

      if (wrapped.length > 1) didWrap = true;
    }

    return didWrap;
  }

  private applyAdvancedYamlWrap(params: {
    textRows: SVGTextElement[][];
    baseY: number;
    radius: number;
    isRightAligned: boolean;
    isTopHalf: boolean;
    fontScale: number;
    pulseLineHeight: number;
    lineInnerRadius: number;
  }): boolean {
    const {
      textRows,
      baseY,
      radius,
      isRightAligned,
      isTopHalf,
      fontScale,
      pulseLineHeight,
      lineInnerRadius
    } = params;

    let didWrap = false;
    let yOffset = 0;
    const titleLineHeight = 32 * fontScale;
    const synopsisLineHeight = 22 * fontScale;
    const scorePreGap = 46 * fontScale;
    const defaultMaxWidth = MAX_TEXT_WIDTH * fontScale;

    for (let rowIndex = 0; rowIndex < textRows.length; rowIndex++) {
      const rowElements = textRows[rowIndex];
      const primaryEl = rowElements[0];
      if (!primaryEl) continue;

      // Match row spacing logic used during layout
      if (rowIndex > 0) {
        const currentEl = rowElements[0];
        const isGossamerLine = currentEl.classList.contains('ert-gossamer-score-line');
        const isBeatsText = currentEl.classList.contains('pulse-text');
        const prevEl = textRows[rowIndex - 1][0];
        const isPrevLineSynopsis = prevEl.classList.contains('rt-title-text-secondary');
        const isPrevLineBeats = prevEl.classList.contains('pulse-text');

        if (rowIndex === 1) {
          yOffset += titleLineHeight;
        } else if (isGossamerLine && isPrevLineSynopsis) {
          yOffset += scorePreGap;
        } else if (isBeatsText || isPrevLineBeats) {
          yOffset += pulseLineHeight;
        } else {
          yOffset += synopsisLineHeight;
        }
      }

      const lineGroup = primaryEl.closest('.rt-hover-metadata-line');
      if (!lineGroup) continue;
      const raw = primaryEl.getAttribute('data-advanced-raw') ?? primaryEl.textContent ?? '';
      if (!raw.trim()) continue;

      const anchorY = baseY + yOffset;
      const radiusDiff = radius * radius - anchorY * anchorY;
      if (radiusDiff <= 0) continue;

      const circleX = Math.sqrt(radiusDiff);
      const direction = isRightAligned ? 1 : -1;

      let inset = 0;
      if (isTopHalf) {
        const style = window.getComputedStyle(primaryEl);
        const fontSize = parseFloat(style.fontSize) || 16;
        const ratio = rowIndex <= 1 ? 0.5 : SynopsisManager.TEXT_HEIGHT_INSET_RATIO;
        inset = fontSize * ratio;
      }

      const hasHoverIcon = this.getHoverIconTotalOffset(primaryEl) > 0;
      const extraRightInset = isRightAligned && hasHoverIcon ? 20 : 0;
      const anchorAbsoluteX = (circleX - inset - extraRightInset) * direction;
      const rightEdge = anchorAbsoluteX - SYNOPSIS_INSET;

      let maxWidth = defaultMaxWidth;
      let boundaryX = 0;
      if (lineInnerRadius > 0 && Math.abs(anchorY) < lineInnerRadius) {
        const innerDiff = lineInnerRadius * lineInnerRadius - anchorY * anchorY;
        if (innerDiff > 0) {
          boundaryX = Math.sqrt(innerDiff);
        }
      }
      if (isRightAligned) {
        maxWidth = rightEdge - boundaryX;
      } else {
        const leftEdge = anchorAbsoluteX + SYNOPSIS_INSET;
        const leftBoundary = boundaryX > 0 ? -boundaryX : 0;
        maxWidth = leftBoundary - leftEdge;
      }

      maxWidth += SynopsisManager.WRAP_OVERFLOW_TOLERANCE * fontScale;

      if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
        continue;
      }

      const wrapped = this.wrapTextToMeasuredWidth(raw, maxWidth, value => this.measureTextWidthForWrap(primaryEl, value));
      if (wrapped.length <= 1) continue;

      primaryEl.textContent = wrapped[0];
      for (let i = 1; i < wrapped.length; i++) {
        const cont = primaryEl.cloneNode(false) as SVGTextElement;
        cont.setAttribute('data-advanced-wrap', 'true');
        cont.setAttribute('data-advanced-line', 'true');
        cont.textContent = wrapped[i];
        lineGroup?.appendChild(cont);
      }
      didWrap = true;
    }

    return didWrap;
  }

  private applyWrappedListLineWrap(params: {
    textRows: SVGTextElement[][];
    baseY: number;
    radius: number;
    isRightAligned: boolean;
    isTopHalf: boolean;
    fontScale: number;
    pulseLineHeight: number;
    lineInnerRadius: number;
  }): boolean {
    const {
      textRows,
      baseY,
      radius,
      isRightAligned,
      isTopHalf,
      fontScale,
      pulseLineHeight,
      lineInnerRadius
    } = params;

    let didWrap = false;
    let yOffset = 0;
    const titleLineHeight = 32 * fontScale;
    const synopsisLineHeight = 22 * fontScale;
    const scorePreGap = 46 * fontScale;
    const defaultMaxWidth = MAX_TEXT_WIDTH * fontScale;

    for (let rowIndex = 0; rowIndex < textRows.length; rowIndex++) {
      const rowElements = textRows[rowIndex];
      const primaryEl = rowElements[0];
      if (!primaryEl || primaryEl.getAttribute('data-list-wrap') === 'true') continue;

      if (rowIndex > 0) {
        const currentEl = rowElements[0];
        const isGossamerLine = currentEl.classList.contains('ert-gossamer-score-line');
        const isBeatsText = currentEl.classList.contains('pulse-text');
        const prevEl = textRows[rowIndex - 1][0];
        const isPrevLineSynopsis = prevEl.classList.contains('rt-title-text-secondary');
        const isPrevLineBeats = prevEl.classList.contains('pulse-text');

        if (rowIndex === 1) {
          yOffset += titleLineHeight;
        } else if (isGossamerLine && isPrevLineSynopsis) {
          yOffset += scorePreGap;
        } else if (isBeatsText || isPrevLineBeats) {
          yOffset += pulseLineHeight;
        } else {
          yOffset += synopsisLineHeight;
        }
      }

      const listData = this.getWrappedListData(primaryEl);
      if (!listData) continue;

      const anchorY = baseY + yOffset;
      const radiusDiff = radius * radius - anchorY * anchorY;
      if (radiusDiff <= 0) continue;

      const circleX = Math.sqrt(radiusDiff);
      const direction = isRightAligned ? 1 : -1;

      let inset = 0;
      if (isTopHalf) {
        const style = window.getComputedStyle(primaryEl);
        const fontSize = parseFloat(style.fontSize) || 16;
        const ratio = rowIndex <= 1 ? 0.5 : SynopsisManager.TEXT_HEIGHT_INSET_RATIO;
        inset = fontSize * ratio;
      }

      const anchorAbsoluteX = (circleX - inset) * direction;
      const rightEdge = anchorAbsoluteX - SYNOPSIS_INSET;

      let maxWidth = defaultMaxWidth;
      let boundaryX = 0;
      if (lineInnerRadius > 0 && Math.abs(anchorY) < lineInnerRadius) {
        const innerDiff = lineInnerRadius * lineInnerRadius - anchorY * anchorY;
        if (innerDiff > 0) {
          boundaryX = Math.sqrt(innerDiff);
        }
      }
      if (isRightAligned) {
        maxWidth = rightEdge - boundaryX;
      } else {
        const leftEdge = anchorAbsoluteX + SYNOPSIS_INSET;
        const leftBoundary = boundaryX > 0 ? -boundaryX : 0;
        maxWidth = leftBoundary - leftEdge;
      }

      maxWidth += SynopsisManager.WRAP_OVERFLOW_TOLERANCE * fontScale;

      if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
        continue;
      }

      const wrappedLines = this.wrapWrappedListItems(primaryEl, listData.kind, listData.items, maxWidth);
      if (wrappedLines.length <= 1) continue;

      this.setWrappedListLineContent(primaryEl, listData.kind, wrappedLines[0]);
      const insertParent = primaryEl.parentNode;
      let insertBefore = primaryEl.nextSibling;
      for (let i = 1; i < wrappedLines.length; i++) {
        const cont = primaryEl.cloneNode(false) as SVGTextElement;
        cont.setAttribute('data-list-wrap', 'true');
        this.setWrappedListLineContent(cont, listData.kind, wrappedLines[i]);
        insertParent?.insertBefore(cont, insertBefore);
        insertBefore = cont.nextSibling;
      }

      didWrap = true;
    }

    return didWrap;
  }

  private buildPlanetaryLine(scene: TimelineItem): string | null {
    if (!scene.when) return null;
    const profile = getActivePlanetaryProfile(this.plugin.settings);
    if (!profile) return null;
    const conversion = convertFromEarth(scene.when, profile);
    if (!conversion) return null;
    const label = (profile.label || 'LOCAL').toUpperCase();
    return `${label}: ${conversion.formatted}`;
  }

  /**
   * Add title content to a text element safely
   * @param titleContent The title content to add
   * @param titleTextElement The text element to add to
   * @param titleColor The color for the title
   * @param sceneNumber Optional scene number from frontmatter
   * @param sceneDate Optional scene date from frontmatter (should be pre-formatted)
   * @param sceneDuration Optional scene duration from frontmatter
   */
  /**
   * Add title content to the title text element
   * Returns a metadata text element if date/duration exist, otherwise null
   */
  private addTitleContent(titleContent: string, titleTextElement: SVGTextElement, titleColor: string, sceneNumber?: number | null, sceneDate?: string, sceneDuration?: string): SVGTextElement | null {
    const ownerDoc = titleTextElement.ownerDocument;
    if (titleContent.includes('<tspan')) {

      this.processContentWithTspans(titleContent, titleTextElement);

      return null; // Pre-formatted content doesn't have separate metadata

    } else {
      // Non-search case: render title with date and duration
      const titleParts = parseSceneTitleComponents(titleContent, sceneNumber, sceneDate, sceneDuration);

      // Add scene number if it exists
      if (titleParts.sceneNumber) {
        const numTspan = ownerDoc.win.createSvg("tspan");
        numTspan.classList.add('rt-scene-title-bold');
        numTspan.setAttribute("data-item-type", "title");
        numTspan.style.setProperty('--rt-dynamic-color', titleColor);
        numTspan.style.setProperty('fill', titleColor);
        numTspan.textContent = `${titleParts.sceneNumber} `;
        titleTextElement.appendChild(numTspan);
      }

      // Add main title
      const mainTspan = ownerDoc.win.createSvg("tspan");
      mainTspan.classList.add('rt-scene-title-bold');
      mainTspan.setAttribute("data-item-type", "title");
      mainTspan.style.setProperty('--rt-dynamic-color', titleColor);
      mainTspan.style.setProperty('fill', titleColor);
      mainTspan.textContent = titleParts.title;
      titleTextElement.appendChild(mainTspan);


      // Create separate date/time and duration element (Column 2 of title row)
      // This is the mini-block positioned to the right of the main scene title
      if (titleParts.date || titleParts.duration) {
        const metadataElement = ownerDoc.win.createSvg("text");
        metadataElement.setAttribute("class", "rt-info-text rt-title-text-main rt-title-date-time");
        metadataElement.setAttribute("x", "0");
        metadataElement.setAttribute("y", "0"); // Same baseline as title, layout handled later
        metadataElement.setAttribute("text-anchor", "start");
        metadataElement.setAttribute("data-metadata-block", "true");
        metadataElement.setAttribute("data-column-gap", `8px`); // default gap in px

        // Row 1: Date/time (at baseline, same as title)
        if (titleParts.date) {
          const dateTspan = ownerDoc.win.createSvg("tspan");
          dateTspan.setAttribute('class', 'rt-date-text');
          dateTspan.setAttribute('data-item-type', 'date');
          dateTspan.setAttribute('data-column-role', 'date');
          dateTspan.setAttribute('dy', `-16px`); // Lift slightly so smaller text sits with title cap height
          dateTspan.textContent = titleParts.date;
          metadataElement.appendChild(dateTspan);
        }

        // Row 2: Duration (on new line, aligned with date start)
        if (titleParts.duration) {
          const durationTspan = ownerDoc.win.createSvg("tspan");
          durationTspan.setAttribute('class', 'rt-duration-text');
          durationTspan.setAttribute('data-item-type', 'duration');
          durationTspan.setAttribute('data-column-role', 'duration');
          durationTspan.setAttribute('x', '0'); // Will be positioned in layout step
          durationTspan.setAttribute('dy', titleParts.date ? `16px` : '0'); // New line only if date exists
          durationTspan.textContent = titleParts.duration;
          metadataElement.appendChild(durationTspan);
        }

        return metadataElement;
      }
    }

    return null; // No metadata to add
  }


  /**
   * Create a DOM element for a scene synopsis with consistent formatting
   * @returns An SVG group element containing the formatted synopsis
   */
  generateElement(scene: TimelineItem, contentLines: string[], sceneId: string, subplotIndexResolver?: (name: string) => number, alienModeActive = false): SVGGElement {
    const { titleColor: defaultTitleColor } = getPublishStageStyle(scene["Publish Stage"], this.plugin.settings.publishStageColors);
    const fontScale = this.getReadabilityScale();

    // Determine beat-specific Gossamer stage color (latest Gossamer run), fallback to publish stage color
    const stageColors = this.plugin.settings.publishStageColors;
    let beatStageColor: string | null = null;
    if (scene.itemType === 'Beat' || scene.itemType === 'Plot') {
      const fm = scene.rawFrontmatter || {};
      for (let i = 30; i >= 1; i--) {
        const scoreKey = `Gossamer${i}`;
        const stageKey = `GossamerStage${i}`;
        if (fm[scoreKey] !== undefined && fm[scoreKey] !== null) {
          const stage = fm[stageKey];
          if (typeof stage === 'string') {
            beatStageColor = stageColors[stage as keyof typeof stageColors] || stageColors.Zero;
          }
          break;
        }
      }
    }
    let titleColor = beatStageColor || defaultTitleColor;
    if (scene.itemType === 'Backdrop') {
      const maxStageColor = getComputedStyle(activeDocument.documentElement)
        .getPropertyValue('--rt-max-publish-stage-color')
        .trim();
      titleColor = maxStageColor || 'var(--rt-max-publish-stage-color)';
    }

    const { synopsisEndIndex, metadataItems } = splitSynopsisLines(contentLines);

    // Process all content lines to decode any HTML entities
    const decodedContentLines = decodeContentLines(contentLines);

    // Deterministic subplot color from stylesheet variables
    const getSubplotColor = (subplot: string, sceneIdentifier: string): string => {
      const resolveCssVariable = (index: number): string => readSubplotColor(activeDocument, index);

      const resolveIndex = (): number => {
        if (subplotIndexResolver) {
          const resolved = subplotIndexResolver(subplot);
          if (!Number.isFinite(resolved)) {
            throw new Error(`Subplot index resolver returned an invalid value for "${subplot}".`);
          }
          return resolved;
        }

        const sceneGroup = activeDocument.getElementById(sceneIdentifier)?.closest('.scene-group') as HTMLElement | null;
        if (!sceneGroup) {
          throw new Error(`Scene group not found for synopsis ${sceneIdentifier}.`);
        }
        const idxAttr = sceneGroup.getAttribute('data-subplot-color-index') || sceneGroup.getAttribute('data-subplot-index');
        if (!idxAttr) {
          throw new Error(`Scene group for ${sceneIdentifier} is missing data-subplot-index.`);
        }
        const parsed = parseInt(idxAttr, 10);
        if (Number.isNaN(parsed)) {
          throw new Error(`Invalid subplot index "${idxAttr}" for scene ${sceneIdentifier}.`);
        }
        return parsed;
      };

      const index = resolveIndex();
      return resolveCssVariable(index);
    };

    const styleSource = getComputedStyle(activeDocument.documentElement);
    const synopsisLineHeight = parseFloat(styleSource.getPropertyValue('--rt-synopsis-line-height'));
    const pulseLineHeightRaw = parseFloat(styleSource.getPropertyValue('--rt-pulse-line-height'));
    const metadataLineHeight = parseFloat(styleSource.getPropertyValue('--rt-synopsis-metadata-line-height'));
    const lineHeight = synopsisLineHeight * fontScale;
    const pulseLineHeight = pulseLineHeightRaw * fontScale;

    // Create the main container group
    const containerGroup = createSynopsisContainer(sceneId, scene.path);
    const doc = containerGroup.ownerDocument;

    // Store publish stage color on synopsis for hover title color updates in Progress mode
    containerGroup.setAttribute('data-stage-color', titleColor);

    // Create the synopsis text group
    const synopsisTextGroup = createTextGroup();
    containerGroup.appendChild(synopsisTextGroup);

    // Add the title at origin (0,0) - stage color moved to child tspans
    const titleContent = decodedContentLines[0];
    const titleTextElement = doc.win.createSvg("text");
    titleTextElement.setAttribute("class", `rt-info-text rt-title-text-main`);
    titleTextElement.setAttribute("x", "0");
    titleTextElement.setAttribute("y", "0");

    // Format date from When field for display
    // For Beats (Plot items), only show date if NOT in Gossamer mode
    const currentMode = this.plugin.settings.currentMode || 'narrative';
    const isGossamerMode = currentMode === 'gossamer';
    const isBackdrop = scene.itemType === 'Backdrop';
    const shouldShowDate = scene.when && !(scene.itemType === 'Plot' && isGossamerMode);

    let formattedDate: string | undefined;
    if (shouldShowDate && scene.when) {
      if (alienModeActive) {
        const profile = getActivePlanetaryProfile(this.plugin.settings);
        const conversion = profile ? convertFromEarth(scene.when, profile) : null;
        if (conversion) {
          // Use Alien Date Format
          formattedDate = conversion.formatted;
        } else {
          formattedDate = formatDateForDisplay(scene.when);
        }
      } else {
        formattedDate = formatDateForDisplay(scene.when);
      }
    }

    let duration = scene.Duration ? scene.Duration : undefined;
    if (isBackdrop && scene.End) {
      const endDate = parseWhenField(scene.End);
      if (endDate) {
        duration = `to ${formatDateForDisplay(endDate)}`;
      } else {
        duration = `to ${scene.End}`;
      }
    }

    const metadataElement = this.addTitleContent(titleContent, titleTextElement, titleColor, scene.number, formattedDate, duration);

    synopsisTextGroup.appendChild(titleTextElement);

    // Append metadata element; positioning handled during layout pass
    if (metadataElement) {
      synopsisTextGroup.appendChild(metadataElement);
    }

    // Insert special extra lines right after the title (Due/Pending Edits), then the regular synopsis lines
    let extraLineCount = 0;

    const appendInfoLine = (className: string, text: string) => {
      const y = (1 + extraLineCount) * metadataLineHeight;
      synopsisTextGroup.appendChild(createText(0, y, className, text));
      extraLineCount += 1;
    };

    const appendPlanetaryLine = (text: string) => {
      const y = (1 + extraLineCount) * metadataLineHeight;
      const indentX = 6; // indent text inward
      const group = doc.win.createSvg("g");
      const textEl = createText(0, y, 'rt-info-text rt-title-text-secondary rt-planetary-time-text', text);
      // Force indent via dx attribute (more reliable than x for relative offset)
      textEl.setAttribute('dx', String(indentX));
      textEl.style.fill = titleColor; // Use scene publish stage color

      const rect = doc.win.createSvg("rect");
      rect.setAttribute('class', 'rt-planetary-outline');
      rect.style.stroke = titleColor; // Use scene publish stage color for border too

      // Compute approximate size immediately (getBBox fails when hidden)
      const charWidth = 7.5 * fontScale;
      const estWidth = text.length * charWidth + indentX;
      const estHeight = 15 * fontScale;
      const padX = 6;
      const padY = 2 * fontScale;

      // Border starts at x=0 like other text lines (parent group handles positioning)
      // Note: y position is overridden by positionRowColumns using PLANETARY_RECT_Y_OFFSET
      rect.setAttribute('x', '0');
      rect.setAttribute('y', String(y - SynopsisManager.PLANETARY_RECT_Y_OFFSET * fontScale));
      rect.setAttribute('width', String(estWidth + padX));
      rect.setAttribute('height', String(estHeight + padY * 2));
      rect.setAttribute('rx', '6');
      rect.setAttribute('ry', '6');

      group.appendChild(rect);
      group.appendChild(textEl);
      synopsisTextGroup.appendChild(group);

      extraLineCount += 1;
    };

    const missingWhenMessage = this.buildMissingWhenMessage(scene);
    if (missingWhenMessage) {
      appendInfoLine('rt-info-text rt-title-text-secondary rt-missing-when-text', missingWhenMessage);
    }

    const planetaryLine = this.buildPlanetaryLine(scene);
    if (planetaryLine) {
      appendPlanetaryLine(planetaryLine);
    }

    // Compute Due/Overdue state (YYYY-MM-DD expected)
    const dueString = scene.due;
    if (dueString && isOverdueAndIncomplete(scene)) {
      appendInfoLine('rt-info-text rt-title-text-secondary rt-overdue-text', t('timeline.overdue', { date: dueString }));
    }

    // Pending Edits line if non-empty (notes for next revision)
    const pendingEdits = scene.pendingEdits && typeof scene.pendingEdits === 'string' ? scene.pendingEdits.trim() : '';
    if (pendingEdits) {
      const y = (1 + extraLineCount) * metadataLineHeight;
      const prefix = 'Pending Edits: ';
      const textEl = createText(0, y, 'rt-info-text rt-title-text-secondary rt-pending-edits-text', `${prefix}${pendingEdits}`);
      textEl.setAttribute('data-pending-line', 'true');
      textEl.setAttribute('data-pending-raw', pendingEdits);
      textEl.setAttribute('data-pending-prefix', prefix);
      synopsisTextGroup.appendChild(textEl);
      extraLineCount += 1;
    }

    // Add synopsis lines with precise vertical spacing, offset by the number of extra lines
    for (let i = 1; i < synopsisEndIndex; i++) {
      const lineContent = decodedContentLines[i];

      // Check if this is a Gossamer score line (marked with <gossamer> tags) - check BEFORE decoding
      const isGossamerLine = contentLines[i].includes('<gossamer>') && contentLines[i].includes('</gossamer>');
      // Check if this is a Gossamer justification line (AI analysis feedback)
      const isGossamerJustificationLine = contentLines[i].includes('<gossamer-justification>') && contentLines[i].includes('</gossamer-justification>');
      // Check if this is a Gossamer pulse-format line (score + justification like pulse analysis)
      const isGossamerPulseLine = contentLines[i].includes('<gossamer-pulse>') && contentLines[i].includes('</gossamer-pulse>');
      // Check if this is a Gossamer pulse continuation line (wrapped text)
      const isGossamerPulseContLine = contentLines[i].includes('<gossamer-pulse-cont>') && contentLines[i].includes('</gossamer-pulse-cont>');
      // Check if this is a Gossamer spacer (gap before momentum line)
      const isGossamerSpacer = contentLines[i].includes('<gossamer-spacer>');

      const lineY = (i + extraLineCount) * lineHeight; // shift down by inserted lines
      const synopsisLineElement = doc.win.createSvg("text");

      if (isGossamerSpacer) {
        // Add a visual gap before Gossamer momentum line (like scenes have before pulse)
        // Create an invisible spacer element that adds vertical space
        synopsisLineElement.setAttribute("class", "rt-info-text rt-gossamer-spacer");
        synopsisLineElement.setAttribute("x", "0");
        synopsisLineElement.setAttribute("y", String(lineY));
        synopsisLineElement.setAttribute("font-size", "2px");
        synopsisLineElement.textContent = "\u00A0"; // Non-breaking space
        synopsisLineElement.classList.add('rt-invisible-spacer');
        // The lineY increment will create the gap for the next line
      } else if (isGossamerLine) {
        // Apply title styling for Gossamer lines
        synopsisLineElement.setAttribute("class", "rt-info-text rt-title-text-main ert-gossamer-score-line");
        synopsisLineElement.setAttribute("x", "0");
        synopsisLineElement.setAttribute("y", String(lineY));

        // Extract the content between the tags from the original line (before decoding)
        const gossamerContent = contentLines[i].replace(/<gossamer>/g, '').replace(/<\/gossamer>/g, '');

        // Create tspan for score (bold, colored)
        const gossamerTspan = doc.win.createSvg('tspan');
        gossamerTspan.classList.add('rt-scene-title-bold');
        gossamerTspan.setAttribute("data-item-type", "title");
        gossamerTspan.style.setProperty('--rt-dynamic-color', titleColor);
        gossamerTspan.textContent = gossamerContent;
        synopsisLineElement.appendChild(gossamerTspan);
      } else if (isGossamerJustificationLine) {
        // Style Gossamer justification like pulse analysis (gray, uppercase, same line height)
        synopsisLineElement.setAttribute("class", "rt-info-text pulse-text rt-gossamer-justification-line");
        synopsisLineElement.setAttribute("x", "0");
        synopsisLineElement.setAttribute("y", String(lineY));

        // Extract the content between the tags (already uppercased in builder)
        const justificationContent = contentLines[i].replace(/<gossamer-justification>/g, '').replace(/<\/gossamer-justification>/g, '');
        synopsisLineElement.textContent = justificationContent;
      } else if (isGossamerPulseLine) {
        // Format: "80/100 — JUSTIFICATION" with beat-stage grade styling
        synopsisLineElement.setAttribute("class", "rt-info-text gossamer-grade");
        synopsisLineElement.setAttribute("x", "0");
        synopsisLineElement.setAttribute("y", String(lineY));
        if (beatStageColor) {
          synopsisLineElement.style.setProperty('--rt-gossamer-stage-color', beatStageColor);
        }

        // Extract content between tags
        const pulseContent = contentLines[i]
          .replace(/<gossamer-pulse[^>]*>/g, '')
          .replace(/<\/gossamer-pulse>/g, '');

        // Check for " — " separator (em dash)
        const dashIndex = pulseContent.indexOf(' — ');
        if (dashIndex !== -1) {
          const scorePart = pulseContent.substring(0, dashIndex);
          const justificationPart = pulseContent.substring(dashIndex + 3);

          // Score tspan (grade styling, beat-stage color)
          const scoreTspan = doc.win.createSvg('tspan');
          scoreTspan.classList.add('gossamer-grade');
          scoreTspan.textContent = scorePart;
          synopsisLineElement.appendChild(scoreTspan);

          // Em dash + justification (same grade styling to keep line consistent)
          const justificationTspan = doc.win.createSvg('tspan');
          justificationTspan.classList.add('gossamer-grade');
          justificationTspan.textContent = ' — ' + justificationPart;
          synopsisLineElement.appendChild(justificationTspan);
        } else {
          // Just the score (no justification)
          const scoreTspan = doc.win.createSvg('tspan');
          scoreTspan.classList.add('gossamer-grade');
          scoreTspan.textContent = pulseContent;
          synopsisLineElement.appendChild(scoreTspan);
        }
      } else if (isGossamerPulseContLine) {
        // Continuation line for wrapped Gossamer justification (same grade styling)
        synopsisLineElement.setAttribute("class", "rt-info-text gossamer-grade");
        synopsisLineElement.setAttribute("x", "0");
        synopsisLineElement.setAttribute("y", String(lineY));
        if (beatStageColor) {
          synopsisLineElement.style.setProperty('--rt-gossamer-stage-color', beatStageColor);
        }

        // Extract content between tags
        const contContent = contentLines[i].replace(/<gossamer-pulse-cont>/g, '').replace(/<\/gossamer-pulse-cont>/g, '');
        synopsisLineElement.textContent = contContent;
      } else {
        // Regular synopsis line styling
        synopsisLineElement.setAttribute("class", "rt-info-text rt-title-text-secondary");
        synopsisLineElement.setAttribute("x", "0");
        synopsisLineElement.setAttribute("y", String(lineY));

        if (lineContent.includes('<tspan')) {
          this.processContentWithTspans(lineContent, synopsisLineElement);
        } else {
          synopsisLineElement.textContent = lineContent;
          synopsisLineElement.setAttribute('data-synopsis-line', 'true');
          synopsisLineElement.setAttribute('data-synopsis-raw', lineContent);
          if (scene.itemType === 'Backdrop' || isBeatNote(scene)) {
            synopsisLineElement.setAttribute('data-synopsis-budget-exempt', 'true');
          }
        }
      }

      synopsisTextGroup.appendChild(synopsisLineElement);
    }

    // Process metadata items with consistent vertical spacing.
    // Also render if there are enabled advanced YAML fields — resolved per item
    // type, the same way the block below renders them. Gating on the scene list
    // alone skipped the whole block for a beat or backdrop whose own fields were
    // enabled, so those fields never appeared.
    const hasEnabledHoverFields = resolveHoverMetadataFields(this.plugin.settings, scene).length > 0;
    if (metadataItems.length > 0 || hasEnabledHoverFields) {

      // Helper function to add a spacer element
      const addSpacer = (yPosition: number, height: number) => {
        const spacerElement = doc.win.createSvg("text");
        spacerElement.setAttribute("class", "synopsis-spacer");
        spacerElement.setAttribute("x", "0");
        spacerElement.setAttribute("y", String(yPosition));
        // We need a measurable font-size so layout math can read bbox height; keep it tiny and invisible.
        spacerElement.setAttribute("font-size", "2px");
        spacerElement.textContent = "\u00A0"; // Non-breaking space
        spacerElement.classList.add('rt-invisible-spacer'); // Make it invisible
        synopsisTextGroup.appendChild(spacerElement);
        // Return value now adds 0 height, placing next block immediately after previous
        // Need to return the original yPosition so next block starts correctly relative to the last *content* block
        return yPosition; // Return the STARTING yPosition of the spacer
      };

      // --- Add Spacer IMMEDIATELY after Synopsis Text ---
      const synopsisBottomY = synopsisEndIndex * lineHeight;
      // Call addSpacer with height 0, and store the returned start position
      let currentMetadataY = addSpacer(synopsisBottomY, 0);
      const showTripletNeighbors = this.plugin.settings.showFullTripletAnalysis ?? true;

      // Process previousSceneAnalysis metadata if it exists and AI scene analysis is enabled
      if (this.plugin.settings.enableAiSceneAnalysis && showTripletNeighbors && scene["previousSceneAnalysis"]) {
        const beatsY = currentMetadataY;
        const beatsText = scene["previousSceneAnalysis"] || '';
        const linesAdded = this.formatBeatsText(beatsText, 'previousSceneAnalysis', synopsisTextGroup, beatsY, pulseLineHeight, 0); // Pass 'previousSceneAnalysis'
        currentMetadataY = beatsY + (linesAdded * pulseLineHeight);
        if (linesAdded > 0) {
          // Call addSpacer with height 0, update starting point for next block
          currentMetadataY = addSpacer(currentMetadataY, 0);
        }
      }

      // Process currentSceneAnalysis metadata if it exists and AI scene analysis is enabled
      if (this.plugin.settings.enableAiSceneAnalysis && scene["currentSceneAnalysis"]) {
        const beatsY = currentMetadataY;
        const beatsText = scene["currentSceneAnalysis"] || '';
        const linesAdded = this.formatBeatsText(beatsText, 'currentSceneAnalysis', synopsisTextGroup, beatsY, pulseLineHeight, 0); // Pass 'currentSceneAnalysis'
        currentMetadataY = beatsY + (linesAdded * pulseLineHeight);
        if (linesAdded > 0) {
          // Call addSpacer with height 0, update starting point for next block
          currentMetadataY = addSpacer(currentMetadataY, 0);
        }
      }

      // Process nextSceneAnalysis metadata if it exists and AI scene analysis is enabled
      if (this.plugin.settings.enableAiSceneAnalysis && showTripletNeighbors && scene["nextSceneAnalysis"]) {
        const beatsY = currentMetadataY;
        const beatsText = scene["nextSceneAnalysis"] || '';
        const linesAdded = this.formatBeatsText(beatsText, 'nextSceneAnalysis', synopsisTextGroup, beatsY, pulseLineHeight, 0); // Pass 'nextSceneAnalysis'
        currentMetadataY = beatsY + (linesAdded * pulseLineHeight);
        if (linesAdded > 0) {
          // Call addSpacer with height 0, update starting point for next block
          currentMetadataY = addSpacer(currentMetadataY, 0);
        }
      }

      const pulseReviewWarningRaw = readFrontmatterFieldValue(
        scene.rawFrontmatter,
        'Pulse Review Warning'
      );
      const pulseReviewWarning = typeof pulseReviewWarningRaw === 'string'
        ? pulseReviewWarningRaw.trim()
        : '';
      if (this.plugin.settings.enableAiSceneAnalysis && pulseReviewWarning) {
        const y = currentMetadataY;
        const lineGroup = doc.win.createSvg("g");
        lineGroup.setAttribute("class", "rt-hover-metadata-line is-pulse-review-warning");
        lineGroup.setAttribute("data-hover-key", "Pulse Review Warning");

        const iconSize = 18 * fontScale;
        const iconGap = 6 * fontScale;
        const iconSvg = getIcon('alert-triangle');
        const hasIcon = !!iconSvg;
        const textX = hasIcon ? (iconSize + iconGap) : 0;

        if (iconSvg) {
          const iconG = doc.win.createSvg("g");
          iconG.setAttribute("class", "rt-hover-metadata-icon-g");
          iconG.setAttribute("stroke", "currentColor");
          iconG.setAttribute("stroke-linecap", "round");
          iconG.setAttribute("stroke-linejoin", "round");
          iconG.setAttribute("fill", "none");
          const scale = iconSize / 24;
          const iconY = y - (iconSize * 0.70);
          iconG.setAttribute("transform", `translate(0, ${iconY}) scale(${scale})`);
          const paths = iconSvg.querySelectorAll('path, circle, line, polyline, rect, polygon, ellipse');
          paths.forEach((node) => iconG.appendChild(node.cloneNode(true)));
          lineGroup.appendChild(iconG);
        }

        const textEl = doc.win.createSvg("text");
        textEl.setAttribute("class", "rt-hover-metadata-text");
        textEl.setAttribute("x", String(textX));
        textEl.setAttribute("y", String(y));
        textEl.textContent = pulseReviewWarning;
        lineGroup.appendChild(textEl);
        synopsisTextGroup.appendChild(lineGroup);
        currentMetadataY = addSpacer(currentMetadataY + metadataLineHeight, 0);
      }

      // --- Custom Hover Metadata Fields ---
      // Resolver and formatter are shared with SearchService so the searched
      // set stays equal to the rendered set (src/utils/hoverMetadata.ts).
      const enabledHoverFields = resolveHoverMetadataFields(this.plugin.settings, scene);
      if (enabledHoverFields.length > 0) {
        const hoverMetaStartY = currentMetadataY;
        let hoverMetaLinesAdded = 0;

        enabledHoverFields.forEach((field: HoverMetadataField) => {
          // Check if the scene has this key in its raw frontmatter
          const sceneValue = readFrontmatterFieldValue(scene.rawFrontmatter, field.key);

          // Skip if value is undefined, null, empty string, or empty array
          if (sceneValue === undefined || sceneValue === null) return;
          if (sceneValue === '') return;
          if (Array.isArray(sceneValue) && sceneValue.length === 0) return;

          const y = hoverMetaStartY + (hoverMetaLinesAdded * metadataLineHeight);

          const valueStr = formatHoverMetadataValue(sceneValue);
          if (!valueStr) return; // Skip if formatted value is empty

          // Create a group for this advanced YAML line
          const lineGroup = doc.win.createSvg("g");
          lineGroup.setAttribute("class", "rt-hover-metadata-line");
          lineGroup.setAttribute("data-hover-key", field.key);

          // Icon positioning
          const iconSize = 18 * fontScale;
          const iconGap = 6 * fontScale;
          const iconName = typeof field.icon === 'string' ? field.icon.trim() : '';
          const iconSvg = iconName ? getIcon(iconName) : null;
          const hasIcon = !!iconSvg;
          const textX = hasIcon ? (iconSize + iconGap) : 0; // No icon fallback = no offset

          // Get the Lucide icon SVG
          if (iconSvg) {
            // Native SVG approach: Extract paths and transform
            const iconG = doc.win.createSvg("g");
            iconG.setAttribute("class", "rt-hover-metadata-icon-g");
            iconG.setAttribute("stroke", "currentColor");
            iconG.setAttribute("stroke-linecap", "round");
            iconG.setAttribute("stroke-linejoin", "round");
            iconG.setAttribute("fill", "none");

            // Calculate scale: Lucide icons are 24x24
            const scale = iconSize / 24;

            // Position: y is baseline, so we move up by iconSize (roughly) to align bottom
            // Fine-tuned: y - iconSize * 0.70 aligns the visual bottom of the icon with the text baseline (moved down from 0.85)
            const iconY = y - (iconSize * 0.70);

            iconG.setAttribute("transform", `translate(0, ${iconY}) scale(${scale})`);

            // Copy all child nodes (paths, circles, etc.) from the Lucide SVG
            Array.from(iconSvg.childNodes).forEach(node => {
              // Skip non-element nodes if any
              if (node.nodeType === 1) { // Element node
                const clone = node.cloneNode(true) as SVGElement;
                iconG.appendChild(clone);
              }
            });

            lineGroup.appendChild(iconG);
          }

          // Create the text element (advanced YAML value)
          const textEl = createText(textX, y, 'rt-info-text rt-title-text-secondary rt-hover-metadata-text', valueStr);
          textEl.setAttribute('data-hover-raw', valueStr);
          textEl.setAttribute('data-advanced-line', 'true');
          textEl.setAttribute('data-advanced-raw', valueStr);
          const isTitleField = field.key.trim().toLowerCase() === 'title';
          if (isTitleField) {
            lineGroup.setAttribute('color', titleColor);
            textEl.style.fill = titleColor;
          }
          textEl.setAttribute('data-hover-icon-size', String(hasIcon ? iconSize : 0));
          textEl.setAttribute('data-hover-icon-gap', String(hasIcon ? iconGap : 0));
          lineGroup.appendChild(textEl);

          synopsisTextGroup.appendChild(lineGroup);
          hoverMetaLinesAdded++;
        });

        if (hoverMetaLinesAdded > 0) {
          currentMetadataY = hoverMetaStartY + (hoverMetaLinesAdded * metadataLineHeight);
          currentMetadataY = addSpacer(currentMetadataY, 0);
        }
      }

      // --- Subplot rendering starts here, using the final currentMetadataY ---
      // currentMetadataY now holds the Y position *before* the last added spacer (if any)
      // or after the last content block if no spacer was added.
      const subplotStartY = currentMetadataY;

      // Process subplots if first metadata item exists
      const decodedMetadataItems = metadataItems.map(item => decodeHtmlEntities(item));

      if (decodedMetadataItems.length > 0 && decodedMetadataItems[0] && decodedMetadataItems[0].trim().length > 0) {
        const subplots = decodedMetadataItems[0].split(', ').filter((s: string) => s.trim().length > 0);

        if (subplots.length > 0) {
          const subplotTextElement = doc.win.createSvg("text");
          subplotTextElement.setAttribute("class", "rt-info-text rt-metadata-text");
          subplotTextElement.setAttribute("x", "0");
          // Use the calculated subplotStartY
          subplotTextElement.setAttribute("y", String(subplotStartY));
          subplotTextElement.setAttribute('data-list-wrap-kind', 'subplot');
          subplotTextElement.setAttribute('data-list-wrap-items', JSON.stringify(
            subplots.map((subplot: string) => ({
              text: subplot.trim(),
              color: getSubplotColor(subplot.trim(), sceneId)
            }))
          ));

          // Format each subplot with its own color
          subplots.forEach((subplot: string, j: number) => {
            const color = getSubplotColor(subplot.trim(), sceneId);
            const subplotText = subplot.trim();
            const tspan = doc.win.createSvg("tspan");
            tspan.setAttribute("data-item-type", "subplot");
            tspan.style.setProperty('--rt-dynamic-color', color);
            tspan.textContent = subplotText;
            subplotTextElement.appendChild(tspan);
            if (j < subplots.length - 1) {
              const comma = doc.win.createSvg("tspan");
              comma.setAttribute("fill", "var(--text-muted)");
              comma.textContent = ", ";
              subplotTextElement.appendChild(comma);
            }
          });

          synopsisTextGroup.appendChild(subplotTextElement);
        }
      }

      // Process character - second metadata item
      if (decodedMetadataItems.length > 1 && decodedMetadataItems[1] && decodedMetadataItems[1].trim().length > 0) {
        // Calculate character Y based on subplot position plus standard line height
        const characterY = subplotStartY + lineHeight;
        const characterList = decodedMetadataItems[1].split(', ').filter((c: string) => c.trim().length > 0);

        if (characterList.length > 0) {
          const CHARACTER_COLOR_DEFAULT = '#666666';
          const CHARACTER_COLOR_POV = '#000000';
          const characterTextElement = doc.win.createSvg("text");
          characterTextElement.setAttribute("class", "rt-info-text rt-metadata-text");
          characterTextElement.setAttribute("x", "0");
          characterTextElement.setAttribute("y", String(characterY));
          characterTextElement.setAttribute('data-list-wrap-kind', 'character');
          characterTextElement.setAttribute('data-list-wrap-items', JSON.stringify(
            characterList.map((character: string) => {
              const trimmedChar = character.trim();
              const markerMatch = trimmedChar.match(/>pov(?:=([^<]+))<$/i);
              const povLabel = markerMatch ? (markerMatch[1]?.trim() || 'POV') : undefined;
              const cleanedText = markerMatch
                ? trimmedChar.replace(/\s*>pov(?:=[^<]+)?<\s*/i, '').trim()
                : trimmedChar;
              const color = povLabel ? CHARACTER_COLOR_POV : CHARACTER_COLOR_DEFAULT;
              return {
                text: cleanedText,
                color,
                povLabel
              };
            }).filter(item => item.text.length > 0)
          ));

          // Format each character with its own color
          characterList.forEach((character: string, j: number) => {
            const trimmedChar = character.trim();
            let baselineRaised = false;

            const markerMatch = trimmedChar.match(/>pov(?:=([^<]+))<$/i);
            const povLabel = markerMatch ? (markerMatch[1]?.trim() || 'POV') : undefined;
            const cleanedText = markerMatch
              ? trimmedChar.replace(/\s*>pov(?:=[^<]+)?<\s*/i, '').trim()
              : trimmedChar;
            const color = povLabel ? CHARACTER_COLOR_POV : CHARACTER_COLOR_DEFAULT;

            if (cleanedText) {
              const tspan = doc.win.createSvg("tspan");
              tspan.setAttribute("data-item-type", "character");
              tspan.style.setProperty('--rt-dynamic-color', color);
              if (povLabel) {
                tspan.classList.add('rt-pov-character');
              }
              tspan.textContent = cleanedText;
              characterTextElement.appendChild(tspan);
            }

            if (povLabel) {
              const povTspan = doc.win.createSvg("tspan");
              povTspan.setAttribute("class", "rt-pov-marker");
              povTspan.setAttribute("dy", "-8px");
              povTspan.style.setProperty('--rt-dynamic-color', color);
              povTspan.textContent = povLabel;
              characterTextElement.appendChild(povTspan);
              baselineRaised = true;
            }

            // Add comma after this character (if not the last one)
            if (j < characterList.length - 1) {
              const comma = doc.win.createSvg("tspan");
              comma.setAttribute("fill", "var(--text-muted)");
              if (baselineRaised) {
                comma.setAttribute("dy", "8px");
              }
              comma.textContent = ", ";
              characterTextElement.appendChild(comma);
            } else if (baselineRaised) {
              const resetTspan = doc.win.createSvg("tspan");
              resetTspan.setAttribute("dy", "8px");
              resetTspan.textContent = "";
              characterTextElement.appendChild(resetTspan);
            }
          });

          synopsisTextGroup.appendChild(characterTextElement);
        }
      }
    }

    return containerGroup;
  }

  /**
   * Generate SVG string from DOM element (temporary compatibility method)
   */
  generateHTML(scene: TimelineItem, contentLines: string[], sceneId: string): string {
    const element = this.generateElement(scene, contentLines, sceneId);
    const serializer = new XMLSerializer();
    return serializer.serializeToString(element);
  }

  /**
   * Update the position of a synopsis based on mouse position
   */
  updatePosition(synopsis: Element, event: MouseEvent, svg: SVGSVGElement, sceneId: string): void {
    if (!synopsis.instanceOf(SVGElement)) {
      throw new Error('Synopsis element must be an SVGElement.');
    }
    if (!svg) {
      throw new Error('SVG root is required to position synopsis content.');
    }

    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      throw new Error('Unable to compute screen CTM for timeline SVG.');
    }

    const svgP = pt.matrixTransform(ctm.inverse());
    const quadrant = this.getQuadrant(svgP.x, svgP.y);

    const currentMode = this.plugin.settings.currentMode || 'narrative';
    const isChronologueMode = currentMode === 'chronologue';
    const isProgressMode = currentMode === 'progress';
    const readabilityScale = getReadabilityScale(this.plugin.settings);

    const subplotOuterRadius = isChronologueMode
      ? SUBPLOT_OUTER_RADIUS_CHRONOLOGUE
      : isProgressMode
        ? SUBPLOT_OUTER_RADIUS_MAINPLOT
        : SUBPLOT_OUTER_RADIUS_STANDARD[readabilityScale];

    const adjustedRadius = subplotOuterRadius - SYNOPSIS_INSET;

    synopsis.removeAttribute('style');
    synopsis.classList.remove('rt-synopsis-q1', 'rt-synopsis-q2', 'rt-synopsis-q3', 'rt-synopsis-q4');

    const position = this.getPositionForQuadrant(quadrant, adjustedRadius);
    synopsis.classList.add(`rt-synopsis-${position.quadrantClass}`);

    const y = position.y;
    if (Math.abs(y) >= adjustedRadius) {
      throw new Error(`Synopsis y-position ${y} exceeds radius ${adjustedRadius}`);
    }

    const diff = adjustedRadius * adjustedRadius - y * y;
    if (diff < 0) {
      throw new Error('Cannot compute synopsis x-position due to invalid radius difference.');
    }
    const baseX = Math.sqrt(diff);
    const x = position.isRightAligned ? baseX : -baseX;

    synopsis.setAttribute('transform', `translate(${x}, ${y})`);
    synopsis.classList.add('rt-visible');
    synopsis.setAttribute('opacity', '1');
    synopsis.setAttribute('pointer-events', 'all');

    const lineInnerRadius = this.getLineInnerRadius(svg);
    this.positionTextElements(synopsis, position.isRightAligned, position.isTopHalf, adjustedRadius, sceneId, lineInnerRadius);

    const search = this.plugin.searchState;
    if (shouldHighlightMetadataTerm(search)) {
      clearSearchHighlightsInRoot(synopsis);
      applySearchTermHighlightsInRoot(synopsis, search.term);
    }
  }

  /**
   * Determine which quadrant a point is in
   * SVG coordinate system: (0,0) is at center
   * Q1: Bottom-Right (+x, +y)
   * Q2: Bottom-Left (-x, +y)
   * Q3: Top-Left (-x, -y)
   * Q4: Top-Right (+x, -y)
   */
  private getQuadrant(x: number, y: number): string {

    // Define quadrants based on SVG coordinates
    if (x >= 0 && y >= 0) return "Q1";      // Bottom Right (+x, +y)
    else if (x < 0 && y >= 0) return "Q2";  // Bottom Left (-x, +y)
    else if (x < 0 && y < 0) return "Q3";   // Top Left (-x, -y)
    else return "Q4";                       // Top Right (+x, -y)
  }

  /**
   * Get position configuration for a specific quadrant
   */
  private getPositionForQuadrant(quadrant: string, outerRadius: number): {
    x: number,
    y: number,
    quadrantClass: string,
    isRightAligned: boolean,
    isTopHalf: boolean
  } {
    // Place synopsis in opposite quadrant from mouse position (same half)
    let result = {
      x: 0,
      y: 0,
      quadrantClass: "",
      isRightAligned: false,
      isTopHalf: false
    };

    // Fixed vertical positions
    const topHalfOffset = -550; // Fixed vertical position from center for top half
    const bottomHalfOffset = 120; // Updated value for bottom half (Q1, Q2)


    switch (quadrant) {
      case "Q1": // Mouse in Bottom Right -> Synopsis in Q2 (Bottom Left)
        result.x = 0;
        result.y = bottomHalfOffset; // Bottom half with updated value
        result.quadrantClass = "q2";
        result.isRightAligned = false; // Left aligned
        result.isTopHalf = false;
        break;

      case "Q2": // Mouse in Bottom Left -> Synopsis in Q1 (Bottom Right)
        result.x = 0;
        result.y = bottomHalfOffset; // Bottom half with updated value
        result.quadrantClass = "q1";
        result.isRightAligned = true; // Right aligned
        result.isTopHalf = false;
        break;

      case "Q3": // Mouse in Top Left -> Synopsis in Q4 (Top Right)
        result.x = 0;
        result.y = topHalfOffset; // Top half (unchanged)
        result.quadrantClass = "q4";
        result.isRightAligned = true; // Right aligned
        result.isTopHalf = true;
        break;

      case "Q4": // Mouse in Top Right -> Synopsis in Q3 (Top Left)
        result.x = 0;
        result.y = topHalfOffset; // Top half (unchanged)
        result.quadrantClass = "q3";
        result.isRightAligned = false; // Left aligned
        result.isTopHalf = true;
        break;
    }


    return result;
  }

  /**
   * Position text elements along an arc
   * 
   * TEXT POSITIONING ON THE RADIAL ARC:
   * Each row's X position is calculated using Pythagorean theorem to place it
   * exactly on the circle at that Y coordinate: circleX = sqrt(r² - y²)
   * 
   * This works identically for both top and bottom halves of the timeline.
   * The text-anchor property (start/end) determines which edge of the text
   * aligns with the calculated arc position.
   * 
   * MINIMAL INSET FOR TEXT OVERHANG:
   * SVG text extends above its baseline (ascenders, cap height). We measure
   * the actual rendered text height via getBBox() and use a fraction of it
   * as the inset. This automatically scales with:
   * - Font size (title vs body vs beats)
   * - Readability scale (normal vs large)
   * - Font metrics (different fonts/localizations)
   */
  private static readonly TEXT_HEIGHT_INSET_RATIO = 0.35;

  private positionTextElements(
    synopsis: Element,
    isRightAligned: boolean,
    isTopHalf: boolean,
    radius: number,
    sceneId: string,
    lineInnerRadius: number
  ): void {
    const wrapMode = isRightAligned ? 'right' : 'left';
    const prevWrapMode = (synopsis as SVGElement).getAttribute('data-hover-synopsis-wrap') || '';
    const shouldRewrap = prevWrapMode !== wrapMode;

    if (shouldRewrap) {
      this.resetWrappedListLines(synopsis);
      this.resetAdvancedYamlWrap(synopsis);
      this.resetPendingEditsWrap(synopsis);
      this.resetMainSynopsisWrap(synopsis);
    }

    const buildTextRows = (elements: SVGTextElement[]): SVGTextElement[][] => {
      const rows: SVGTextElement[][] = [];
      elements.forEach((textEl) => {
        if (textEl.getAttribute('data-metadata-block') === 'true' && rows.length > 0) {
          rows[rows.length - 1].push(textEl);
        } else {
          rows.push([textEl]);
        }
      });
      return rows;
    };

    const applyTextAnchors = (elements: SVGTextElement[]): void => {
      const textAnchor = isRightAligned ? 'end' : 'start';
      elements.forEach(textEl => {
        if (textEl.getAttribute('data-metadata-block') === 'true') {
          textEl.setAttribute('text-anchor', 'start');
        } else {
          textEl.setAttribute('text-anchor', textAnchor);
        }
      });
    };

    let textElements = Array.from(synopsis.querySelectorAll('text'));
    if (textElements.length === 0) return;

    applyTextAnchors(textElements);

    // Get the synopsis text group
    const synopsisTextGroup = synopsis.querySelector('.rt-synopsis-text');
    if (!synopsisTextGroup) {
      return;
    }

    // Reset any previous transforms
    (synopsisTextGroup as SVGElement).removeAttribute('transform');

    const fontScale = this.getReadabilityScale();
    // Circle parameters scale with readability to avoid overlaps
    const titleLineHeight = 32 * fontScale; // Increased spacing for title/date line
    const synopsisLineHeight = 22 * fontScale; // Reduced spacing for synopsis text
    const scorePreGap = 46 * fontScale; // Manual gap before the Gossamer score line; adjust as needed
    const metadataSpacing = 14 * fontScale; // Default horizontal gap between title and metadata block

    // Get pulse line height from CSS for beats text
    const styleSource = getComputedStyle(synopsis.ownerDocument.documentElement);
    const pulseLineHeightRaw = parseFloat(styleSource.getPropertyValue('--rt-pulse-line-height'));
    const pulseLineHeight = pulseLineHeightRaw * fontScale;

    // Calculate starting y-position from synopsis position
    const synopsisTransform = (synopsis as SVGElement).getAttribute('transform') || '';
    const translateMatch = synopsisTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);

    if (!translateMatch || translateMatch.length < 3) {
      return;
    }

    const baseX = parseFloat(translateMatch[1]);
    const baseY = parseFloat(translateMatch[2]);

    let textRows = buildTextRows(textElements);

    if (shouldRewrap) {
      const mainWrapped = this.applyMainSynopsisWrap({
        textRows,
        baseY,
        radius,
        isRightAligned,
        isTopHalf,
        fontScale,
        pulseLineHeight,
        lineInnerRadius
      });
      if (mainWrapped) {
        textElements = Array.from(synopsis.querySelectorAll('text'));
        if (textElements.length === 0) return;
        applyTextAnchors(textElements);
        textRows = buildTextRows(textElements);
      }

      const pendingWrapped = this.applyPendingEditsWrap({
        textRows,
        baseY,
        radius,
        isRightAligned,
        isTopHalf,
        fontScale,
        pulseLineHeight,
        lineInnerRadius
      });
      if (pendingWrapped) {
        textElements = Array.from(synopsis.querySelectorAll('text'));
        if (textElements.length === 0) return;
        applyTextAnchors(textElements);
        textRows = buildTextRows(textElements);
      }

      // Pulse triplet rows intentionally skip inner-radius wrapping.
      // It was tried and produced visibly worse hover output than letting the
      // pulse lines run long, so only synopsis/pending/advanced metadata use
      // the donut-hole width constraint.
      const advancedWrapped = this.applyAdvancedYamlWrap({
        textRows,
        baseY,
        radius,
        isRightAligned,
        isTopHalf,
        fontScale,
        pulseLineHeight,
        lineInnerRadius
      });
      if (advancedWrapped) {
        textElements = Array.from(synopsis.querySelectorAll('text'));
        if (textElements.length === 0) return;
        applyTextAnchors(textElements);
        textRows = buildTextRows(textElements);
      }

      const listWrapped = this.applyWrappedListLineWrap({
        textRows,
        baseY,
        radius,
        isRightAligned,
        isTopHalf,
        fontScale,
        pulseLineHeight,
        lineInnerRadius
      });
      if (listWrapped) {
        textElements = Array.from(synopsis.querySelectorAll('text'));
        if (textElements.length === 0) return;
        applyTextAnchors(textElements);
        textRows = buildTextRows(textElements);
      }
    }

    if (shouldRewrap) {
      (synopsis as SVGElement).setAttribute('data-hover-synopsis-wrap', wrapMode);
    }

    const budgetChanged = this.enforceLineBudget({
      synopsis,
      radius,
      baseY,
      fontScale,
      pulseLineHeight
    });

    if (budgetChanged) {
      textElements = Array.from(synopsis.querySelectorAll('text'));
      if (textElements.length === 0) return;
      applyTextAnchors(textElements);
      textRows = buildTextRows(textElements);
    }

    // Position each row using Pythagorean theorem relative to circle center
    let yOffset = 0;

    textRows.forEach((rowElements, rowIndex) => {
      const primaryEl = rowElements[0] ?? null;

      // Calculate absolute position for this row with variable line heights
      if (rowIndex > 0) {
        const currentEl = rowElements[0];
        const isGossamerLine = currentEl.classList.contains('ert-gossamer-score-line');
        const isBeatsText = currentEl.classList.contains('pulse-text');
        const prevEl = textRows[rowIndex - 1][0];
        const isPrevLineSynopsis = prevEl.classList.contains('rt-title-text-secondary');
        const isPrevLineBeats = prevEl.classList.contains('pulse-text');

        if (rowIndex === 1) {
          // Always use title spacing right after the title line
          yOffset += titleLineHeight;
        } else if (isGossamerLine && isPrevLineSynopsis) {
          // Fixed manual gap before the Gossamer score line
          yOffset += scorePreGap;
        } else if (isBeatsText || isPrevLineBeats) {
          // Use pulse line height for beats/analysis text
          yOffset += pulseLineHeight;
        } else {
          // Default spacing between regular synopsis/metadata lines
          yOffset += synopsisLineHeight;
        }
      }

      let anchorY = baseY + yOffset;

      if (Math.abs(anchorY) >= radius) {
        // Clamp rows that extend beyond the circle; they'll hug the perimeter instead of crashing
        anchorY = Math.sign(anchorY) * (radius - 1);
      }

      const radiusDiff = radius * radius - anchorY * anchorY;
      if (radiusDiff < 0) {
        throw new Error(`Cannot resolve anchor for row ${rowIndex}; negative radius difference computed.`);
      }

      const circleX = Math.sqrt(radiusDiff);
      const direction = isRightAligned ? 1 : -1;

      // Top half only: inset based on font size to compensate for text above baseline
      // Bottom half needs no adjustment - the baseline alignment works correctly there
      // Title and first synopsis line need more inset; later rows need less
      let inset = 0;
      if (isTopHalf && primaryEl) {
        const style = window.getComputedStyle(primaryEl);
        const fontSize = parseFloat(style.fontSize) || 16;
        // Rows 0-1 (title, first synopsis) need more inset; others use base ratio
        const ratio = rowIndex <= 1 ? 0.5 : SynopsisManager.TEXT_HEIGHT_INSET_RATIO;
        inset = fontSize * ratio;
      }
      const rightQuadrantInset = isRightAligned ? 20 : 0;
      // Only apply extra inset on right side when the row carries a hover icon
      const hasHoverIcon = this.getHoverIconTotalOffset(primaryEl) > 0;
      const extraRightInset = isRightAligned && hasHoverIcon ? rightQuadrantInset : 0;
      const anchorAbsoluteX = (circleX - inset - extraRightInset) * direction;

      const anchorX = anchorAbsoluteX - baseX;

      const { primaryWidth, metadataWidth, gap } = this.measureRowLayout(rowElements, metadataSpacing, isRightAligned);
      // Only nudge rows with hover icons; other rows stay flush against the outer radius
      const textNudge = isRightAligned && hasHoverIcon ? -8 : 0;
      const roundedAnchorX = Math.round(anchorX + textNudge);
      const rowY = rowIndex === 0 ? 0 : yOffset;

      this.positionRowColumns(
        rowElements,
        roundedAnchorX,
        rowY,
        primaryWidth,
        metadataWidth,
        gap,
        isRightAligned
      );

    });

    // After positioning text, reposition advanced YAML icons to match the row start
    this.updateHoverMetadataIcons(synopsis);
  }

  private measureRowLayout(rowElements: SVGTextElement[], defaultGap: number, isRightAligned: boolean): { primaryWidth: number; metadataWidth: number; gap: number } {
    if (rowElements.length === 0) {
      return { primaryWidth: 0, metadataWidth: 0, gap: defaultGap };
    }

    const iconOffset = isRightAligned ? 0 : this.getHoverIconTotalOffset(rowElements[0]);
    const primaryWidth = this.measureTextWidth(rowElements[0]) + iconOffset;
    let metadataWidth = 0;
    let gap = defaultGap;

    if (rowElements.length > 1) {
      const metadataEl = rowElements[1];
      metadataWidth = this.measureTextWidth(metadataEl);
      const gapAttr = metadataEl.getAttribute('data-column-gap');
      if (gapAttr) {
        const parsedGap = parseFloat(gapAttr);
        if (!Number.isNaN(parsedGap)) {
          gap = parsedGap;
        }
      }
    }

    return { primaryWidth, metadataWidth, gap };
  }

  private positionRowColumns(
    rowElements: SVGTextElement[],
    anchorX: number,
    yPosition: number,
    primaryWidth: number,
    metadataWidth: number,
    gap: number,
    isRightAligned: boolean
  ): void {
    if (rowElements.length === 0) {
      return;
    }

    const fontScale = this.getReadabilityScale();
    const hasMetadata = rowElements.length > 1;

    if (isRightAligned) {
      const metadataRightEdge = anchorX - SYNOPSIS_INSET;
      const metadataLeftEdge = hasMetadata ? metadataRightEdge - metadataWidth : metadataRightEdge;
      const titleRightEdge = hasMetadata ? metadataLeftEdge - gap : metadataRightEdge;

      rowElements.forEach((textEl, index) => {
        const iconOffset = 0; // Icons render after text on right-aligned rows
        const targetX = index === 0 ? titleRightEdge - iconOffset : metadataLeftEdge;
        textEl.setAttribute('x', String(targetX));
        textEl.setAttribute('y', String(yPosition));

        // Update planetary outline rect if present
        const prev = textEl.previousElementSibling;
        if (prev && prev.tagName === 'rect' && prev.classList.contains('rt-planetary-outline')) {
          let currentWidth = parseFloat(prev.getAttribute('width') || '0');
          try {
            const len = textEl.getComputedTextLength();
            if (len > 0) {
              currentWidth = len + 12; // text len + indent(6) + pad(6)
              prev.setAttribute('width', String(currentWidth));
            }
          } catch { /* ignore */ }

          prev.setAttribute('x', String(targetX - currentWidth));
          prev.setAttribute('y', String(yPosition - SynopsisManager.PLANETARY_RECT_Y_OFFSET * fontScale));
          textEl.setAttribute('dx', '-6');
        }

        if (index !== 0) {
          textEl.setAttribute('text-anchor', 'start');
          this.alignMetadataTspans(textEl, metadataLeftEdge);
        }
      });
    } else {
      const rowLeftEdge = anchorX + SYNOPSIS_INSET;
      const metadataLeftEdge = hasMetadata ? rowLeftEdge + primaryWidth + gap : rowLeftEdge;

      rowElements.forEach((textEl, index) => {
        const iconOffset = index === 0 ? this.getHoverIconTotalOffset(textEl) : 0;
        const x = index === 0 ? rowLeftEdge + iconOffset : metadataLeftEdge;
        textEl.setAttribute('x', String(x));
        textEl.setAttribute('y', String(yPosition));

        // Update planetary outline rect if present
        const prev = textEl.previousElementSibling;
        if (prev && prev.tagName === 'rect' && prev.classList.contains('rt-planetary-outline')) {
          try {
            const len = textEl.getComputedTextLength();
            if (len > 0) {
              prev.setAttribute('width', String(len + 12));
            }
          } catch { /* ignore */ }

          prev.setAttribute('x', String(x));
          prev.setAttribute('y', String(yPosition - SynopsisManager.PLANETARY_RECT_Y_OFFSET * fontScale));
          textEl.setAttribute('dx', '6');
        }

        if (index !== 0) {
          this.alignMetadataTspans(textEl, metadataLeftEdge);
        }
      });
    }
  }

  private getHoverIconOffsets(textEl: SVGTextElement | null): { iconSize: number; iconGap: number; total: number } {
    if (!textEl) return { iconSize: 0, iconGap: 0, total: 0 };
    const iconSize = parseFloat(textEl.getAttribute('data-hover-icon-size') || '0') || 0;
    const iconGap = parseFloat(textEl.getAttribute('data-hover-icon-gap') || '0') || 0;
    return { iconSize, iconGap, total: iconSize + iconGap };
  }

  private getHoverIconTotalOffset(textEl: SVGTextElement | null): number {
    return this.getHoverIconOffsets(textEl).total;
  }

  private updateHoverMetadataIcons(synopsis: Element): void {
    const lines = Array.from(synopsis.querySelectorAll('.rt-hover-metadata-line'));
    if (lines.length === 0) return;

    lines.forEach(line => {
      const textEl = line.querySelector<SVGTextElement>('.rt-hover-metadata-text');
      const iconG = line.querySelector<SVGGElement>('.rt-hover-metadata-icon-g');
      if (!textEl || !iconG) return;

      const { iconSize, iconGap, total } = this.getHoverIconOffsets(textEl);
      if (total <= 0) return;

      const textX = parseFloat(textEl.getAttribute('x') || '0');
      const textY = parseFloat(textEl.getAttribute('y') || '0');
      const anchor = textEl.getAttribute('text-anchor') || 'start';
      const textWidth = this.measureTextWidth(textEl);

      const isRightAligned = anchor === 'end';
      const textStartX = anchor === 'end' ? textX - textWidth : textX;
      // Nudge icons closer to their text and slightly upward for clearer rendering
      const baseHorizontalNudge = 4; // px
      const verticalNudge = 2; // px
      const iconX = Math.round(
        isRightAligned
          ? textX + iconGap - (baseHorizontalNudge + 0) + 2 // push outward (right) by 2px
          : textStartX - iconGap - iconSize + 2            // push outward (right) by 2px
      );
      const iconY = Math.round(textY - (iconSize * 0.85) - verticalNudge);
      const scale = iconSize / 24;

      iconG.setAttribute('transform', `translate(${iconX}, ${iconY}) scale(${scale})`);
      iconG.setAttribute('stroke-width', '2');
      iconG.setAttribute('stroke-linecap', 'round');
      iconG.setAttribute('stroke-linejoin', 'round');
      iconG.style.removeProperty('stroke');
      iconG.style.removeProperty('fill');
    });
  }

  private alignMetadataTspans(metadataText: SVGTextElement, columnX: number): void {
    const tspans = Array.from(metadataText.querySelectorAll('tspan'));
    tspans.forEach(tspan => {
      const role = tspan.getAttribute('data-column-role');
      if (role === 'date' || role === 'duration') {
        tspan.setAttribute('x', String(columnX));
      }
    });
  }

  private enforceLineBudget(params: {
    synopsis: Element;
    radius: number;
    baseY: number;
    fontScale: number;
    pulseLineHeight: number;
  }): boolean {
    const { synopsis, radius, baseY, fontScale, pulseLineHeight } = params;
    const titleLineHeight = 32 * fontScale;
    const synopsisLineHeight = 22 * fontScale;
    const scorePreGap = 46 * fontScale;

    const buildRows = (): SVGTextElement[][] => {
      const elements = Array.from(synopsis.querySelectorAll('text'));
      const rows: SVGTextElement[][] = [];
      elements.forEach((textEl) => {
        if (textEl.getAttribute('data-metadata-block') === 'true' && rows.length > 0) {
          rows[rows.length - 1].push(textEl);
        } else {
          rows.push([textEl]);
        }
      });
      return rows;
    };

    const getCategory = (textEl: SVGTextElement): { category: 'synopsis' | 'pending' | 'advanced' | 'other'; key?: string } => {
      if (
        (textEl.getAttribute('data-synopsis-line') === 'true' || textEl.getAttribute('data-synopsis-wrap') === 'true')
        && textEl.getAttribute('data-synopsis-budget-exempt') !== 'true'
      ) {
        return { category: 'synopsis' };
      }
      if (textEl.getAttribute('data-pending-line') === 'true' || textEl.getAttribute('data-pending-wrap') === 'true') {
        return { category: 'pending' };
      }
      if (textEl.getAttribute('data-advanced-line') === 'true' || textEl.getAttribute('data-advanced-wrap') === 'true') {
        const group = textEl.closest('.rt-hover-metadata-line');
        const key = group?.getAttribute('data-hover-key') || '';
        return { category: 'advanced', key };
      }
      return { category: 'other' };
    };

    const hasOverflow = (rows: SVGTextElement[][]): boolean => {
      let yOffset = 0;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const rowElements = rows[rowIndex];
        if (rowIndex > 0) {
          const currentEl = rowElements[0];
          const isGossamerLine = currentEl.classList.contains('ert-gossamer-score-line');
          const isBeatsText = currentEl.classList.contains('pulse-text');
          const prevEl = rows[rowIndex - 1][0];
          const isPrevLineSynopsis = prevEl.classList.contains('rt-title-text-secondary');
          const isPrevLineBeats = prevEl.classList.contains('pulse-text');

          if (rowIndex === 1) {
            yOffset += titleLineHeight;
          } else if (isGossamerLine && isPrevLineSynopsis) {
            yOffset += scorePreGap;
          } else if (isBeatsText || isPrevLineBeats) {
            yOffset += pulseLineHeight;
          } else {
            yOffset += synopsisLineHeight;
          }
        }

        const anchorY = baseY + yOffset;
        if (Math.abs(anchorY) >= radius) {
          return true;
        }
      }
      return false;
    };

    const removeOne = (): { category: 'synopsis' | 'pending' | 'advanced'; key?: string } | null => {
      const rows = buildRows();
      if (rows.length === 0) return null;

      const synopsisMin = Math.max(3, getSynopsisHoverLineLimit(this.plugin.settings));
      const pendingMin = 3;

      let synopsisCount = 0;
      let pendingCount = 0;
      const advancedCounts = new Map<string, number>();

      rows.forEach(row => {
        const primary = row[0];
        if (!primary) return;
        const info = getCategory(primary);
        if (info.category === 'synopsis') synopsisCount += 1;
        if (info.category === 'pending') pendingCount += 1;
        if (info.category === 'advanced') {
          const key = info.key || '';
          advancedCounts.set(key, (advancedCounts.get(key) || 0) + 1);
        }
      });

      for (let i = rows.length - 1; i >= 0; i--) {
        const primary = rows[i][0];
        if (!primary) continue;
        const info = getCategory(primary);

        if (info.category === 'advanced') {
          const key = info.key || '';
          const count = advancedCounts.get(key) || 0;
          if (count > 1) {
            primary.remove();
            return { category: 'advanced', key };
          }
        }
      }

      for (let i = rows.length - 1; i >= 0; i--) {
        const primary = rows[i][0];
        if (!primary) continue;
        const info = getCategory(primary);
        if (info.category === 'pending' && pendingCount > pendingMin) {
          primary.remove();
          return { category: 'pending' };
        }
      }

      for (let i = rows.length - 1; i >= 0; i--) {
        const primary = rows[i][0];
        if (!primary) continue;
        const info = getCategory(primary);
        if (info.category === 'synopsis' && synopsisCount > synopsisMin) {
          primary.remove();
          return { category: 'synopsis' };
        }
      }

      return null;
    };

    let changed = false;
    let truncatedSynopsis = false;
    let truncatedPending = false;
    const truncatedAdvanced = new Set<string>();
    let guard = 0;
    while (guard < 200) {
      guard += 1;
      const rows = buildRows();
      if (!hasOverflow(rows)) break;
      const removed = removeOne();
      if (!removed) break;
      if (removed.category === 'synopsis') truncatedSynopsis = true;
      if (removed.category === 'pending') truncatedPending = true;
      if (removed.category === 'advanced') truncatedAdvanced.add(removed.key || '');
      changed = true;
    }

    if (changed) {
      const appendEllipsis = (el: SVGTextElement | null): void => {
        if (!el) return;
        const text = el.textContent ?? '';
        if (!text.endsWith('...')) {
          el.textContent = `${text}...`;
        }
      };

      if (truncatedSynopsis) {
        const lines = Array.from(synopsis.querySelectorAll<SVGTextElement>('[data-synopsis-line="true"]'));
        appendEllipsis(lines[lines.length - 1] ?? null);
      }

      if (truncatedPending) {
        const lines = Array.from(synopsis.querySelectorAll<SVGTextElement>('[data-pending-line="true"]'));
        appendEllipsis(lines[lines.length - 1] ?? null);
      }

      if (truncatedAdvanced.size > 0) {
        const groups = Array.from(synopsis.querySelectorAll('.rt-hover-metadata-line'));
        truncatedAdvanced.forEach(key => {
          const group = groups.find(g => (g.getAttribute('data-hover-key') || '') === key);
          if (!group) return;
          const lines = Array.from(group.querySelectorAll<SVGTextElement>('[data-advanced-line="true"]'));
          appendEllipsis(lines[lines.length - 1] ?? null);
        });
      }
    }

    return changed;
  }

  private measureTextWidth(element: SVGTextElement): number {
    const box = element.getBBox();
    if (box && Number.isFinite(box.width)) {
      return Math.max(0, box.width);
    }

    const length = element.getComputedTextLength();
    if (Number.isFinite(length)) {
      return Math.max(0, length);
    }

    throw new Error('Unable to measure text width for synopsis element.');
  }

  /**
   * Process content with tspan elements and add to an SVG element
   * @param content The HTML content to process
   * @param parentElement The SVG element to append processed nodes to
   */
  private processContentWithTspans(content: string, parentElement: SVGElement): void {
    appendSynopsisInline(content, parentElement);
  }

  /**
   * Formats and adds beat text lines to an SVG group.
   * @param beatsText The multi-line string containing beats for one section.
   * @param beatKey The key identifying the section ('previousSceneAnalysis', 'currentSceneAnalysis', 'nextSceneAnalysis').
   * @param parentGroup The SVG group element to append the text elements to.
   * @param baseY The starting Y coordinate for the first line.
   * @param lineHeight The vertical distance between lines.
   * @param spacerSize Size of the spacer to add after this beats section.
   */
  private formatBeatsText(beatsText: string, beatKey: 'previousSceneAnalysis' | 'currentSceneAnalysis' | 'nextSceneAnalysis', parentGroup: SVGElement, baseY: number, lineHeight: number, spacerSize: number = 0): number {
    const doc = parentGroup.ownerDocument;
    // START: Restore line splitting logic
    if (!beatsText || typeof beatsText !== 'string' || beatsText === 'undefined' || beatsText === 'null') {
      return 0;
    }
    beatsText = beatsText.replace(/undefined|null/gi, '').trim();
    if (!beatsText) {
      return 0;
    }

    let lines: string[] = [];

    // Performance optimization: Check if already contains newlines (most common case for YAML)
    const hasNewlines = beatsText.includes('\n');

    if (hasNewlines) {
      // Fast path: already formatted with newlines, just split
      lines = beatsText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    } else {
      const trimmedText = beatsText.trim();
      if (trimmedText.startsWith('-')) {
        if (trimmedText.length > 1) { lines = [trimmedText]; }
      } else {
        // Split on commas that appear between beats (not within descriptions)
        // Pattern: split on ", " followed by text containing "+ /" or "- /" or "? /"
        const beatSeparatorPattern = /,\s*(?=[^,]*[+\-?]\s*\/)/g;
        const parts = trimmedText.split(beatSeparatorPattern);

        if (parts.length > 1) {
          lines = parts.map(item => `- ${item.trim()}`).filter(line => line.length > 2);
        } else {
          // If no pattern match, use original comma splitting as fallback
          lines = trimmedText.split(',').map(item => `- ${item.trim()}`).filter(line => line.length > 2);
        }
        if (lines.length === 0 && trimmedText.length > 0) {
          lines = [`- ${trimmedText}`];
        }
      }
    }
    // END: Restore line splitting logic



    // Add this after the line splitting logic but before the for loop
    // Around line 1275-1280, right after "// END: Restore line splitting logic"

    // Pre-process lines for wrapping for all beats sections.
    if (lines.length > 0) {
      const processedLines: string[] = [];

      for (const originalLine of lines) {
        if (!originalLine || !originalLine.trim()) continue;

        const line = originalLine.trim();
        let wasSplit = false;

        // 1. Check if the line should have grade styling.
        let isGradeLine = false;
        const prefixMatch = line.match(/^\s*(\[[A-Z][+-]?\]\s*)/);
        const numericGradeRegex = /^\s*-?\s*(\d+(\.\d+)?\s+[ABC])/i; // Simplified to find the grade pattern itself.
        if (prefixMatch || line.match(numericGradeRegex)) {
          isGradeLine = true;
        }




        // 2. Determine the correct splitter character and method.
        // IMPORTANT: If the beat already includes a title/comment separator (" / "),
        // do NOT split further on commas or periods — commas belong to the comment.
        // This prevents unwanted wrapping like "smoother, but decent continuation".
        let splitChar = '';
        const hasSlashSeparator = /\s\/\s/.test(line);
        if (!hasSlashSeparator) {
          if (isGradeLine) {
            // For grade lines (when not using slash), prefer splitting on ". " to avoid decimals, else comma.
            if (line.match(/\.\s/)) {
              splitChar = '.';
            } else if (line.includes(',')) {
              splitChar = ',';
            }
          } else {
            // Non-grade lines (no slash) may be legacy comma-separated items
            if (line.includes(',')) {
              splitChar = ',';
            }
          }
        }

        // 3. Perform the split and format the new lines.
        if (splitChar) {
          const parts = line.split(splitChar);
          if (parts.length > 1) {
            wasSplit = true;
            const wrapTag = isGradeLine ? '[GRADE]' : '[BODY]';

            // First part includes the split character.
            processedLines.push(parts[0] + splitChar);

            // Subsequent parts get the appropriate wrap tag.
            for (let i = 1; i < parts.length; i++) {
              const part = parts[i].trim();
              if (part) {
                // Add split character back except for the last part
                const text = (i < parts.length - 1) ? part + splitChar : part;
                processedLines.push(`${wrapTag} ${text}`);
              }
            }
          }
        }

        // 4. If no split occurred, add the original line back.
        if (!wasSplit) {
          processedLines.push(originalLine);
        }
      }

      // Replace original lines with the new processed lines.
      lines.splice(0, lines.length, ...processedLines);
    }

    let currentY = baseY;
    let lineCount = 0;

    // Process lines and render synopsis content

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line.startsWith('-')) { line = `- ${line}`; }
      let rawContent = line.substring(1).trim();
      if (!rawContent) continue;

      // --- Revised Splitting and Formatting Logic --- 
      let titleText = rawContent; // Default: whole line is title
      let commentText = '';     // Default: no comment
      let titleClass = 'pulse-text-neutral'; // Default class
      let commentClass = 'pulse-text'; // Default comment class
      let signDetected: string | null = null; // Store the detected sign (+, -, ?)
      let useSlashSeparator = false; // Flag to control adding " / "

      // Check for body text wrapper from non-grade line splitting FIRST
      const bodyWrapMatch = rawContent.match(/^\[BODY\]\s*(.*)$/);
      const gradeWrapMatch = rawContent.match(/^\[GRADE\]\s*(.*)$/);

      if (gradeWrapMatch) {
        // This is a wrapped line from a grade line.
        titleText = gradeWrapMatch[1];
        rawContent = titleText;
        // Apply grade formatting to wrapped grade segments
        titleClass = 'pulse-text-grade';
        commentClass = 'pulse-text-grade';
      } else if (bodyWrapMatch) {
        // This is a wrapped line from a regular line.
        titleText = bodyWrapMatch[1];
        rawContent = titleText;
        // Apply light gray body text formatting  
        titleClass = 'rt-info-text rt-title-text-secondary';
        commentClass = 'rt-info-text rt-title-text-secondary';
      } else {
        // Only do sign detection if this is NOT body text or grade text
        if (!bodyWrapMatch && !gradeWrapMatch) {
          // 1. Find the specific "Sign /" pattern
          const signSlashPattern = /^(.*?)\s*([-+?])\s*\/\s*(.*)$/;
          const match = rawContent.match(signSlashPattern);

          if (match) {
            // Pattern "Title Sign / Comment" found
            titleText = match[1].trim();    // Part before the sign
            signDetected = match[2];        // The actual sign (+, -, ?)
            commentText = match[3].trim(); // Part after the slash
            useSlashSeparator = true;     // We found the pattern, so use the slash
            // NOTE: Title sign is implicitly removed because titleText comes from group 1 (before the sign)
          } else {
            // Pattern not found. Check if there's a sign at the end for coloring, but don't split.
            const endSignMatch = rawContent.match(/\s*([-+?])$/);
            if (endSignMatch) {
              signDetected = endSignMatch[1];
              // Remove the sign from the title text for display
              titleText = rawContent.substring(0, endSignMatch.index).trim();
            }
            // No split needed, commentText remains empty, useSlashSeparator remains false
          }

          // 2. Determine Title CSS Class based on the detected sign
          if (signDetected === '+') {
            titleClass = 'pulse-text-positive';
          } else if (signDetected === '-') {
            titleClass = 'pulse-text-negative';
          } // Otherwise remains 'pulse-text-neutral'
        }
      }

      // Handle special case for currentSceneAnalysis grade detection (simple, content-based only)
      if (beatKey === 'currentSceneAnalysis' && !bodyWrapMatch && !gradeWrapMatch) {
        // Check if THIS specific line has a grade pattern
        const gradeMatch = titleText.match(/^\s*-?\s*(\d+(\.\d+)?\s+[ABC])/i);

        if (gradeMatch) {
          // This line itself has a grade - apply grade formatting
          titleClass = 'pulse-text-grade';
          commentClass = 'pulse-text-grade';
        }
      }

      // --- Create SVG Elements with forced wrap support ([BR]) --- 
      // Support user-forced line breaks using [br]/[BR] tokens inside title/comment (case-insensitive)
      const brRe = /\s*\[br\]\s*/i;
      const titleSegments = (titleText || '').split(brRe);
      const commentSegments = (useSlashSeparator && commentText) ? (commentText || '').split(brRe) : [];

      // First visual line: title seg 0 plus optional comment seg 0 with slash
      const makeLine = (titlePart: string | null, commentPart: string | null) => {
        const lineText = doc.win.createSvg("text");
        lineText.setAttribute("class", "pulse-text");
        lineText.setAttribute("data-pulse-section", beatKey);
        lineText.setAttribute("x", "0");
        lineText.setAttribute("y", String(currentY));
        lineText.setAttribute("text-anchor", "start");

        if (titlePart !== null) {
          const tt = doc.win.createSvg("tspan");
          tt.setAttribute("class", titleClass);
          tt.textContent = titlePart;
          lineText.appendChild(tt);
        }
        if (commentPart !== null) {
          const ct = doc.win.createSvg("tspan");
          ct.setAttribute("class", commentClass);
          ct.textContent = (titlePart ? " / " : "") + commentPart;
          lineText.appendChild(ct);
        }

        parentGroup.appendChild(lineText);
        currentY += lineHeight;
        lineCount += 1;
      };

      makeLine(titleSegments[0] ?? '', commentSegments.length > 0 ? (commentSegments[0] ?? '') : null);

      // Additional lines from remaining title segments (each on its own line)
      for (let i = 1; i < titleSegments.length; i++) {
        makeLine(titleSegments[i], null);
      }

      // Additional lines from remaining comment segments (each on its own line)
      for (let i = 1; i < commentSegments.length; i++) {
        makeLine(commentSegments[i], null);
      }
    }

    // Removed grade border overlay; grade is now shown by coloring number text

    // Add spacer at the end of this section if needed
    if (spacerSize > 0) {
      const addSpacer = (yPosition: number, height: number) => {
        const spacer = doc.win.createSvg("rect");
        spacer.setAttribute("class", "synopsis-spacer");
        spacer.setAttribute("x", "0");
        spacer.setAttribute("y", String(yPosition));
        spacer.setAttribute("width", "20");
        spacer.setAttribute("height", String(height));

        parentGroup.appendChild(spacer);
      };

      addSpacer(currentY, spacerSize);
      currentY += spacerSize;
    }

    return lineCount;
  }

  private buildMissingWhenMessage(scene: TimelineItem): string | null {
    if (!shouldDisplayMissingWhenWarning(scene)) return null;

    const neighbors = this.getNarrativeNeighbors(scene);
    const previousDate = this.getValidWhen(neighbors?.previous);
    const nextDate = this.getValidWhen(neighbors?.next);

    const suggestions: string[] = [];
    if (previousDate) {
      suggestions.push(`Prev ${formatDateForDisplay(previousDate)}`);
    }
    if (nextDate) {
      suggestions.push(`Next ${formatDateForDisplay(nextDate)}`);
    }

    if (suggestions.length === 0) {
      return 'Missing When date';
    }

    const suggestionText = suggestions.length === 1
      ? suggestions[0]
      : `${suggestions[0]} or ${suggestions[1]}`;

    return `Missing When date — Try ${suggestionText}`;
  }

  private getNarrativeNeighbors(scene: TimelineItem): { previous?: TimelineItem; next?: TimelineItem } | null {
    const dataset = this.plugin.lastSceneData;
    if (!Array.isArray(dataset) || dataset.length === 0) return null;

    const sceneEntries = dataset.filter(item => !isBeatNote(item));
    if (sceneEntries.length === 0) return null;

    const seenKeys = new Set<string>();
    const deduped: TimelineItem[] = [];
    sceneEntries.forEach(item => {
      const key = this.getSceneKey(item);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduped.push(item);
      }
    });

    const ordered = sortScenes(deduped, false);
    const targetKey = this.getSceneKey(scene);
    const index = ordered.findIndex(item => this.getSceneKey(item) === targetKey);
    if (index === -1) return null;

    return {
      previous: index > 0 ? ordered[index - 1] : undefined,
      next: index < ordered.length - 1 ? ordered[index + 1] : undefined
    };
  }

  private getSceneKey(item: TimelineItem): string {
    return item.path || `${item.title || ''}::${String(item.when ?? '')}`;
  }

  private getValidWhen(item?: TimelineItem): Date | null {
    if (!item) return null;
    if (!(item.when instanceof Date)) return null;
    return Number.isNaN(item.when.getTime()) ? null : item.when;
  }
}
