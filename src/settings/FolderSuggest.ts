/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { App, AbstractInputSuggest, TFolder, TextComponent, normalizePath } from 'obsidian';
import RadialTimelinePlugin from '../main';

/**
 * FolderSuggest encapsulates folder suggestions for the source path setting.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private plugin: RadialTimelinePlugin;
  private text: TextComponent;

  constructor(app: App, input: HTMLInputElement, plugin: RadialTimelinePlugin, text: TextComponent) {
    super(app, input);
    this.plugin = plugin;
    this.text = text;
  }

  getSuggestions(query: string): TFolder[] {
    const q = query?.toLowerCase() ?? '';
    const folders = this.app.vault.getAllFolders();
    if (!q) return folders;
    return folders.filter(f => f.path.toLowerCase().includes(q));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    const inputEl = this.text.inputEl;
    // Update the text field immediately for user feedback
    const normalized = normalizePath(folder.path);
    this.text.setValue(normalized);

    // Validate and remember; only save the setting once on success
    void this.plugin.validateAndRememberPath(normalized).then(async (ok) => {
      if (ok) {
        // SAFE: normalized is from normalizePath() above
        this.plugin.settings.sourcePath = normalized;
        await this.plugin.saveSettings();
        inputEl.removeClass('setting-input-error');
        inputEl.addClass('setting-input-success');
        window.setTimeout(() => inputEl.removeClass('setting-input-success'), 1000);
      } else {
        inputEl.addClass('setting-input-error');
        window.setTimeout(() => inputEl.removeClass('setting-input-error'), 2000);
      }
      // Close suggestions and focus input
      this.close();
      inputEl.focus();
    });
  }
}

/**
 * ModalFolderSuggest provides folder autocomplete for use inside modals.
 * Unlike FolderSuggest, it does NOT write to settings.sourcePath.
 * Instead it invokes an onSelect callback with the chosen folder path,
 * letting the caller store the value locally.
 */
export class ModalFolderSuggest extends AbstractInputSuggest<TFolder> {
  private onChoose: (path: string) => void;
  private inputRef: HTMLInputElement;

  constructor(app: App, input: HTMLInputElement, onChoose: (path: string) => void) {
    super(app, input);
    this.inputRef = input;
    this.onChoose = onChoose;
  }

  getSuggestions(query: string): TFolder[] {
    const q = query?.toLowerCase() ?? '';
    const folders = this.app.vault.getAllFolders();
    if (!q) return folders;
    return folders.filter(f => f.path.toLowerCase().includes(q));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    const normalized = normalizePath(folder.path);
    this.inputRef.value = normalized;
    this.onChoose(normalized);
    this.close();
    this.inputRef.focus();
  }
}


