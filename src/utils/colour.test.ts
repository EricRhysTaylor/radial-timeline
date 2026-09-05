/*
 * Tests for colour utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  desaturateColor,
  darkenColor,
  lightenColor,
} from './colour';

describe('hexToRgb', () => {
  it('converts a valid hex color to RGB', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('handles hex colors without the # prefix', () => {
    expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns null for invalid hex strings', () => {
    expect(hexToRgb('')).toBeNull();
    expect(hexToRgb('invalid')).toBeNull();
    expect(hexToRgb('#fff')).toBeNull(); // 3-digit hex not supported
    expect(hexToRgb('#gggggg')).toBeNull();
  });

  it('handles mixed case hex values', () => {
    expect(hexToRgb('#AABBCC')).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb('#aAbBcC')).toEqual({ r: 170, g: 187, b: 204 });
  });
});

describe('rgbToHex', () => {
  it('converts RGB values to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('handles intermediate values', () => {
    expect(rgbToHex(128, 128, 128)).toBe('#808080');
    expect(rgbToHex(170, 187, 204)).toBe('#aabbcc');
  });
});

describe('rgbToHsl and hslToRgb', () => {
  it('converts red correctly', () => {
    const hsl = rgbToHsl(255, 0, 0);
    expect(hsl.h).toBeCloseTo(0, 2);
    expect(hsl.s).toBeCloseTo(1, 2);
    expect(hsl.l).toBeCloseTo(0.5, 2);

    const rgb = hslToRgb(0, 1, 0.5);
    expect(rgb.r).toBe(255);
    expect(rgb.g).toBe(0);
    expect(rgb.b).toBe(0);
  });

  it('converts green correctly', () => {
    const hsl = rgbToHsl(0, 255, 0);
    expect(hsl.h).toBeCloseTo(1 / 3, 2);
    expect(hsl.s).toBeCloseTo(1, 2);
    expect(hsl.l).toBeCloseTo(0.5, 2);
  });

  it('converts blue correctly', () => {
    const hsl = rgbToHsl(0, 0, 255);
    expect(hsl.h).toBeCloseTo(2 / 3, 2);
    expect(hsl.s).toBeCloseTo(1, 2);
    expect(hsl.l).toBeCloseTo(0.5, 2);
  });

  it('handles grayscale (no saturation)', () => {
    const hsl = rgbToHsl(128, 128, 128);
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBeCloseTo(0.5, 1);

    const rgb = hslToRgb(0, 0, 0.5);
    expect(rgb.r).toBe(rgb.g);
    expect(rgb.g).toBe(rgb.b);
  });

  it('round-trips RGB through HSL correctly', () => {
    const originalRgb = { r: 100, g: 150, b: 200 };
    const hsl = rgbToHsl(originalRgb.r, originalRgb.g, originalRgb.b);
    const backToRgb = hslToRgb(hsl.h, hsl.s, hsl.l);

    expect(backToRgb.r).toBeCloseTo(originalRgb.r, 0);
    expect(backToRgb.g).toBeCloseTo(originalRgb.g, 0);
    expect(backToRgb.b).toBeCloseTo(originalRgb.b, 0);
  });
});

describe('desaturateColor', () => {
  it('returns the original color when amount is 0', () => {
    const color = '#ff0000';
    expect(desaturateColor(color, 0)).toBe(color);
  });

  it('returns gray when fully desaturated', () => {
    // Full desaturation (amount = 1) should produce a gray
    const result = desaturateColor('#ff0000', 1);
    const rgb = hexToRgb(result);
    expect(rgb).not.toBeNull();
    // Gray means R ≈ G ≈ B
    expect(rgb!.r).toBe(rgb!.g);
    expect(rgb!.g).toBe(rgb!.b);
  });

  it('partially desaturates a color', () => {
    const original = hexToRgb('#ff0000')!;
    const result = desaturateColor('#ff0000', 0.5);
    const desaturated = hexToRgb(result)!;

    // The desaturated color should be less saturated (closer to gray)
    // For red, this means green and blue values should increase
    expect(desaturated.g).toBeGreaterThan(original.g);
    expect(desaturated.b).toBeGreaterThan(original.b);
  });

  it('returns the original color for invalid hex input', () => {
    expect(desaturateColor('invalid', 0.5)).toBe('invalid');
  });
});

describe('darkenColor', () => {
  it('darkens a color by the specified percentage', () => {
    const result = darkenColor('#ffffff', 50);
    const rgb = hexToRgb(result)!;

    // White darkened by 50% should reduce each channel
    expect(rgb.r).toBeLessThan(255);
    expect(rgb.g).toBeLessThan(255);
    expect(rgb.b).toBeLessThan(255);
  });

  it('does not go below 0', () => {
    const result = darkenColor('#101010', 100);
    const rgb = hexToRgb(result)!;

    expect(rgb.r).toBeGreaterThanOrEqual(0);
    expect(rgb.g).toBeGreaterThanOrEqual(0);
    expect(rgb.b).toBeGreaterThanOrEqual(0);
  });

  it('returns black when darkened 100%', () => {
    const result = darkenColor('#808080', 100);
    const rgb = hexToRgb(result)!;

    // darkenColor subtracts (2.55 * percent) from each channel
    // 128 - 255 = -127, clamped to 0
    expect(rgb.r).toBe(0);
    expect(rgb.g).toBe(0);
    expect(rgb.b).toBe(0);
  });
});

describe('lightenColor', () => {
  it('lightens a color by the specified percentage', () => {
    const result = lightenColor('#000000', 50);
    const rgb = hexToRgb(result)!;

    // Black lightened should move toward white
    expect(rgb.r).toBeGreaterThan(0);
    expect(rgb.g).toBeGreaterThan(0);
    expect(rgb.b).toBeGreaterThan(0);
  });

  it('does not exceed 255', () => {
    const result = lightenColor('#f0f0f0', 100);
    const rgb = hexToRgb(result)!;

    expect(rgb.r).toBeLessThanOrEqual(255);
    expect(rgb.g).toBeLessThanOrEqual(255);
    expect(rgb.b).toBeLessThanOrEqual(255);
  });

  it('returns white when lightened 100%', () => {
    const result = lightenColor('#000000', 100);
    const rgb = hexToRgb(result)!;

    expect(rgb.r).toBe(255);
    expect(rgb.g).toBe(255);
    expect(rgb.b).toBe(255);
  });
});

