/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem } from '../../types';
import type { RadialTimelineSettings } from '../../types/settings';
// Value import used only inside event handlers (call-time), so the
// TimeLineView <-> controller cycle stays inert at module init.
import { RadialTimelineView } from '../TimeLineView';
import { getActivePlanetaryProfile, validatePlanetaryProfile, convertFromEarth, formatElapsedTimePlanetary, formatPlanetaryDateAdaptive } from '../../utils/planetaryTime';
import { parseWhenField, formatElapsedTime } from '../../utils/date';
import { t } from '../../i18n';
import {
    CHRONOLOGUE_BOUNDARY_LINE_SPACING,
    SHIFT_BUTTON_POS_X,
    SHIFT_BUTTON_POS_Y
} from '../../renderer/layout/LayoutConstants';
import {
    buildSceneNumberLookup,
    drawComparisonArc,
    removeComparisonArc,
    removeSceneHighlights,
    resetComparisonStates,
    sceneIdOfGroup,
    setNumberSquareActive,
    updateSceneSelection
} from './sceneComparison';

// Scaling applied on click/activation
const BUTTON_ACTIVE_SCALE = 1.2;

// Saved Earth-label tspan structures, captured before the planetary calendar rewrites a
// textPath and replayed on restore. Keyed by the live textPath element so entries
// vanish with the DOM they describe.
const savedEarthLabelNodes = new WeakMap<Element, Node[]>();

function saveEarthLabelNodes(textPath: Element): void {
    if (!savedEarthLabelNodes.has(textPath)) {
        savedEarthLabelNodes.set(textPath, Array.from(textPath.childNodes, node => node.cloneNode(true)));
    }
}

function restoreEarthLabelNodes(textPath: Element): boolean {
    const nodes = savedEarthLabelNodes.get(textPath);
    if (!nodes) return false;
    while (textPath.firstChild) textPath.removeChild(textPath.firstChild);
    nodes.forEach(node => textPath.appendChild(node.cloneNode(true)));
    return true;
}

interface SceneGeometryInfo {
    startAngle: number;
    ring: number;
}

/**
 * Setup Chronologue Shift Mode Controller
 * Handles the Shift and Alt keycaps and two-scene selection for elapsed time comparison
 */
