import { describe, expect, it } from 'vitest';
import { buildInquiryJsonSchema, buildInquiryOmnibusJsonSchema } from './jsonSchema';

function assertOpenAiStrictObjectContracts(schema: Record<string, any>): void {
    if (schema.type === 'object' && schema.additionalProperties === false) {
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

describe('Inquiry JSON schemas', () => {
    it('closes all Inquiry strict-output object shapes', () => {
        const schema = buildInquiryJsonSchema() as Record<string, any>;
        assertOpenAiStrictObjectContracts(schema);
    });

    it('closes all Inquiry omnibus strict-output object shapes', () => {
        const schema = buildInquiryOmnibusJsonSchema() as Record<string, any>;
        assertOpenAiStrictObjectContracts(schema);
    });

    it('exposes verdict as flat verdictFlow/verdictDepth, never a nested object (Opus 4.8 corrupts nested tool inputs)', () => {
        const single = buildInquiryJsonSchema() as Record<string, any>;
        expect(single.properties.verdict).toBeUndefined();
        expect(single.properties.verdictFlow).toEqual({ type: 'number' });
        expect(single.properties.verdictDepth).toEqual({ type: 'number' });
        expect(single.required).toEqual(expect.arrayContaining(['verdictFlow', 'verdictDepth']));

        const omnibus = buildInquiryOmnibusJsonSchema() as Record<string, any>;
        const resultItems = omnibus.properties.results.items;
        expect(resultItems.properties.verdict).toBeUndefined();
        expect(resultItems.properties.verdictFlow).toEqual({ type: 'number' });
        expect(resultItems.properties.verdictDepth).toEqual({ type: 'number' });
        expect(resultItems.required).toEqual(expect.arrayContaining(['verdictFlow', 'verdictDepth']));
    });

    it('requires ref_id, ref_label, and ref_path on every finding so hallucinated citations can be rescued via label/path', () => {
        const schema = buildInquiryJsonSchema() as Record<string, any>;
        const findingItems = schema.properties.findings.items;
        expect(findingItems.required).toEqual(expect.arrayContaining(['ref_id', 'ref_label', 'ref_path']));
        expect(findingItems.required).toEqual(expect.arrayContaining(['recommended_action', 'subject', 'span', 'supporting_refs']));
        expect(findingItems.properties.ref_label).toEqual({ type: 'string' });
        expect(findingItems.properties.ref_path).toEqual({ type: 'string' });
        expect(findingItems.properties.recommended_action).toEqual({ type: 'string' });
        expect(findingItems.properties.supporting_refs.items.required).toEqual(['ref_id', 'ref_label', 'ref_path', 'quote']);
    });

    it('requires ref_id, ref_label, and ref_path on omnibus findings', () => {
        const schema = buildInquiryOmnibusJsonSchema() as Record<string, any>;
        const findingItems = schema.properties.results.items.properties.findings.items;
        expect(findingItems.required).toEqual(expect.arrayContaining(['ref_id', 'ref_label', 'ref_path']));
        expect(findingItems.required).toEqual(expect.arrayContaining(['recommended_action', 'subject', 'span', 'supporting_refs']));
        expect(findingItems.properties.ref_label).toEqual({ type: 'string' });
        expect(findingItems.properties.ref_path).toEqual({ type: 'string' });
        expect(findingItems.properties.recommended_action).toEqual({ type: 'string' });
    });
});
