import { describe, expect, it } from 'vitest';
import { getUnifiedBeatAnalysisJsonSchema } from './unifiedBeatAnalysis';
import { getSceneAnalysisJsonSchema } from './sceneAnalysis';
import { getSummaryJsonSchema, getSynopsisJsonSchema } from './synopsis';
import { getRuntimeAiResponseSchema } from '../../RuntimeCommands';
import { getTimelineAuditAiResponseSchema } from '../../timelineAudit/AuditPipeline';

/**
 * Asserts that an arbitrary JSON schema satisfies OpenAI structured-output
 * strict mode:
 *   - every type:object node has additionalProperties:false
 *   - every type:object node's required[] covers all property keys
 *   - recursively applies to properties and array items
 *
 * Previous version only enforced the required==properties check WHEN
 * additionalProperties was already false — schemas that simply omitted
 * additionalProperties slipped through. That left RuntimeCommands and
 * TimelineAuditAI silently incompatible with OpenAI strict mode until
 * the 2026-05-23 audit caught it.
 */
function assertOpenAiStrictObjectContracts(schema: Record<string, any>): void {
    if (schema.type === 'object') {
        expect(schema.additionalProperties, `schema node missing additionalProperties:false`).toBe(false);
        const propertyKeys = Object.keys(schema.properties || {}).sort();
        const requiredKeys = Array.isArray(schema.required) ? [...schema.required].sort() : [];
        expect(requiredKeys).toEqual(propertyKeys);
    }

    Object.values(schema.properties || {}).forEach(value => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            assertOpenAiStrictObjectContracts(value as Record<string, any>);
        }
    });

    const items = schema.items;
    if (items && typeof items === 'object' && !Array.isArray(items)) {
        assertOpenAiStrictObjectContracts(items as Record<string, any>);
    }
}

describe('Strict JSON schemas', () => {
    it('keeps unified beat analysis OpenAI-strict compatible', () => {
        const schema = getUnifiedBeatAnalysisJsonSchema() as Record<string, any>;
        assertOpenAiStrictObjectContracts(schema);
    });

    it('keeps scene analysis OpenAI-strict compatible', () => {
        const schema = getSceneAnalysisJsonSchema() as Record<string, any>;
        assertOpenAiStrictObjectContracts(schema);
    });

    it('keeps summary and synopsis OpenAI-strict compatible', () => {
        assertOpenAiStrictObjectContracts(getSummaryJsonSchema() as Record<string, any>);
        assertOpenAiStrictObjectContracts(getSynopsisJsonSchema() as Record<string, any>);
    });

    it('keeps RuntimeAI per-scene response OpenAI-strict compatible', () => {
        assertOpenAiStrictObjectContracts(getRuntimeAiResponseSchema() as Record<string, any>);
    });

    it('keeps TimelineAuditAI per-scene response OpenAI-strict compatible', () => {
        assertOpenAiStrictObjectContracts(getTimelineAuditAiResponseSchema() as Record<string, any>);
    });
});
