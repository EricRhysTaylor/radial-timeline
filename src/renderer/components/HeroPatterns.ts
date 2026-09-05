/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Curated subset of SVG motifs from Hero Patterns (https://heropatterns.com)
 * by Steve Schoger, used under CC BY 4.0. Shapes are stored as structured data
 * so both Defs.ts (string output for the timeline SVG) and ColorsSection.ts
 * (DOM construction for the settings preview) can render them without
 * injecting raw markup. The per-stage tint is applied by a parent <g>.
 */
export interface HeroPatternShape {
    tag: 'path' | 'circle';
    attrs: Record<string, string>;
}

export interface HeroPattern {
    id: string;
    name: string;
    tileW: number;
    tileH: number;
    // Not readonly — user-defined customs are stored in mutable settings JSON
    // and read back as plain arrays. Built-in entries are still effectively
    // immutable because the registry array itself is `readonly`.
    shapes: HeroPatternShape[];
    fillOpacity: number;
    fillRule?: 'evenodd' | 'nonzero';
}

export const HERO_PATTERNS: readonly HeroPattern[] = [
    {
        id: 'wiggle',
        name: 'Wiggle',
        tileW: 52,
        tileH: 26,
        fillOpacity: 0.4,
        shapes: [
            { tag: 'path', attrs: { d: 'M10 10c0-2.21-1.79-4-4-4-3.314 0-6-2.686-6-6h2c0 2.21 1.79 4 4 4 3.314 0 6 2.686 6 6 0 2.21 1.79 4 4 4 3.314 0 6 2.686 6 6 0 2.21 1.79 4 4 4v2c-3.314 0-6-2.686-6-6 0-2.21-1.79-4-4-4-3.314 0-6-2.686-6-6zm25.464-1.95l8.486 8.486-1.414 1.414-8.486-8.486 1.414-1.414z' } },
        ],
    },
    {
        id: 'polka-dots',
        name: 'Polka dots',
        tileW: 20,
        tileH: 20,
        fillOpacity: 0.4,
        fillRule: 'evenodd',
        shapes: [
            { tag: 'circle', attrs: { cx: '3', cy: '3', r: '3' } },
            { tag: 'circle', attrs: { cx: '13', cy: '13', r: '3' } },
        ],
    },
    {
        id: 'endless-clouds',
        name: 'Endless clouds',
        tileW: 56,
        tileH: 28,
        fillOpacity: 0.4,
        shapes: [
            { tag: 'path', attrs: { d: 'M56 26v2h-7.75c2.3-1.27 4.94-2 7.75-2zm-26 2a2 2 0 1 0-4 0h-4.09A25.98 25.98 0 0 0 0 16v-2c.67 0 1.34.02 2 .07V14a2 2 0 0 0-2-2v-2a4 4 0 0 1 3.98 3.6 28.09 28.09 0 0 1 2.8-3.86A8 8 0 0 0 0 6V4a9.99 9.99 0 0 1 8.17 4.23c.94-.95 1.96-1.83 3.03-2.63A13.98 13.98 0 0 0 0 0h7.75c2 1.1 3.73 2.63 5.1 4.45 1.12-.72 2.3-1.37 3.53-1.93A20.1 20.1 0 0 0 14.28 0h2.7c.45.56.88 1.14 1.29 1.74 1.3-.48 2.63-.87 4-1.15-.11-.2-.23-.4-.36-.59H26v.07a28.4 28.4 0 0 1 4 0V0h4.09l-.37.59c1.38.28 2.72.67 4.01 1.15.4-.6.84-1.18 1.3-1.74h2.69a20.1 20.1 0 0 0-2.1 2.52c1.23.56 2.41 1.2 3.54 1.93A16.08 16.08 0 0 1 48.25 0H56c-4.58 0-8.65 2.2-11.2 5.6 1.07.8 2.09 1.68 3.03 2.63A9.99 9.99 0 0 1 56 4v2a8 8 0 0 0-6.77 3.74c1.03 1.2 1.97 2.5 2.79 3.86A4 4 0 0 1 56 10v2a2 2 0 0 0-2 2.07 28.4 28.4 0 0 1 2-.07v2c-9.2 0-17.3 4.78-21.91 12H30zM7.75 28H0v-2c2.81 0 5.46.73 7.75 2zM56 20v2c-5.6 0-10.65 2.3-14.28 6h-2.7c4.04-4.89 10.15-8 16.98-8zm-39.03 8h-2.69C10.65 24.3 5.6 22 0 22v-2c6.83 0 12.94 3.11 16.97 8zm15.01-.4a28.09 28.09 0 0 1 2.8-3.86 8 8 0 0 0-13.55 0c1.03 1.2 1.97 2.5 2.79 3.86a4 4 0 0 1 7.96 0zm14.29-11.86c1.3-.48 2.63-.87 4-1.15a25.99 25.99 0 0 0-44.55 0c1.38.28 2.72.67 4.01 1.15a21.98 21.98 0 0 1 36.54 0zm-5.43 2.71c1.13-.72 2.3-1.37 3.54-1.93a19.98 19.98 0 0 0-32.76 0c1.23.56 2.41 1.2 3.54 1.93a15.98 15.98 0 0 1 25.68 0zm-4.67 3.78c.94-.95 1.96-1.83 3.03-2.63a13.98 13.98 0 0 0-22.4 0c1.07.8 2.09 1.68 3.03 2.63a9.99 9.99 0 0 1 16.34 0z' } },
        ],
    },
    {
        id: 'signal',
        name: 'Signal',
        tileW: 84,
        tileH: 48,
        fillOpacity: 0.4,
        fillRule: 'evenodd',
        shapes: [
            { tag: 'path', attrs: { d: 'M0 0h12v6H0V0zm28 8h12v6H28V8zm14-8h12v6H42V0zm14 0h12v6H56V0zm0 8h12v6H56V8zM42 8h12v6H42V8zm0 16h12v6H42v-6zm14-8h12v6H56v-6zm14 0h12v6H70v-6zm0-16h12v6H70V0zM28 32h12v6H28v-6zM14 16h12v6H14v-6zM0 24h12v6H0v-6zm0 8h12v6H0v-6zm14 0h12v6H14v-6zm14 8h12v6H28v-6zm-14 0h12v6H14v-6zm28 0h12v6H42v-6zm14-8h12v6H56v-6zm0-8h12v6H56v-6zm14 8h12v6H70v-6zm0 8h12v6H70v-6zM14 24h12v6H14v-6zm14-8h12v6H28v-6zM14 8h12v6H14V8zM0 8h12v6H0V8z' } },
        ],
    },
];

export const DEFAULT_WORKING_PATTERN_ID = 'wiggle';
export const CUSTOM_PATTERN_ID_PREFIX = 'custom-';

export function getHeroPattern(
    id: string | undefined,
    customs?: readonly HeroPattern[]
): HeroPattern {
    if (id) {
        if (customs && customs.length > 0) {
            const ext = customs.find(p => p.id === id);
            if (ext) return ext;
        }
        const found = HERO_PATTERNS.find(p => p.id === id);
        if (found) return found;
    }
    return HERO_PATTERNS[0];
}

/** Serialize the pattern shapes to an SVG fragment string (for renderer string output). */
export function heroPatternShapesToSvgString(pattern: HeroPattern): string {
    return pattern.shapes.map(shape => {
        const attrs = Object.entries(shape.attrs)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ');
        return `<${shape.tag} ${attrs}/>`;
    }).join('');
}