export function setupChronologueShiftController(view: RadialTimelineView, svg: SVGSVGElement): void {
    // Only available in Chronologue mode
    if (view.currentMode !== 'chronologue') {
        return;
    }

    // Resolve the document owning this SVG so popout windows work correctly
    const doc = svg.ownerDocument;

    const mode = view.chronologueState;
    let selectedScenes: TimelineItem[] = []; // Locked scenes (stay selected)
    let elapsedTimeClickCount = 0;

    // Observes the keycap buttons' active class so the header sub-nav mirrors
    // sub-mode state no matter how it was toggled (keyboard, keycap, or chip).
    let subNavObserver: MutationObserver | null = null;

    const sceneGeometry = new Map<string, SceneGeometryInfo>(); // Map scene path (encoded) to outer ring geometry

    // Number squares, their text and subplot slots, indexed once per render
    const numberLookup = buildSceneNumberLookup(svg);

    // Cache synopsis elements for fast lookup (avoiding querySelectorAll on every hover)
    const allSynopsisElements: Element[] = Array.from(svg.querySelectorAll('.rt-scene-info'));

    // Cache scene ID lookups for fast access
    const sceneIdCache = new WeakMap<Element, string>();
    const getSceneIdFromGroup = (group: Element): string | null => {
        const cached = sceneIdCache.get(group);
        if (cached) return cached;
        const sceneId = sceneIdOfGroup(group);
        if (sceneId) {
            sceneIdCache.set(group, sceneId);
        }
        return sceneId;
    };

    // Extract scene start angles from SVG data attributes
    // Each scene group has data-start-angle attribute set during rendering
    const sceneGroups = Array.from(svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"]'));

    sceneGroups.forEach((group) => {
        const scenePath = group.getAttribute('data-path'); // Already URL-encoded
        if (!scenePath) return;

        const ringAttr = group.getAttribute('data-ring');
        const ringIndex = ringAttr ? parseInt(ringAttr, 10) : 0;

        const startAngleAttr = group.getAttribute('data-start-angle');
        const angle = startAngleAttr ? parseFloat(startAngleAttr) : NaN;

        if (isNaN(angle)) return;

        const existing = sceneGeometry.get(scenePath);
        if (!existing || ringIndex > existing.ring) {
            sceneGeometry.set(scenePath, { startAngle: angle, ring: ringIndex });
        }
    });

    // Create shift button (top-left quadrant)
    // Create buttons logic (Shift is always created, ALT is conditional)
    const shiftButton = createShiftButton();
    svg.appendChild(shiftButton);

    let altButton: SVGGElement | null = null;

    // Check if Planetary Time is enabled and active profile is valid
    const activeProfile = getActivePlanetaryProfile(view.plugin.settings);
    const isProfileValid = activeProfile ? validatePlanetaryProfile(activeProfile).ok : false;
    const shouldShowAlt = isProfileValid;

    if (shouldShowAlt) {
        altButton = createAltButton();
        svg.appendChild(altButton);
    }

    const persistChronologueCalendarView = (calendarView: 'earth' | 'planetary') => {
        const settings = view.plugin.settings;
        if (!settings || settings.chronologueLastCalendarView === calendarView) return;
        settings.chronologueLastCalendarView = calendarView;
        void view.plugin.saveSettings();
    };

    const shouldStartInPlanetaryCalendar = (): boolean => {
        if (!shouldShowAlt) return false;
        const settings = view.plugin.settings;
        const configuredDefault = settings?.chronologueCalendarDefault ?? 'earth';
        if (configuredDefault === 'planetary') return true;
        return configuredDefault === 'remember' && settings?.chronologueLastCalendarView === 'planetary';
    };

    // Function to deactivate alien mode
    const deactivateAlienMode = () => {
        if (!altButton && !mode.alien) return;
        mode.alien = false;
        if (altButton) updateAltButtonState(altButton, false);
        updateDateLabelsForAlienMode(false);
        persistChronologueCalendarView('earth');
        
        // Clear selected scenes and elapsed time arc (same as shift mode)
        selectedScenes = [];
        rebuildSelectedPathsSet();
        elapsedTimeClickCount = 0;
        removeComparisonArc(svg);
        removeSceneHighlights(svg);
        svg.classList.remove('rt-shift-scene-hover');
        svg.classList.remove('rt-global-fade');

        // Clear data attribute if no other mode is active
        if (!mode.shift) {
            svg.removeAttribute('data-shift-mode');
        }
    };

    const activateShiftMode = (enableAlien: boolean = false) => {
        if (!mode.shift) {
            mode.shift = true;
            updateShiftButtonState(shiftButton, true);
        }

        // If Alt/Alien was latched, clicking Shift should replace it
        if (!enableAlien && mode.alien) {
            deactivateAlienMode();
        }

        // Handle Alien Logic overlap
        if (enableAlien && altButton) {
            if (!mode.alien) {
                mode.alien = true;
                updateAltButtonState(altButton, true);
            }
        } else {
            // Standard Shift activation (Alien might be on or off, usually off unless locked? 
            // Logic: If we just activate Shift (key/button), should we kill Alien? 
            // If dragging shift, we want normal. If ALT is locked, we want Alien.
            // Let's say explicit Shift activation (key) doesn't force Alien unless Alt is held.
        }

        // Visual Updates
        const modeAttr = mode.alien ? 'alien' : 'active';
        svg.setAttribute('data-shift-mode', modeAttr);
        persistChronologueCalendarView(mode.alien ? 'planetary' : 'earth');
        
        // Update date labels for alien mode
        if (mode.alien) {
            updateDateLabelsForAlienMode(true);
        }

        // Make all scenes non-select (gray) - CSS handles this automatically
        resetComparisonStates(svg);
        // Hide all synopsis elements in shift mode using cached array
        allSynopsisElements.forEach(syn => {
            if (syn.classList.contains('rt-visible')) {
                syn.classList.remove('rt-visible');
            }
        });

        // Check if there's a currently hovered scene and apply shift styling to it
        const hoveredGroups = svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"]:hover');
        if (hoveredGroups.length > 0) {
            const hoveredGroup = hoveredGroups[0];
            const scenePathEncoded = hoveredGroup.getAttribute('data-path');
            if (scenePathEncoded) {
                hoveredGroup.classList.add('rt-shift-hover');
                // Activate matching number square with subplot color
                const sid = getSceneIdFromGroup(hoveredGroup);
                setNumberSquareActive(sid, true, numberLookup);
            }
        }
    };

    // Function to deactivate shift mode
    const deactivateShiftMode = () => {
        if (mode.shift) {
            mode.shift = false;
            updateShiftButtonState(shiftButton, false);

            // Also kill Alien Mode
            mode.alien = false;
            if (altButton) updateAltButtonState(altButton, false);
            
            // Restore Earth labels
            updateDateLabelsForAlienMode(false);
            persistChronologueCalendarView('earth');

            selectedScenes = [];
            rebuildSelectedPathsSet(); // Rebuild Set after clearing
            elapsedTimeClickCount = 0;
            removeComparisonArc(svg);
            removeSceneHighlights(svg);
            // Remove shift mode marker (also hides discontinuity markers via CSS)
            svg.removeAttribute('data-shift-mode');
            svg.classList.remove('rt-shift-scene-hover');
            svg.classList.remove('rt-global-fade');

            // Clear all regular Chronologue hover states (from normal mode)
            // This ensures we return to a clean state with no highlights
            svg.querySelectorAll('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title, .rt-discontinuity-marker').forEach(el => {
                el.classList.remove('rt-selected', 'rt-non-selected');
            });

            // Hide all synopses
            svg.querySelectorAll('.rt-scene-info.rt-visible').forEach(syn => {
                syn.classList.remove('rt-visible');
            });

            // Remove scene-hover class from SVG if present
            svg.classList.remove('scene-hover');
        }
    };

    // Update all date labels around the chronologue perimeter for alien mode (planetary time)
    const updateDateLabelsForAlienMode = (enableAlien: boolean) => {
        const dateLabels = svg.querySelectorAll('.rt-month-label-outer[data-earth-date]');
        const profile = getActivePlanetaryProfile(view.plugin.settings);

        const includeTimeInLabel = (earthLabel: string): boolean =>
            /(\d{1,2}:\d{2}\s*(am|pm)?|noon|midnight)/i.test(earthLabel);
        const padTime = (value: number): string => String(Math.max(0, value)).padStart(2, '0');

        dateLabels.forEach(label => {
            const textPath = label.querySelector('textPath');
            if (!textPath) return;

            if (enableAlien && profile) {
                const earthDateStr = label.getAttribute('data-earth-date');
                if (!earthDateStr) return;

                // Store original Earth label if not already stored
                if (!label.getAttribute('data-earth-label')) {
                    const tspans = textPath.querySelectorAll('tspan');
                    if (tspans.length > 0) {
                        const lines = Array.from(tspans).map(span => span.textContent || '');
                        label.setAttribute('data-earth-label', lines.join('\n'));
                    } else {
                        label.setAttribute('data-earth-label', textPath.textContent || '');
                    }
                }
                saveEarthLabelNodes(textPath);

                const earthLabel = label.getAttribute('data-earth-label') || '';
                const earthDate = new Date(earthDateStr);
                const conversion = convertFromEarth(earthDate, profile);
                if (conversion) {
                    const monthName = profile.monthNames?.[conversion.localMonthIndex] || String(conversion.localMonthIndex + 1);
                    const isBoundary = label.classList.contains('rt-date-boundary');

                    if (isBoundary) {
                        // Boundary labels keep their multi-line layout
                        // Uses a cleaner adaptive format for boundaries too
                        // Use the same two-line extent as Earth boundaries. A
                        // four-line label either hits the scene title or clips
                        // above the SVG when moved outside the ring.
                        const yearLabel = profile.epochLabel
                            ? t('ui.chronologueShiftController.epochYear', { epoch: profile.epochLabel, year: conversion.localYear })
                            : t('ui.chronologueShiftController.year', { year: conversion.localYear });
                        let dateLabel = `${monthName} ${conversion.localDayOfMonth}`;
                        if (includeTimeInLabel(earthLabel)) {
                            dateLabel += ` ${padTime(conversion.localHours)}:${padTime(conversion.localMinutes)}`;
                        }
                        const alienLines = [yearLabel, dateLabel];

                        while (textPath.firstChild) textPath.removeChild(textPath.firstChild);
                        alienLines.forEach((line, i) => {
                            const tspan = doc.win.createSvg('tspan');
                            tspan.setAttribute('x', '0');
                            tspan.setAttribute('dy', i === 0 ? '0' : CHRONOLOGUE_BOUNDARY_LINE_SPACING);
                            tspan.textContent = line;
                            textPath.appendChild(tspan);
                        });
                    } else {
                        // Regular perimeter ticks use the new adaptive short format
                        const alienText = formatPlanetaryDateAdaptive(conversion, earthLabel);
                        
                        while (textPath.firstChild) textPath.removeChild(textPath.firstChild);
                        textPath.textContent = alienText;
                    }
                }
            } else {
                // Restore Earth label
                const earthLabel = label.getAttribute('data-earth-label');
                if (!restoreEarthLabelNodes(textPath) && earthLabel) {
                    while (textPath.firstChild) textPath.removeChild(textPath.firstChild);
                    if (earthLabel.includes('\n')) {
                        earthLabel.split('\n').forEach((line, i) => {
                            const tspan = doc.win.createSvg('tspan');
                            tspan.setAttribute('x', '0');
                            tspan.setAttribute('dy', i === 0 ? '0' : CHRONOLOGUE_BOUNDARY_LINE_SPACING);
                            tspan.textContent = line;
                            textPath.appendChild(tspan);
                        });
                    } else {
                        textPath.textContent = earthLabel;
                    }
                }
            }
        });
    };

    const toggleAlienMode = () => {
        if (!altButton) return; // Guard clause

        if (mode.alien) {
            // Turn OFF Alien Mode
            deactivateAlienMode();
            return;
        }

        // Turn ON Alien Mode (exclusive)
        if (mode.shift) deactivateShiftMode();
        mode.shift = false;

        mode.alien = true;
        updateAltButtonState(altButton, true);
        svg.setAttribute('data-shift-mode', 'alien');
        updateDateLabelsForAlienMode(true);
        persistChronologueCalendarView('planetary');
    };

    // Register shift button click handler
    view.renderScope.registerDomEvent(shiftButton as unknown as HTMLElement, 'click', (e: MouseEvent) => {
        e.stopPropagation();
        if (mode.shift) {
            deactivateShiftMode();
        } else {
            activateShiftMode(false); // Normal shift
        }
    });

    // Register ALT button click handler
    if (altButton) {
        view.renderScope.registerDomEvent(altButton as unknown as HTMLElement, 'click', (e: MouseEvent) => {
            e.stopPropagation();
            toggleAlienMode();
        });
    }

    let capsLockState = false;
    let pendingCapsLockSync = false;

    const syncShiftModeToCapsLock = (isActive: boolean) => {
        if (capsLockState === isActive) {
            return;
        }
        capsLockState = isActive;
        if (isActive) {
            if (!mode.shift) {
                activateShiftMode();
            }
        } else {
            if (mode.shift) deactivateShiftMode();
        }
    };

    // Keyboard event handlers for Shift and Caps Lock
    const handleKeyDown = (e: KeyboardEvent) => {
        // Only handle when radial timeline is active and in chronologue mode
                const activeView = view.app.workspace.getActiveViewOfType(RadialTimelineView);
        if (activeView !== view || view.currentMode !== 'chronologue') {
            return;
        }
        // If focus is inside an input/textarea/select or a contenteditable element, don't intercept
        const activeEl = doc.activeElement as HTMLElement | null;
        if (activeEl) {
            const tag = activeEl.tagName.toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl.isContentEditable) {
                return; // Let the input handle the keystroke (typing numbers, shift, etc.)
            }
        }

        if (e.key === 'Shift') {
            activateShiftMode(); // Shift only
        } else if (e.key === 'Alt') {
            // Alt key toggles Alien mode (same behavior as clicking the Alt button)
            // This also activates/deactivates Shift mode as needed
            if (altButton) {
                e.preventDefault(); // Prevent browser menu on Alt
                toggleAlienMode();
            }
        } else if (e.key === 'CapsLock') {
            if (e.repeat) {
                return;
            }

            const reportedState = e.getModifierState('CapsLock');
            if (reportedState !== capsLockState) {
                syncShiftModeToCapsLock(reportedState);
                pendingCapsLockSync = false;
            } else {
                // macOS reports the *previous* Caps Lock state on keydown; wait for keyup to sync
                pendingCapsLockSync = true;
            }
        }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
        // Only handle when radial timeline is active and in chronologue mode
                const activeView = view.app.workspace.getActiveViewOfType(RadialTimelineView);
        if (activeView !== view || view.currentMode !== 'chronologue') {
            return;
        }
        // If focus is inside an input/textarea/select or a contenteditable element, don't intercept
        const activeElUp = doc.activeElement as HTMLElement | null;
        if (activeElUp) {
            const tagUp = activeElUp.tagName.toUpperCase();
            if (tagUp === 'INPUT' || tagUp === 'TEXTAREA' || tagUp === 'SELECT' || activeElUp.isContentEditable) {
                return; // Let the input handle keyup
            }
        }

        if (e.key === 'Shift') {
            deactivateShiftMode();
        } else if (e.key === 'Alt') {
            // Alt key uses toggle behavior (keydown toggles, keyup does nothing)
            // State stays latched until Alt is pressed again or Shift is released
            e.preventDefault(); // Prevent browser menu on Alt
        } else if (e.key === 'CapsLock') {
            const reportedState = e.getModifierState('CapsLock');
            if (pendingCapsLockSync || reportedState !== capsLockState) {
                pendingCapsLockSync = false;
                syncShiftModeToCapsLock(reportedState);
            }
        }
    };

    // SAFE: Document-level listeners cleaned up via view.renderScope.register() below
    doc.addEventListener('keydown', handleKeyDown);
    // SAFE: Cleanup handled by view.renderScope.register() below
    doc.addEventListener('keyup', handleKeyUp);
    view.renderScope.register(() => {
        doc.removeEventListener('keydown', handleKeyDown);
        doc.removeEventListener('keyup', handleKeyUp);
    });

    // Store cleanup function for mode switching (removes buttons immediately)
    view._chronologueShiftCleanup = () => {
        // Remove keyboard listeners
        doc.removeEventListener('keydown', handleKeyDown);
        doc.removeEventListener('keyup', handleKeyUp);

        // Tear down the header sub-nav mirror and hide the sub-nav.
        if (subNavObserver) {
            subNavObserver.disconnect();
            subNavObserver = null;
        }
        view.chronologueSubNav = undefined;
        view.hideChronologueSubNav();

        // Explicitly remove buttons and slider to ensure instant disappearance on mode switch
        if (shiftButton && shiftButton.parentNode) {
            shiftButton.parentNode.removeChild(shiftButton);
        }
        if (altButton && altButton.parentNode) {
            altButton.parentNode.removeChild(altButton);
        }
    };

    // Helper function to find scene by path - use view.sceneData if available
    // path parameter is already URL-encoded (from data-path attribute)
    const findSceneByPath = (path: string): TimelineItem | null => {
        // Decode path for comparison with Scene.path (which is decoded)
        const decodedPath = decodeURIComponent(path);

        // First try to find in view.sceneData (full Scene objects)
        const scene = view.sceneData.find((s: TimelineItem) => s.path === decodedPath);
        if (scene) {
            return scene;
        }

        // Fallback: verify scene group exists
        const sceneGroup = svg.querySelector(`.rt-scene-group[data-path="${path}"]`);
        if (!sceneGroup) return null;

        // If we can't find in sceneData, create minimal scene object
        // This shouldn't normally happen, but provides fallback
        return {
            path: decodedPath,
            when: undefined,
            title: '',
            subplot: '',
            itemType: 'Scene' as const,
        } as TimelineItem;
    };

    // Setup shift mode hover handlers - MUST run before other handlers
    const setupShiftModeHover = () => {
        // Build selected paths Set for O(1) lookups (rebuilt when scenes selected/deselected)
        let selectedPathsSet = new Set<string>();

        const rebuildSelectedPathsSet = () => {
            selectedPathsSet = new Set(selectedScenes.map(s => s.path ? encodeURIComponent(s.path) : '').filter(p => p));
        };

        // Use capture phase to run before other handlers
        // Works for Shift mode and ALT (Alien) mode
        view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
            if (!mode.shift && !mode.alien) return;

            const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"]');
            if (!g) return;

            // Stop ALL event handlers (including other listeners on same element)
            e.stopImmediatePropagation();
            e.preventDefault();

            svg.classList.add('rt-shift-scene-hover');

            const scenePathEncoded = g.getAttribute('data-path');
            if (!scenePathEncoded) return;

            // Check if this scene is locked - O(1) lookup with Set
            const isLocked = selectedPathsSet.has(scenePathEncoded);

            if (!isLocked) {
                // Add hover class - CSS handles the visual styling
                g.classList.add('rt-shift-hover');

                // Activate number square
                const sid = getSceneIdFromGroup(g);
                setNumberSquareActive(sid, true, numberLookup);
            }
        }, { capture: true }); // Use capture phase

        // Use capture phase for pointerout too
        // Works for Shift mode and ALT (Alien) mode
        view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
            if (!mode.shift && !mode.alien) return;

            const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"]');
            if (!g) return;

            // Stop ALL event handlers
            e.stopImmediatePropagation();
            e.preventDefault();

            svg.classList.remove('rt-shift-scene-hover');

            const scenePathEncoded = g.getAttribute('data-path');
            if (!scenePathEncoded) return;

            // Check if this scene is locked - O(1) lookup with Set
            const isLocked = selectedPathsSet.has(scenePathEncoded);

            if (!isLocked) {
                // Remove hover class
                g.classList.remove('rt-shift-hover');

                // Deactivate number square
                const sid = getSceneIdFromGroup(g);
                setNumberSquareActive(sid, false, numberLookup);
            }
        }, { capture: true }); // Use capture phase

        // Return function to rebuild Set when selected scenes change
        return rebuildSelectedPathsSet;
    };

    const rebuildSelectedPathsSet = setupShiftModeHover();

    // Export click handler for external use (called from ChronologueMode)
    // Works for Shift mode and ALT (Alien) mode
    view.handleShiftModeClick = (e: MouseEvent, sceneGroup: Element) => {
        if (!mode.shift && !mode.alien) return false;

        // Prevent default scene opening behavior when in shift mode
        e.preventDefault();
        e.stopPropagation();

        // Get scene data from the group (path is already URL-encoded)
        const scenePathEncoded = sceneGroup.getAttribute('data-path');
        if (!scenePathEncoded) return true;

        // Find the actual scene object (pass encoded path)
        const scene = findSceneByPath(scenePathEncoded);
        if (!scene) return true;

        // Check if this scene is already locked (compare encoded paths)
        const isAlreadyLocked = selectedScenes.some(s => {
            const encoded = s.path ? encodeURIComponent(s.path) : '';
            return encoded === scenePathEncoded;
        });

        if (isAlreadyLocked) {
            // If clicking a locked scene, unlock it
            selectedScenes = selectedScenes.filter(s => {
                const encoded = s.path ? encodeURIComponent(s.path) : '';
                return encoded !== scenePathEncoded;
            });
            rebuildSelectedPathsSet(); // Rebuild Set after change
            updateSceneSelection(svg, selectedScenes, numberLookup);
            if (selectedScenes.length < 2) {
                removeComparisonArc(svg);
            } else {
                showElapsedTime(svg, selectedScenes, elapsedTimeClickCount, sceneGeometry, view.plugin.settings);
            }
            return true;
        }

        // Add to selected scenes (keep only the 2 most recent)
        selectedScenes.push(scene);
        if (selectedScenes.length > 2) {
            selectedScenes = selectedScenes.slice(-2); // Keep only last 2
        }

        rebuildSelectedPathsSet(); // Rebuild Set after change
        updateSceneSelection(svg, selectedScenes, numberLookup);

        // If we have 2 scenes, show elapsed time
        if (selectedScenes.length === 2) {
            showElapsedTime(svg, selectedScenes, elapsedTimeClickCount, sceneGeometry, view.plugin.settings);
        }

        return true; // Indicate we handled the click
    };

    // Register elapsed time text click handler (works for Shift and ALT modes)
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', (e: MouseEvent) => {
        if ((!mode.shift && !mode.alien) || selectedScenes.length !== 2) return;

        const elapsedTimeLabel = (e.target as Element).closest('.rt-elapsed-time-label');
        if (!elapsedTimeLabel) return;

        e.preventDefault();
        e.stopPropagation();

        elapsedTimeClickCount++;
        showElapsedTime(svg, selectedScenes, elapsedTimeClickCount, sceneGeometry, view.plugin.settings);
    });

    // =========================================================================
    // STATE RESTORATION: Reapply this view's state after SVG refresh
    // When a refresh replaces the SVG, a new controller is created. We need to
    // restore its buttons and data attributes from the owning view.
    // Modes are MUTUALLY EXCLUSIVE: only one of Alien or Shift can be active.
    // =========================================================================
    const schedulePlanetaryLabelUpdate = () => {
        const timeoutId = window.setTimeout(() => {
            try {
                if (view.currentMode !== 'chronologue') return;
                updateDateLabelsForAlienMode(true);
            } catch (error) {
                console.warn('[Chronologue] Failed to apply planetary calendar labels after render.', error);
                try {
                    deactivateAlienMode();
                } catch {
                    mode.alien = false;
                    svg.removeAttribute('data-shift-mode');
                }
            }
        }, 0);
        view.renderScope.register(() => window.clearTimeout(timeoutId));
    };

    const schedulePlanetaryDefaultActivation = () => {
        const timeoutId = window.setTimeout(() => {
            try {
                if (view.currentMode !== 'chronologue') return;
                toggleAlienMode();
            } catch (error) {
                console.warn('[Chronologue] Failed to activate default planetary calendar view after render.', error);
                try {
                    deactivateAlienMode();
                } catch {
                    mode.alien = false;
                    svg.removeAttribute('data-shift-mode');
                }
            }
        }, 0);
        view.renderScope.register(() => window.clearTimeout(timeoutId));
    };

    if (mode.alien && altButton) {
        // Alien is now independent of Shift - don't activate Shift
        updateAltButtonState(altButton, true);
        svg.setAttribute('data-shift-mode', 'alien');
        schedulePlanetaryLabelUpdate();
    } else if (mode.shift) {
        updateShiftButtonState(shiftButton, true);
        svg.setAttribute('data-shift-mode', 'active');
    } else if (shouldStartInPlanetaryCalendar()) {
        schedulePlanetaryDefaultActivation();
    }

    // ── Header sub-nav bridge ────────────────────────────────────────────────
    // Expose the sub-mode toggles as the single source of truth for the header
    // chips. Clicking a chip runs the exact same closure the keycap click uses,
    // so keyboard, keycap, and chip stay unified.
    const syncHeaderSubNav = () => {
        view.syncChronologueSubNav({
            shift: mode.shift,
            alt: mode.alien,
        });
    };

    view.chronologueSubNav = {
        hasAlt: shouldShowAlt,
        // Mirrors the keycap click handler: toggle Shift on/off.
        toggleShift: () => {
            if (mode.shift) {
                deactivateShiftMode();
            } else {
                activateShiftMode(false);
            }
            syncHeaderSubNav();
        },
        toggleAlt: () => {
            toggleAlienMode();
            syncHeaderSubNav();
        },
    };
    view.showChronologueSubNav({ hasAlt: shouldShowAlt });

    // Mirror sub-mode state onto the header chips whenever a keycap's active
    // class flips — covering physical Shift/CapsLock/Alt and keycap clicks that
    // bypass the chip handlers above. The keycaps are the single state owner.
    const observedButtons = [shiftButton, altButton].filter((b): b is SVGGElement => b !== null);
    subNavObserver = new MutationObserver(syncHeaderSubNav);
    observedButtons.forEach(btn => subNavObserver?.observe(btn, { attributes: true, attributeFilter: ['class'] }));
    // Reflect any state restored above (observer only fires on future changes).
    syncHeaderSubNav();
}

