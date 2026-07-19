import { describe, expect, it } from 'vitest';
import {
    buildTimelineDataExport,
    snapshotRenderConfig,
    TIMELINE_DATA_EXPORT_SCHEMA_VERSION,
    type BuildTimelineDataExportParams,
} from './TimelineExportService';
import type { BookMeta, RadialTimelineSettings, TimelineItem } from '../../types';

/**
 * Minimal settings stub carrying only the facade-consumed fields the render
 * config snapshot reads. Cast through the full settings type — the builder only
 * touches the enumerated keys.
 */
function makeSettings(overrides: Partial<RadialTimelineSettings> = {}): RadialTimelineSettings {
    return {
        publishStageColors: { Zero: '#111111', Author: '#222222', House: '#333333', Press: '#444444' },
        subplotColors: ['#aaaaaa', '#bbbbbb'],
        enableAiSceneAnalysis: false,
        currentMode: 'narrative',
        sortByWhenDate: false,
        actCount: 3,
        books: [],
        activeBookId: 'book-1',
        ...overrides,
    } as unknown as RadialTimelineSettings;
}

function makeItems(): TimelineItem[] {
    return [
        { title: '1 Opening', date: '2020-01-01', path: 'Book/1 Opening.md', itemType: 'Scene', when: new Date('2020-01-01T00:00:00Z') },
        { title: 'Copyright', date: '', path: 'Book/0.1 Copyright.md', itemType: 'Frontmatter', matterMeta: { side: 'front', role: 'copyright' } },
        { title: 'Acknowledgments', date: '', path: 'Book/200.1 Ack.md', itemType: 'Backmatter', matterMeta: { side: 'back', role: 'acknowledgments' } },
    ];
}

function makeParams(overrides: Partial<BuildTimelineDataExportParams> = {}): BuildTimelineDataExportParams {
    const bookMeta: BookMeta = { title: 'Test Book', author: 'A. Writer', sourcePath: 'Book/BookMeta.md' };
    return {
        items: makeItems(),
        bookMeta,
        settings: makeSettings(),
        pluginVersion: '6.2.6',
        mode: 'narrative',
        activeBookId: 'book-1',
        bookTitle: 'Test Book',
        now: new Date('2026-07-19T12:00:00Z'),
        ...overrides,
    };
}

describe('buildTimelineDataExport', () => {
    it('stamps the schema version, timestamp, generator, and plugin version', () => {
        const doc = buildTimelineDataExport(makeParams());
        expect(doc.schemaVersion).toBe(TIMELINE_DATA_EXPORT_SCHEMA_VERSION);
        expect(doc.schemaVersion).toBe('1.0.0');
        expect(doc.exportedAt).toBe('2026-07-19T12:00:00.000Z');
        expect(doc.generator).toBe('Radial Timeline');
        expect(doc.pluginVersion).toBe('6.2.6');
    });

    it('includes the full item array as fed to the renderer', () => {
        const items = makeItems();
        const doc = buildTimelineDataExport(makeParams({ items }));
        expect(doc.items).toHaveLength(items.length);
        expect(doc.context.itemCount).toBe(items.length);
        expect(doc.items[0].title).toBe('1 Opening');
    });

    it('extracts front/back matter entries with their parsed matter meta', () => {
        const doc = buildTimelineDataExport(makeParams());
        expect(doc.matter).toHaveLength(2);
        const roles = doc.matter.map((m) => m.matterMeta?.role).sort();
        expect(roles).toEqual(['acknowledgments', 'copyright']);
        expect(doc.matter.every((m) => typeof m.path === 'string')).toBe(true);
    });

    it('carries book meta through and tolerates a null book meta', () => {
        expect(buildTimelineDataExport(makeParams()).bookMeta?.title).toBe('Test Book');
        expect(buildTimelineDataExport(makeParams({ bookMeta: null })).bookMeta).toBeNull();
    });

    it('deep-clones input so later mutation does not leak into the document', () => {
        const items = makeItems();
        const doc = buildTimelineDataExport(makeParams({ items }));
        items[0].title = 'MUTATED';
        expect(doc.items[0].title).toBe('1 Opening');
    });

    it('contains no machine-specific absolute paths', () => {
        const doc = buildTimelineDataExport(makeParams());
        const serialized = JSON.stringify(doc);
        expect(serialized).not.toContain('/Users/');
        expect(serialized).not.toContain('/home/');
        expect(serialized).not.toMatch(/[A-Za-z]:\\\\/); // Windows drive path
    });
});

describe('snapshotRenderConfig', () => {
    it('captures the facade-consumed settings subset as values', () => {
        const settings = makeSettings({ readabilityScale: 'large' as RadialTimelineSettings['readabilityScale'] });
        const config = snapshotRenderConfig(settings);
        expect(config.publishStageColors).toEqual(settings.publishStageColors);
        expect(config.subplotColors).toEqual(settings.subplotColors);
        expect(config.enableAiSceneAnalysis).toBe(false);
        expect(config.currentMode).toBe('narrative');
        expect(config.actCount).toBe(3);
        expect(config.activeBookId).toBe('book-1');
    });

    it('does not carry keys outside the facade-consumed subset', () => {
        const settings = makeSettings({ pandocPath: '/usr/local/bin/pandoc' } as Partial<RadialTimelineSettings>);
        const config = snapshotRenderConfig(settings);
        expect(config as Record<string, unknown>).not.toHaveProperty('pandocPath');
    });
});
