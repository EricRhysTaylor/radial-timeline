const REDACTED = '[REDACTED]';

const SENSITIVE_FIELD_NAMES = new Set([
    'apikey',
    'api_key',
    'api-key',
    'authorization',
    'xapikey',
    'x_api_key',
    'x-api-key',
    'token',
    'accesstoken',
    'access_token',
    'refresh_token',
    'refreshtoken',
    'secret',
    'key'
]);

function normalizeFieldName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function isHandleLikeFieldName(value: string): boolean {
    const normalized = normalizeFieldName(value);
    return normalized.endsWith('id') || normalized.endsWith('name') || normalized.endsWith('handle');
}

function isSensitiveFieldName(value: string): boolean {
    if (!value) return false;
    if (isHandleLikeFieldName(value)) return false;
    const normalized = normalizeFieldName(value);
    if (SENSITIVE_FIELD_NAMES.has(normalized)) return true;
    return false;
}

function redactQueryParams(input: string): string {
    return input.replace(
        /([?&](?:key|api[_-]?key|access_token|token|secret)=)([^&#\s]+)/gi,
        (_, prefix: string) => `${prefix}${REDACTED}`
    );
}

export function redactSensitiveValue(str: string): string {
    if (!str) return str;

    let value = str;
    value = redactQueryParams(value);
    value = value.replace(
        /(authorization\s*[:=]\s*["']?\s*bearer\s+)([^"'\s,;]+)/gi,
        (_, prefix: string) => `${prefix}${REDACTED}`
    );
    value = value.replace(
        /(\bx-api-key\b\s*[:=]\s*["']?)([^"'\s,;]+)/gi,
        (_, prefix: string) => `${prefix}${REDACTED}`
    );
    value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`);
    value = value.replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED);
    value = value.replace(/sk-[A-Za-z0-9_-]{10,}/g, REDACTED);
    value = value.replace(/AIza[0-9A-Za-z_-]{16,}/g, REDACTED);
    return value;
}

function cloneAndRedact(value: unknown, seen: WeakMap<object, unknown>): unknown {
    if (typeof value === 'string') {
        return redactSensitiveValue(value);
    }

    if (Array.isArray(value)) {
        return value.map(item => cloneAndRedact(item, seen));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (seen.has(value)) {
        return '[Circular]';
    }

    if (value instanceof Error) {
        const next: Record<string, unknown> = {
            name: value.name,
            message: redactSensitiveValue(value.message)
        };
        if (value.stack) next.stack = redactSensitiveValue(value.stack);
        seen.set(value, next);
        Object.entries(value).forEach(([key, nested]) => {
            if (isSensitiveFieldName(key)) {
                next[key] = REDACTED;
            } else {
                next[key] = cloneAndRedact(nested, seen);
            }
        });
        return next;
    }

    const output: Record<string, unknown> = {};
    seen.set(value, output);
    Object.entries(value).forEach(([key, nested]) => {
        if (isSensitiveFieldName(key)) {
            output[key] = REDACTED;
            return;
        }
        output[key] = cloneAndRedact(nested, seen);
    });
    return output;
}

export function redactSensitiveObject<T>(obj: T): T {
    return cloneAndRedact(obj, new WeakMap<object, unknown>()) as T;
}