/**
 * Create the shift button SVG path
 */
function createShiftButtonShape(): string {
    return 'M0 11C0 4.92487 4.92487 0 11 0H67C83.5685 0 97 13.4315 97 30V44C97 50.0751 92.0751 55 86 55H11C4.92487 55 0 50.0751 0 44V11Z';
}

/**
 * Create the shift button element
 */
function createShiftButton(): SVGGElement {
    const button = activeWindow.createSvg('g');
    button.setAttribute('class', 'rt-shift-mode-button');
    button.setAttribute('id', 'shift-mode-toggle');

    button.setAttribute('transform', `translate(${SHIFT_BUTTON_POS_X}, ${SHIFT_BUTTON_POS_Y})`);

    // Create path element
    const path = activeWindow.createSvg('path');
    path.setAttribute('d', createShiftButtonShape());
    path.setAttribute('class', 'rt-shift-button-bg');
    path.setAttribute('fill', 'var(--interactive-normal)');
    path.setAttribute('stroke', 'var(--text-normal)');
    path.setAttribute('stroke-width', '2');

    // Create text element with up arrow
    const text = activeWindow.createSvg('text');
    text.setAttribute('x', '48.5'); // Center of button (97/2)
    text.setAttribute('y', '45'); // Near bottom like page icons (55 - 12 + 2px offset)
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('class', 'rt-shift-button-text');
    text.textContent = t('ui.chronologueShiftController.shiftButton');

    // Add tooltip data attributes for Obsidian setTooltip
    button.classList.add('rt-tooltip-target');
    button.setAttribute('data-tooltip', t('ui.chronologueShiftController.shiftTooltip'));
    button.setAttribute('data-tooltip-placement', 'bottom');

    button.appendChild(path);
    button.appendChild(text);

    return button;
}

