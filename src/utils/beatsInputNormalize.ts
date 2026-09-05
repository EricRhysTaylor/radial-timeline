/**
 * Shared normalization helpers for beat-related user inputs.
 * Keeps matching, filenames, and settings edits consistent.
 */

const CONTROL_CHARS = /\p{Cc}+/gu;
const HAS_ALNUM = /[A-Za-z0-9]/;

function normalizeInlineText(value: string): string {
  return (value || '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasBeatReadableText(value: string): boolean {
  return HAS_ALNUM.test(value);
}

export function normalizeBeatSetNameInput(value: string, fallback = 'Custom'): string {
  const normalized = normalizeInlineText(value);
  return normalized || fallback;
}

export function normalizeBeatNameInput(value: string, fallback = 'New Beat'): string {
  const normalized = normalizeInlineText(value);
  return normalized || fallback;
}

export function normalizeBeatFieldKeyInput(value: string): string {
  // YAML keys should not contain ":" because it breaks key serialization.
  return normalizeInlineText(value).replace(/:/g, ' - ').replace(/\s+/g, ' ').trim();
}

export function normalizeBeatFieldValueInput(value: string): string {
  return normalizeInlineText(value);
}

export function normalizeBeatFieldListValueInput(value: string): string[] {
  return (value || '')
    .split(',')
    .map(v => normalizeBeatFieldValueInput(v))
    .filter(Boolean);
}

export function sanitizeBeatFilenameSegment(value: string, fallback = 'Beat'): string {
  const normalized = normalizeInlineText(value)
    .replace(/[\\/:*?"<>|!.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-|-$/g, '')
    .trim();
  return normalized || fallback;
}

function normalizeForMatching(value: string): string {
  return normalizeInlineText(value)
    .replace(/&/g, ' and ')
    .replace(/[/\\\-_‐‑‒–—―]+/g, ' ')
    .replace(/[^A-Za-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const WORD_NUMBER_MAP: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10'
};

function normalizeWordNumbers(value: string): string {
  return value.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (token) => {
    const mapped = WORD_NUMBER_MAP[token.toLowerCase()];
    return mapped ?? token;
  });
}

export function toBeatMatchKey(value: string): string {
  const trimmed = normalizeInlineText(value);
  if (!trimmed) return '';
  const withoutAct = trimmed.replace(/^Act\s*\d+\s*:\s*/i, '');
  const withoutPrefix = withoutAct.replace(/^\d+(?:\.\d+)?\s*[.\-:)]?\s*/i, '');
  return normalizeForMatching(normalizeWordNumbers(withoutPrefix));
}

export function toBeatModelMatchKey(value: string): string {
  return normalizeForMatching(value).replace(/\s+/g, '');
}

/** Stable GUID for custom beats — crypto.randomUUID with timestamp fallback. */
export function generateBeatGuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
