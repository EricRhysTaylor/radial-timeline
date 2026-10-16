import { describe, it, expect } from 'vitest';
import {
  resolveReadingOrder,
  flattenScenes,
  type ManuscriptModel,
  type ManuscriptScene,
} from './manuscriptModel';

function scene(over: Partial<ManuscriptScene> = {}): ManuscriptScene {
  return {
    title: 'x',
    rawText: 'body',
    knownMetadata: {},
    knownSynopsis: null,
    sourceRef: 'x.md',
    ...over,
  };
}

describe('resolveReadingOrder', () => {
  it('orders numbered filenames numerically, not lexically', () => {
    const result = resolveReadingOrder(
      ['10 Ten.md', '2 Two.md', '01 One.md'],
      null
    );
    expect(result.kind).toBe('ordered');
    if (result.kind === 'ordered') {
      expect(result.order).toEqual(['01 One.md', '2 Two.md', '10 Ten.md']);
    }
  });

  it('needs an order when names are unnumbered and there is no TOC', () => {
    const result = resolveReadingOrder(['Ithaca.md', 'Troy.md'], null);
    expect(result.kind).toBe('needs-order');
  });

  it('uses TOC.md wikilinks for order when filenames are not numbered', () => {
    const toc = '- [[Troy]]\n- [[Ithaca]]';
    const result = resolveReadingOrder(['Ithaca.md', 'Troy.md'], toc);
    expect(result.kind).toBe('ordered');
    if (result.kind === 'ordered') {
      expect(result.order).toEqual(['Troy.md', 'Ithaca.md']);
    }
  });

  it('uses TOC.md plain list lines when there are no wikilinks', () => {
    const toc = '1. Troy.md\n2. Ithaca.md';
    const result = resolveReadingOrder(['Ithaca.md', 'Troy.md'], toc);
    expect(result.kind).toBe('ordered');
    if (result.kind === 'ordered') {
      expect(result.order).toEqual(['Troy.md', 'Ithaca.md']);
    }
  });

  it('needs an order when the TOC does not cover every note', () => {
    const toc = '- [[Troy]]';
    const result = resolveReadingOrder(['Ithaca.md', 'Troy.md'], toc);
    expect(result.kind).toBe('needs-order');
    if (result.kind === 'needs-order') {
      expect(result.reason).toMatch(/1\/2/);
    }
  });

  it('needs an order for an empty folder', () => {
    expect(resolveReadingOrder([], null).kind).toBe('needs-order');
  });
});

describe('flattenScenes', () => {
  const model: ManuscriptModel = {
    sourceKind: 'md',
    customFields: [],
    chapters: [
      { title: null, scenes: [scene(), scene()] },
      { title: null, scenes: [scene()] },
    ],
  };

  it('flattens chapters in order', () => {
    expect(flattenScenes(model)).toHaveLength(3);
  });
});
