import { Notice } from 'obsidian';
import { TimelineMode } from '../../modes/ModeDefinition';
// Value import used only inside event handlers (call-time), keeping the
// TimeLineView <-> controller cycle inert at module init.
import { RadialTimelineView } from '../TimeLineView';
import { getToggleableModes } from '../../modes/ModeRegistry';
import {
    MODE_SELECTOR_POS_X,
    MODE_SELECTOR_POS_Y,
    MODE_TITLE_POS_X,
    MODE_TITLE_POS_Y
} from '../../renderer/layout/LayoutConstants';
import { t } from '../../i18n';

/**
 * Resolve translated mode label by mode id. Falls back to mode.name from definition.
 */
function getModeLabel(modeId: string, fallback: string): string {
    const key = `timeline.modes.${modeId}.name`;
    const value = t(key);
    return value && !value.startsWith('[missing:') ? value : fallback;
}

/**
 * Resolve translated mode acronym by mode id. Falls back to definition acronym.
 */
function getModeAcronym(modeId: string, fallback: string): string {
    const key = `timeline.modes.${modeId}.acronym`;
    const value = t(key);
    return value && !value.startsWith('[missing:') ? value : fallback;
}

// Build MODE_OPTIONS dynamically from mode registry - SINGLE SOURCE OF TRUTH
// label/acronym are resolved via t() at render time (so locale changes are honored)
function buildModeOptions() {
    return getToggleableModes().map(mode => {
        const fallbackAcronym = mode.ui.acronym || mode.name.charAt(0).toUpperCase();
        return {
            id: mode.id,
            get label() { return getModeLabel(mode.id, mode.name); },
            get acronym() { return getModeAcronym(mode.id, fallbackAcronym); },
            order: mode.ui.order
        };
    });
}

const MODE_OPTIONS = buildModeOptions();

// Inactive icon dimensions (~30% smaller than the original 43x60 source path).
// All values are whole pixels — no fractional positioning.
const ICON_WIDTH = 30;
const ICON_NUMBER_X = 6;
const ICON_NUMBER_Y = 8;
// Single-letter acronym, anchored bottom-left (mirrors the top-left number label).
const LETTER_X = 6;
const LETTER_Y = 34;   // 42 - 8, mirror of ICON_NUMBER_Y

// Active mode dimensions (1.2x of the inactive size, also whole pixels).
const ICON_WIDTH_ACTIVE = 36;
const ICON_NUMBER_X_ACTIVE = 7;
const ICON_NUMBER_Y_ACTIVE = 10;
const LETTER_X_ACTIVE = 7;
const LETTER_Y_ACTIVE = 40;   // 50 - 10, mirror of ICON_NUMBER_Y_ACTIVE

// Path scale factors derived from the original 43-wide source path.
const ICON_BASE_SCALE = ICON_WIDTH / 43;        // -> 30/43 ≈ 0.6977
const ICON_ACTIVE_SCALE = ICON_WIDTH_ACTIVE / 43; // -> 36/43 ≈ 0.8372

// Visual spacing
const ICON_VISUAL_GAP_INACTIVE = 4;
const ICON_VISUAL_GAP_ACTIVE = 15;

/**
 * Scale SVG path coordinates to target size
 * @param pathData Original path string
 * @param scale Scale factor to apply
 * @returns Scaled path string
 */
function scalePath(pathData: string, scale: number): string {
    // Parse and scale all numeric values in the path
    return pathData.replace(/([-\d.]+)/g, (match) => {
        const num = parseFloat(match);
        return isNaN(num) ? match : String(num * scale);
    });
}

/**
 * Original SVG path for document shape with folded corner
 * Based on viewBox 0 0 43 60
 */
