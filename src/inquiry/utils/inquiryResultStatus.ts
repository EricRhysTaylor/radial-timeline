/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { InquiryResult } from '../state';
import type { InquirySession, InquirySessionStatus } from '../sessionTypes';

/**
 * Whether the result represents a hard failure.
 *
 * A result is considered erroneous when the provider reported a non-success
 * status (anything other than `success` or `degraded` — the latter is still
 * usable content) OR when any finding came back with `kind === 'error'`.
 *
 * `null`/`undefined` is treated as "no result, no error" — an absence, not
 * a failure.
 */
export function isInquiryResultError(result: InquiryResult | null | undefined): boolean {
    if (!result) return false;
    if (result.aiStatus && result.aiStatus !== 'success' && result.aiStatus !== 'degraded') return true;
    return result.findings.some(finding => finding.kind === 'error');
}

/**
 * Whether the result was returned as degraded — i.e. the provider succeeded
 * but flagged partial fidelity (e.g. recovered after an invalid response).
 */
export function isInquiryResultDegraded(result: InquiryResult | null | undefined): boolean {
    return !!result && (result.aiStatus === 'degraded' || result.aiReason === 'recovered_invalid_response');
}

/**
 * Resolve the status pill shown next to a session in the briefing popover.
 *
 * Precedence:
 *   1. `simulated` override (debug/diagnostics)
 *   2. The session's explicitly persisted `status`, if set
 *   3. `error` when the underlying result is erroneous
 *   4. `saved` when a brief artifact path exists
 *   5. `unsaved` otherwise
 */
export function resolveInquirySessionStatus(
    session: InquirySession,
    options?: { simulated?: boolean }
): InquirySessionStatus {
    if (options?.simulated) return 'simulated';
    if (session.status) return session.status;
    if (isInquiryResultError(session.result)) return 'error';
    if (session.briefPath) return 'saved';
    return 'unsaved';
}

/**
 * Resolve the status for a result that is not yet attached to a persisted
 * session (e.g. mid-run synthesis). Only `simulated` and `error` are
 * detectable here; everything else collapses to `unsaved`.
 */
export function resolveInquirySessionStatusFromResult(
    result: InquiryResult,
    options?: { simulated?: boolean }
): InquirySessionStatus {
    if (options?.simulated) return 'simulated';
    if (isInquiryResultError(result)) return 'error';
    return 'unsaved';
}
