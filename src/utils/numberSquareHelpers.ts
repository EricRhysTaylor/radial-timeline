/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { escapeXml } from '../utils/svg';

function hashKey(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
}

/**
 * Helper function to generate scene IDs for number squares
 */
export function makeSceneId(
    actIndex: number,
    ring: number,
    idx: number,
    isOuterAllScenes: boolean,
    isOuter: boolean,
    uniqueKey?: string
): string {
    const base = isOuterAllScenes && isOuter
        ? `scene-path-${actIndex}-${ring}-outer-${idx}`
        : `scene-path-${actIndex}-${ring}-${idx}`;
    if (!uniqueKey) return base;
    return `${base}-${hashKey(uniqueKey)}`;
}

/**
 * Helper function to generate number square DOM structure
 */
export function generateNumberSquareGroup(
    squareX: number, 
    squareY: number, 
    squareSize: { width: number; height: number }, 
    squareClasses: string, 
    sceneId: string, 
    number: string, 
    textClasses: string,
    grade?: string,
    options?: {
        cornerRadius?: number;
        subplotIndex?: number;
        dataAttrs?: Record<string, string | number | boolean | null | undefined>;
    }
): string {
    const cornerRadius = options?.cornerRadius ?? 0;
    const radiusAttr = cornerRadius > 0 ? ` rx="${cornerRadius}" ry="${cornerRadius}"` : '';
    const subplotAttr = options?.subplotIndex !== undefined ? ` data-subplot-idx="${options.subplotIndex}"` : '';
    const dataAttrString = options?.dataAttrs
        ? Object.entries(options.dataAttrs)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
            .join(' ')
        : '';
    const dataAttrs = dataAttrString ? ` ${dataAttrString}` : '';

    return `
        <g class="number-square-group"${dataAttrs} transform="translate(${squareX}, ${squareY})">
            <g class="number-square-orient">
                <rect 
                    x="-${squareSize.width/2}" 
                    y="-${squareSize.height/2}" 
                    width="${squareSize.width}" 
                    height="${squareSize.height}" 
                    class="${squareClasses}" 
                    data-scene-id="${escapeXml(sceneId)}"
                    ${radiusAttr}${subplotAttr}
                />
                <text 
                    x="0" 
                    y="0" 
                    text-anchor="middle" 
                    dominant-baseline="middle" 
                    class="${textClasses}"
                    data-scene-id="${escapeXml(sceneId)}"
                    dy="0.1em"
                >${number}</text>
            </g>
        </g>
    `;
}