const ORIGINAL_DOCUMENT_PATH = 'M0.0349451 51.6667C0.0349438 56.1905 1.58191 60 8.89418 60H35.0768C40.5492 60 42.9307 53.5714 42.9651 50C43.0437 41.8254 42.9651 26.291 42.9651 22.8571C42.9651 20.4762 41.431 15.935 35.0768 8.33333C28.7081 0.714286 23.5187 0 21.7359 0H8.05486C2.28955 0 0.0577294 4.28571 0.0349455 8.33333C-0.043681 22.3016 0.0349463 47.8524 0.0349451 51.6667Z';

// Pre-scaled path strings — the path numbers themselves are shrunk so there is
// no runtime transform/scale on the rendered SVG.
const INACTIVE_DOCUMENT_PATH = scalePath(ORIGINAL_DOCUMENT_PATH, ICON_BASE_SCALE);
const ACTIVE_DOCUMENT_PATH = scalePath(ORIGINAL_DOCUMENT_PATH, ICON_ACTIVE_SCALE);

function createInactiveDocumentShape(): string {
    return INACTIVE_DOCUMENT_PATH;
}

function createActiveDocumentShape(): string {
    return ACTIVE_DOCUMENT_PATH;
}

/**
 * Create the mode selector grid element
 */
function createModeSelectorGrid(view: RadialTimelineView, doc: Document): SVGGElement {
    const grid = doc.win.createSvg('g');
    grid.setAttribute('class', 'rt-mode-selector-grid');
    grid.setAttribute('id', 'mode-selector');

    // Initial positioning with inactive gaps (will be adjusted in updateState)
    const spacePerIcon = ICON_WIDTH + ICON_VISUAL_GAP_INACTIVE;
    const totalWidth = MODE_OPTIONS.length * ICON_WIDTH + (MODE_OPTIONS.length - 1) * ICON_VISUAL_GAP_INACTIVE;
    const startX = MODE_SELECTOR_POS_X - totalWidth / 2 + ICON_WIDTH / 2;

    MODE_OPTIONS.forEach((mode, index) => {
        const x = startX + index * spacePerIcon;

        // Create outer group for positioning (translate only)
        const optionGroup = doc.win.createSvg('g');
        optionGroup.setAttribute('class', 'rt-mode-option');
        optionGroup.setAttribute('data-mode', mode.id);
        optionGroup.setAttribute('transform', `translate(${x}, ${MODE_SELECTOR_POS_Y})`);

        // Create inner group for hover scaling (CSS transform will apply here)
        const innerGroup = doc.win.createSvg('g');
        innerGroup.setAttribute('class', 'rt-mode-option-content');

        // Create path element - scaled to inactive size (native)
        const path = doc.win.createSvg('path');
        path.setAttribute('class', 'rt-document-bg');
        path.setAttribute('d', createInactiveDocumentShape());

        // Acronym letter in bottom-left, mirroring the top-left number label
        const letter = doc.win.createSvg('text');
        letter.setAttribute('class', 'rt-mode-acronym-text');
        letter.setAttribute('x', String(LETTER_X));
        letter.setAttribute('y', String(LETTER_Y));
        letter.setAttribute('text-anchor', 'start');
        letter.setAttribute('dominant-baseline', 'middle');
        letter.textContent = mode.acronym;

        // Create number label (1, 2, 3, 4) at top left corner - Native Size
        const numberLabel = doc.win.createSvg('text');
        numberLabel.setAttribute('class', 'rt-mode-number-label');
        numberLabel.setAttribute('x', String(ICON_NUMBER_X));
        numberLabel.setAttribute('y', String(ICON_NUMBER_Y));
        numberLabel.setAttribute('text-anchor', 'start');
        numberLabel.setAttribute('dominant-baseline', 'middle');
        numberLabel.textContent = String(index + 1);

        innerGroup.appendChild(path);
        innerGroup.appendChild(letter);
        innerGroup.appendChild(numberLabel);
        optionGroup.appendChild(innerGroup);
        grid.appendChild(optionGroup);
    });

    // Add mode title text above the first icon
    const titleText = doc.win.createSvg('text');
    titleText.setAttribute('class', 'rt-mode-title-text');
    titleText.setAttribute('x', String(MODE_TITLE_POS_X));
    titleText.setAttribute('y', String(MODE_TITLE_POS_Y));
    titleText.setAttribute('text-anchor', 'start');
    titleText.setAttribute('dominant-baseline', 'baseline');
    titleText.setAttribute('id', 'mode-title');
    // Set initial text content to first mode
    if (MODE_OPTIONS.length > 0) {
        titleText.textContent = MODE_OPTIONS[0].label;
    }

    grid.appendChild(titleText);

    return grid;
}

