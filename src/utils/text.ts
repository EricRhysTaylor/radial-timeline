/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { escapeRegExp } from './regex';
import { escapeXml } from './svg';
import { getNumberSquareWidthFromCache } from '../renderer/utils/FontMetricsCache';
import { NUMBER_SQUARE_HEIGHT_PX } from '../renderer/layout/LayoutConstants';

// Decode basic HTML entities. If string already contains <tspan> markup we leave it untouched so SVG formatting is preserved.
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  if (text.includes('<tspan') || text.includes('&lt;tspan')) return text;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<!DOCTYPE html><body><span>${text}</span></body>`, 'text/html');
    const span = doc.querySelector('span');
    return span?.textContent ?? '';
  } catch {
    // DOMParser is always present in Obsidian; only DOM-less test hosts land
    // here, and they get the text back undecoded.
    return text;
  }
}

export interface SceneTitleParts { sceneNumber: string; title: string; date: string; duration: string; }

function normalizeIntegerPrefixToken(token: string): string {
  const trimmed = token.trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isFinite(parsed)) return String(parsed);
  return trimmed.replace(/^0+(?=\d)/, '');
}

export function parseSceneTitleComponents(titleText: string, sceneNumber?: number | null, date?: string, duration?: string): SceneTitleParts {
  const result: SceneTitleParts = { sceneNumber: '', title: '', date: '', duration: '' };
  if (!titleText) return result;
  
  // Use frontmatter data if available
  if (sceneNumber !== null && sceneNumber !== undefined) {
    result.sceneNumber = String(sceneNumber);
  }
  if (date) {
    result.date = date;
  }
  if (duration) {
    result.duration = duration;
  }
  
  const decodedText = decodeHtmlEntities(titleText);
  if (decodedText.includes('<tspan')) {
    result.title = decodedText;
    return result;
  }
  
  // If we don't have frontmatter data, fall back to regex parsing
  if (result.sceneNumber === '' || result.date === '') {
    const dateMatch = decodedText.match(/\s{3,}(.+?)$/);
    if (dateMatch && result.date === '') {
      result.date = dateMatch[1].trim();
      const titlePart = decodedText.substring(0, dateMatch.index).trim();
      const titleMatch = titlePart.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      if (titleMatch) {
        if (result.sceneNumber === '') result.sceneNumber = normalizeIntegerPrefixToken(titleMatch[1]);
        result.title = titleMatch[2];
      } else {
        result.title = titlePart;
      }
    } else {
      const titleMatch = decodedText.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      if (titleMatch) {
        if (result.sceneNumber === '') result.sceneNumber = normalizeIntegerPrefixToken(titleMatch[1]);
        result.title = titleMatch[2];
      } else {
        result.title = decodedText;
      }
    }
  } else {
    // We have frontmatter data, just clean the title
    result.title = decodedText.replace(/^\d+(?:\.\d+)?\s+/, '').replace(/\s{3,}(.+?)$/, '').trim();
  }
  
  return result;
}

/**
 * Renders just the main title part of the scene title.
 * @param title - The title text.
 * @param searchTerm - The search term for highlighting.
 * @returns A DocumentFragment containing the title tspan.
 */
export function renderSceneTitleFragment(
  title: string,
  searchTerm: string
): DocumentFragment {
  const fragment = activeWindow.createFragment();
  const main = activeWindow.createSvg('tspan');
  main.setAttribute('class', 'rt-scene-title-bold');
  main.setAttribute('data-item-type', 'title');

  if (searchTerm && title) {
    const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(title))) {
      if (m.index > last) main.appendChild(activeDocument.createTextNode(title.slice(last, m.index)));
      const hl = activeWindow.createSvg('tspan');
      hl.setAttribute('class', 'rt-search-term');
      // No fill attribute; inherit from parent via --rt-dynamic-color
      hl.textContent = m[0];
      main.appendChild(hl);
      last = m.index + m[0].length;
    }
    if (last < title.length) main.appendChild(activeDocument.createTextNode(title.slice(last)));
  } else {
    main.textContent = title;
  }

  fragment.appendChild(main);
  return fragment;
}

/**
 * Splits text into balanced lines where each line has roughly equal length.
 * Avoids orphaned words (1-2 words) on the last line.
 * 
 * @param text - The text to split
 * @param maxWidth - Maximum width in pixels (used to estimate chars per line)
 * @param fontScale - Font scale multiplier
 * @returns Array of balanced line strings
 */
export function splitIntoBalancedLinesOptimal(text: string, maxWidth: number, fontScale: number = 1): string[] {
  if (!text) return [''];
  
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [''];
  if (words.length <= 3) return [text]; // Short text - keep on one line
  
  const approxCharWidth = 8 * (fontScale || 1);
  const maxCharsPerLine = Math.max(20, Math.round((maxWidth || 400) / approxCharWidth));
  const totalChars = text.length;
  
  // If it fits on one line, return as-is
  if (totalChars <= maxCharsPerLine) return [text];
  
  // Calculate optimal number of lines
  const estimatedLines = Math.ceil(totalChars / maxCharsPerLine);
  // Target chars per line for balanced distribution
  const targetCharsPerLine = Math.ceil(totalChars / estimatedLines);
  
  const lines: string[] = [];
  let currentLine = '';
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const remainingWords = words.length - i;
    const testLine = currentLine ? currentLine + ' ' + word : word;
    
    // Check if adding this word exceeds target AND we have more words
    // But don't break if it would leave orphans (1-2 words on last line)
    const wouldExceedTarget = testLine.length > targetCharsPerLine;
    const wouldCreateOrphan = remainingWords <= 2 && lines.length > 0;
    
    if (wouldExceedTarget && currentLine && !wouldCreateOrphan) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  
  if (currentLine) lines.push(currentLine);
  
  // Post-process: if last line is very short compared to previous, rebalance
  if (lines.length >= 2) {
    const lastLine = lines[lines.length - 1];
    const prevLine = lines[lines.length - 2];
    
    // If last line is less than 40% of previous line, try to rebalance
    if (lastLine.length < prevLine.length * 0.4) {
      // Combine last two lines and re-split at midpoint
      const combined = prevLine + ' ' + lastLine;
      const words2 = combined.split(/\s+/);
      const midpoint = Math.ceil(words2.length / 2);
      
      lines[lines.length - 2] = words2.slice(0, midpoint).join(' ');
      lines[lines.length - 1] = words2.slice(midpoint).join(' ');
    }
  }
  
  return lines;
}

// --- Scene title parser that prefers frontmatter data over regex parsing ---
export function parseSceneTitle(title: string, sceneNumber?: number | null): { number: string; text: string } {
  if (!title) return { number: '0', text: '' };
  
  // Use frontmatter sceneNumber if available
  if (sceneNumber !== null && sceneNumber !== undefined) {
    const cleanTitle = title.replace(/^\d+(?:\.\d+)?\s+/, ''); // Remove leading number if present
    return { number: String(sceneNumber), text: escapeXml(cleanTitle) };
  }
  
  // Fallback to regex parsing for legacy data
  const match = title.match(/^(\d+(?:\.\d+)?)\s+(.+)/);
  if (match) {
    const number = normalizeIntegerPrefixToken(match[1]);
    const text = match[2];
    return { number, text: escapeXml(text) };
  }
  
  // If no number is found, use the whole title
  return { number: '', text: escapeXml(title) };
}

export type NormalizedStatus = 'Todo' | 'Working' | 'Due' | 'Completed';

export function normalizeStatus(raw: unknown): NormalizedStatus | null {
  if (raw == null) return 'Todo';
  const first = Array.isArray(raw) ? raw[0] ?? '' : raw;
  const v = (typeof first === 'object' ? JSON.stringify(first) : String(first)).trim().toLowerCase();
  if (!v) return 'Todo';
  if (v === 'complete' || v === 'done' || v === 'completed') return 'Completed';
  if (v === 'working' || v === 'in progress' || v === 'progress') return 'Working';
  if (v === 'todo' || v === 'to do' || v === 'tbd') return 'Todo';
  return null; // let caller decide Due based on date, or default
}

// Unified helpers for scene prefix numbers and number-square sizing
export function getScenePrefixNumber(title: string | undefined | null, sceneNumber?: number | null): string | null {
  if (!title) return null;
  
  // Use frontmatter sceneNumber if available
  if (sceneNumber !== null && sceneNumber !== undefined) {
    return String(sceneNumber);
  }
  
  // Fallback to regex parsing for legacy data
  const decoded = decodeHtmlEntities(title);
  // Titles are of the form: "12.3 Title here" or "12 Title here" (no dates)
  const m = decoded.match(/^(\d+(?:\.\d+)?)\s+.+/);
  return m ? normalizeIntegerPrefixToken(m[1]) : null;
}

export function getNumberSquareSize(num: string, scale: number = 1): { width: number; height: number } {
  const height = NUMBER_SQUARE_HEIGHT_PX * scale;
  
  // Use cached font metrics for accurate width measurement
  const width = getNumberSquareWidthFromCache(num, scale);
  return { width, height };
}

/**
 * Remove Obsidian comment blocks (%%...%%) from text.
 * Handles both single-line and multi-line comments.
 */
export function stripObsidianComments(text: string): string {
  if (!text) return text;
  // Remove all %%...%% blocks (non-greedy match, multi-line aware)
  return text.replace(/%%[\s\S]*?%%/g, '').trim();
}

/**
 * Strip Obsidian wiki link syntax [[...]] from text.
 * Handles both simple [[Link]] and aliased [[Link|Alias]] formats.
 * @param text - Text that may contain wiki links
 * @returns Text with wiki link brackets removed (just the link target or alias)
 */
export function stripWikiLinks(text: string): string {
  if (!text) return text;
  // Replace [[Link|Alias]] with Alias, and [[Link]] with Link
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, link, alias) => alias || link).trim();
}

/**
 * Truncate text to a maximum word count, adding ellipsis if truncated.
 * Used for display-only truncation (e.g., hover synopsis preview).
 * @param text - The text to truncate
 * @param maxWords - Maximum number of words to keep (default: 100)
 * @returns Truncated text with "..." appended if it exceeded the limit
 */
export function truncateToWordLimit(text: string, maxWords: number = 100): string {
  if (!text) return '';
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}
