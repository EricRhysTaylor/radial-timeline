import { TFile } from 'obsidian';
import { openOrRevealFile } from '../../utils/fileUtils';
import { buildSearchHighlight } from '../../services/searchHighlight';
import { RadialTimelineView } from '../TimeLineView';

export function setupGossamerMode(view: RadialTimelineView, svg: SVGSVGElement): void {
    let currentGroup: Element | null = null;
    let currentSynopsis: Element | null = null;

    const findSynopsisForScene = (sceneId: string): Element | null => {
        return svg.querySelector(`.rt-scene-info[data-for-scene="${sceneId}"]`);
    };

    const getSceneIdFromGroup = (group: Element): string | null => {
        const pathEl = group.querySelector('.rt-scene-path');
        return pathEl?.id || null;
    };

    // 1a. Beat Slice Hover (delegated fallback): Show synopsis, sync dot+spoke
    const beatSliceOver = (e: PointerEvent) => {
        const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Beat"]');
        if (!g) return;
        beatSliceEnter(g, e);
    };

    // 1b. Beat Slice direct handlers for reliability
    const beatSliceEnter = (g: Element, e: Event) => {
        if (g === currentGroup) return;

        currentGroup = g;
        svg.classList.add('scene-hover');
        svg.classList.add('gossamer-hover');

        const sid = getSceneIdFromGroup(g);
        if (sid) {
            currentSynopsis = findSynopsisForScene(sid);
            if (currentSynopsis) {
                currentSynopsis.classList.add('rt-visible');
                view.plugin.synopsisManager.updatePosition(currentSynopsis, e as unknown as MouseEvent, svg, sid);
            }
        }

        const encodedPath = g.getAttribute('data-path') || '';
        if (encodedPath) {
            // Find either dot or score text for this beat (to get data-beat attribute)
            const dotOrScore = svg.querySelector(`.rt-gossamer-dot[data-path="${encodedPath}"], .rt-gossamer-score-text[data-path="${encodedPath}"]`);
            
            // Get beat name - first try from dot/score, then fall back to scene title or spoke
            let beatName: string | null = null;
            if (dotOrScore) {
                dotOrScore.classList.add('rt-hover');
                beatName = dotOrScore.getAttribute('data-beat');
            }
            
            // If no dot/score (missing data), try to get beat name from the scene title in the beat group
            if (!beatName) {
                // The beat slice group typically has a title element with the beat name
                const titleEl = g.querySelector('.rt-storybeat-title');
                if (titleEl) {
                    beatName = titleEl.textContent?.trim() || null;
                }
            }
            
            if (beatName) {
                // Show center dot
                const centerDot = svg.querySelector(`.rt-gossamer-dot-center[data-beat="${beatName}"]`);
                if (centerDot) centerDot.classList.add('rt-hover');
                // Highlight spoke
                const spoke = svg.querySelector(`.rt-gossamer-spoke[data-beat="${beatName}"]`);
                if (spoke) spoke.classList.add('rt-gossamer-spoke-hover');
                // Highlight beat outline
                const beatOutline = svg.querySelector(`.rt-gossamer-beat-outline[data-beat="${beatName}"]`);
                if (beatOutline) beatOutline.classList.add('rt-hover');
                // Highlight range deviation segments
                const rangeSegments = svg.querySelectorAll(`.rt-gossamer-range-segment[data-beat="${beatName}"]`);
                rangeSegments.forEach(seg => seg.classList.add('rt-hover'));
                // Highlight ideal range line
                const idealRange = svg.querySelector(`.rt-gossamer-ideal-range[data-beat="${beatName}"]`);
                if (idealRange) idealRange.classList.add('rt-hover');
                // Highlight all historical dots with matching beat name
                const historicalDots = svg.querySelectorAll(`.rt-gossamer-dot-historical[data-beat="${beatName}"]`);
                historicalDots.forEach(hd => hd.classList.add('rt-hover'));
                // Also highlight the score text for this beat
                const scoreText = svg.querySelector(`.rt-gossamer-score-text[data-beat="${beatName}"]`);
                if (scoreText) scoreText.classList.add('rt-hover');
                // Hide range values for this beat
                const rangeValues = svg.querySelectorAll(`.rt-gossamer-range-value[data-beat="${beatName}"]`);
                rangeValues.forEach(rv => rv.classList.add('ert-hidden'));
                
                g.classList.add('rt-gossamer-hover');
            }
        }
    };

    const beatSliceOut = (e: PointerEvent) => {
        if (!currentGroup) return;

        const toEl = e.relatedTarget as Element | null;
        if (toEl && (currentGroup.contains(toEl) ||
                    !!toEl.closest('.rt-gossamer-dot') ||
                    !!toEl.closest('.rt-gossamer-score-text'))) return;

        svg.classList.remove('scene-hover');
        if (currentSynopsis) {
            currentSynopsis.classList.remove('rt-visible');
            currentSynopsis = null;
        }

        const encodedPath = currentGroup.getAttribute('data-path') || '';
        if (encodedPath) {
            // Find either dot or score text
            const dotOrScore = svg.querySelector(`.rt-gossamer-dot[data-path="${encodedPath}"], .rt-gossamer-score-text[data-path="${encodedPath}"]`);
            
            // Get beat name - try from dot/score, then fall back to scene title
            let beatName: string | null = null;
            if (dotOrScore) {
                dotOrScore.classList.remove('rt-hover');
                beatName = dotOrScore.getAttribute('data-beat');
            }
            
            // If no dot/score (missing data), get beat name from the beat title
            if (!beatName) {
                const titleEl = currentGroup.querySelector('.rt-storybeat-title');
                if (titleEl) {
                    beatName = titleEl.textContent?.trim() || null;
                }
            }
            
            if (beatName) {
                // Hide center dot
                const centerDot = svg.querySelector(`.rt-gossamer-dot-center[data-beat="${beatName}"]`);
                if (centerDot) centerDot.classList.remove('rt-hover');
                // Remove spoke highlight
                const spoke = svg.querySelector(`.rt-gossamer-spoke[data-beat="${beatName}"]`);
                if (spoke) spoke.classList.remove('rt-gossamer-spoke-hover');
                // Remove beat outline highlight
                const beatOutline = svg.querySelector(`.rt-gossamer-beat-outline[data-beat="${beatName}"]`);
                if (beatOutline) beatOutline.classList.remove('rt-hover');
                // Remove range segment highlight
                const rangeSegments = svg.querySelectorAll(`.rt-gossamer-range-segment[data-beat="${beatName}"]`);
                rangeSegments.forEach(seg => seg.classList.remove('rt-hover'));
                // Remove ideal range highlight
                const idealRange = svg.querySelector(`.rt-gossamer-ideal-range[data-beat="${beatName}"]`);
                if (idealRange) idealRange.classList.remove('rt-hover');
                // Remove hover from historical dots
                const historicalDots = svg.querySelectorAll(`.rt-gossamer-dot-historical[data-beat="${beatName}"]`);
                historicalDots.forEach(hd => hd.classList.remove('rt-hover'));
                // Remove hover from score text
                const scoreText = svg.querySelector(`.rt-gossamer-score-text[data-beat="${beatName}"]`);
                if (scoreText) scoreText.classList.remove('rt-hover');
                // Restore range values for this beat
                const rangeValues = svg.querySelectorAll(`.rt-gossamer-range-value[data-beat="${beatName}"]`);
                rangeValues.forEach(rv => rv.classList.remove('ert-hidden'));
                
                currentGroup.classList.remove('rt-gossamer-hover');
            }
        }

        currentGroup = null;
    };

    // 2. Gossamer Dot Hover: Show synopsis, sync plot slice+spoke+center dot
    const dotOver = (e: PointerEvent) => {
        const dot = (e.target as Element).closest('.rt-gossamer-dot, .rt-gossamer-score-text');
        if (!dot) return;
        
        dot.classList.add('rt-hover');
        const encodedPath = dot.getAttribute('data-path');
        const beatName = dot.getAttribute('data-beat');
        if (!encodedPath) return;
        
        svg.classList.add('scene-hover');
        svg.classList.add('gossamer-hover');
        
        // Show center dot and highlight beat outline
        if (beatName) {
            const centerDot = svg.querySelector(`.rt-gossamer-dot-center[data-beat="${beatName}"]`);
            if (centerDot) centerDot.classList.add('rt-hover');
            const beatOutline = svg.querySelector(`.rt-gossamer-beat-outline[data-beat="${beatName}"]`);
            if (beatOutline) beatOutline.classList.add('rt-hover');
            // Hide range values for this beat
            const rangeValues = svg.querySelectorAll(`.rt-gossamer-range-value[data-beat="${beatName}"]`);
            rangeValues.forEach(rv => rv.classList.add('ert-hidden'));
        }
        
        // Find and highlight the beat slice (both have encoded paths now)
        const beatGroup = svg.querySelector(`.rt-scene-group[data-path="${encodedPath}"]`);
        if (beatGroup) {
            currentGroup = beatGroup;
            beatGroup.classList.add('rt-gossamer-hover');
            
            const sid = getSceneIdFromGroup(beatGroup);
            if (sid) {
                currentSynopsis = findSynopsisForScene(sid);
                if (currentSynopsis) {
                    currentSynopsis.classList.add('rt-visible');
                    view.plugin.synopsisManager.updatePosition(currentSynopsis, e, svg, sid);
                }
            }
        }
        
        // Highlight spoke, beat outline, and historical dots
        if (beatName) {
            const spoke = svg.querySelector(`.rt-gossamer-spoke[data-beat="${beatName}"]`);
            if (spoke) {
                spoke.classList.add('rt-gossamer-spoke-hover');
            }
            const rangeSegments = svg.querySelectorAll(`.rt-gossamer-range-segment[data-beat="${beatName}"]`);
            rangeSegments.forEach(seg => seg.classList.add('rt-hover'));
            const idealRange = svg.querySelector(`.rt-gossamer-ideal-range[data-beat="${beatName}"]`);
            if (idealRange) idealRange.classList.add('rt-hover');
            const beatOutline = svg.querySelector(`.rt-gossamer-beat-outline[data-beat="${beatName}"]`);
            if (beatOutline) {
                beatOutline.classList.add('rt-hover');
            }
            // Highlight all historical dots with matching beat name
            const historicalDots = svg.querySelectorAll(`.rt-gossamer-dot-historical[data-beat="${beatName}"]`);
            historicalDots.forEach(hd => hd.classList.add('rt-hover'));
            // Also highlight the main dot and score text for this beat (in case we hovered on one but not the other)
            const mainDot = svg.querySelector(`.rt-gossamer-dot[data-beat="${beatName}"]`);
            if (mainDot) mainDot.classList.add('rt-hover');
            const scoreText = svg.querySelector(`.rt-gossamer-score-text[data-beat="${beatName}"]`);
            if (scoreText) scoreText.classList.add('rt-hover');
        }
    };

    const dotOut = (e: PointerEvent) => {
        const toEl = e.relatedTarget as Element | null;
        // If moving to a beat slice, another dot, or score text, keep highlights
        if (toEl && (toEl.closest('.rt-scene-group[data-item-type="Beat"]') || 
                    toEl.closest('.rt-gossamer-dot') ||
                    toEl.closest('.rt-gossamer-score-text'))) return;

        svg.classList.remove('scene-hover');
        svg.classList.remove('gossamer-hover');

        if (currentSynopsis) {
            currentSynopsis.classList.remove('rt-visible');
            currentSynopsis = null;
        }

        if (currentGroup) {
            currentGroup.classList.remove('rt-gossamer-hover');
            currentGroup = null;
        }

        // Remove all highlights (including historical dots and range values)
        svg.querySelectorAll('.rt-gossamer-spoke-hover').forEach(el => {
            el.classList.remove('rt-gossamer-spoke-hover');
        });
        svg.querySelectorAll('.rt-gossamer-dot.rt-hover, .rt-gossamer-score-text.rt-hover').forEach(el => {
            el.classList.remove('rt-hover');
        });
        svg.querySelectorAll('.rt-gossamer-dot-center.rt-hover').forEach(el => {
            el.classList.remove('rt-hover');
        });
        svg.querySelectorAll('.rt-gossamer-beat-outline.rt-hover').forEach(el => {
            el.classList.remove('rt-hover');
        });
        svg.querySelectorAll('.rt-gossamer-range-segment.rt-hover').forEach(el => {
            el.classList.remove('rt-hover');
        });
        svg.querySelectorAll('.rt-gossamer-ideal-range.rt-hover').forEach(el => {
            el.classList.remove('rt-hover');
        });
        svg.querySelectorAll('.rt-gossamer-dot-historical.rt-hover').forEach(hd => {
            hd.classList.remove('rt-hover');
        });
        svg.querySelectorAll('.rt-gossamer-range-value.ert-hidden').forEach(rv => {
            rv.classList.remove('ert-hidden');
        });
    };

    // 3. Click handlers
    const beatSliceClick = async (e: MouseEvent) => {
        const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Beat"]');
        if (!g) return;
        
        e.stopPropagation();
        
        const encodedPath = g.getAttribute('data-path');
        if (!encodedPath) return;
        
        const filePath = decodeURIComponent(encodedPath);
        const file = view.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const highlight = await buildSearchHighlight(view.plugin.app, file, view.plugin.searchState);
            await openOrRevealFile(view.plugin.app, file, false, highlight);
        }
    };

    const dotClick = async (e: MouseEvent) => {
        const dot = (e.target as Element).closest('.rt-gossamer-dot, .rt-gossamer-score-text');
        if (!dot) return;
        
        e.stopPropagation();
        
        const encodedPath = dot.getAttribute('data-path');
        if (!encodedPath) return;
        
        const path = decodeURIComponent(encodedPath);
        const file = view.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const highlight = await buildSearchHighlight(view.plugin.app, file, view.plugin.searchState);
            await openOrRevealFile(view.plugin.app, file, false, highlight);
        }
    };

    // 4. Background click to exit Gossamer mode
    const backgroundClick = (e: MouseEvent) => {
        const target = e.target as Element;
        
        if (target.closest('.rt-gossamer-dot') || 
            target.closest('.rt-gossamer-score-text') ||
            target.closest('.rt-scene-group[data-item-type="Beat"]')) {
            return;
        }
        
        void import('../../GossamerCommands').then(({ toggleGossamerMode }) => {
            void toggleGossamerMode(view.plugin);
        });
    };

    // Register via view (so cleanup works consistently)
    // Void wrappers keep a single listener reference for both add and removal.
    const beatSliceClickListener = (e: MouseEvent) => { void beatSliceClick(e); };
    const dotClickListener = (e: MouseEvent) => { void dotClick(e); };
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', beatSliceClickListener);
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', dotClickListener);
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', backgroundClick);
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', beatSliceOver);
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', beatSliceOut);
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', dotOver);
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', dotOut);

    // Track for manual cleanup when switching modes
    view.registerGossamerHandler('pointerover::svg', beatSliceOver);
    view.registerGossamerHandler('pointerout::svg', beatSliceOut);
    view.registerGossamerHandler('pointerover::dot::svg', dotOver);
    view.registerGossamerHandler('pointerout::dot::svg', dotOut);
    view.registerGossamerHandler('click::beat::svg', beatSliceClickListener);
    view.registerGossamerHandler('click::dot::svg', dotClickListener);
    view.registerGossamerHandler('click::bg::svg', backgroundClick);

    // Direct beat-group handlers for reliability
    const beatGroups = svg.querySelectorAll('.rt-scene-group[data-item-type="Beat"]');
    beatGroups.forEach((el) => {
        view.renderScope.registerDomEvent(el as HTMLElement, 'pointerenter', (ev) => beatSliceEnter(el, ev));
        view.renderScope.registerDomEvent(el as HTMLElement, 'pointerleave', (ev) => beatSliceOut(ev as PointerEvent));
        view.renderScope.registerDomEvent(el as HTMLElement, 'click', (ev) => beatSliceClick(ev as MouseEvent));
    });
}

