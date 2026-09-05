/*
 * Exhaustiveness helper for closed unions.
 *
 * Use as the `default:` branch of a switch over a closed TS union so the
 * compiler flags any new union member that is added without a corresponding
 * case. At runtime, a forced unreachable branch surfaces a clear error.
 */

export function assertNever(value: never, context?: string): never {
    throw new Error(`Unhandled case${context ? ` in ${context}` : ''}: ${String(value)}`);
}
