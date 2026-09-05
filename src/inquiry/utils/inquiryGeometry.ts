/**
 * Pure polar -> cartesian conversion for inquiry SVG layout.
 * Degrees, screen coordinates (Y grows downward). Single source of truth
 * for the inquiry polar formula; SVG string serialization (e.g. toFixed)
 * is the caller's boundary concern, not this helper's.
 */
export const polarToCartesian = (radius: number, degrees: number): { x: number; y: number } => {
    const radians = (degrees * Math.PI) / 180;
    return {
        x: radius * Math.cos(radians),
        y: radius * Math.sin(radians)
    };
};