/**
 * Update shift button visual state
 */
function updateShiftButtonState(button: SVGGElement, active: boolean): void {
    // Get current transform to preserve position
    const currentTransform = button.getAttribute('transform') || '';
    const baseTransform = currentTransform.replace(/scale\([^)]+\)/, '').trim();

    if (active) {
        // Scale up when active (like mode pages) - CSS handles colors
        button.setAttribute('transform', `${baseTransform} scale(${BUTTON_ACTIVE_SCALE})`);
        button.classList.add('rt-shift-mode-active');
    } else {
        // Normal scale when inactive - CSS handles colors
        button.setAttribute('transform', `${baseTransform}`);
        button.classList.remove('rt-shift-mode-active');
    }
}

/**
 * Create the ALT button element (Left of Shift)
 */
function createAltButton(): SVGGElement {
    const button = activeWindow.createSvg('g');
    button.setAttribute('class', 'rt-shift-mode-button rt-alt-button');
    button.setAttribute('id', 'alt-mode-toggle');

    // Position to the LEFT of Shift button.
    // Shift is at SHIFT_BUTTON_POS_X.
    // Space 10px.
    // Alt Button Native Width = 43px.
    const posX = SHIFT_BUTTON_POS_X - 10 - 43;
    // Align bottom of Alt button with bottom of Shift button
    // Shift height = 55, Alt height = 46, so offset = 55 - 46 = 9
    const posY = SHIFT_BUTTON_POS_Y + 9;

    button.setAttribute('transform', `translate(${posX}, ${posY})`);

    // Create path element
    const path = activeWindow.createSvg('path');
    path.setAttribute('d', createAltButtonShape());
    path.setAttribute('class', 'rt-shift-button-bg');
    path.setAttribute('fill', 'var(--interactive-normal)');
    path.setAttribute('stroke', 'var(--text-normal)');
    path.setAttribute('stroke-width', '2');

    // Create text element
    const text = activeWindow.createSvg('text');
    text.setAttribute('x', '21.5'); // Center of 43
    text.setAttribute('y', '36'); // Near bottom like page icons (46 - 12 + 2px offset)
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('class', 'rt-shift-button-text');
    text.textContent = t('ui.chronologueShiftController.altButton');

    // Add tooltip data attributes for Obsidian setTooltip
    button.classList.add('rt-tooltip-target');
    button.setAttribute('data-tooltip', t('ui.chronologueShiftController.altTooltip'));
    button.setAttribute('data-tooltip-placement', 'bottom');

    button.appendChild(path);
    button.appendChild(text);

    return button;
}

