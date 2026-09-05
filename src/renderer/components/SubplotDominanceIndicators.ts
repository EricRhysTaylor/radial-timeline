import type { TimelineItem } from '../../types';
import { escapeXml } from '../../utils/svg';

export interface SubplotDominanceState {
    hasSharedOverlap: boolean;
    hasHiddenSharedScenes: boolean;
}

export interface DominantSceneResolution {
    scene: TimelineItem;
    dominantSubplot: string;
    storedPreference?: string;
    preferenceMatched: boolean;
}

function normalizeSubplotName(name?: string | null): string {
    if (name && name.trim().length > 0) {
        return name.trim();
    }
    return 'Main Plot';
}

export function resolveDominantScene(params: {
    scenePath?: string;
    candidateScenes: TimelineItem[];
    masterSubplotOrder: string[];
    dominantSubplots?: Record<string, string>;
}): DominantSceneResolution {
    const { scenePath, candidateScenes, masterSubplotOrder, dominantSubplots } = params;
    if (!candidateScenes.length) {
        throw new Error('resolveDominantScene requires at least one candidate scene');
    }

    const selectFallback = (): { scene: TimelineItem; subplot: string } => {
        let fallbackScene = candidateScenes[0];
        let fallbackSubplot = normalizeSubplotName(fallbackScene.subplot);
        let bestIndex = masterSubplotOrder.indexOf(fallbackSubplot);
        if (bestIndex === -1) bestIndex = Infinity;

        candidateScenes.forEach(scene => {
            const subplotName = normalizeSubplotName(scene.subplot);
            const idx = masterSubplotOrder.indexOf(subplotName);
            if (idx !== -1 && idx < bestIndex) {
                fallbackScene = scene;
                fallbackSubplot = subplotName;
                bestIndex = idx;
            }
        });

        return { scene: fallbackScene, subplot: fallbackSubplot };
    };

    const storedPreference = scenePath && dominantSubplots ? dominantSubplots[scenePath] : undefined;
    if (storedPreference) {
        const matchedScene = candidateScenes.find(scene => normalizeSubplotName(scene.subplot) === storedPreference);
        if (matchedScene) {
            return {
                scene: matchedScene,
                dominantSubplot: storedPreference,
                storedPreference,
                preferenceMatched: true
            };
        }

        const fallback = selectFallback();
        return {
            scene: fallback.scene,
            dominantSubplot: fallback.subplot,
            storedPreference,
            preferenceMatched: false
        };
    }

    const fallback = selectFallback();
    return {
        scene: fallback.scene,
        dominantSubplot: fallback.subplot,
        preferenceMatched: false
    };
}

export function computeSubplotDominanceStates(params: {
    scenes: TimelineItem[];
    masterSubplotOrder: string[];
    dominantSubplots?: Record<string, string>;
}): Map<string, SubplotDominanceState> {
    const { scenes, masterSubplotOrder, dominantSubplots } = params;
    const subplotDominanceStates = new Map<string, SubplotDominanceState>();
    masterSubplotOrder.forEach(subplot => {
        subplotDominanceStates.set(subplot, {
            hasSharedOverlap: false,
            hasHiddenSharedScenes: false
        });
    });

    const scenesGroupedByPath = new Map<string, TimelineItem[]>();
    scenes.forEach(scene => {
        if (!scene.path) return;
        if (!scenesGroupedByPath.has(scene.path)) {
            scenesGroupedByPath.set(scene.path, []);
        }
        scenesGroupedByPath.get(scene.path)!.push(scene);
    });

    scenesGroupedByPath.forEach((items, path) => {
        const uniqueSubplots = Array.from(
            new Set(items.map(scene => normalizeSubplotName(scene.subplot)))
        );
        if (uniqueSubplots.length <= 1) return;

        const { dominantSubplot } = resolveDominantScene({
            scenePath: path,
            candidateScenes: items,
            masterSubplotOrder,
            dominantSubplots
        });

        uniqueSubplots.forEach(subplotName => {
            const existing = subplotDominanceStates.get(subplotName) || {
                hasSharedOverlap: false,
                hasHiddenSharedScenes: false
            };
            existing.hasSharedOverlap = true;
            if (subplotName !== dominantSubplot) {
                existing.hasHiddenSharedScenes = true;
            }
            subplotDominanceStates.set(subplotName, existing);
        });
    });

    return subplotDominanceStates;
}

export function renderSubplotDominanceIndicators(params: {
    masterSubplotOrder: string[];
    ringStartRadii: number[];
    ringWidths: number[];
    subplotStates: Map<string, SubplotDominanceState>;
    subplotColorFor: (subplotName: string) => string;
}): string {
    const { masterSubplotOrder, ringStartRadii, ringWidths, subplotStates, subplotColorFor } = params;
    if (masterSubplotOrder.length === 0) return '';

    // Constants for triangle size and positioning
    const TRIANGLE_SIZE = 11;  // Triangle width and height in pixels
    const RADIAL_INSET = 11;   // Distance y-axis from bottom ring edge
    const TANGENT_OFFSET = 10.7; // Offset along the tangent (to the right at 12 o'clock)
    const CENTER_OFFSET_X = 10; // Centering offset X
    const CENTER_OFFSET_Y = 0;  // Centering offset Y
    
    const totalRings = masterSubplotOrder.length;
    const iconAngle = -Math.PI / 2; // 12 o'clock position
    const radialX = Math.cos(iconAngle); // 0 at 12 o'clock
    const radialY = Math.sin(iconAngle); // -1 at 12 o'clock
    const tangentX = Math.round(-radialY); // 1 at 12 o'clock
    const tangentY = Math.round(radialX);  // 0 at 12 o'clock
    
    let svg = '<g class="rt-subplot-dominance-flags">';

    masterSubplotOrder.forEach((subplotName, offset) => {
        const state = subplotStates.get(subplotName);
        if (!state || !state.hasSharedOverlap) return;

        const ring = totalRings - offset - 1;
        const innerR = ringStartRadii[ring];
        const ringWidth = ringWidths[ring];
        if (innerR === undefined || ringWidth === undefined) return;

        const iconRadius = Math.round(innerR + RADIAL_INSET);
        const iconX = Math.round(iconRadius * radialX);
        const iconY = Math.round(iconRadius * radialY);
        
        // Right triangle: vertical left side, horizontal bottom, 45° diagonal (page corner)
        const path = `M 0 0 L 0 ${TRIANGLE_SIZE} L ${TRIANGLE_SIZE} ${TRIANGLE_SIZE} Z`;
        const cssClass = state.hasHiddenSharedScenes ? 'is-hidden' : 'is-shown';
        const subplotColor = subplotColorFor(subplotName);
        
        // Calculate final position
        const finalX = iconX + tangentX * TANGENT_OFFSET - CENTER_OFFSET_X;
        const finalY = iconY + tangentY * TANGENT_OFFSET - CENTER_OFFSET_Y;

        const styleAttr = `style="--flag-color: ${subplotColor}"`; // SAFE: inline style used for dynamic color variable

        svg += `
            <g class="rt-subplot-dominance-flag ${cssClass}"
               data-subplot-name="${escapeXml(subplotName)}"
               data-has-hidden="${state.hasHiddenSharedScenes ? 'true' : 'false'}"
               transform="translate(${finalX} ${finalY})"
               ${styleAttr}>
                <path d="${path}" />
            </g>
        `;
    });

    svg += '</g>';
    return svg;
}
