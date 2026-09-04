import type { SourceCitation } from '../ai/types';
import type { TokenUsage } from '../ai/usage/providerUsage';
import type { InquiryQuestionPromptForm } from './questions/resolveQuestionPrompt';

export type InquiryScope = 'book' | 'saga';
export type InquiryLens = 'flow' | 'depth';
export type InquirySelectionMode = 'discover' | 'focused';
export type InquiryZone = 'setup' | 'pressure' | 'payoff';
export type InquiryPromptFormOverride = 'auto' | 'standard' | 'focused';

export type InquiryAiStatus = 'success' | 'degraded' | 'rejected' | 'unavailable' | 'timeout' | 'auth' | 'rate_limit';
export type InquiryTokenUsageScope = 'full' | 'partial' | 'synthesis_only';
export type FindingRole = 'target' | 'context';
export type InquiryRoleValidation = 'ok' | 'missing-target-roles';

export type InquiryCitation = SourceCitation;

/**
 * Classifies why a prior inquiry run is now stale relative to the current corpus.
 * A run may have multiple reasons (e.g. one scene edited AND another added).
 */
export type InquiryStaleReason =
    | { kind: 'scenes_edited'; paths: string[] }
    | { kind: 'scenes_added'; paths: string[] }
    | { kind: 'scenes_removed'; paths: string[] }
    | { kind: 'inclusion_changed'; paths: string[] }
    | { kind: 'target_changed'; paths: string[] }
    | { kind: 'corpus_changed'; paths: string[] };

export interface InquiryStaleDiagnosis {
    reasons: InquiryStaleReason[];
    /** Short fragment for badges: e.g. "1 scene edited", "corpus changed". */
    shortLabel: string;
    /** Detail lines for tooltips / modal: each describes one reason with scene names. */
    tooltipLines: string[];
}

export interface EvidenceDocumentMeta {
    /** Display title (e.g. "The Red Night" or "Book outline"). */
    title: string;
    /** Vault-relative file path for navigation. */
    path?: string;
    /** Scene ID (e.g. "S42"), if a scene document. */
    sceneId?: string;
    /** Evidence class: "scene", "outline", or formatted reference class. */
    evidenceClass: string;
}

export interface InquiryVerdict {
    flow: number;
    depth: number;
}

export interface InquiryFinding {
    refId: string;
    kind: 'none' | 'loose_end' | 'continuity' | 'escalation' | 'conflict' | 'unclear' | 'error' | 'strength' | 'thread' | 'arc' | 'payoff' | 'structure';
    headline: string;
    bullets: string[];
    /**
     * Concrete author-facing edit/check recommendation derived from the finding.
     * Empty/omitted means the finding is informational enough that no separate
     * action should be written into the brief or scene frontmatter.
     */
    recommendedAction?: string;
    subject?: string;
    span?: string;
    /**
     * Verbatim sentence/phrase from the cited scene that grounds this finding.
     * Empty string when the cited scene is authorial notes/placeholder with no
     * quotable prose. Surfaced in the Sources block as the truthful quote — never
     * synthesized from the AI's headline or bullets.
     */
    evidenceQuote?: string;
    related: string[];
    supportingRefs?: Array<{
        refId: string;
        refLabel?: string;
        refPath?: string;
        quote?: string;
    }>;
    evidenceType: 'scene' | 'outline' | 'mixed';
    lens?: 'flow' | 'depth' | 'both';
    role?: FindingRole;
    /**
     * Original ref values emitted by the AI, preserved when normalization altered
     * or had to infer the canonical ref. Present only for findings whose ref_id
     * was rescued from a non-canonical or fabricated value.
     */
    rawRef?: {
        refId?: string;
        refLabel?: string;
        refPath?: string;
    };
}

/**
 * A finding whose AI-supplied ref_id / ref_label / ref_path could not be matched
 * to any scene in the active corpus. Surfaces to the author as "Unverified AI
 * citation" — never rendered as if it were a trusted finding.
 */
export interface UnverifiedCitation {
    rawRefId?: string;
    rawRefLabel?: string;
    rawRefPath?: string;
    kind: InquiryFinding['kind'];
    headline: string;
    bullets: string[];
    lens?: 'flow' | 'depth' | 'both';
    role?: FindingRole;
    /** Diagnostic warning from the normalizer explaining the failure. */
    warning: string;
}

