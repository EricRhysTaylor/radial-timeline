/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { App, AbstractInputSuggest, setIcon, getIconIds } from 'obsidian';

/**
 * IconSuggest provides autocomplete suggestions for Lucide icon names
 * with icon previews displayed beside each suggestion.
 */
export class IconSuggest extends AbstractInputSuggest<string> {
    private iconIds: string[];
    private onSelectCallback: (iconName: string) => void;

    constructor(app: App, inputEl: HTMLInputElement, onSelectCallback: (iconName: string) => void) {
        super(app, inputEl);
        this.iconIds = getIconIds();
        this.onSelectCallback = onSelectCallback;
    }

    getSuggestions(query: string): string[] {
        const q = query?.toLowerCase().trim() ?? '';
        if (!q) {
            // Return a subset of common icons when no query
            return this.iconIds.slice(0, 50);
        }
        // Filter icons that contain the query string
        return this.iconIds
            .filter(id => id.toLowerCase().includes(q))
            .slice(0, 50); // Limit results for performance
    }

    renderSuggestion(iconId: string, el: HTMLElement): void {
        el.addClass('ert-ui', 'ert-scope--settings', 'ert-icon-suggestion');
        
        // Create icon preview
        const iconPreview = el.createSpan({ cls: 'ert-icon-suggestion-preview' });
        setIcon(iconPreview, iconId);
        
        // Create text label
        el.createSpan({ text: iconId, cls: 'ert-icon-suggestion-text' });
    }

    selectSuggestion(iconId: string, _evt: MouseEvent | KeyboardEvent): void {
        this.onSelectCallback(iconId);
        this.close();
    }
}
