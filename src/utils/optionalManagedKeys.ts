import type { NoteType } from './yamlTemplateNormalize';
import {
    SHARED_PART_EPIGRAPH_BY_FIELD_KEY,
    SHARED_PART_EPIGRAPH_FIELD_KEY,
    SHARED_PART_FIELD_KEY,
} from './timelineParts';

/**
 * Optional-managed note properties.
 *
 * Doctrine:
 *   Templates define fields seeded into new notes. The optional-managed registry
 *   defines author-facing fields Radial Timeline may insert through an explicit
 *   author action or approved migration. Both are RT-owned schema;
 *   optional-managed fields are absent by default.
 *
 * This supersedes "YAML manager templates define managed fields" as the whole
 * story. It is not a licence to put plugin state in note YAML: the registry is
 * restricted to **author-facing** fields. Operational state (provenance,
 * migration stamps, run bookkeeping) stays out of frontmatter and lives in
 * sidecars.
 *
 * A registered key is:
 *   - **known** to the audit and to the safety scanner, so a note carrying one is
 *     not reported as "Not managed by Radial Timeline" and the field is not
 *     offered up for deletion as a foreign key;
 *   - **canonically ordered**, so when RT inserts it, it lands in a defined place
 *     and the reorder pass keeps it there;
 *   - **never demanded** — excluded from missing-field checks, backfill, and
 *     ordinary note creation, because absent is its normal state.
 *
 * Why a registry rather than the template: a key in no template is reported as
 * `extraKeys` (`yamlAudit.ts`), regardless of any missing-field exemption.
 * `insertMissingChapterFrontmatter` works only because `Chapter` already ships in
 * the Scene base template. Part fields must not ship there — most scenes never
 * carry them — so they need schema standing without template membership.
 *
 * `sceneAiSchemaKeys` in `yamlAudit.ts` solves a similar problem for AI keys, but
 * it is an audit-local exception that governs neither ordering nor insertion, and
 * it is deliberately *not* extended here.
 */

export interface OptionalManagedKeyDefinition {
    key: string;
    /**
     * Preferred canonical position: the registry places this key immediately
     * before `anchorBefore` when that key is present in the note type's order.
     */
    anchorBefore?: string;
    /**
     * Fallback anchors, tried in order, when `anchorBefore` is absent from a
     * customized template. The key is placed immediately after the first match.
     * When nothing matches, the key is appended.
     */
    anchorAfter?: readonly string[];
}

/**
 * Part markers are author-facing publishing structure: a boundary that owns a
 * range of scenes, plus the epigraph printed on its opener. They sit immediately
 * before `Chapter` because the structural nesting is Part → Chapter → Scene.
 */
const SCENE_OPTIONAL_MANAGED_KEYS: readonly OptionalManagedKeyDefinition[] = [
    {
        key: SHARED_PART_FIELD_KEY,
        anchorBefore: 'Chapter',
        anchorAfter: ['Duration', 'When', 'Act', 'Class'],
    },
    {
        key: SHARED_PART_EPIGRAPH_FIELD_KEY,
        anchorBefore: 'Chapter',
        anchorAfter: [SHARED_PART_FIELD_KEY, 'Duration', 'When', 'Act', 'Class'],
    },
    {
        key: SHARED_PART_EPIGRAPH_BY_FIELD_KEY,
        anchorBefore: 'Chapter',
        anchorAfter: [SHARED_PART_EPIGRAPH_FIELD_KEY, 'Duration', 'When', 'Act', 'Class'],
    },
];

const OPTIONAL_MANAGED_KEYS: Record<NoteType, readonly OptionalManagedKeyDefinition[]> = {
    Scene: SCENE_OPTIONAL_MANAGED_KEYS,
    Beat: [],
    Backdrop: [],
};

/** Registered optional-managed keys for a note type, in declaration order. */
export function getOptionalManagedKeys(noteType: NoteType): string[] {
    return OPTIONAL_MANAGED_KEYS[noteType].map((definition) => definition.key);
}

/**
 * True when `key` is RT-owned schema that is legitimately absent by default.
 *
 * Deliberately kept separate from `getExcludeKeyPredicate`: that predicate marks
 * *dynamic* and *legacy* keys, and the settings UI labels anything it matches as
 * RT-managed dynamic state. Optional-managed keys are neither — they are current,
 * author-facing schema.
 */
export function isOptionalManagedKey(noteType: NoteType, key: string): boolean {
    return OPTIONAL_MANAGED_KEYS[noteType].some((definition) => definition.key === key);
}

/**
 * Splice a note type's optional-managed keys into a canonical key order.
 *
 * Ordering is what gives these keys an insertion position: `buildOrderedKeyList`
 * only places keys the note actually has, so a key absent from a note is ignored,
 * and a key present in a note lands where the order says. Keys already in `order`
 * (a template that happens to declare one) are left alone rather than duplicated.
 */
export function withOptionalManagedKeys(noteType: NoteType, order: string[]): string[] {
    const definitions = OPTIONAL_MANAGED_KEYS[noteType];
    if (definitions.length === 0) return order;

    const result = [...order];

    for (const definition of definitions) {
        if (result.includes(definition.key)) continue;

        if (definition.anchorBefore) {
            const beforeIndex = result.indexOf(definition.anchorBefore);
            if (beforeIndex >= 0) {
                result.splice(beforeIndex, 0, definition.key);
                continue;
            }
        }

        const afterIndex = (definition.anchorAfter ?? []).reduce<number>((found, anchor) => {
            if (found >= 0) return found;
            return result.indexOf(anchor);
        }, -1);

        if (afterIndex >= 0) {
            result.splice(afterIndex + 1, 0, definition.key);
            continue;
        }

        result.push(definition.key);
    }

    return result;
}
