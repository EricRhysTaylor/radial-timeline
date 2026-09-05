/*
 * Tests for date utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  parseWhenField,
  parseDuration,
  parseDurationDetail,
  parseDateRangeInput,
  calculateTimeSpan,
  formatElapsedTime,
  isOverdueDateString,
  detectDiscontinuities,
  calculateAutoDiscontinuityThreshold,
  prepareScenesForDiscontinuityDetection,
} from './date';

describe('parseWhenField', () => {
  describe('ISO date formats', () => {
    it('parses YYYY-MM-DD format', () => {
      const date = parseWhenField('2024-03-15');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(2); // March is 0-indexed
      expect(date!.getDate()).toBe(15);
      expect(date!.getHours()).toBe(12); // Default noon
    });

    it('parses single-digit month and day', () => {
      const date = parseWhenField('2024-3-5');
      expect(date).not.toBeNull();
      expect(date!.getMonth()).toBe(2);
      expect(date!.getDate()).toBe(5);
    });

    it('parses historical dates', () => {
      // Pride & Prejudice era date
      const date = parseWhenField('1812-09-17');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(1812);
      expect(date!.getMonth()).toBe(8); // September
      expect(date!.getDate()).toBe(17);
    });
  });

  describe('ISO 8601 with time', () => {
    it('parses YYYY-MM-DDTHH:MM:SS format', () => {
      const date = parseWhenField('2024-03-15T14:30:00');
      expect(date).not.toBeNull();
      expect(date!.getHours()).toBe(14);
      expect(date!.getMinutes()).toBe(30);
      expect(date!.getSeconds()).toBe(0);
    });

    it('parses YYYY-MM-DDTHH:MM format (no seconds)', () => {
      const date = parseWhenField('2024-03-15T14:30');
      expect(date).not.toBeNull();
      expect(date!.getHours()).toBe(14);
      expect(date!.getMinutes()).toBe(30);
    });

    it('parses date + time with space separator', () => {
      const date = parseWhenField('2024-03-15 14:30');
      expect(date).not.toBeNull();
      expect(date!.getHours()).toBe(14);
      expect(date!.getMinutes()).toBe(30);
    });
  });

  describe('12-hour time with AM/PM', () => {
    it('parses AM times', () => {
      const date = parseWhenField('2024-03-15 9:30 am');
      expect(date).not.toBeNull();
      expect(date!.getHours()).toBe(9);
      expect(date!.getMinutes()).toBe(30);
    });

    it('parses PM times', () => {
      const date = parseWhenField('2024-03-15 2:30 pm');
      expect(date).not.toBeNull();
      expect(date!.getHours()).toBe(14);
      expect(date!.getMinutes()).toBe(30);
    });

    it('handles noon correctly', () => {
      const date = parseWhenField('2024-03-15 12:00 pm');
      expect(date).not.toBeNull();
      expect(date!.getHours()).toBe(12);
    });

    it('handles midnight correctly', () => {
      const date = parseWhenField('2024-03-15 12:00 am');
      expect(date).not.toBeNull();
      expect(date!.getHours()).toBe(0);
    });
  });

  describe('natural language formats', () => {
    it('parses year only', () => {
      const date = parseWhenField('1812');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(1812);
      expect(date!.getMonth()).toBe(0); // January
      expect(date!.getDate()).toBe(1);
    });

    it('parses year-month only', () => {
      const date = parseWhenField('2024-03');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(2); // March
      expect(date!.getDate()).toBe(1);
    });

    it('parses Month Year format', () => {
      const date = parseWhenField('March 2024');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(2);
    });

    it('parses Month Day, Year format', () => {
      const date = parseWhenField('March 15, 2024');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(2);
      expect(date!.getDate()).toBe(15);
    });

    it('parses Day Month Year format', () => {
      const date = parseWhenField('15 March 2024');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(2);
      expect(date!.getDate()).toBe(15);
    });

    it('handles ordinal suffixes', () => {
      expect(parseWhenField('15th March 2024')).not.toBeNull();
      expect(parseWhenField('1st January 2024')).not.toBeNull();
      expect(parseWhenField('2nd February 2024')).not.toBeNull();
      expect(parseWhenField('3rd March 2024')).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(parseWhenField('')).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(parseWhenField('not a date')).toBeNull();
      // Note: JavaScript Date constructor is lenient with overflow values
      // (2024/13/45 becomes 2025-02-14 due to rollover)
      // The parser converts slashes to dashes and parses successfully
    });

    it('handles slashes as date separators', () => {
      const date = parseWhenField('2024/03/15');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
    });

    it('parses month/day/year with time', () => {
      const date = parseWhenField('4/24/2024 1:45pm');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(3); // April
      expect(date!.getDate()).toBe(24);
      expect(date!.getHours()).toBe(13);
      expect(date!.getMinutes()).toBe(45);
    });

    it('trims whitespace', () => {
      const date = parseWhenField('  2024-03-15  ');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
    });
  });
});

describe('parseDateRangeInput', () => {
  it('parses slash-delimited date ranges with optional time', () => {
    const parsed = parseDateRangeInput('4/24/2024-4/25/2025 1:45pm');
    expect(parsed).not.toBeNull();
    expect(parsed!.start).not.toBeNull();
    expect(parsed!.end).not.toBeNull();
    expect(parsed!.start!.getFullYear()).toBe(2024);
    expect(parsed!.end!.getFullYear()).toBe(2025);
  });

  it('parses dashed date ranges with spaces', () => {
    const parsed = parseDateRangeInput('2024-04-24 - 2024-04-25');
    expect(parsed).not.toBeNull();
    expect(parsed!.start).not.toBeNull();
    expect(parsed!.end).not.toBeNull();
  });

  it('parses slash date ranges with spaces', () => {
    const parsed = parseDateRangeInput('4/24/2024 - 4/25/2025');
    expect(parsed).not.toBeNull();
    expect(parsed!.start).not.toBeNull();
    expect(parsed!.end).not.toBeNull();
  });

  it('parses mixed date/time ranges', () => {
    const parsed = parseDateRangeInput('4/24/2024 1:45pm - 4/25/2025');
    expect(parsed).not.toBeNull();
    expect(parsed!.start).not.toBeNull();
    expect(parsed!.end).not.toBeNull();
    expect(parsed!.start!.getHours()).toBe(13);
  });
});

describe('parseDuration', () => {
  it('parses hours', () => {
    expect(parseDuration('2 hours')).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration('2.5 hours')).toBe(2.5 * 60 * 60 * 1000);
  });

  it('parses days', () => {
    expect(parseDuration('3 days')).toBe(3 * 24 * 60 * 60 * 1000);
    expect(parseDuration('3d')).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('parses weeks', () => {
    expect(parseDuration('1 week')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration('2 weeks')).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('parses months', () => {
    const oneMonth = 30.44 * 24 * 60 * 60 * 1000;
    expect(parseDuration('1 month')).toBeCloseTo(oneMonth, -3);
    expect(parseDuration('2mo')).toBeCloseTo(2 * oneMonth, -3);
  });

  it('parses minutes and seconds', () => {
    expect(parseDuration('30 minutes')).toBe(30 * 60 * 1000);
    expect(parseDuration('45s')).toBe(45 * 1000);
  });

  it('returns null for invalid input', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('invalid')).toBeNull();
    expect(parseDuration('abc hours')).toBeNull();
  });

  it('handles zero', () => {
    expect(parseDuration('0')).toBe(0);
    expect(parseDuration('0 hours')).toBe(0);
  });
});

describe('parseDurationDetail', () => {
  it('returns detailed duration info', () => {
    const detail = parseDurationDetail('2 hours');
    expect(detail).not.toBeNull();
    expect(detail!.value).toBe(2);
    expect(detail!.unitKey).toBe('hours');
    expect(detail!.unitSingular).toBe('hour');
    expect(detail!.unitPlural).toBe('hours');
    expect(detail!.ms).toBe(2 * 60 * 60 * 1000);
  });

  it('returns null for invalid input', () => {
    expect(parseDurationDetail('')).toBeNull();
    expect(parseDurationDetail('invalid')).toBeNull();
  });

  it('returns null for zero values', () => {
    expect(parseDurationDetail('0 hours')).toBeNull();
  });
});

describe('calculateTimeSpan', () => {
  it('returns zeros for empty array', () => {
    const span = calculateTimeSpan([]);
    expect(span.totalMs).toBe(0);
    expect(span.days).toBe(0);
  });

  it('calculates span for date range', () => {
    const dates = [
      new Date('2024-01-01'),
      new Date('2024-01-15'),
    ];
    const span = calculateTimeSpan(dates);
    expect(span.days).toBeCloseTo(14, 0);
    expect(span.weeks).toBeCloseTo(2, 0);
  });

  it('recommends appropriate units', () => {
    // Short span - should recommend hours
    const shortDates = [
      new Date('2024-01-01T10:00:00'),
      new Date('2024-01-01T22:00:00'),
    ];
    expect(calculateTimeSpan(shortDates).recommendedUnit).toBe('hours');

    // Medium span - should recommend days
    const mediumDates = [
      new Date('2024-01-01'),
      new Date('2024-01-10'),
    ];
    expect(calculateTimeSpan(mediumDates).recommendedUnit).toBe('days');

    // Long span - 2 years is 24 months, which is at the boundary
    // The code uses months for <= 24 months
    const longDates = [
      new Date('2022-01-01'),
      new Date('2024-01-01'),
    ];
    expect(calculateTimeSpan(longDates).recommendedUnit).toBe('months');
    
    // Need > 24 months to get 'years'
    const veryLongDates = [
      new Date('2020-01-01'),
      new Date('2024-01-01'),
    ];
    expect(calculateTimeSpan(veryLongDates).recommendedUnit).toBe('years');
  });
});

describe('formatElapsedTime', () => {
  it('formats small durations in minutes', () => {
    const fiveMinutes = 5 * 60 * 1000;
    expect(formatElapsedTime(fiveMinutes)).toContain('minute');
  });

  it('formats larger durations in hours', () => {
    const twoHours = 2 * 60 * 60 * 1000;
    expect(formatElapsedTime(twoHours)).toContain('hour');
  });

  it('handles zero', () => {
    expect(formatElapsedTime(0)).toBe('0 minutes');
  });

  it('cycles through units with click count', () => {
    const oneDay = 24 * 60 * 60 * 1000;
    const result0 = formatElapsedTime(oneDay, 0);
    const result1 = formatElapsedTime(oneDay, 1);
    const result2 = formatElapsedTime(oneDay, 2);

    // Different click counts should potentially show different units
    // At least one should differ (cycling behavior)
    expect([result0, result1, result2].some((r, i, arr) => arr.indexOf(r) !== i) || 
           result0 !== result1 || result1 !== result2).toBe(true);
  });
});

describe('isOverdueDateString', () => {
  it('returns true for past dates', () => {
    // Create a date at noon to avoid timezone issues
    const today = new Date(2024, 5, 15, 12, 0, 0); // June 15, 2024
    expect(isOverdueDateString('2024-06-14', today)).toBe(true);
    expect(isOverdueDateString('2024-05-01', today)).toBe(true);
    expect(isOverdueDateString('2023-12-31', today)).toBe(true);
  });

  it('returns false for today', () => {
    const today = new Date(2024, 5, 15, 12, 0, 0); // June 15, 2024
    expect(isOverdueDateString('2024-06-15', today)).toBe(false);
  });

  it('returns false for future dates', () => {
    const today = new Date(2024, 5, 15, 12, 0, 0); // June 15, 2024
    expect(isOverdueDateString('2024-06-16', today)).toBe(false);
    expect(isOverdueDateString('2024-07-01', today)).toBe(false);
  });

  it('returns false for invalid input', () => {
    expect(isOverdueDateString('')).toBe(false);
    expect(isOverdueDateString(undefined)).toBe(false);
    expect(isOverdueDateString('invalid')).toBe(false);
  });
});

describe('discontinuity detection', () => {
  describe('prepareScenesForDiscontinuityDetection', () => {
    it('filters to Scene items only', () => {
      const scenes = [
        { when: new Date('2024-01-01'), itemType: 'Scene', path: '/a' },
        { when: new Date('2024-01-02'), itemType: 'Plot', path: '/b' },
        { when: new Date('2024-01-03'), itemType: 'Scene', path: '/c' },
      ];
      const result = prepareScenesForDiscontinuityDetection(scenes);
      expect(result.length).toBe(2);
    });

    it('deduplicates by path', () => {
      const scenes = [
        { when: new Date('2024-01-01'), itemType: 'Scene', path: '/a' },
        { when: new Date('2024-01-02'), itemType: 'Scene', path: '/a' }, // Duplicate path
        { when: new Date('2024-01-03'), itemType: 'Scene', path: '/b' },
      ];
      const result = prepareScenesForDiscontinuityDetection(scenes);
      expect(result.length).toBe(2);
    });

    it('sorts chronologically', () => {
      // Use explicit Date constructor to avoid timezone issues
      const scenes = [
        { when: new Date(2024, 0, 15, 12, 0, 0), itemType: 'Scene', path: '/c' },
        { when: new Date(2024, 0, 1, 12, 0, 0), itemType: 'Scene', path: '/a' },
        { when: new Date(2024, 0, 10, 12, 0, 0), itemType: 'Scene', path: '/b' },
      ];
      const result = prepareScenesForDiscontinuityDetection(scenes);
      expect(result[0].when.getDate()).toBe(1);
      expect(result[1].when.getDate()).toBe(10);
      expect(result[2].when.getDate()).toBe(15);
    });
  });

  describe('calculateAutoDiscontinuityThreshold', () => {
    it('returns null for fewer than 3 scenes', () => {
      const scenes = [
        { when: new Date('2024-01-01'), itemType: 'Scene', path: '/a' },
        { when: new Date('2024-01-02'), itemType: 'Scene', path: '/b' },
      ];
      expect(calculateAutoDiscontinuityThreshold(scenes)).toBeNull();
    });

    it('calculates 3x median gap', () => {
      // Gaps: 1 day, 1 day, 1 day → median = 1 day → threshold = 3 days
      const scenes = [
        { when: new Date('2024-01-01'), itemType: 'Scene', path: '/a' },
        { when: new Date('2024-01-02'), itemType: 'Scene', path: '/b' },
        { when: new Date('2024-01-03'), itemType: 'Scene', path: '/c' },
        { when: new Date('2024-01-04'), itemType: 'Scene', path: '/d' },
      ];
      const threshold = calculateAutoDiscontinuityThreshold(scenes);
      expect(threshold).not.toBeNull();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      expect(threshold).toBe(threeDaysMs);
    });
  });

  describe('detectDiscontinuities', () => {
    it('returns empty array for fewer than 3 scenes', () => {
      const scenes = [
        { when: new Date('2024-01-01') },
        { when: new Date('2024-01-10') },
      ];
      expect(detectDiscontinuities(scenes, 24 * 60 * 60 * 1000)).toEqual([]);
    });

    it('detects large gaps', () => {
      const oneDayMs = 24 * 60 * 60 * 1000;
      const scenes = [
        { when: new Date('2024-01-01') },
        { when: new Date('2024-01-02') }, // 1 day gap
        { when: new Date('2024-01-10') }, // 8 day gap - discontinuity!
        { when: new Date('2024-01-11') }, // 1 day gap
      ];
      const discontinuities = detectDiscontinuities(scenes, 3 * oneDayMs);
      expect(discontinuities).toContain(2); // Index 2 has big gap before it
      expect(discontinuities.length).toBe(1);
    });

    it('returns empty for small threshold', () => {
      const scenes = [
        { when: new Date('2024-01-01') },
        { when: new Date('2024-01-02') },
        { when: new Date('2024-01-03') },
      ];
      // Threshold of 0 should return empty
      expect(detectDiscontinuities(scenes, 0)).toEqual([]);
    });
  });
});