/**
 * Switch to the specified mode
 */
async function switchToMode(view: RadialTimelineView, modeId: string, modeSelector: SVGGElement): Promise<void> {
    const modeManager = view.getModeManager();
    view.closeWritingSessionPanel();

    // Update UI immediately for instant visual feedback
    updateModeSelectorState(modeSelector, modeId);

    try {
        await modeManager.switchMode(modeId as TimelineMode);
        // Re-sync UI to the actual active mode (guarded switches may no-op)
        const finalMode = modeManager.getCurrentMode();
        if (finalMode !== (modeId as TimelineMode)) {
            updateModeSelectorState(modeSelector, finalMode);
        }
    } catch (error) {
        // Revert UI on unhandled error and notify user
        const fallbackMode = modeManager.getCurrentMode();
        updateModeSelectorState(modeSelector, fallbackMode);
        console.error(`[ModeToggle] Failed to switch to ${modeId}:`, error);
        new Notice(`Could not switch to ${modeId} mode. Check the developer console for details.`, 6000);
    }
}

/**
 * Update the visual state of the mode selector
 */
function updateModeSelectorState(modeSelector: SVGGElement, currentMode: string): void {
    const activeIndex = MODE_OPTIONS.findIndex(m => m.id === (currentMode as TimelineMode));

    // Calculate positions with different gaps
    let x = MODE_SELECTOR_POS_X;
    const positions: number[] = [];

    for (let i = 0; i < MODE_OPTIONS.length; i++) {
        positions.push(x);

        if (i === activeIndex) {
            // After active icon, add larger gap
            x += ICON_WIDTH_ACTIVE + ICON_VISUAL_GAP_ACTIVE;
        } else if (i + 1 === activeIndex) {
            // Before active icon, add larger gap
            x += ICON_WIDTH + ICON_VISUAL_GAP_ACTIVE;
        } else {
            // Between inactive icons
            x += ICON_WIDTH + ICON_VISUAL_GAP_INACTIVE;
        }
    }

    // Center the group
    const offset = MODE_SELECTOR_POS_X - (positions[0] + positions[positions.length - 1]) / 2;

    MODE_OPTIONS.forEach((mode, index) => {
        const modeElement = modeSelector.querySelector(`[data-mode="${mode.id}"]`);
        if (!modeElement) return;

        const bg = modeElement.querySelector('.rt-document-bg') as SVGElement;
        const letter = modeElement.querySelector('.rt-mode-acronym-text');
        const numberLabel = modeElement.querySelector('.rt-mode-number-label') as SVGElement;

        const finalX = positions[index] + offset;
        const isActive = mode.id === (currentMode as TimelineMode);

        modeElement.setAttribute('transform', `translate(${finalX}, ${MODE_SELECTOR_POS_Y})`);
        modeElement.classList.toggle('rt-mode-current', isActive);
        bg.classList.toggle('rt-active', isActive);
        if (numberLabel) numberLabel.classList.toggle('rt-active', isActive);
        if (letter) letter.classList.toggle('rt-active', isActive);

        if (isActive) {
            bg.setAttribute('d', createActiveDocumentShape());
            if (numberLabel) {
                numberLabel.setAttribute('x', String(ICON_NUMBER_X_ACTIVE));
                numberLabel.setAttribute('y', String(ICON_NUMBER_Y_ACTIVE));
            }
            if (letter) {
                letter.setAttribute('x', String(LETTER_X_ACTIVE));
                letter.setAttribute('y', String(LETTER_Y_ACTIVE));
            }
        } else {
            bg.setAttribute('d', createInactiveDocumentShape());
            if (numberLabel) {
                numberLabel.setAttribute('x', String(ICON_NUMBER_X));
                numberLabel.setAttribute('y', String(ICON_NUMBER_Y));
            }
            if (letter) {
                letter.setAttribute('x', String(LETTER_X));
                letter.setAttribute('y', String(LETTER_Y));
            }
        }
    });

    // Update mode title: text content and left-edge alignment to the leftmost button
    const titleText = modeSelector.querySelector('#mode-title') as SVGTextElement;
    if (titleText && activeIndex >= 0) {
        titleText.textContent = MODE_OPTIONS[activeIndex].label;
        titleText.setAttribute('x', String(positions[0] + offset));
    }
}

