/*
 * Stored-spec version migration.
 *
 * Designed layouts persist their DesignedStyleSpec in settings and read it back
 * as `JSON.parse(...) as DesignedStyleSpec` — a cast TypeScript cannot check. So
 * a spec written by an older plugin version claims the current version at the
 * type level while carrying whatever shape it was written with. These tests pin
 * the upgrade that makes the cast honest.
 */
import { describe, expect, it } from 'vitest';
import {
    DESIGNED_STYLE_SPEC_VERSION,
    migrateDesignedStyleSpec,
    type DesignedStyleSpec,
} from './designedStyle';

/** A v2 spec: the shape stored before `parts.title` existed. */
function buildV2Spec(): DesignedStyleSpec {
    return {
        specVersion: 2,
        archetype: 'structured',
        paperSize: 'us-trade-6x9',
        margins: { topIn: 1, bottomIn: 1, leftIn: 1, rightIn: 1, mirrored: false },
        body: {
            font: 'sorts-mill-goudy',
            fontFallbackChain: [],
            sizePt: 11,
            lineSpacing: 1.5,
            paragraphIndentEm: 1.5,
        },
        runningHeader: { mode: 'centered-title' },
        folio: { position: 'bottom-center' },
        parts: { mode: 'roman', pageBreak: true, epigraph: true },
        chapters: { mode: 'numbered-titled', pageBreak: true, resetSceneCounter: false },
        scene: {
            opener: 'inline-separator',
            headingMode: 'scene-number',
            suppressHeaderFooterOnOpener: false,
        },
        epigraph: { enabled: false, italic: false, attributionStyle: 'plain' },
    } as unknown as DesignedStyleSpec; // SAFE: models on-disk v2 JSON, which predates the current literal specVersion type.
}

describe('migrateDesignedStyleSpec', () => {
    it('upgrades a stored v2 spec to the current version', () => {
        const migrated = migrateDesignedStyleSpec(buildV2Spec());
        expect(migrated.specVersion).toBe(DESIGNED_STYLE_SPEC_VERSION);
    });

    it('defaults parts.title to false so a pre-title layout keeps printing numerals only', () => {
        const migrated = migrateDesignedStyleSpec(buildV2Spec());
        // The upgrade must be output-neutral: a v2 spec had no opinion about
        // titles because it could not have one, and numerals-only is what it rendered.
        expect(migrated.parts.title).toBe(false);
    });

    it('preserves every other part setting', () => {
        const source = buildV2Spec();
        const migrated = migrateDesignedStyleSpec(source);
        expect(migrated.parts.mode).toBe(source.parts.mode);
        expect(migrated.parts.pageBreak).toBe(source.parts.pageBreak);
        expect(migrated.parts.epigraph).toBe(source.parts.epigraph);
        expect(migrated.chapters).toEqual(source.chapters);
        expect(migrated.scene).toEqual(source.scene);
    });

    it('does not mutate the stored spec in place', () => {
        const source = buildV2Spec();
        migrateDesignedStyleSpec(source);
        expect(source.specVersion).toBe(2);
        expect(source.parts.title).toBeUndefined();
    });

    it('returns the same object when already current, so callers can skip persisting', () => {
        const current = migrateDesignedStyleSpec(buildV2Spec());
        // Identity, not equality — this is what lets the layout normalizer decide
        // whether settings actually need writing back.
        expect(migrateDesignedStyleSpec(current)).toBe(current);
    });

    it('upgrades a spec that carries the current version but lacks the new field', () => {
        // Possible if a spec was hand-edited, or written by a build between the
        // field landing and the version bump. Version alone is not proof of shape.
        const halfway = { ...buildV2Spec(), specVersion: DESIGNED_STYLE_SPEC_VERSION };
        const migrated = migrateDesignedStyleSpec(halfway);
        expect(migrated).not.toBe(halfway);
        expect(migrated.parts.title).toBe(false);
    });

    it('leaves an explicit title preference alone', () => {
        const titled = {
            ...buildV2Spec(),
            parts: { ...buildV2Spec().parts, title: true },
        };
        expect(migrateDesignedStyleSpec(titled).parts.title).toBe(true);
    });
});
