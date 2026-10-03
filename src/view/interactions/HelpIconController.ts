/*
 * Radial Timeline Plugin for Obsidian — Help Icon Controller
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Community help hub: every help route (Guide, Requests, bug form, known issues) on one page.
 * Routed through the counted redirector; the `rt-help` slug in the Community repo's
 * lib/go-links.json owns the destination (/help).
 */
const HELP_URL = 'https://community.radialtimeline.com/go/rt-help';

interface HelpIconView {
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
}

/**
 * Setup click handlers for the help icon
 * - Opens the Community help hub
 */
export function setupHelpIconController(view: HelpIconView, svg: SVGSVGElement): void {
    const helpIcon = svg.querySelector('#help-icon');
    if (!helpIcon) return;

    // Find the icon hit area
    const hitArea = helpIcon.querySelector('.rt-help-icon-hitarea');
    
    // Handler function
    const openHelp = (ev: Event) => {
        ev.stopPropagation();
        window.open(HELP_URL, '_blank');
    };

    // Handle click on icon area
    if (hitArea) {
        view.renderScope.registerDomEvent(hitArea as unknown as HTMLElement, 'click', openHelp);
    }

    // Also handle click on the icon group itself
    const iconGroup = helpIcon.querySelector('g');
    if (iconGroup) {
        view.renderScope.registerDomEvent(iconGroup as unknown as HTMLElement, 'click', openHelp);
    }
    
    // Set cursor to pointer
    helpIcon.classList.add('ert-cursor-pointer');
}
