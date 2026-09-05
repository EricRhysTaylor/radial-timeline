export function buildOutputRulesText(params: {
    outputRules?: string;
    returnType?: string;
    responseSchema?: Record<string, unknown>;
}): string {
    if (params.outputRules && params.outputRules.trim().length > 0) {
        return params.outputRules;
    }
    if (params.returnType === 'json') {
        const schemaText = params.responseSchema
            ? JSON.stringify(params.responseSchema, null, 2)
            : '{}';
        return `Return JSON only. Validate against this schema:\n${schemaText}`;
    }
    return 'Return plain text only.';
}
