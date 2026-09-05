/*
 * Structured Response Envelope Unwrap
 *
 * Provider-agnostic post-parse normalization for AI structured outputs.
 * Some providers — observed in production with Anthropic Claude Opus 4.7
 * tool_use — return a semantically complete response wrapped in a
 * single-key envelope:
 *
 *   {"input":           {"beats": [...], "overallAssessment": {...}}}
 *   {"$PARAMETER_NAME": {"beats": [...], "overallAssessment": {...}}}
 *
 * The wrapping is a known formatting defect of the model's tool_use
 * adapter, not a content error: every interior field is present and
 * correct. Without unwrap, the caller's validator (rightly) rejects the
 * shape and the user pays for a discarded response.
 *
 * This helper performs *narrow, auditable* structural correction:
 *
 *   - Root must be a non-array object with EXACTLY ONE own key.
 *   - That key must be in an explicit allow-list of known wrapper names.
 *   - The wrapped value must be a non-array object that contains EVERY
 *     declared canonical key (e.g. "beats", "overallAssessment").
 *   - The root must NOT itself contain any canonical key (paranoia guard
 *     against collisions if a future caller adds a canonical key that is
 *     also a known wrapper name).
 *   - No recursion: only one envelope is removed per call.
 *   - Arrays, scalars, multi-key objects, and any partial match are
 *     returned unchanged.
 *
 * If those conditions hold, the wrapped value is returned and the
 * onUnwrap callback fires so the caller can record an audit line
 * (e.g. into the run-log's schemaWarnings) along the lines of:
 *
 *   `Unwrapped Anthropic tool envelope key "input" before validation`
 *
 * The caller's strict validator runs on the returned value either way —
 * unwrap never bypasses validation, it only corrects a known shape
 * defect before the validator runs.
 */

/**
 * Canonical list of envelope keys observed in the wild (or documented as
 * placeholders in tool_use adapters). Order has no semantic meaning;
 * membership is what's checked. Extend conservatively — every entry is a
 * key the unwrap function will silently strip when the rest of the
 * conditions match.
 */
export const DEFAULT_ENVELOPE_WRAPPER_KEYS = [
    'input',
    'output',
    'data',
    'response',
    'result',
    'parameters',
    'arguments',
    '$PARAMETER_NAME',
    '$INPUT'
] as const;

export interface UnwrapOptions {
    /** Override the default wrapper-key allow-list. */
    allowedWrapperKeys?: readonly string[];
    /** Fires once with the wrapper key name when an unwrap actually happens. */
    onUnwrap?: (wrapperKey: string) => void;
}

export interface UnwrapResult<T> {
    /** The unwrapped value, or the original parsed input if no unwrap occurred. */
    value: T;
    /** The wrapper key that was removed, or null if no unwrap occurred. */
    unwrappedKey: string | null;
}

/**
 * Conditionally remove a single-key envelope from a parsed structured
 * response. See module header for the full rule set — the conditions are
 * deliberately narrow so a real broken response is never silently
 * "repaired" into a valid-looking one.
 */
export function unwrapStructuredEnvelope<T = unknown>(
    parsed: unknown,
    canonicalKeys: readonly string[],
    options?: UnwrapOptions
): UnwrapResult<T> {
    const noChange: UnwrapResult<T> = { value: parsed as T, unwrappedKey: null };

    if (!isPlainObject(parsed)) return noChange;
    const root = parsed;
    const rootKeys = Object.keys(root);
    if (rootKeys.length !== 1) return noChange;

    const wrapperCandidate = rootKeys[0];
    const allowed = options?.allowedWrapperKeys ?? DEFAULT_ENVELOPE_WRAPPER_KEYS;
    if (!allowed.includes(wrapperCandidate)) return noChange;

    const inner = root[wrapperCandidate];
    if (!isPlainObject(inner)) return noChange;
    const innerObj = inner;

    // Inner must contain every declared canonical key — that's how we know
    // we're looking at a wrapped version of the expected response, not a
    // coincidentally-single-keyed object whose value happens to be an object.
    for (const canonicalKey of canonicalKeys) {
        if (!(canonicalKey in innerObj)) return noChange;
    }

    // Root collision guard: if the root already contained a canonical key,
    // refuse to unwrap. Given rootKeys.length === 1 and wrapperCandidate is
    // already constrained to the allow-list (which intentionally does not
    // overlap with typical canonical keys), this check normally never
    // triggers. It exists so a caller cannot accidentally make the allow-list
    // overlap with a canonical key and produce a wrong unwrap.
    for (const canonicalKey of canonicalKeys) {
        if (canonicalKey in root) return noChange;
    }

    options?.onUnwrap?.(wrapperCandidate);
    return { value: inner as T, unwrappedKey: wrapperCandidate };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
