/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Multi-window document enumeration.
 *
 * Obsidian can host views in popout windows, each with its own Document.
 * Services that bind to a document (CSS variables, document-level listeners,
 * MutationObservers) must cover every open window — not just the one that
 * happened to be active at plugin load. This module is the single source of
 * truth for "every document the workspace renders into".
 */

import type { Plugin, Workspace } from 'obsidian';

/** The main window's document plus every open popout window's document. */
export function getOpenDocuments(workspace: Workspace): Document[] {
    // rootSplit is null until Obsidian builds the workspace layout — plugins
    // load before that. Calling this earlier is a contract violation; fail
    // loudly instead of letting `.doc` throw a cryptic TypeError mid-onload.
    if (!workspace.rootSplit) {
        throw new Error('getOpenDocuments() requires the workspace layout; call it after onLayoutReady');
    }
    const docs = new Set<Document>([workspace.rootSplit.doc]);
    workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
    return [...docs];
}

/**
 * Run `bind` once per open document — when the workspace layout is ready, and
 * again for each popout window opened later. Safe to call during plugin
 * onload: enumeration waits for onLayoutReady (which fires immediately if the
 * layout already exists). For one-shot per-document setup (listeners,
 * observers); subscriptions are cleaned up by the plugin lifecycle.
 */
export function bindToAllDocuments(plugin: Plugin, bind: (doc: Document) => void): void {
    const bound = new Set<Document>();
    const bindOnce = (doc: Document) => {
        if (bound.has(doc)) return;
        bound.add(doc);
        bind(doc);
    };
    plugin.app.workspace.onLayoutReady(() => getOpenDocuments(plugin.app.workspace).forEach(bindOnce));
    plugin.registerEvent(plugin.app.workspace.on('window-open', (win) => bindOnce(win.doc)));
}