export type CitationIntegrityStage = 'unresolved_ref' | 'ref_label_mismatch';

/**
 * A run-level warning about citation integrity. Each entry corresponds to one
 * integrity event (e.g. a fabricated ref, a label that points to a different
 * scene than its ref_id). Rendered in a blunt banner above findings.
 *
 * Reserved for HARD failures that affect trust: unresolved/quarantined refs and
 * id/label mismatches. Deterministic repairs (a malformed ref matched to a
 * unique scene via label/path) are NOT warnings — they are diagnostics; see
 * `CitationRepairDiagnostic`.
 */
export interface CitationIntegrityWarning {
    stage: CitationIntegrityStage;
    message: string;
}

/**
 * An internal diagnostic recording a citation the model emitted with a
 * malformed/non-canonical ref_id that was deterministically repaired to a
 * single corpus scene via an exact label/path match. The finding is fully
 * usable — these are logged for audit, never surfaced as an author-facing
 * "untrusted evidence" warning. (Observed: Opus 4.8 emitting `scn_16` for
 * scene 16 instead of the canonical `scn_<hash>` id.)
 */
export interface CitationRepairDiagnostic {
    /** The malformed ref the model emitted, e.g. "scn_16". */
    rawRef: string;
    /** The canonical corpus id it was repaired to, e.g. "scn_2b0eb73f". */
    canonicalRef: string;
}

/**
 * Derived run-level citation-integrity counts. Not stored on the result —
 * computed from `findings` + `unverifiedFindings` + `citationIntegrityWarnings`
 * whenever a surface (log line, dashboard, test) needs a summary.
 *
 * - verifiedCount: findings whose refId was accepted as-is by the normalizer.
 * - rescuedCount:  findings whose AI-supplied ref_id did not match the corpus
 *   directly but was repaired via label/path.
 * - unverifiedCount: findings that could not be matched at all.
 * - mismatchCount: findings whose ref_id resolved to scene A but whose
 *   ref_label/ref_path pointed to a different scene B (ref_id trusted).
 * - evidenceCompromised: true when the run produced at least one unverified
 *   citation AND no verified findings — the whole evidence base is suspect.
 */
export interface CitationIntegritySummary {
    verifiedCount: number;
    rescuedCount: number;
    unverifiedCount: number;
    mismatchCount: number;
    evidenceCompromised: boolean;
}

export function computeCitationIntegritySummary(
    result: Pick<InquiryResult, 'findings' | 'unverifiedFindings' | 'citationIntegrityWarnings'>
): CitationIntegritySummary {
    const findings = result.findings || []; // SAFE: sessions persisted before findings became required rehydrate without the field; see InquiryView.normalizeLegacyResult
    const unverified = result.unverifiedFindings || [];
    const warnings = result.citationIntegrityWarnings || [];
    const rescuedCount = findings.filter(finding => finding.rawRef !== undefined).length;
    const mismatchCount = warnings.filter(warning => warning.stage === 'ref_label_mismatch').length;
    const unverifiedCount = unverified.length;
    const verifiedCount = findings.length;
    return {
        verifiedCount,
        rescuedCount,
        unverifiedCount,
        mismatchCount,
        evidenceCompromised: unverifiedCount > 0 && verifiedCount === 0
    };
}

