/*
 * Manuscript Assembly Utilities
 */
import { TFile, Vault, App, getFrontMatterInfo, parseYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { TimelineItem, BookMeta, MatterMeta, LegacyMatterOrder } from '../types';
import { getScenePrefixNumber } from './text';
import { getActiveBookExportContext } from './exportContext';
import { normalizeMatterBodyMode, parseMatterMetaFromFrontmatter, type MatterBodyMode } from './matterMeta';
import { normalizeFrontmatterKeys } from './frontmatter';
import { groupTimelineChapterMarkersByScenePath, resolveTimelineChapterMarkers, type TimelineChapterMarker } from './timelineChapters';
import { cleanEvidenceBody } from '../inquiry/utils/evidenceCleaning';
import { readSceneId } from './sceneIds';
import {
  resolveBookPages,
  applyBookPageOrder,
  type MatterNoteSummary,
  type ResolvedPage
} from './bookPagesResolver';

export interface SceneContent {
  title: string;
  bodyText: string;
  wordCount: number;
  sceneId?: string;
  /** Source note path when this entry came from a real manuscript scene. */
  sourcePath?: string;
}

/** One note the assembler could not read. Carried out so callers can block. */
export interface ManuscriptReadFailure {
  path: string;
  error: unknown;
}

export interface AssembledManuscript {
  text: string;
  totalWords: number;
  totalScenes: number;
  scenes: SceneContent[];
  sortOrder?: string;
  /**
   * Notes that failed to read. Non-empty means `text` is missing content:
   * export runners must block before writing any deliverable. Never empty
   * a failure into the manuscript body — a reader cannot tell it apart from
   * the author's own prose.
   */
  readFailures: ManuscriptReadFailure[];
}

export type ManuscriptOrder = 'narrative' | 'chronological' | 'reverse-narrative' | 'reverse-chronological';

export interface ManuscriptSceneSelection {
  files: TFile[];
  sortOrder: string;
  titles: string[];
  whenDates: (string | null)[];
  acts: (number | null)[];
  sceneNumbers: number[];
  subplots: string[];
  synopses: (string | null)[];
  runtimes: (number | null)[];
  wordCounts: (number | null)[];
  matterMetaByPath?: Map<string, MatterMeta>;
  chapterMarkersByScenePath?: Record<string, TimelineChapterMarker[]>;
}

export type TocMode = 'markdown' | 'plain' | 'none';
export type ManuscriptSceneHeadingMode = 'scene-number' | 'scene-number-title' | 'title-only';
export type SceneHeadingRenderMode = 'markdown-h2' | 'latex-section-starred';

export interface ModernClassicStructureOptions {
  enabled: boolean;
  actEpigraphs?: string[];
  actEpigraphAttributions?: string[];
}

export interface AssembleManuscriptOptions {
  sceneHeadingMode?: ManuscriptSceneHeadingMode;
  sceneHeadingRenderMode?: SceneHeadingRenderMode;
  modernClassicStructure?: ModernClassicStructureOptions;
  suppressMatterPageChrome?: boolean;
  chapterMarkersByScenePath?: Record<string, TimelineChapterMarker[]>;
  /** When true, append each scene's SceneId to its TOC entry (default off in core; UI default on). */
  includeSceneIdInToc?: boolean;
  /** When true, append each scene's SceneId to its body heading. Default off — adds visual chrome to manuscript proper. */
  includeSceneIdInHeading?: boolean;
  /** Use plain SceneId text for Pandoc PDF headings; code spans are unsafe in PDF bookmark strings. */
  sceneIdFormat?: 'code' | 'plain';
  /**
   * Emit chapter markers as `\rtChapter{N}{Title}` raw LaTeX instead of `# Title`
   * markdown. Use this for any layout whose template defines an `\rtChapter`
   * macro (e.g. Contemporary Literary, Modern Classic). When false (default),
   * chapter markers fall through to pandoc's default `\chapter{}` via the
   * book document class.
   *
   * Only applies to the non-Modern-Classic emission branch; the Modern
   * Classic structure path already emits `\rtChapter` unconditionally.
   */
  useRtChapterMacro?: boolean;
  /**
   * User-saved Book Pages order from `BookProfile.bookPageOrder`. When set,
   * matter pages emit in this order (saved positions first, new pages
   * appended canonically). Empty/undefined → resolver canonical order.
   */
  bookPageOrder?: string[];
  /**
   * When false, suppress both physical matter notes and BookMeta-only Book
   * Pages. Used by the Manuscript Export "Include front & back matter" toggle.
   */
  includeMatterPages?: boolean;
}

let matterOrderIgnoredWarned = false;
const matterLikeMissingClassWarnings = new Set<string>();

function isDevMode(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

function formatSceneIdForManuscript(sceneId: string, format: AssembleManuscriptOptions['sceneIdFormat'] = 'code'): string {
  return format === 'plain' ? sceneId : `\`${sceneId}\``;
}

function warnMatterOrderIgnoredOnce(): void {
  if (isDevMode() && !matterOrderIgnoredWarned) {
    matterOrderIgnoredWarned = true;
    console.warn('Matter.order is ignored; ordering uses filename prefixes.');
  }
}

function warnMatterLikeWithoutClass(scene: TimelineItem): void {
  if (!isDevMode()) return;
  const key = scene.path || scene.title || '(unknown)';
  if (matterLikeMissingClassWarnings.has(key)) return;
  matterLikeMissingClassWarnings.add(key);
  console.warn(`[Matter Export] Note looks like matter by prefix but has no Frontmatter/Backmatter Class: ${key}`);
}

/**
 * Extract note body with minimal normalization only.
 * Cleanup is handled centrally by manuscriptSanitize.ts at export time.
 */
export function extractBodyText(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim();
}

function extractBodyTextAfterFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  const match = normalized.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (!match) return normalized;
  return normalized.slice(match[0].length).trim();
}

/**
 * Extract the body text basis used for manuscript word counts.
 * Excludes YAML frontmatter and draft-only comment syntax.
 */
export function extractCountableBodyText(content: string): string {
  return cleanEvidenceBody(content.replace(/\r\n?/g, '\n'));
}

// ════════════════════════════════════════════════════════════════════════════
// Semantic Matter Helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract matter metadata from raw file content by parsing YAML frontmatter.
 * Uses simplified front/back matter keys (Class + Role/UseBookMeta/BodyMode).
 */
function extractMatterMeta(content: string): MatterMeta | null {
  try {
    const fmInfo = getFrontMatterInfo(content);
    const fmText = (fmInfo as { frontmatter?: string }).frontmatter;
    if (!fmText) return null;

    const yaml = parseYaml(fmText);
    if (!yaml || typeof yaml !== 'object' || Array.isArray(yaml)) return null;

    const parsed = parseMatterMetaFromFrontmatter(yaml as Record<string, unknown>);
    const parsedLegacy: LegacyMatterOrder | null = parsed;
    if (parsedLegacy?.order !== undefined) {
      warnMatterOrderIgnoredOnce();
    }
    return parsed;
  } catch {
    return null;
  }
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}$&#_%])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function processBody(bodyText: string, bodyMode: MatterBodyMode): string {
  const trimmed = bodyText.trim();
  return bodyMode === 'latex' ? preserveLatexMatterHardWraps(trimmed) : escapeLatex(trimmed);
}

function isLatexMatterProseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('\\')) return false;
  if (trimmed.startsWith('%')) return false;
  if (trimmed.startsWith('<!--') || trimmed.startsWith('-->')) return false;
  return true;
}

function hasExplicitLatexLineBreak(line: string): boolean {
  return /\\\\\s*(?:%.*)?$/.test(line);
}

function preserveLatexMatterHardWraps(bodyText: string): string {
  const lines = bodyText.split(/\r?\n/);
  return lines.map((line, index) => {
    if (!isLatexMatterProseLine(line) || hasExplicitLatexLineBreak(line)) return line;
    const nextLine = lines[index + 1];
    if (!nextLine || !isLatexMatterProseLine(nextLine)) return line;
    return `${line}\\\\`;
  }).join('\n');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripScenePrefix(title: string, prefix: string | null): string {
  const trimmed = title.trim();
  if (!prefix) return trimmed;
  const pattern = new RegExp(`^${escapeRegex(prefix)}(?:\\s+|[._:-]+\\s*)?`, 'i');
  return trimmed.replace(pattern, '').trim();
}

function extractScenePrefixFromTitle(title: string): string | null {
  const match = title.trim().match(/^(\d+(?:\.\d+)?)/);
  return match?.[1] || null;
}

function resolveSceneHeading(
  title: string,
  mode: ManuscriptSceneHeadingMode,
  fallbackNumber: number
): string {
  const trimmed = title.trim();
  const prefix = extractScenePrefixFromTitle(trimmed);
  const strippedTitle = stripScenePrefix(trimmed, prefix);

  switch (mode) {
    case 'scene-number':
      return prefix || `Scene ${fallbackNumber}`;
    case 'title-only':
      return strippedTitle || trimmed || `Scene ${fallbackNumber}`;
    case 'scene-number-title':
    default:
      if (prefix && strippedTitle) return `${prefix} ${strippedTitle}`;
      return trimmed || `Scene ${fallbackNumber}`;
  }
}

function resolveSceneTitleForPublishing(
  basename: string,
  frontmatter: Record<string, unknown> | null
): string {
  const trimmed = basename.trim();
  const prefix = extractScenePrefixFromTitle(trimmed);
  const strippedTitle = stripScenePrefix(trimmed, prefix);
  if (strippedTitle) return trimmed;

  const frontmatterTitle = frontmatter
    ? getFirstFrontmatterString(frontmatter, ['Title', 'Scene Title', 'SceneTitle', 'Scene Name', 'SceneName', 'Name'])
    : undefined;
  if (!frontmatterTitle) return trimmed;

  const fmPrefix = extractScenePrefixFromTitle(frontmatterTitle);
  const fmTitle = stripScenePrefix(frontmatterTitle, fmPrefix);
  const titleText = fmTitle || frontmatterTitle.trim();
  if (prefix && titleText) return `${prefix} ${titleText}`;
  return titleText || trimmed;
}

function resolveLatexSceneHeading(
  title: string,
  mode: ManuscriptSceneHeadingMode,
  fallbackNumber: number
): string {
  const trimmed = title.trim();
  const prefix = extractScenePrefixFromTitle(trimmed);
  const strippedTitle = stripScenePrefix(trimmed, prefix);

  if (mode === 'scene-number') {
    return escapeLatex(prefix || `Scene ${fallbackNumber}`);
  }
  if (mode === 'title-only') {
    return escapeLatex(strippedTitle || trimmed || `Scene ${fallbackNumber}`);
  }
  if (prefix && strippedTitle) {
    const safePrefix = escapeLatex(prefix);
    const safeTitle = escapeLatex(strippedTitle);
    // Tight line break + small upright sub-title in parens. Earlier form used
    // \itshape and 0.25em vertical leading; that left too much air between the
    // scene number and the title, and italics conflict stylistically with body
    // emphasis. Plain upright in parens reads cleaner and tighter.
    return `${safePrefix}\\\\{\\normalsize (${safeTitle})}`;
  }
  return escapeLatex(trimmed || `Scene ${fallbackNumber}`);
}

function resolveLatexSceneRunningMark(
  title: string,
  fallbackNumber: number
): string {
  const trimmed = title.trim();
  const prefix = extractScenePrefixFromTitle(trimmed);
  const strippedTitle = stripScenePrefix(trimmed, prefix);
  return escapeLatex(strippedTitle || trimmed || `Scene ${fallbackNumber}`);
}

/**
 * Roles whose pages can be rendered from BookMeta when `UseBookMeta: true`.
 * Other roles ignore the flag and render their body as-is.
 */
export const BOOK_META_BACKED_ROLES: ReadonlySet<string> = new Set([
  'copyright',
  'title-page',
  'about-author',
  'dedication',
  'epigraph',
  'acknowledgments',
  'author-note',
  'other-works',
]);

function preferBookMetaText(value: string | undefined, bodyText: string, bodyMode: MatterBodyMode): string {
  const normalized = (value || '').trim();
  if (normalized) return escapeLatex(normalized);
  return processBody(bodyText, bodyMode);
}

function renderTitlePage(bookMeta: BookMeta, bodyText: string, bodyMode: MatterBodyMode): string {
  const title = escapeLatex(bookMeta.title ?? '');
  const subtitle = escapeLatex(bookMeta.subtitle ?? '');
  const author = escapeLatex(bookMeta.author ?? '');
  const titlePageNote = preferBookMetaText(bookMeta.frontmatter?.title_page_note, bodyText, bodyMode);

  const parts: string[] = [];
  parts.push('\\begin{center}');
  parts.push('\\vspace*{4cm}');
  parts.push('');
  if (title) {
    parts.push(`{\\Huge ${title}}\\\\[1em]`);
  }
  if (subtitle) {
    parts.push(`{\\Large ${subtitle}}\\\\[1.5em]`);
  }
  if (author) {
    parts.push(`{\\Large ${author}}`);
  }
  if (titlePageNote) {
    parts.push('');
    parts.push('\\vspace{1cm}');
    parts.push('');
    parts.push(titlePageNote);
  }
  parts.push('');
  parts.push('\\vfill');
  parts.push('\\end{center}');
  parts.push('\\newpage');

  return parts.join('\n');
}

function renderCopyrightPage(bookMeta: BookMeta, bodyText: string, bodyMode: MatterBodyMode): string {
  const year = bookMeta.rights?.year;
  const yearStr = year ? year.toString() : '[YEAR MISSING]';
  const holder = escapeLatex(bookMeta.rights?.copyright_holder ?? bookMeta.author ?? '');
  const processedBody = processBody(bodyText, bodyMode);

  const parts: string[] = [];
  parts.push('\\begin{center}');
  parts.push('\\vspace*{\\fill}');
  parts.push('');

  if (processedBody) {
    parts.push(processedBody);
    parts.push('');
    parts.push('\\vspace{0.4cm}');
    parts.push('');
  }

  parts.push(`Copyright \\textcopyright{} ${yearStr} ${holder}`.trimEnd());

  if (bookMeta.publisher?.name) {
    parts.push('');
    parts.push('\\vspace{0.3cm}');
    parts.push('');
    parts.push(escapeLatex(bookMeta.publisher.name));
  }

  if (bookMeta.identifiers?.isbn_paperback) {
    parts.push('');
    parts.push('\\vspace{0.3cm}');
    parts.push('');
    parts.push(`ISBN: ${escapeLatex(bookMeta.identifiers.isbn_paperback)}`);
  }

  parts.push('');
  parts.push('\\vfill');
  parts.push('\\end{center}');

  return parts.join('\n');
}

function renderAboutAuthorPage(bookMeta: BookMeta, bodyText: string, bodyMode: MatterBodyMode): string {
  const author = escapeLatex(bookMeta.author ?? '');
  const processedBody = preferBookMetaText(bookMeta.backmatter?.about_author, bodyText, bodyMode);

  const parts: string[] = [];
  parts.push('\\section*{About the Author}');
  parts.push('');
  if (author) {
    parts.push(`\\noindent\\textbf{${author}}`);
    parts.push('');
  }
  if (processedBody) {
    parts.push(processedBody);
  }

  return parts.join('\n');
}

function renderDedicationPage(bookMeta: BookMeta, bodyText: string, bodyMode: MatterBodyMode): string {
  const dedication = preferBookMetaText(bookMeta.frontmatter?.dedication, bodyText, bodyMode);
  if (!dedication) return '';
  return [
    '\\begin{center}',
    '\\vspace*{0.33\\textheight}',
    dedication,
    '\\vfill',
    '\\end{center}',
    '\\newpage'
  ].join('\n');
}

function renderEpigraphPage(bookMeta: BookMeta, bodyText: string, bodyMode: MatterBodyMode): string {
  const quote = (bookMeta.frontmatter?.epigraph_quote || '').trim();
  const attribution = (bookMeta.frontmatter?.epigraph_attribution || '').trim();
  if (!quote && !attribution) {
    const fallback = processBody(bodyText, bodyMode);
    if (!fallback) return '';
    return `${fallback}\n\\newpage`;
  }
  const parts: string[] = [];
  parts.push('\\begin{center}');
  parts.push('\\vspace*{0.32\\textheight}');
  parts.push('\\begin{minipage}{0.72\\textwidth}');
  if (quote) parts.push(`\\itshape ${escapeLatex(quote)}`);
  if (attribution) {
    parts.push('');
    parts.push('\\vspace{0.8em}');
    parts.push(`\\raggedleft\\normalfont --- ${escapeLatex(attribution)}`);
  }
  parts.push('\\end{minipage}');
  parts.push('\\vfill');
  parts.push('\\end{center}');
  parts.push('\\newpage');
  return parts.join('\n');
}

function renderProseMatterPage(
  heading: string,
  bookMetaText: string | undefined,
  bodyText: string,
  bodyMode: MatterBodyMode
): string {
  const processedBody = preferBookMetaText(bookMetaText, bodyText, bodyMode);
  const parts: string[] = [];
  parts.push(`\\section*{${escapeLatex(heading)}}`);
  parts.push('');
  if (processedBody) parts.push(processedBody);
  return parts.join('\n');
}

function renderBookMetaBackedMatterPage(
  role: string,
  bookMeta: BookMeta,
  bodyText: string,
  bodyMode: MatterBodyMode
): string | null {
  switch (role) {
    case 'copyright':
      return renderCopyrightPage(bookMeta, bodyText, bodyMode);
    case 'title-page':
      return renderTitlePage(bookMeta, bodyText, bodyMode);
    case 'about-author':
      return renderAboutAuthorPage(bookMeta, bodyText, bodyMode);
    case 'dedication':
      return renderDedicationPage(bookMeta, bodyText, bodyMode);
    case 'epigraph':
      return renderEpigraphPage(bookMeta, bodyText, bodyMode);
    case 'acknowledgments':
      return renderProseMatterPage('Acknowledgments', bookMeta.backmatter?.acknowledgments, bodyText, bodyMode);
    case 'author-note':
      return renderProseMatterPage('Author Note', bookMeta.backmatter?.author_note, bodyText, bodyMode);
    case 'other-works':
      return renderProseMatterPage('Other Works', bookMeta.backmatter?.other_works, bodyText, bodyMode);
    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════

/**
 * Count words in text
 */
export function countWords(text: string): number {
  // Split on whitespace and filter out empty strings
  const words = text.split(/\s+/).filter(word => word.length > 0);
  return words.length;
}

/**
 * Estimate tokens from word count (rough approximation: 1 token ≈ 0.75 words)
 */
export function estimateTokens(wordCount: number): number {
  return Math.ceil(wordCount / 0.75);
}

/**
 * Get sorted scene files ready for manuscript assembly
 * This is the single source of truth for preparing scenes for manuscript generation
 * Uses the same sorting logic as the timeline view
 * @param plugin - The RadialTimelinePlugin instance
 * @returns Object with array of TFile objects and sort order description
 */
export async function getSortedSceneFiles(plugin: RadialTimelinePlugin): Promise<{ files: TFile[], sortOrder: string }> {
  const exportContext = getActiveBookExportContext(plugin);
  const allScenes = await plugin.getSceneData({ sourcePath: exportContext.sourceFolder });

  // Deduplicate by path
  const uniquePaths = new Set<string>();
  const uniqueScenes = allScenes.filter(s => {
    if (s.itemType === 'Scene' && s.path && !uniquePaths.has(s.path)) {
      uniquePaths.add(s.path);
      return true;
    }
    return false;
  });

  // Sort scenes using the same logic as the timeline view
  // Check current mode and sorting settings
  const currentMode = plugin.settings.currentMode || 'narrative';
  const isChronologueMode = currentMode === 'chronologue';
  const sortByWhen = isChronologueMode ? true : (plugin.settings.sortByWhenDate ?? false);
  const forceChronological = isChronologueMode;

  // Import and use the same sortScenes function that the timeline uses
  const { sortScenes } = await import('./sceneHelpers');
  const sortedScenes = sortScenes(uniqueScenes, sortByWhen, forceChronological);

  // Convert to TFile objects
  const sceneFiles = sortedScenes
    .map(s => plugin.app.vault.getAbstractFileByPath(s.path!))
    .filter((f): f is TFile => f instanceof TFile);

  // Determine sort order description
  let sortOrder: string;
  if (isChronologueMode) {
    sortOrder = 'Chronological (by When date/time)';
  } else {
    sortOrder = 'Narrative (by scene title/number)';
  }

  return { files: sceneFiles, sortOrder };
}

import { parseRuntimeField } from './runtimeEstimator';

/**
 * Get all valid scenes from the timeline (wrapper for getting timeline items directly)
 */
export async function getAllScenes(app: App, plugin: RadialTimelinePlugin): Promise<TimelineItem[]> {
  const exportContext = getActiveBookExportContext(plugin);
  const data = await plugin.getSceneData({ sourcePath: exportContext.sourceFolder });
  return data.filter(s => s.itemType === 'Scene' || !s.itemType);
}

/**
 * Fetch scene files in a specific order (ignores current mode when explicit order is provided)
 * @param includeMatter - When true, also includes Frontmatter/Backmatter items for manuscript export
 */
export async function getSceneFilesByOrder(
  app: App,
  plugin: RadialTimelinePlugin,
  order: ManuscriptOrder,
  subplotFilter?: string,
  includeMatter?: boolean
): Promise<ManuscriptSceneSelection> {
  const exportContext = getActiveBookExportContext(plugin);
  const allScenes = await plugin.getSceneData({ sourcePath: exportContext.sourceFolder });

  const uniquePaths = new Set<string>();
  const uniqueTimelineItems = allScenes.filter((scene: TimelineItem) => {
    // Filter by subplot if specified (matter notes bypass subplot filter)
    const isMatter = scene.itemType === 'Frontmatter' || scene.itemType === 'Backmatter';
    if (!isMatter && subplotFilter && subplotFilter !== 'All Subplots') {
      const sceneSubplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
      if (sceneSubplot !== subplotFilter) return false;
    }

    const isAllowedType = scene.itemType === 'Scene'
      || !scene.itemType
      || (includeMatter && isMatter);

    if (isAllowedType && scene.path && !uniquePaths.has(scene.path)) {
      uniquePaths.add(scene.path);
      return true;
    }
    return false;
  });

  const { sortScenes, sortScenesChronologically } = await import('./sceneHelpers');
  let sortedScenes: TimelineItem[];
  let sortOrder: string;

  if (order === 'chronological' || order === 'reverse-chronological') {
    sortedScenes = sortScenesChronologically(uniqueTimelineItems);
    if (order === 'reverse-chronological') {
      sortedScenes = sortedScenes.slice().reverse();
      sortOrder = 'Reverse chronological (by When date/time)';
    } else {
      sortOrder = 'Chronological (by When date/time)';
    }
  } else {
    sortedScenes = sortScenes(uniqueTimelineItems, false, false);
    if (order === 'reverse-narrative') {
      sortedScenes = sortedScenes.slice().reverse();
      sortOrder = 'Reverse narrative (by scene title/number)';
    } else {
      sortOrder = 'Narrative (by scene title/number)';
    }
  }

  const isMatterItem = (scene: TimelineItem): boolean =>
    scene.itemType === 'Frontmatter' || scene.itemType === 'Backmatter';

  const resolveMatterSideFromClass = (scene: TimelineItem): 'front' | 'back' =>
    scene.itemType === 'Backmatter' ? 'back' : 'front';

  const extractMatterPrefixToken = (title: string): string | null => {
    const match = title.trim().match(/^(\d+(?:\.\d+)?)/);
    return match?.[1] || null;
  };

  const looksLikeMatterByPrefix = (title: string): boolean => {
    const match = title.trim().match(/^(\d+(?:\.\d+)?)/);
    if (!match) return false;
    return /^0(?:\.|$)/.test(match[1]) || /^200(?:\.|$)/.test(match[1]);
  };

  const compareMatterItems = (a: TimelineItem, b: TimelineItem): number => {
    const aTitle = a.title || '';
    const bTitle = b.title || '';
    const aPrefix = extractMatterPrefixToken(aTitle);
    const bPrefix = extractMatterPrefixToken(bTitle);

    if (aPrefix && bPrefix) {
      const prefixCmp = aPrefix.localeCompare(bPrefix, undefined, { numeric: true, sensitivity: 'base' });
      if (prefixCmp !== 0) return prefixCmp;
    } else if (aPrefix && !bPrefix) {
      return -1;
    } else if (!aPrefix && bPrefix) {
      return 1;
    }

    return aTitle.localeCompare(bTitle, undefined, { numeric: true, sensitivity: 'base' });
  };

  const orderedItems = (() => {
    if (!includeMatter) return sortedScenes.filter(s => s.itemType === 'Scene' || !s.itemType);

    const frontMatter = sortedScenes
      .filter(s => isMatterItem(s) && resolveMatterSideFromClass(s) === 'front')
      .sort(compareMatterItems);
    const backMatter = sortedScenes
      .filter(s => isMatterItem(s) && resolveMatterSideFromClass(s) === 'back')
      .sort(compareMatterItems);
    const sceneItems = sortedScenes.filter(s => {
      if (isMatterItem(s)) return false;
      if (includeMatter && looksLikeMatterByPrefix((s.title || '').trim())) {
        warnMatterLikeWithoutClass(s);
      }
      return s.itemType === 'Scene' || !s.itemType;
    });
    return [...frontMatter, ...sceneItems, ...backMatter];
  })();

  const chapterMarkersByScenePath = groupTimelineChapterMarkersByScenePath(
    resolveTimelineChapterMarkers(
      sortedScenes.filter((item) => item.itemType === 'Scene' || !item.itemType)
    )
  );

  const synopses: (string | null)[] = [];
  const runtimes: (number | null)[] = [];
  const wordCounts: (number | null)[] = [];
  const matterMetaByPath = new Map<string, MatterMeta>();

  const files: TFile[] = [];
  const titles: string[] = [];
  const whenDates: (string | null)[] = [];
  const acts: (number | null)[] = [];
  const sceneNumbers: number[] = [];
  const subplots: string[] = [];

  for (const scene of orderedItems) {
    if (!scene.path) continue;
    const file = app.vault.getAbstractFileByPath(scene.path);
    if (!(file instanceof TFile)) continue;
    files.push(file);
    titles.push(file.basename);
    whenDates.push(scene.when ? formatWhenDate(scene.when) : null);
    acts.push(parseActNumber(scene.actNumber ?? scene.act));
    const numStr = getScenePrefixNumber(scene.title, scene.number);
    sceneNumbers.push(numStr ? parseInt(numStr, 10) || 0 : 0);
    const sceneSubplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
    subplots.push(sceneSubplot);

    const rf = scene.rawFrontmatter;

    // Prefer Synopsis, then scene.synopsis
    let synopsis: string | null = null;
    if (rf && typeof rf.Synopsis === 'string') synopsis = rf.Synopsis;
    else if (scene.synopsis && scene.synopsis.trim().length > 0) synopsis = scene.synopsis;
    synopses.push(synopsis);

    const rt = rf?.Runtime as string | number | undefined;
    runtimes.push(parseRuntimeField(rt));

    let fallbackWordCount: number | null = null;
    const w = rf?.Words;
    if (typeof w === 'number') fallbackWordCount = w;
    else if (typeof w === 'string') {
      const parsed = parseInt(w, 10);
      fallbackWordCount = Number.isFinite(parsed) ? parsed : null;
    }

    try {
      const raw = await app.vault.cachedRead(file);
      wordCounts.push(countWords(extractCountableBodyText(raw)));
    } catch {
      wordCounts.push(fallbackWordCount);
    }

    if (isMatterItem(scene) && scene.path) {
      const matterLegacy: LegacyMatterOrder | undefined = scene.matterMeta;
      if (matterLegacy?.order !== undefined) {
        warnMatterOrderIgnoredOnce();
      }
      const normalizedSide: 'front' | 'back' = resolveMatterSideFromClass(scene);
      matterMetaByPath.set(scene.path, {
        ...(scene.matterMeta || {}),
        side: normalizedSide,
        bodyMode: normalizeMatterBodyMode(scene.matterMeta?.bodyMode)
      });
    }
  }

  return {
    files,
    sortOrder,
    titles,
    whenDates,
    acts,
    sceneNumbers,
    subplots,
    synopses,
    runtimes,
    wordCounts,
    matterMetaByPath,
    chapterMarkersByScenePath
  };
}

function formatWhenDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseActNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numericMatch = trimmed.match(/\d+/);
  if (numericMatch) {
    const parsed = parseInt(numericMatch[0], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const normalizedRoman = trimmed.toUpperCase().replace(/^ACT\s+/i, '');
  const romanMap: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10
  };
  return romanMap[normalizedRoman] ?? null;
}

interface ModernClassicState {
  enabled: boolean;
  currentActIndex: number | null;
  chapterIndex: number;
  sceneIndexInAct: number;
  actEpigraphs: string[];
  actEpigraphAttributions: string[];
}

function toRomanNumeral(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let remaining = Math.floor(value);
  let output = '';
  for (const [numeric, roman] of table) {
    while (remaining >= numeric) {
      output += roman;
      remaining -= numeric;
    }
  }
  return output;
}

function escapeModernClassicMacroText(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[{}]/g, '')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function sanitizeModernClassicMacroArg(value: string): string {
  return escapeModernClassicMacroText(value)
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeModernClassicEpigraphArg(value: string): string {
  const rawLines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const renderedLines: string[] = [];
  let pendingBlankGap = false;

  for (const rawLine of rawLines) {
    const line = escapeModernClassicMacroText(rawLine)
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!line) {
      pendingBlankGap = renderedLines.length > 0;
      continue;
    }
    if (renderedLines.length === 0) {
      renderedLines.push(line);
    } else {
      renderedLines.push(`${pendingBlankGap ? '\\\\[0.35em]' : '\\\\'}\n${line}`);
    }
    pendingBlankGap = false;
  }

  return renderedLines.join('');
}

function sanitizeModernClassicAttributionArg(value: string): string {
  return sanitizeModernClassicMacroArg(value)
    .replace(/^[\s—–-]+/, '')
    .trim();
}

function normalizeChapterHeadingText(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRawLatexBlock(command: string): string {
  return `\`\`\`{=latex}\n${command}\n\`\`\`\n\n`;
}

function extractFrontmatterObject(content: string): Record<string, unknown> | null {
  try {
    const fmInfo = getFrontMatterInfo(content);
    const fmText = (fmInfo as { frontmatter?: string }).frontmatter;
    if (!fmText) return null;
    const yaml = parseYaml(fmText);
    if (!yaml || typeof yaml !== 'object' || Array.isArray(yaml)) return null;
    return normalizeFrontmatterKeys(yaml as Record<string, unknown>);
  } catch {
    return null;
  }
}

function getFirstFrontmatterString(frontmatter: Record<string, unknown>, keys: string[]): string | undefined {
  const normalizedAliases = new Set(
    keys.map(key => key.toLowerCase().replace(/[\s_-]/g, ''))
  );
  for (const [rawKey, value] of Object.entries(frontmatter)) {
    const normalizedKey = rawKey.toLowerCase().replace(/[\s_-]/g, '');
    if (!normalizedAliases.has(normalizedKey)) continue;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Read a scene's canonical Act number from its frontmatter.
 *
 * Scene placement on the timeline ring (Narrative / Progress modes) is
 * driven by the scene's own `Act:` frontmatter field — see
 * `SceneDataService.parseScenes`. The publishing export uses the same
 * source so Part / Act dividers in the PDF match the structure the user
 * sees in the timeline. There is no beat indirection: scenes self-declare
 * which Act they belong to, and the export reads it directly.
 *
 * Returns null when the field is missing, empty, non-numeric, or <= 0.
 */
function extractSceneActIndex(content: string): number | null {
  const fm = extractFrontmatterObject(content);
  if (!fm) return null;
  const raw = getFirstFrontmatterString(fm, ['Act']);
  if (!raw) {
    // Numeric Act values (Act: 1) survive YAML parsing as numbers, not
    // strings — getFirstFrontmatterString only matches strings, so we
    // re-scan for the Act key with case-insensitive normalization.
    for (const [rawKey, value] of Object.entries(fm)) {
      const normalizedKey = rawKey.toLowerCase().replace(/[\s_-]/g, '');
      if (normalizedKey !== 'act') continue;
      const parsed = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
      return null;
    }
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function createModernClassicState(options?: ModernClassicStructureOptions): ModernClassicState {
  const normalizeList = (values: unknown): string[] => {
    if (!Array.isArray(values)) return [];
    return values.map(value => (typeof value === 'string' ? value : ''));
  };
  return {
    enabled: options?.enabled === true,
    currentActIndex: null,
    chapterIndex: 0,
    sceneIndexInAct: 0,
    actEpigraphs: normalizeList(options?.actEpigraphs),
    actEpigraphAttributions: normalizeList(options?.actEpigraphAttributions),
  };
}

/**
 * Apply an inclusive range to any ordered list of scenes.
 * Range is 1-based; if start/end are undefined the full list is returned.
 */
export function sliceScenesByRange(
  sceneFiles: TFile[],
  startIndex?: number,
  endIndex?: number
): TFile[] {
  if (!sceneFiles.length) return sceneFiles;

  const start = startIndex && startIndex > 0 ? startIndex : 1;
  const end = endIndex && endIndex > 0 ? endIndex : sceneFiles.length;
  const clampedStart = Math.min(Math.max(start, 1), sceneFiles.length);
  const clampedEnd = Math.min(Math.max(end, clampedStart), sceneFiles.length);

  return sceneFiles.slice(clampedStart - 1, clampedEnd);
}


/**
 * Generate a table of contents for the manuscript
 * @param scenes - Array of scene content
 * @param totalWords - Total word count
 * @param useObsidianLinks - If true, use [[#Scene Title]] format for clickable links in Obsidian
 * @param sortOrder - Description of the sort order used
 */
function generateTableOfContents(
  scenes: SceneContent[],
  totalWords: number,
  useObsidianLinks = false,
  sortOrder?: string,
  includeSceneIdInToc = false,
  sceneIdFormat: AssembleManuscriptOptions['sceneIdFormat'] = 'code'
): string {
  const tocLines: string[] = [
    '# TABLE OF CONTENTS',
    '',
    `Total Scenes: ${scenes.length} | Total Words: ${totalWords.toLocaleString()}`,
    ''
  ];

  // Add sort order note if provided
  if (sortOrder) {
    tocLines.push(`**Sort Order:** ${sortOrder}`);
    tocLines.push('');
  }

  tocLines.push('---', '');

  scenes.forEach((scene, index) => {
    const sceneNum = index + 1;
    const sceneIdSuffix = includeSceneIdInToc
      ? ` ${formatSceneIdForManuscript(scene.sceneId || '(no SceneId)', sceneIdFormat)}`
      : '';
    if (useObsidianLinks) {
      // Obsidian internal link format - clickable in reading mode
      tocLines.push(`${sceneNum}. [[#${scene.title}]] (${scene.wordCount.toLocaleString()} words)${sceneIdSuffix}`);
    } else {
      // Plain text format - better for AI processing
      tocLines.push(`${sceneNum}. ${scene.title} (${scene.wordCount.toLocaleString()} words)${sceneIdSuffix}`);
    }
  });

  tocLines.push('', '---', '', '');

  return tocLines.join('\n');
}

/**
 * Assemble full manuscript from scene files
 * @param sceneFiles - Array of TFile objects in manuscript order
 * @param vault - Obsidian vault instance
 * @param progressCallback - Optional callback for progress updates
 * @param useObsidianLinks - If true, TOC uses [[#Scene Title]] clickable links (default: false for AI processing)
 * @param sortOrder - Optional description of the sort order used
 */
export async function assembleManuscript(
  sceneFiles: TFile[],
  vault: Vault,
  progressCallback?: (sceneIndex: number, sceneTitle: string, totalScenes: number) => void,
  useObsidianLinks = false,
  sortOrder?: string,
  includeToc: boolean = true,
  bookMeta?: BookMeta | null,
  matterMetaByPath?: Map<string, MatterMeta>,
  options?: AssembleManuscriptOptions
): Promise<AssembledManuscript> {
  const scenes: SceneContent[] = [];
  const textParts: string[] = [];
  const readFailures: ManuscriptReadFailure[] = [];
  let totalWords = 0;
  const sceneHeadingMode = options?.sceneHeadingMode || 'scene-number-title';
  const sceneHeadingRenderMode = options?.sceneHeadingRenderMode || 'markdown-h2';
  const suppressMatterPageChrome = options?.suppressMatterPageChrome === true;
  const chapterMarkersByScenePath = options?.chapterMarkersByScenePath ?? {};
  const includeSceneIdInToc = options?.includeSceneIdInToc === true;
  const includeSceneIdInHeading = options?.includeSceneIdInHeading === true;
  const sceneIdFormat = options?.sceneIdFormat || 'code';
  const useRtChapterMacro = options?.useRtChapterMacro === true;
  // Chapter counter for the non-Modern-Classic + \rtChapter macro path.
  // Modern Classic tracks its own counter via modernClassicState.chapterIndex.
  let rtChapterCounter = 0;
  const matterDiagnostics: Array<{
    filePath: string;
    side: 'front' | 'back';
    prefix: number | null;
    bodyMode: MatterBodyMode;
    role?: string;
    usesBookMeta: boolean;
  }> = [];
  const modernClassicState = createModernClassicState(options?.modernClassicStructure);
  let matterChromeActive = false;

  const beginMatterPage = () => {
    if (!suppressMatterPageChrome) return;
    if (!matterChromeActive) {
      textParts.push(buildRawLatexBlock('\\clearpage\\pagestyle{empty}\\thispagestyle{empty}'));
      matterChromeActive = true;
      return;
    }
    textParts.push(buildRawLatexBlock('\\clearpage\\thispagestyle{empty}'));
  };

  const endMatterChrome = () => {
    if (!suppressMatterPageChrome || !matterChromeActive) return;
    textParts.push(buildRawLatexBlock('\\clearpage\\pagestyle{fancy}'));
    matterChromeActive = false;
  };

  const inferMatterSide = (meta?: MatterMeta): 'front' | 'back' => {
    const side = (meta?.side || '').toString().trim().toLowerCase();
    return side === 'back' || side === 'backmatter' ? 'back' : 'front';
  };

  const extractPrefix = (title: string): number | null => {
    const match = title.trim().match(/^(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // ── Pre-pass: classify each input file as matter or scene ─────────────
  // Matter classification = `Class: Frontmatter | Backmatter` in YAML, either
  // pre-resolved via `matterMetaByPath` (production path) or detected from
  // the file content here (test path / files lacking a pre-resolved entry).
  // We read content once and stash it so the emit helpers don't re-read.
  interface ClassifiedFile {
    file: TFile;
    content: string | null;          // null when read failed
    readError: unknown;
    matterMeta: MatterMeta | null;
  }
  const classified: ClassifiedFile[] = [];
  for (const file of sceneFiles) {
    let content: string | null = null;
    let readError: unknown = null;
    try {
      content = await vault.read(file);
    } catch (error) {
      readError = error;
    }
    const matterMeta = (file.path && matterMetaByPath?.get(file.path))
      || (content !== null ? extractMatterMeta(content) : null)
      || null;
    classified.push({ file, content, readError, matterMeta });
  }

  // ── Resolver-driven matter emission ──────────────────────────────────
  // Build summaries from the matter files we just classified, then ask the
  // resolver for the canonical (or user-saved) order. The resolver dedupes
  // note-vs-bookmeta-for-same-role: if a note and BookMeta both define
  // `dedication`, only the note surfaces.
  const matterClassified = classified.filter(c => c.matterMeta !== null);
  const sceneClassified = classified.filter(c => c.matterMeta === null);

  const matterSummaries: MatterNoteSummary[] = matterClassified.map(c => {
    const meta = c.matterMeta!;
    const sideRaw = (meta.side || '').toString().trim().toLowerCase();
    const side: 'frontmatter' | 'backmatter' = (sideRaw === 'back' || sideRaw === 'backmatter')
      ? 'backmatter'
      : 'frontmatter';
    return {
      role: typeof meta.role === 'string' ? meta.role : '',
      path: c.file.path,
      title: c.file.basename,
      bodyMode: normalizeMatterBodyMode(meta.bodyMode),
      side,
      ...(meta.enabled === false ? { enabled: false } : {}),
    };
  });

  const includeMatterPages = options?.includeMatterPages !== false;
  const resolved = includeMatterPages
    ? resolveBookPages(bookMeta || undefined, matterSummaries)
    : [];
  const ordered = applyBookPageOrder(resolved, options?.bookPageOrder);
  const frontPages = ordered.filter(p => p.side === 'frontmatter');
  const backPages = ordered.filter(p => p.side === 'backmatter');

  // Map matter file paths → ClassifiedFile so the note-source emit can find
  // the cached content + meta for the resolver-selected note.
  const classifiedByPath = new Map<string, ClassifiedFile>();
  for (const c of matterClassified) classifiedByPath.set(c.file.path, c);

  /**
   * Emit a single matter page. Note-source pages render the underlying
   * note's body via the existing matter-rendering paths (BookMeta-backed
   * via `UseBookMeta: true`, raw LaTeX, or plain). BookMeta-source pages
   * synthesize content from BookMeta with no underlying note (this is the
   * new path: previously BookMeta-only roles were silently dropped).
   */
  const emitMatterPage = (page: ResolvedPage): void => {
    if (page.source === 'note') {
      if (!page.path) return;
      const c = classifiedByPath.get(page.path);
      if (!c) return;
      const file = c.file;
      if (c.readError !== null && c.content === null) {
        readFailures.push({ path: file.path, error: c.readError });
        return;
      }
      const title = file.basename;
      const content = c.content || '';
      const meta = c.matterMeta!;
      beginMatterPage();
      const bodyText = extractBodyTextAfterFrontmatter(content);
      const countableBodyText = extractCountableBodyText(content);
      const bodyMode = normalizeMatterBodyMode(meta.bodyMode);
      const role = meta.role;
      const usesBookMeta = meta.usesBookMeta === true;
      const sceneFrontmatter = extractFrontmatterObject(content);
      const sceneId = readSceneId(sceneFrontmatter);
      matterDiagnostics.push({
        filePath: file.path,
        side: inferMatterSide(meta),
        prefix: extractPrefix(title),
        bodyMode,
        role,
        usesBookMeta,
      });

      const renderedFromBookMeta = (role && usesBookMeta && bookMeta)
        ? renderBookMetaBackedMatterPage(role, bookMeta, bodyText, bodyMode)
        : null;

      if (renderedFromBookMeta !== null) {
        const wordCount = countWords(countableBodyText);
        scenes.push({ title, bodyText: renderedFromBookMeta, wordCount, sceneId });
        totalWords += wordCount;
        textParts.push(`${renderedFromBookMeta}\n\n`);
      } else if (bodyMode === 'latex') {
        const renderedBody = preserveLatexMatterHardWraps(bodyText.trim());
        const wordCount = countWords(countableBodyText);
        scenes.push({ title, bodyText: renderedBody, wordCount, sceneId });
        totalWords += wordCount;
        textParts.push(`${renderedBody}\n\n`);
      } else {
        // Plain matter note → default heading + body (markdown-h2 path).
        const wordCount = countWords(countableBodyText);
        const heading = resolveSceneHeading(title, sceneHeadingMode, scenes.length + 1);
        scenes.push({ title: heading, bodyText, wordCount, sceneId });
        totalWords += wordCount;
        const headingSuffix = includeSceneIdInHeading
          ? sceneId ? ` ${formatSceneIdForManuscript(sceneId, sceneIdFormat)}` : ''
          : '';
        textParts.push(`## ${heading}${headingSuffix}\n\n${bodyText}\n\n`);
      }
      return;
    }
    // ── BookMeta-only synthetic page ────────────────────────────────────
    if (!page.role || !bookMeta) return;
    const synthesized = renderBookMetaBackedMatterPage(page.role, bookMeta, '', 'plain');
    if (synthesized === null) return;
    beginMatterPage();
    const wordCount = countWords(synthesized);
    scenes.push({ title: page.title, bodyText: synthesized, wordCount });
    totalWords += wordCount;
    textParts.push(`${synthesized}\n\n`);
    matterDiagnostics.push({
      filePath: `(bookmeta:${page.role})`,
      side: page.side === 'backmatter' ? 'back' : 'front',
      prefix: null,
      bodyMode: 'plain',
      role: page.role,
      usesBookMeta: true,
    });
  };

  // Frontmatter pages first (resolver order, with bookPageOrder applied).
  for (const page of frontPages) emitMatterPage(page);
  endMatterChrome();

  // ── Scene loop ────────────────────────────────────────────────────────
  // Original scene order is preserved (matter notes have been hoisted to
  // the resolver-driven section).
  for (let i = 0; i < sceneClassified.length; i++) {
    const c = sceneClassified[i];
    const file = c.file;
    const title = file.basename;

    if (progressCallback) {
      progressCallback(i + 1, title, sceneClassified.length);
    }

    if (c.readError !== null && c.content === null) {
      readFailures.push({ path: file.path, error: c.readError });
      continue;
    }

    const content = c.content || '';
    const bodyText = extractBodyText(content);
    const countableBodyText = extractCountableBodyText(content);
    const sceneFrontmatter = extractFrontmatterObject(content);
    const sceneId = readSceneId(sceneFrontmatter);
    const wordCount = countWords(countableBodyText);

    if (modernClassicState.enabled) {
      // RT terminology → structure mapping:
      //   Acts (from each scene's `Act:` frontmatter field, the canonical
      //         source that also drives the timeline ring partitions)
      //                                    → \rtPart{Roman}{quote}{attr} — Part page
      //   Chapters (from Chapter fields)   → \rtChapter{n}{Title} — chapter opener
      //   Scenes (scene notes)             → \rtSceneSep{roman} — scene opener
      const nextActIndex = extractSceneActIndex(content);
      if (typeof nextActIndex === 'number' && nextActIndex > 0 && nextActIndex !== modernClassicState.currentActIndex) {
        const actRoman = toRomanNumeral(nextActIndex);
        if (actRoman) {
          const epigraphQuote = sanitizeModernClassicEpigraphArg(modernClassicState.actEpigraphs[nextActIndex - 1] || '');
          const epigraphAttribution = sanitizeModernClassicAttributionArg(modernClassicState.actEpigraphAttributions[nextActIndex - 1] || '');
          textParts.push(buildRawLatexBlock(`\\rtPart{${actRoman}}{${epigraphQuote}}{${epigraphAttribution}}`));
          modernClassicState.currentActIndex = nextActIndex;
          modernClassicState.sceneIndexInAct = 0;
        }
      }

      const chapterMarkers = file.path ? (chapterMarkersByScenePath[file.path] || []) : [];
      if (chapterMarkers.length > 0) {
        for (const marker of chapterMarkers) {
          const chapterTitle = sanitizeModernClassicMacroArg(marker.title);
          if (!chapterTitle) continue;
          modernClassicState.chapterIndex += 1;
          textParts.push(buildRawLatexBlock(`\\rtChapter{${modernClassicState.chapterIndex}}{${chapterTitle}}`));
        }
      }

      modernClassicState.sceneIndexInAct += 1;
      const sceneRoman = toRomanNumeral(modernClassicState.sceneIndexInAct).toLowerCase();
      textParts.push(buildRawLatexBlock(`\\rtSceneSep{${sceneRoman}}`));

      scenes.push({ title, bodyText, wordCount, sceneId, sourcePath: file.path });
      totalWords += wordCount;
      textParts.push(`${bodyText}\n\n`);
    } else {
      const chapterMarkers = file.path ? (chapterMarkersByScenePath[file.path] || []) : [];
      for (const marker of chapterMarkers) {
        if (useRtChapterMacro) {
          // Emit \rtChapter{N}{Title} so the layout's template macro owns the
          // chapter page typography (cleardoublepage, chrome suppression,
          // centered title, page-number arabic switch). Without this branch
          // the chapter falls through to pandoc's default \chapter{} via the
          // book class, which produces left-aligned "Chapter N" + "Shail +
          // Trisan" header + roman page numbers because \rtBeginMainArabic
          // never runs and \thispagestyle{rtEmpty} never applies.
          const chapterTitle = sanitizeModernClassicMacroArg(marker.title);
          if (!chapterTitle) continue;
          rtChapterCounter += 1;
          textParts.push(buildRawLatexBlock(`\\rtChapter{${rtChapterCounter}}{${chapterTitle}}`));
        } else {
          const chapterTitle = normalizeChapterHeadingText(marker.title);
          if (!chapterTitle) continue;
          textParts.push(`# ${chapterTitle}\n\n`);
        }
      }

      const publishTitle = resolveSceneTitleForPublishing(title, sceneFrontmatter);
      const heading = resolveSceneHeading(publishTitle, sceneHeadingMode, i + 1);
      scenes.push({ title: heading, bodyText, wordCount, sceneId, sourcePath: file.path });
      totalWords += wordCount;

      if (sceneHeadingRenderMode === 'latex-section-starred') {
        const latexHeading = resolveLatexSceneHeading(publishTitle, sceneHeadingMode, i + 1);
        const latexRunningMark = resolveLatexSceneRunningMark(publishTitle, i + 1);
        // Emit a single \rtSceneOpener{HEADING} call. The opener macro
        // (defined by the layout's .tex; see designedStyleFragments
        // renderSceneOpener) owns the cleardoublepage, chrome suppression,
        // vertical spacing, and centered title typography — so the
        // assembler does not pre-bake \section* or \thispagestyle{empty}.
        //
        // Signature Literary's openerHeadingModes path overrides this
        // macro to emit \section{N} or \section*{Title} via titlesec hooks.
        // The .tex generator decides which form to define; the assembler
        // contract surface is always \rtSceneOpener.
        textParts.push(`\\rtSceneOpener{${latexHeading}}\n\\rtSetSceneRunningTitle{${latexRunningMark}}\n\n${bodyText}\n\n`);
      } else {
        const headingSuffix = includeSceneIdInHeading
          ? sceneId ? ` ${formatSceneIdForManuscript(sceneId, sceneIdFormat)}` : ''
          : '';
        textParts.push(`## ${heading}${headingSuffix}\n\n${bodyText}\n\n`);
      }
    }
  }

  // Backmatter pages last (resolver order, with bookPageOrder applied).
  for (const page of backPages) emitMatterPage(page);
  endMatterChrome();

  // Generate TOC and prepend to manuscript
  const toc = includeToc ? generateTableOfContents(scenes, totalWords, useObsidianLinks, sortOrder, includeSceneIdInToc, sceneIdFormat) : '';
  const manuscriptText = toc + textParts.join('');

  return {
    text: manuscriptText,
    totalWords,
    totalScenes: sceneFiles.length,
    scenes,
    sortOrder,
    readFailures
  };
}

/**
 * Update the Words field in scene YAML frontmatter for each processed scene
 * @param app - Obsidian App instance
 * @param sceneFiles - Array of TFile objects that were processed
 * @param scenes - Array of SceneContent with word counts
 * @returns Number of files successfully updated
 */
export async function updateSceneWordCounts(
  app: App,
  sceneFiles: TFile[],
  scenes: SceneContent[]
): Promise<number> {
  let updatedCount = 0;
  const scenesByPath = new Map<string, SceneContent>();
  for (const scene of scenes) {
    if (scene.sourcePath) scenesByPath.set(scene.sourcePath, scene);
  }
  const hasPathMetadata = scenesByPath.size > 0;

  for (let i = 0; i < sceneFiles.length; i++) {
    const file = sceneFiles[i];

    if (!file) continue;

    try {
      let didUpdate = false;
      await app.fileManager.processFrontMatter(file, (fm) => {
        const fmObj = fm as Record<string, unknown>;
        const rawClass = fmObj['Class'] ?? fmObj['class'];
        const classValue = typeof rawClass === 'string' ? rawClass.trim().toLowerCase() : '';
        const wordsKey = Object.keys(fmObj).find(key => key.toLowerCase() === 'words') ?? 'Words';

        // Only scene notes should receive word-count writes.
        if (classValue && classValue !== 'scene') return;

        const scene = hasPathMetadata
          ? scenesByPath.get(file.path)
          : scenes[i];
        if (!scene) return;

        fmObj[wordsKey] = scene.wordCount;
        didUpdate = true;
      });
      if (didUpdate) updatedCount++;
    } catch (error) {
      console.error(`[updateSceneWordCounts] Error updating ${file.path}:`, error);
    }
  }

  return updatedCount;
}
