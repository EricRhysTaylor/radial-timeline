/*
 * Radial Timeline Plugin for Obsidian — Help Icon Controller
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

const WIKI_URL = 'https://github.com/EricRhysTaylor/radial-timeline/wiki';

interface HelpIconView {
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
}

/**
 * Setup click handlers for the help icon
 * - Opens the GitHub Wiki
 */
export function setupHelpIconController(view: HelpIconView, svg: SVGSVGElement): void {
    const helpIcon = svg.querySelector('#help-icon');
    if (!helpIcon) return;

    // Find the icon hit area
    const hitArea = helpIcon.querySelector('.rt-help-icon-hitarea');
    
    // Handler function
    const openWiki = (ev: Event) => {
        ev.stopPropagation();
        window.open(WIKI_URL, '_blank');
    };

    // Handle click on icon area
    if (hitArea) {
        view.renderScope.registerDomEvent(hitArea as unknown as HTMLElement, 'click', openWiki);
    }

    // Also handle click on the icon group itself
    const iconGroup = helpIcon.querySelector('g');
    if (iconGroup) {
        view.renderScope.registerDomEvent(iconGroup as unknown as HTMLElement, 'click', openWiki);
    }
    
    // Set cursor to pointer
    helpIcon.classList.add('ert-cursor-pointer');
}
