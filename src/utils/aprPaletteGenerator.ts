/**
 * APR Color Palette Generator
 * Generates harmonious 3-color palettes for Author Progress Reports
 */

import { hexToRgb, rgbToHsl, hslToRgb, rgbToHex } from './colour';

export interface AprPalette {
    bookTitle: string;
    authorName: string;
    percentNumber: string;
    name: string;
}

/**
 * Generate a 3-color palette from a base color using color theory
 */
export function generatePaletteFromColor(baseColor: string, scheme: 'analogous' | 'complementary' | 'triadic' | 'monochromatic' = 'analogous'): AprPalette {
    const rgb = hexToRgb(baseColor);
    if (!rgb) return getPresetPalettes()[0]; // Fallback to first preset
    
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    
    let colors: string[] = [];
    
    switch (scheme) {
        case 'analogous':
            // Analogous: colors adjacent on color wheel (±30°)
            colors = [
                baseColor, // Book Title (primary)
                hslToHex((hsl.h + 0.08) % 1, hsl.s, hsl.l), // Author Name (slightly shifted)
                hslToHex((hsl.h + 0.12) % 1, Math.max(0.4, hsl.s * 0.9), hsl.l) // Percent Number (slightly shifted, full saturation)
            ];
            break;
            
        case 'complementary':
            // Complementary: base + opposite on color wheel
            colors = [
                baseColor, // Book Title
                hslToHex((hsl.h + 0.5) % 1, hsl.s * 0.8, hsl.l), // Author Name (complement, softer)
                baseColor // Percent Number (same as book title)
            ];
            break;
            
        case 'triadic':
            // Triadic: three colors evenly spaced (120° apart)
            colors = [
                baseColor, // Book Title
                hslToHex((hsl.h + 0.33) % 1, hsl.s * 0.9, hsl.l), // Author Name (120° shift)
                baseColor // Percent Number (same as book title)
            ];
            break;
            
        case 'monochromatic':
            // Monochromatic: variations in lightness/saturation
            colors = [
                baseColor, // Book Title
                hslToHex(hsl.h, hsl.s * 0.85, Math.max(0.2, hsl.l - 0.1)), // Author Name (darker)
                baseColor // Percent Number (same as book title)
            ];
            break;
    }
    
    return {
        bookTitle: colors[0],
        authorName: colors[1],
        percentNumber: colors[2],
        name: `${scheme} from ${baseColor}`
    };
}

/**
 * Convert HSL to hex string
 */
function hslToHex(h: number, s: number, l: number): string {
    const rgb = hslToRgb(h, s, l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/**
 * Preset color palettes - curated, tasteful combinations
 */
export function getPresetPalettes(): AprPalette[] {
    return [
        {
            name: 'Forest Green',
            bookTitle: '#4A7C59',
            authorName: '#6FB971',
            percentNumber: '#6FB971'
        },
        {
            name: 'Ocean Blue',
            bookTitle: '#3B7A9E',
            authorName: '#5BA3D0',
            percentNumber: '#5BA3D0'
        },
        {
            name: 'Sunset Orange',
            bookTitle: '#D2691E',
            authorName: '#FF8C42',
            percentNumber: '#FF8C42'
        },
        {
            name: 'Royal Purple',
            bookTitle: '#6B46C1',
            authorName: '#8B5CF6',
            percentNumber: '#8B5CF6'
        },
        {
            name: 'Crimson Red',
            bookTitle: '#991B1B',
            authorName: '#DC2626',
            percentNumber: '#DC2626'
        },
        {
            name: 'Sage Green',
            bookTitle: '#6B7280',
            authorName: '#9CA3AF',
            percentNumber: '#9CA3AF'
        },
        {
            name: 'Amber Gold',
            bookTitle: '#B45309',
            authorName: '#F59E0B',
            percentNumber: '#F59E0B'
        },
        {
            name: 'Teal Turquoise',
            bookTitle: '#0D9488',
            authorName: '#14B8A6',
            percentNumber: '#14B8A6'
        },
        {
            name: 'Rose Pink',
            bookTitle: '#BE185D',
            authorName: '#EC4899',
            percentNumber: '#EC4899'
        },
        {
            name: 'Slate Blue',
            bookTitle: '#475569',
            authorName: '#64748B',
            percentNumber: '#64748B'
        }
    ];
}