/**
 * Create button shape for ALT (43×46)
 */
function createAltButtonShape(): string {
    return 'M42.6961 35.5616C42.6818 41.0016 38.5008 46 31.7718 46L9.73753 46C2.98561 46 0.0473404 38.6061 0.00495911 34.3114C-0.0062027 33.1802 0.00495911 29.0328 0.00495911 27.6455C0.00495911 25.6393 0.412907 19.3215 8.25278 10.1803C16.1106 1.01827 24.0073 0 26.207 2.71215e-06L32.8167 0C39.9299 0 42.6743 5.31298 42.7024 10.1803C42.7133 12.0656 42.7024 33.1802 42.6961 35.5616Z';
}

/**
 * Update ALT button visual state
 */
function updateAltButtonState(button: SVGGElement, active: boolean): void {
    // Button dimensions
    const ALT_WIDTH = 43;
    const ALT_HEIGHT = 46;
    const SHIFT_HEIGHT = 55;
    
    // Calculate base position (same as in createAltButton)
    // Y offset = SHIFT_HEIGHT - ALT_HEIGHT = 9 (bottom-aligned)
    const basePosX = SHIFT_BUTTON_POS_X - 10 - ALT_WIDTH;
    const basePosY = SHIFT_BUTTON_POS_Y + (SHIFT_HEIGHT - ALT_HEIGHT);
    
    if (active) {
        // Scale from top-right edge: offset left by the expansion amount
        const expansionX = ALT_WIDTH * (BUTTON_ACTIVE_SCALE - 1);
        const scaledPosX = basePosX - expansionX;
        
        // Keep bottoms aligned when scaled:
        // Shift scaled bottom = SHIFT_BUTTON_POS_Y + SHIFT_HEIGHT * scale
        // Alt scaled bottom should match, so:
        // scaledPosY + ALT_HEIGHT * scale = SHIFT_BUTTON_POS_Y + SHIFT_HEIGHT * scale
        // scaledPosY = SHIFT_BUTTON_POS_Y + (SHIFT_HEIGHT - ALT_HEIGHT) * scale
        const scaledPosY = SHIFT_BUTTON_POS_Y + (SHIFT_HEIGHT - ALT_HEIGHT) * BUTTON_ACTIVE_SCALE;
        
        button.setAttribute('transform', `translate(${scaledPosX}, ${scaledPosY}) scale(${BUTTON_ACTIVE_SCALE})`);
        button.classList.add('rt-shift-mode-active');
    } else {
        button.setAttribute('transform', `translate(${basePosX}, ${basePosY})`);
        button.classList.remove('rt-shift-mode-active');
    }
}

