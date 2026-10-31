import { describe, expect, it } from 'vitest';
import { hasPortalReference } from './canvasPortals';

describe('Advanced Canvas portal protection', () => {
    const ids = new Set(['story-card']);
    it('recognizes incoming portal endpoints in a different canvas', () => {
        expect(hasPortalReference({ nodes: [{ id: 'portal', type: 'file', interdimensionalEdges: [
            { fromNode: 'local-card', toNode: 'acportal||portal||story-card' },
        ] }] }, ids, false)).toBe(true);
    });
    it('recognizes local portal edges but does not block ordinary links', () => {
        expect(hasPortalReference({ nodes: [{ id: 'portal', type: 'file', interdimensionalEdges: [
            { fromNode: 'story-card', toNode: 'acportal||portal||elsewhere' },
        ] }] }, ids, true)).toBe(true);
        expect(hasPortalReference({ edges: [{ fromNode: 'story-card', toNode: 'acportal||portal||other' }] }, ids, true)).toBe(true);
        expect(hasPortalReference({ edges: [{ fromNode: 'story-card', toNode: 'ordinary-card' }] }, ids, true)).toBe(false);
    });
});