export interface InquiryResult {
    runId: string;
    scope: InquiryScope;
    scopeLabel: string;
    mode: InquiryLens;
    selectionMode: InquirySelectionMode;
    roleValidation: InquiryRoleValidation;
    questionId: string;
    questionText?: string;
    questionPromptForm?: InquiryQuestionPromptForm;
    questionZone?: InquiryZone;
    summary: string;
    summaryFlow?: string;
    summaryDepth?: string;
    verdict: InquiryVerdict;
    findings: InquiryFinding[];
    corpusFingerprint?: string;
    /** Fingerprint of the corpus state (no modelId) — used to detect "source changed since run". */
    corpusOnlyFingerprint?: string;
    /** Minimal manifest snapshot captured at run time — enables diagnosing *why* a run went stale. */
    corpusManifestSnapshot?: Array<{ path: string; sceneId?: string; mtime: number; class: string; mode: string; isTarget: boolean }>;
    cacheReuseFingerprint?: string;
    corpusOverridesActive?: boolean;
    corpusOverrideSummary?: {
        classCount: number;
        itemCount: number;
        total: number;
    };
    aiProvider?: string;
    aiModelRequested?: string;
    aiModelResolved?: string;
    aiModelNextRunOnly?: boolean;
    aiStatus?: InquiryAiStatus;
    aiReason?: string;
    executionState?: 'blocked_before_send' | 'dispatched_to_provider' | 'multi_pass_failed';
    executionPath?: 'one_pass' | 'multi_pass';
    failureStage?: 'preflight' | 'chunk_execution' | 'synthesis' | 'provider_response_parsing';
    /** Raw provider or runner error message for surfacing in UI diagnostics. */
    aiErrorDetail?: string;
    tokenUsageKnown?: boolean;
    tokenUsageScope?: InquiryTokenUsageScope;
    /**
     * Provider-reported token usage from the run. Includes cache_read /
     * cache_creation breakdown when the provider exposes it. Drives the
     * "Cache" pill in the engine popover so the user can see whether the
     * last run actually hit the prompt cache.
     */
    tokenUsage?: TokenUsage;
    tokenEstimateInput?: number;
    tokenEstimateTier?: 'normal' | 'amber' | 'red';
    submittedAt?: string;
    completedAt?: string;
    roundTripMs?: number;
    /** Number of findings whose ref_id was normalized from a non-canonical format (e.g. scene number, title). */
    refNormalizationCount?: number;
    /**
     * Findings the AI emitted whose references could not be matched to the
     * active corpus. Surfaced separately so they never masquerade as verified
     * evidence. Empty/undefined means every finding resolved cleanly.
     */
    unverifiedFindings?: UnverifiedCitation[];
    /**
     * Run-level warnings about citation integrity (fabricated refs, mismatched
     * label-vs-id, etc.). When present, the UI must show a blunt banner.
     */
    citationIntegrityWarnings?: CitationIntegrityWarning[];
    /**
     * Internal audit log of citations whose malformed ref_id was
     * deterministically repaired via label/path. Diagnostic only — never drives
     * the author-facing untrusted-evidence banner.
     */
    citationRepairs?: CitationRepairDiagnostic[];
    /** Normalized source attribution from provider runtime (manuscript and tool/file/url forms). */
    citations?: InquiryCitation[];
    /** Ordered metadata for evidence documents sent to the AI. Indices match citation documentIndex. */
    evidenceDocumentMeta?: EvidenceDocumentMeta[];
}

export interface InquiryState {
    scope: InquiryScope;
    targetSceneIds: string[];
    activeBookId?: string;
    mode: InquiryLens;
    selectedPromptIds: Record<InquiryZone, string>;
    activeQuestionId?: string;
    activeSessionId?: string;
    activeZone?: InquiryZone | null;
    activeResult?: InquiryResult | null;
    isRunning: boolean;
    lastError?: string;
    cacheStatus?: 'fresh' | 'stale' | 'missing';
    corpusFingerprint?: string;
    /** Current corpus-only fingerprint for the active question (no modelId). */
    corpusOnlyFingerprint?: string;
    /** Current manifest snapshot for diffing against prior runs' snapshots. */
    corpusManifestSnapshot?: Array<{ path: string; sceneId?: string; mtime: number; class: string; mode: string; isTarget: boolean }>;
    settingsSnapshot?: string;
    isNarrowLayout: boolean;
    reportPreviewOpen?: boolean;
    promptFormOverrides: Record<string, InquiryPromptFormOverride>;
}

export const createDefaultInquiryState = (): InquiryState => ({
    scope: 'book',
    targetSceneIds: [],
    mode: 'flow',
    selectedPromptIds: {
        setup: '',
        pressure: '',
        payoff: ''
    },
    activeZone: null,
    activeResult: null,
    isRunning: false,
    isNarrowLayout: false,
    reportPreviewOpen: false,
    promptFormOverrides: {},
});
