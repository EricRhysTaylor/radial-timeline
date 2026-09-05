export function buildInquiryJsonSchema(): Record<string, unknown> {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            schema_version: { type: 'number' },
            summaryFlow: { type: 'string' },
            summaryDepth: { type: 'string' },
            verdictFlow: { type: 'number' },
            verdictDepth: { type: 'number' },
            findings: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        ref_id: { type: 'string' },
                        ref_label: { type: 'string' },
                        ref_path: { type: 'string' },
                        kind: { type: 'string' },
                        lens: { type: 'string' },
                        headline: { type: 'string' },
                        bullets: { type: 'array', items: { type: 'string' } },
                        recommended_action: { type: 'string' },
                        subject: { type: 'string' },
                        span: { type: 'string' },
                        evidence_quote: { type: 'string' },
                        supporting_refs: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    ref_id: { type: 'string' },
                                    ref_label: { type: 'string' },
                                    ref_path: { type: 'string' },
                                    quote: { type: 'string' }
                                },
                                required: ['ref_id', 'ref_label', 'ref_path', 'quote']
                            }
                        },
                        role: { type: 'string' }
                    },
                    required: ['ref_id', 'ref_label', 'ref_path', 'kind', 'lens', 'headline', 'bullets', 'recommended_action', 'subject', 'span', 'evidence_quote', 'supporting_refs', 'role']
                }
            }
        },
        required: ['schema_version', 'summaryFlow', 'summaryDepth', 'verdictFlow', 'verdictDepth', 'findings']
    };
}

export function buildInquiryOmnibusJsonSchema(): Record<string, unknown> {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            schema_version: { type: 'number' },
            results: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        question_id: { type: 'string' },
                        summaryFlow: { type: 'string' },
                        summaryDepth: { type: 'string' },
                        verdictFlow: { type: 'number' },
                        verdictDepth: { type: 'number' },
                        findings: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    ref_id: { type: 'string' },
                                    ref_label: { type: 'string' },
                                    ref_path: { type: 'string' },
                                    kind: { type: 'string' },
                                    lens: { type: 'string' },
                                    headline: { type: 'string' },
                                    bullets: { type: 'array', items: { type: 'string' } },
                                    recommended_action: { type: 'string' },
                                    subject: { type: 'string' },
                                    span: { type: 'string' },
                                    evidence_quote: { type: 'string' },
                                    supporting_refs: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                                ref_id: { type: 'string' },
                                                ref_label: { type: 'string' },
                                                ref_path: { type: 'string' },
                                                quote: { type: 'string' }
                                            },
                                            required: ['ref_id', 'ref_label', 'ref_path', 'quote']
                                        }
                                    },
                                    role: { type: 'string' }
                                },
                                required: ['ref_id', 'ref_label', 'ref_path', 'kind', 'lens', 'headline', 'bullets', 'recommended_action', 'subject', 'span', 'evidence_quote', 'supporting_refs', 'role']
                            }
                        }
                    },
                    required: ['question_id', 'summaryFlow', 'summaryDepth', 'verdictFlow', 'verdictDepth', 'findings']
                }
            }
        },
        required: ['schema_version', 'results']
    };
}
