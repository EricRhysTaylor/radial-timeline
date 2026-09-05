/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { normalizePath } from 'obsidian';

/**
 * Sanitize a vault-relative source path using Obsidian's normalizePath.
 */
export function sanitizeSourcePath(sourcePath: string | undefined | null): string {
  const p = (sourcePath || '').trim();
  return p ? normalizePath(p) : '';
}

/**
 * Build an initial scene filename for new note creation.
 * Returns just the filename (not the full path).
 */
export function buildInitialSceneFilename(baseName: string = '1 Test Scene.md'): string {
  return baseName;
}

/**
 * Build an initial backdrop filename for new note creation.
 * Returns just the filename (not the full path).
 */
export function buildInitialBackdropFilename(baseName: string = '1 Backdrop.md'): string {
  return baseName;
}


