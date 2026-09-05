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
    return;
  }

  // Use Obsidian's openLinkText which handles duplicate tab prevention automatically
  // Pass the file path as linktext and sourcePath (can be empty string for absolute paths)
  await app.workspace.openLinkText(file.path, '', newLeaf, eState ? { eState } : undefined);
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
