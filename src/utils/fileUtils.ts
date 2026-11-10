/*
 * File utilities for opening and managing files
 * 
 * Uses Obsidian's recommended workspace.openLinkText() method which:
 * - Automatically checks if file is already open
 * - Reveals existing tab if found
 * - Opens in new tab if not found
 * - Handles PaneType configuration properly
 */

import { App, TFile, MarkdownView } from 'obsidian';
import { EditorView } from '@codemirror/view';

/**
 * Text to flash-highlight in the opened file — the same ephemeral state
 * Obsidian core search uses when you click one of its results.
 */
export interface OpenMatchHighlight {
  /** Full raw file content: Obsidian resolves `matches` as offsets into this. */
  content: string;
  /** `[start, end)` character ranges to mark. */
  matches: Array<[number, number]>;
}

/**
 * Bring the first highlighted match to the middle of the editor once the note is showing.
 *
 * Obsidian marks the match but doesn't scroll to it when the note shows a long Properties block (core search
 * fails the same way), and `Editor.scrollIntoView` does nothing there either. Measuring the match and scrolling
 * the editor to it does work (Obsidian 1.15, 2026-11-09). A far match isn't drawn yet, so the first pass uses the
 * line's estimated height, and the next pass measures it exactly. Reading view keeps Obsidian's own behavior.
 */
export async function revealHighlight(app: App, file: TFile, highlight: OpenMatchHighlight): Promise<void> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.file?.path !== file.path || view.getMode() !== 'source' || !highlight.matches.length) return;
  const host = view.contentEl.querySelector('.cm-editor');
  const cm = host instanceof HTMLElement ? EditorView.findFromDOM(host) : null;
  if (!cm) return;
  const win = cm.dom.ownerDocument.defaultView;
  if (!win) return;
  const settle = () => new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
  const at = highlight.matches[0][0];
  for (let pass = 0; pass < 3; pass++) {
    await settle();
    const box = cm.scrollDOM.getBoundingClientRect();
    const drawn = cm.coordsAtPos(at);
    const top = drawn ? drawn.top : cm.documentTop + cm.lineBlockAt(at).top;
    const offCenter = top - (box.top + box.height / 2);
    if (drawn && Math.abs(offCenter) < box.height / 4) return;
    view.editor.scrollTo(null, Math.max(0, view.editor.getScrollInfo().top + offCenter));
  }
}

/**
 * Opens a file in the workspace using Obsidian's recommended approach.
 * Uses workspace.openLinkText() which automatically handles duplicate tab prevention.
 *
 * @param app - The Obsidian App instance
 * @param file - The file to open
 * @param newLeaf - Whether to open in a new leaf. Default false (reuse existing tab).
 * @param highlight - Optional text to flash-highlight once the file is showing.
 * @returns Promise that resolves when the file is opened/revealed
 */
export async function openOrRevealFile(
  app: App,
  file: TFile,
  newLeaf: boolean = false,
  highlight?: OpenMatchHighlight
): Promise<void> {
  const eState = highlight ? { match: highlight } : undefined;

  // Check if file is already open
  const leaves = app.workspace.getLeavesOfType('markdown');
  const existingLeaf = leaves.find(leaf => {
    const view = leaf.view;
    return view instanceof MarkdownView && view.file?.path === file.path;
  });

  if (existingLeaf) {
    // Re-open through the leaf rather than just activating it: setActiveLeaf
    // alone carries no ephemeral state, so a highlight would silently do
    // nothing in the common case where the scene is already open.
    if (eState) {
      await existingLeaf.openFile(file, { active: true, eState }); // SAFE: openFile used to carry search-highlight state that openLinkText cannot pass to an already-open leaf
    }
    app.workspace.setActiveLeaf(existingLeaf);
    if (highlight) await revealHighlight(app, file, highlight);
    return;
  }

  // Use Obsidian's openLinkText which handles duplicate tab prevention automatically
  // Pass the file path as linktext and sourcePath (can be empty string for absolute paths)
  await app.workspace.openLinkText(file.path, '', newLeaf, eState ? { eState } : undefined);
  if (highlight) await revealHighlight(app, file, highlight);
}

/**
 * Opens/reveals a file at a heading/block subpath without spawning duplicate tabs.
 *
 * @param app - The Obsidian App instance
 * @param file - The file to open
 * @param subpath - A subpath starting with '#' (e.g. '#Heading' or '#^block-id')
 * @param newLeaf - Whether to open in a new leaf when file is not already open
 */
export async function openOrRevealFileAtSubpath(
  app: App,
  file: TFile,
  subpath: string,
  newLeaf: boolean = false
): Promise<void> {
  const normalizedSubpath = subpath.startsWith('#') ? subpath : `#${subpath}`;
  const leaves = app.workspace.getLeavesOfType('markdown');
  const existingLeaf = leaves.find(leaf => {
    const view = leaf.view;
    return view instanceof MarkdownView && view.file?.path === file.path;
  });

  if (existingLeaf) {
    await existingLeaf.openFile(file, { active: true, eState: { subpath: normalizedSubpath } });
    app.workspace.setActiveLeaf(existingLeaf);
    return;
  }

  await app.workspace.openLinkText(`${file.path}${normalizedSubpath}`, file.path, newLeaf);
}

/**
 * Opens a file by path using Obsidian's recommended approach.
 * 
 * @param app - The Obsidian App instance
 * @param filePath - The path to the file to open
 * @param newLeaf - Whether to open in a new leaf. Default false (reuse existing tab).
 * @returns Promise that resolves when the file is opened/revealed
 */
export async function openOrRevealFileByPath(app: App, filePath: string, newLeaf: boolean = false): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  
  if (!(file instanceof TFile)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  await openOrRevealFile(app, file, newLeaf);
}