/**
 * Show elapsed time arc and label between two scenes.
 * Connects the beginning (start angle) of each scene around the perimeter.
 */
function showElapsedTime(
    svg: SVGSVGElement,
    scenes: TimelineItem[],
    clickCount: number,
    sceneGeometry: Map<string, SceneGeometryInfo>,
    settings?: RadialTimelineSettings
): void {
    removeComparisonArc(svg);

    if (scenes.length !== 2) {
        return;
    }

    const [scene1, scene2] = scenes;
    const geometry1 = sceneGeometry.get(encodeURIComponent(scene1.path || ''));
    const geometry2 = sceneGeometry.get(encodeURIComponent(scene2.path || ''));

    const parseSceneDate = (scene: TimelineItem): Date | null => {
        if (scene.when instanceof Date) return scene.when;
        if (typeof scene.when === 'string') return parseWhenField(scene.when);
        return null;
    };

    const date1 = parseSceneDate(scene1);
    const date2 = parseSceneDate(scene2);

    if (!date1 || !date2 || !geometry1 || !geometry2) {
        return;
    }

    const isAlienMode = svg.getAttribute('data-shift-mode') === 'alien';
    const profile = settings ? getActivePlanetaryProfile(settings) : null;
    const elapsedMs = Math.abs(date2.getTime() - date1.getTime());
    const elapsedTimeText = isAlienMode && profile
        ? formatElapsedTimePlanetary(elapsedMs, profile, clickCount)
        : formatElapsedTime(elapsedMs, clickCount);

    // Always draw clockwise from the chronologically earlier scene to the later
    // one, so the arc covers the timeline content and never crosses the
    // start/end gap.
    const firstSceneIsEarlier = date1.getTime() <= date2.getTime();
    drawComparisonArc(svg, {
        startAngle: firstSceneIsEarlier ? geometry1.startAngle : geometry2.startAngle,
        endAngle: firstSceneIsEarlier ? geometry2.startAngle : geometry1.startAngle,
        markerAngles: [geometry1.startAngle, geometry2.startAngle],
        label: elapsedTimeText,
        layer: svg.querySelector<SVGGElement>('.rt-chronologue-timeline-arc')
    });
}
