import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { hasPortalReference, hasPortalReferences } from './canvasPortals';

describe('Advanced Canvas portal protection', () => {
    const ids = new Set(['story-card']);
    const vaultOf = (files: Record<string, string>) => ({
        workspace: { getLeavesOfType: () => [] },
        vault: {
            getFiles: () => Object.keys(files).map(path => ({ path, extension: 'canvas' })),
            cachedRead: async (file: { path: string }) => files[file.path],
        },
    }) as unknown as App;
    it('keeps converting past a canvas it cannot read', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const app = vaultOf({ 'Empty.canvas': '', 'Broken.canvas': '{ "nodes": [', 'Null.canvas': 'null', 'Healthy.canvas': '{"nodes":[]}' });
        await expect(hasPortalReferences(app, {}, ids)).resolves.toBe(false);
    });
    it('keeps converting past a canvas that parses but has the wrong shape', async () => {
        const app = vaultOf({
            'Edges.canvas': '{"edges":{}}',
            'Nodes.canvas': '{"nodes":5}',
            'NullEdge.canvas': '{"edges":[null,{"fromNode":"story-card","toNode":7}]}',
            'NullNode.canvas': '{"nodes":[null,{"id":"x","interdimensionalEdges":[null]}]}',
        });
        await expect(hasPortalReferences(app, {}, ids)).resolves.toBe(false);
    });
    it('still finds a portal in a healthy canvas beside a damaged one', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const portal = JSON.stringify({ edges: [{ fromNode: 'other', toNode: 'acportal||portal||story-card' }] });
        await expect(hasPortalReferences(vaultOf({ 'Empty.canvas': '', 'Map.canvas': portal }), {}, ids)).resolves.toBe(true);
    });
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
