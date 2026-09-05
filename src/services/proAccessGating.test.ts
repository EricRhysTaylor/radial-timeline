/*
 * Regression tests for the Pro→Core fallback wiring in the export pipeline.
 *
 * Background: a recent refactor hardcoded `hasProAccess: true` at two
 * `resolveTemplateAccess(...)` call sites (CommandRegistrar + PublishingValidationService)
 * and also flattened the manuscript-preset auto-pick gate, silently disabling the
 * Core-user fallback chain. These tests exercise the WIRING — they confirm that the
 * services consult `hasProFeatureAccess(plugin)` rather than passing a constant.
 *
 * The pure tier resolution logic is covered by `templateTiering.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate, RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { PublishingValidationService } from './PublishingValidationService';

function writeTempTemplate(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-pro-gating-'));
    const filePath = path.join(dir, 'template.tex');
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

function makeNovelLayout(content: string, overrides: Partial<PandocLayoutTemplate> = {}): PandocLayoutTemplate {
    return {
        id: overrides.id || 'test-layout',
        name: overrides.name || 'Test Layout',
        preset: 'novel',
        path: writeTempTemplate(content),
        bundled: false,
        ...overrides,
    };
}

function createPlugin(layouts: PandocLayoutTemplate[], options: { pro: boolean }): RadialTimelinePlugin {
    const settings: RadialTimelineSettings = {
        ...DEFAULT_SETTINGS,
        books: [{
            id: 'book-1',
            title: 'Example Book',
            sourceFolder: 'Book',
        }],
        activeBookId: 'book-1',
        pandocLayouts: layouts,
        // hasProFeatureAccess() returns false when the license key is empty / too short.
        proLicenseKey: options.pro ? '1234567890123456' : '',
    };

    return {
        settings,
        app: {
            vault: {
                getMarkdownFiles: () => [],
                getAbstractFileByPath: () => null,
            },
            metadataCache: {
                getFileCache: () => null,
            },
        },
        getBookMeta: () => ({
            title: 'Example Book',
            author: 'Example Author',
            sourcePath: 'Book/000 BookMeta.md',
        }),
    } as unknown as RadialTimelinePlugin;
}

const BASIC_ID = 'bundled-fiction-classic-manuscript';
const SIGNATURE_ID = 'bundled-fiction-signature-literary';

function basicLayout(): PandocLayoutTemplate {
    return makeNovelLayout('$body$', {
        id: BASIC_ID,
        name: 'Standard Manuscript',
        bundled: true,
        tier: 'free',
        templateKind: 'book',
    });
}

function signatureLayout(): PandocLayoutTemplate {
    return makeNovelLayout('$title$\n$body$', {
        id: SIGNATURE_ID,
        name: 'Signature Literary',
        bundled: true,
        tier: 'pro',
        templateKind: 'book',
    });
}

describe('Pro access gating — PublishingValidationService.collect wiring', () => {
    it('falls a Core user (no license) selecting a Pro template back to Standard Manuscript', () => {
        const plugin = createPlugin([basicLayout(), signatureLayout()], { pro: false });

        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: SIGNATURE_ID,
        });

        expect(snapshot.templateAccess).toBeDefined();
        expect(snapshot.templateAccess?.usedFallback).toBe(true);
        expect(snapshot.templateAccess?.requestedTemplateId).toBe(SIGNATURE_ID);
        expect(snapshot.templateAccess?.effectiveTemplateId).toBe(BASIC_ID);
    });

    it('does NOT fall back when the user has a valid Pro license', () => {
        const plugin = createPlugin([basicLayout(), signatureLayout()], { pro: true });

        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            selectedLayoutId: SIGNATURE_ID,
        });

        expect(snapshot.templateAccess).toBeDefined();
        expect(snapshot.templateAccess?.usedFallback).toBe(false);
        expect(snapshot.templateAccess?.effectiveTemplateId).toBe(SIGNATURE_ID);
    });

    it('auto-picks a free-tier layout for a Core user when only Pro+free are available', () => {
        // With both a Pro layout and Standard (free) available, the auto-pick gate must
        // filter to free-only for a Core user, then return Standard. This documents
        // the first arm of the gate (the .find(item => hasProAccess || tier === 'free')
        // filter) — without it the Core user still gets Standard here, but only
        // because Standard happens to outrank Pro in the sort order. The gate's
        // observable distinct effect is the presence of `requestedLayout` in the
        // resolution: with no Pro filter, an all-Pro list would yield a Pro-tier
        // request; with the filter, the Core user gets Standard via the explicit
        // free-tier filter even when the Pro layout sort-rank would otherwise win.
        const plugin = createPlugin([signatureLayout(), basicLayout()], { pro: false });

        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
            // selectedLayoutId omitted on purpose — exercises the auto-pick path.
        });

        // A Core user must never silently end up on a Pro template via auto-pick.
        expect(snapshot.templateAccess?.requestedTemplateId).toBe(BASIC_ID);
        expect(snapshot.templateAccess?.usedFallback).toBe(false);
    });

    it('auto-pick on a Pro-only library yields a Pro request for a Pro user', () => {
        // No free layout available. Pro user must still resolve to a Pro layout
        // without falling back. Without the gate this works trivially; the test
        // documents the wired behavior end-to-end.
        const plugin = createPlugin([signatureLayout()], { pro: true });

        const snapshot = new PublishingValidationService(plugin).collect('book-1', {
            exportType: 'manuscript',
            outputFormat: 'pdf',
            manuscriptPreset: 'novel',
        });

        expect(snapshot.templateAccess?.requestedTemplateId).toBe(SIGNATURE_ID);
        expect(snapshot.templateAccess?.usedFallback).toBe(false);
    });
});
