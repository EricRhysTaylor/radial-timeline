import { describe, it, expect } from 'vitest';
import {
  basename,
  dirname,
  suggestOnboardingFolderName,
  sanitizeFileName,
  openingWords,
} from './paths';

describe('path helpers', () => {
  it('basename / dirname split a vault path', () => {
    expect(basename('Books/My Book/01 A.md')).toBe('01 A.md');
    expect(dirname('Books/My Book/01 A.md')).toBe('Books/My Book');
    expect(dirname('Top.md')).toBe('');
  });

  it('suggests a sibling <Source> RT folder', () => {
    expect(suggestOnboardingFolderName('Books/Odyssey')).toBe('Books/Odyssey RT');
    expect(suggestOnboardingFolderName('Odyssey')).toBe('Odyssey RT');
  });

  it('sanitizes illegal file-name characters', () => {
    expect(sanitizeFileName('A/B: the "return"?')).toBe('A B the return');
    expect(sanitizeFileName('[[Odysseus]]')).toBe('Odysseus');
  });

  it('takes opening words with an ellipsis only when truncated', () => {
    expect(openingWords('one two three', 5)).toBe('one two three');
    expect(openingWords('one two three four five six', 3)).toBe('one two three…');
  });
});