/**
 * Initialize mode selector controls for a view
 */
export function setupModeToggleController(view: RadialTimelineView, svg: SVGSVGElement): void {
    const doc = svg.ownerDocument;

    // Create mode selector grid
    const modeSelector = createModeSelectorGrid(view, doc);
    svg.appendChild(modeSelector);

    // Update initial state
    updateModeSelectorState(modeSelector, view.currentMode || 'narrative');

    // Register click handlers for each mode option
    MODE_OPTIONS.forEach(mode => {
        const modeElement = modeSelector.querySelector(`[data-mode="${mode.id}"]`);
        if (modeElement) {
            const clickTarget = (modeElement.querySelector('.rt-document-bg') ?? modeElement) as unknown as HTMLElement;
            view.renderScope.registerDomEvent(clickTarget, 'click', (e: MouseEvent) => {
                e.stopPropagation();
                void switchToMode(view, mode.id, modeSelector);
            });
        }
    });

    // Register keyboard shortcuts (1, 2, 3, 4)
    const handleKeyPress = async (e: KeyboardEvent) => {
        // Only handle shortcuts when the radial timeline is the active view
        const activeView = view.app.workspace.getActiveViewOfType(RadialTimelineView);
        if (activeView !== view) {
            return; // Different view is active, don't intercept
        }
        // If focus is inside an input/textarea/select or a contenteditable element, don't intercept
        const activeEl = doc.activeElement as HTMLElement | null;
        if (activeEl) {
            const tag = activeEl.tagName.toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl.isContentEditable) {
                return; // Let the input handle the keystroke
            }
        }

        const key = parseInt(e.key);
        if (key >= 1 && key <= 4 && key <= MODE_OPTIONS.length) {
            e.preventDefault();
            const modeId = MODE_OPTIONS[key - 1].id;
            await switchToMode(view, modeId, modeSelector);
        }
    };

    // SAFE: Document-level listener cleaned up via view.renderScope.register() below
    const handleKeyPressListener = (e: KeyboardEvent) => { void handleKeyPress(e); };
    doc.addEventListener('keydown', handleKeyPressListener);
    view.renderScope.register(() => {
        doc.removeEventListener('keydown', handleKeyPressListener);
    });

    // Register hover handlers for visual feedback (color changes only, no scaling)
    MODE_OPTIONS.forEach(mode => {
        const modeElement = modeSelector.querySelector(`[data-mode="${mode.id}"]`);
        if (modeElement) {
            view.renderScope.registerDomEvent(modeElement as unknown as HTMLElement, 'mouseenter', (e: MouseEvent) => {
                modeElement.classList.add('rt-mode-hover');
            });

            view.renderScope.registerDomEvent(modeElement as unknown as HTMLElement, 'mouseleave', (e: MouseEvent) => {
                modeElement.classList.remove('rt-mode-hover');
            });
        }
    });
}
