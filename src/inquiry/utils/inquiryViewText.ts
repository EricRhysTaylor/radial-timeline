import type { SceneInclusion } from '../../types/settings';
import type { CorpusManifestEntry } from '../runner/types';
import type { InquiryFinding, InquiryResult, InquiryStaleReason, InquiryTokenUsageScope } from '../state';
import { SIGMA_CHAR } from '../constants/inquiryUi';
import type { InquiryBriefModel } from '../types/inquiryViewTypes';
import type { InquirySession } from '../sessionTypes';
import type { InquiryCorpusItem } from '../services/InquiryCorpusResolver';
import { getModelDisplayName } from '../../utils/modelResolver';
import { t } from '../../i18n';

export const parseCorpusLabelNumber = (label?: string): number | null => {
    if (!label) return null;
    const match = label.trim().match(/^[A-Za-z](\d+)$/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
};

export const stripNumericTitlePrefix = (value: string): string => {
    const cleaned = (value || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    return cleaned.replace(/^(?:scene\s*)?\d+\s*[-:–—.)]?\s*/i, '').trim();
};

export const stripInquiryReferenceArtifacts = (value?: string): string => {
    if (!value) return '';
    return String(value)
        .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => {
            const fallback = String(target || '').split('/').pop() || '';
            return String(alias || fallback).trim();
        })
        .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
        .replace(/\(\s*#\^[^)]+\)/gi, '')
        .replace(/\(\s*scn_[a-z0-9]+\s*\)/gi, '')
        .replace(/\bscn_[a-z0-9]+\b/gi, '')
        .replace(/\s+\^[-\w]+\b/g, '')
        .replace(/\s+([,.;:!?…])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
};

export const replaceInquiryReferenceTokens = (
    value: string | undefined,
    labelsByRef?: ReadonlyMap<string, string>
): string => {
    if (!value) return '';
    if (!labelsByRef || labelsByRef.size === 0) return String(value);
    const resolve = (raw: string): string | null => {
        const key = raw.trim().toLowerCase();
        return labelsByRef.get(key) ?? null;
    };

    const replaceCompactSequence = (text: string): string => text
        .replace(/\b([sb])(\d+)\s*([/-])\s*\1?(\d+)\b/gi, (match, prefix: string, leftNum: string, separator: string, rightNum: string) => {
            const left = resolve(`${prefix}${leftNum}`);
            const right = resolve(`${prefix}${rightNum}`);
            if (!left && !right) return match;
            if (left && right) return `${left}${separator === '/' ? ' / ' : ' - '}${right}`;
            return left ?? right ?? match;
        })
        .replace(/\b([sb]\d+)\s*\/\s*([sb]\d+)\b/gi, (match, leftRaw: string, rightRaw: string) => {
            const left = resolve(leftRaw);
            const right = resolve(rightRaw);
            if (!left && !right) return match;
            if (left && right) return `${left} / ${right}`;
            return left ?? right ?? match;
        })
        .replace(/\b([sb]\d+)\s*-\s*([sb]\d+)\b/gi, (match, leftRaw: string, rightRaw: string) => {
            const left = resolve(leftRaw);
            const right = resolve(rightRaw);
            if (!left && !right) return match;
            if (left && right) return `${left} - ${right}`;
            return left ?? right ?? match;
        })
        .replace(/\b[sb]\d+\b/gi, (match) => resolve(match) ?? match);

    return replaceCompactSequence(String(value))
        .replace(/\b\d+\s*\(\s*(scn_[a-z0-9]+)\s*\)/gi, (match, refId: string) => resolve(refId) ?? match)
        .replace(/\b(scn_[a-z0-9]+)\b\s*\(([^)]+)\)/gi, (match, refId: string) => resolve(refId) ?? match)
        .replace(/\bscn_[a-z0-9]+\b/gi, (match) => resolve(match) ?? match)
        .replace(/\s+([,.;:!?…])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
};

export const sanitizeDossierText = (value?: string): string => {
    return stripInquiryReferenceArtifacts(value)
        .replace(/^(?:[SB]\d+|Scene\s+\d+)\s*[:\-–—]\s*/i, '')
        .trim();
};

export const normalizeSceneDossierSentence = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/[.!?…]$/.test(trimmed)) return trimmed;
    return `${trimmed}.`;
};

export const buildSceneDossierBodyLines = (finding: InquiryFinding): string[] => {
    const headline = sanitizeDossierText(finding.headline);
    const bullets = (finding.bullets || [])
        .map(entry => sanitizeDossierText(entry))
        .filter(Boolean)
        .slice(0, 2);
    const bodyLines: string[] = [];
    if (headline) {
        bodyLines.push(normalizeSceneDossierSentence(headline));
    }
    if (bullets.length) {
        bullets.forEach(entry => {
            bodyLines.push(normalizeSceneDossierSentence(entry));
        });
    } else if (!headline) {
        bodyLines.push('Finding text unavailable.');
    }
    return bodyLines;
};

export const buildSceneDossierHeader = (options: {
    label: string;
    itemDisplayLabel?: string;
    itemTitle: string;
    hoverLabel: string;
}): string => {
    const fallbackNumber = parseCorpusLabelNumber(options.label);
    const labelNumber = parseCorpusLabelNumber(options.itemDisplayLabel) ?? fallbackNumber;
    const cleanTitle = stripNumericTitlePrefix(options.itemTitle);
    if (labelNumber !== null && cleanTitle) {
        return `${labelNumber} ${cleanTitle}`;
    }
    if (labelNumber !== null) {
        return options.itemDisplayLabel?.toUpperCase().startsWith('B') ? `Book ${labelNumber}` : `Scene ${labelNumber}`;
    }
    return cleanTitle || options.hoverLabel || `Scene ${options.label}`;
};

export const resolveInquiryScopeIndicator = (result: InquiryResult): string | null => {
    const scopeLabel = result.scopeLabel?.trim();
    if (result.scope === 'saga') {
        return scopeLabel && scopeLabel.toLowerCase() !== 'saga' ? `Saga ${scopeLabel}` : 'Saga';
    }
    if (scopeLabel) {
        const lowered = scopeLabel.toLowerCase();
        if (/^s\d+/.test(lowered) || lowered.startsWith('scene')) {
            return `Scene ${scopeLabel}`;
        }
        if (/^c\d+/.test(lowered) || lowered.startsWith('chapter')) {
            return `Chapter ${scopeLabel}`;
        }
        return `Book ${scopeLabel}`;
    }
    return null;
};

export const formatBriefLabel = (value?: string | null): string => {
    if (!value) return 'Unknown';
    return value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
};

export const getSceneNoteSortOrder = (label: string): number => {
    const match = label.trim().match(/^[A-Za-z](\d+)$/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

export const normalizeInquiryHeadline = (headline: string): string =>
    stripInquiryReferenceArtifacts(headline || 'Finding') || 'Finding';

export const formatInquiryBriefLink = (briefId: string, alias?: string | null): string => {
    if (!alias) return `[[${briefId}]]`;
    return `[[${briefId}|${alias}]]`;
};

const INQUIRY_BRIEF_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatInquiryBriefId = (date: Date): string => {
    if (!Number.isFinite(date.getTime())) return 'IB-unknown';
    const yy = String(date.getFullYear() % 100).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `IB-${yy}${mm}${dd}-${hh}${min}`;
};

export const formatInquiryBriefShortDate = (date: Date): string => {
    if (!Number.isFinite(date.getTime())) return 'Unknown';
    return `${INQUIRY_BRIEF_SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`;
};

export const formatManifestClassLabel = (value: string): string => {
    if (!value) return 'Class';
    return value
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

export const formatManifestModeLabel = (
    mode: SceneInclusion | undefined,
    normalizeEvidenceMode: (mode?: SceneInclusion) => 'excluded' | 'summary' | 'full'
): string => {
    const normalized = normalizeEvidenceMode(mode);
    if (normalized === 'summary') return 'Summary';
    if (normalized === 'full') return 'Full Scene';
    return 'Exclude';
};

export const renderInquiryBrief = (brief: InquiryBriefModel): string => {
    const lines: string[] = [];
    const renderRawResponse = (raw: string): void => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        const fence = trimmed.includes('```') ? '~~~' : '```';
        const safeBody = fence === '~~~' ? trimmed.replace(/~~~/g, '~~\\~') : trimmed;
        lines.push('', '## Provider Response (Unparsed)', `${fence}text`, safeBody, fence);
    };

    lines.push('# Question', '', `**${brief.questionTitle}**`, brief.questionText);
    if (brief.scopeIndicator) {
        lines.push(`Scope: ${brief.scopeIndicator}`);
    }

    lines.push('', '## Summary Pills', brief.pills.map(pill => `[${pill}]`).join(' '));

    if (brief.evidenceCompromised) {
        lines.push(
            '',
            '> **⚠ Evidence compromised**',
            '> No verified evidence is available for this run. Every AI citation could not be matched to a scene in your manuscript. Treat the conclusions with caution — the evidence base is not trustworthy.'
        );
    } else if (brief.citationIntegrityWarnings && brief.citationIntegrityWarnings.length) {
        lines.push(
            '',
            '> **⚠ Citation integrity warning**',
            '> Some AI citations could not be matched to your manuscript. These citations are unverified and should not be trusted as evidence.'
        );
    }

    lines.push('', '## High-Level Conclusions', '### Flow', brief.flowSummary, '', '### Depth', brief.depthSummary);

    if (brief.selectionMode === 'focused' && brief.roleValidation === 'missing-target-roles') {
        lines.push(
            '',
            '_Warning: Incomplete Focused Analysis — target scenes were selected, but no target-specific findings were returned._'
        );
    }

    const targetFindings = brief.findings.filter(finding => finding.role === 'target');
    const contextFindings = brief.findings.filter(finding => finding.role === 'context');
    const renderFindingSection = (title: string, findings: InquiryBriefModel['findings']) => {
        lines.push('', `## ${title}`);
        if (!findings.length) {
            lines.push('None.');
            return;
        }
        findings.forEach(finding => {
            lines.push('', `### ${finding.headline}`);
            if (finding.sceneLabel) {
                lines.push(`Scene: ${finding.sceneLabel}`);
            }
            if (finding.lens) {
                lines.push(`Lens: ${finding.lens}`);
            }
            if (finding.bullets.length) {
                finding.bullets.forEach(bullet => {
                    lines.push(`- ${bullet}`);
                });
            }
        });
    };

    renderFindingSection('Primary Findings', targetFindings);
    renderFindingSection('Context Findings', contextFindings);

    if (brief.unverifiedFindings && brief.unverifiedFindings.length) {
        lines.push(
            '',
            '## Unverified AI Citations',
            '_The AI returned these findings but the citations could not be matched to your manuscript. They are shown for transparency and should **not** be trusted as evidence._',
            ''
        );
        brief.unverifiedFindings.forEach(item => {
            lines.push(`### ${item.headline}`);
            const rawParts: string[] = [];
            if (item.rawRefId) rawParts.push(`ref_id=${item.rawRefId}`);
            if (item.rawRefLabel) rawParts.push(`ref_label=${item.rawRefLabel}`);
            if (item.rawRefPath) rawParts.push(`ref_path=${item.rawRefPath}`);
            if (rawParts.length) {
                lines.push(`Cited: ${rawParts.join(' · ')}`);
            }
            lines.push(`Lens: ${item.lens}`);
            if (item.bullets.length) {
                item.bullets.forEach(bullet => {
                    lines.push(`- ${bullet}`);
                });
            }
            lines.push(`_${item.warning}_`, '');
        });
    }

    if (brief.sources.length) {
        const totalCitations = brief.sources.reduce((sum, s) => sum + (s.citationCount ?? 0), 0);
        const headerSuffix = totalCitations > 0 ? ` (${totalCitations} citations)` : '';
        lines.push('', `## Sources${headerSuffix}`, '');
        brief.sources.forEach(source => {
            const countPart = (source.citationCount ?? 0) > 1 ? ` · ${source.citationCount} citations` : '';
            const excerptPart = source.excerpt ? ` — *"${source.excerpt}"*` : '';
            const wikiPath = source.path?.replace(/\.md$/, '');
            const linkPart = (wikiPath && source.classLabel === 'Scene')
                ? ` — [[${wikiPath}|Open scene]]`
                : (source.url ? ` — [Source](${source.url})` : '');
            lines.push(`- **${source.title}** (${source.classLabel}${countPart})${excerptPart}${linkPart}`);
        });
    }

    if (brief.sceneNotes.length) {
        lines.push('', '## Per-Scene / Per-Moment Notes');
        brief.sceneNotes.forEach(note => {
            lines.push('', `### ${note.header}`);
            if (note.anchorId) {
                lines.push(`^${note.anchorId}`);
            }
            note.entries.forEach(entry => {
                lines.push(
                    `- ${entry.headline}`,
                    ...entry.bullets.map(bullet => `- ${bullet}`)
                );
                if (entry.lens) {
                    lines.push(`Lens: ${entry.lens}`);
                }
            });
        });
    }

    if (brief.pendingActions.length) {
        lines.push('', '## Pending Author Actions');
        brief.pendingActions.forEach(action => {
            const prefix = action.targetLabel ? `${action.targetLabel} — ` : '';
            lines.push(`- ${prefix}${action.text}`);
        });
    } else if (brief.showNoActionItems) {
        // Scoped empty-state: a real result from a completed pass, not an
        // absence. Speaks only to THIS inquiry's edit actions — never a
        // manuscript-quality claim, and never shown for error/simulated/
        // evidence-compromised runs (gated by showNoActionItems).
        lines.push('', '## Pending Author Actions',
            '**No Action Items** — no pending edits were identified for this inquiry.');
    }

    if (brief.rawResponse) {
        renderRawResponse(brief.rawResponse);
    }

    if (brief.refNormalized) {
        lines.push('', '_\\* Some scene references were normalized from non-standard formats._');
    }

    lines.push('', brief.logTitle
        ? `[[${brief.logTitle}|View full Inquiry Log →]]`
        : 'View full Inquiry Log →');

    lines.push('');
    return lines.join('\n');
};

export const buildManifestTocLines = (options: {
    manifestEntries: CorpusManifestEntry[] | null | undefined;
    normalizeEvidenceMode: (mode?: SceneInclusion) => 'excluded' | 'summary' | 'full';
    resolveManifestEntryLabel: (entry: CorpusManifestEntry) => string;
}): string[] => {
    const entries = options.manifestEntries;
    if (!entries?.length) {
        return ['- none'];
    }

    const dedupedEntries: CorpusManifestEntry[] = [];
    const seen = new Set<string>();
    entries.forEach(entry => {
        const key = `${entry.class}::${entry.path}::${options.normalizeEvidenceMode(entry.mode)}`;
        if (seen.has(key)) return;
        seen.add(key);
        dedupedEntries.push(entry);
    });

    dedupedEntries.sort((a, b) => {
        if (a.class !== b.class) return a.class.localeCompare(b.class);
        return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
    });

    return dedupedEntries.map(entry => {
        const classLabel = formatManifestClassLabel(entry.class);
        const modeLabel = formatManifestModeLabel(entry.mode, options.normalizeEvidenceMode);
        const itemLabel = options.resolveManifestEntryLabel(entry);
        return `- ${classLabel} · ${modeLabel} · ${itemLabel} (${entry.path})`;
    });
};

export const getDocumentStatusFields = (
    frontmatter: Record<string, unknown>
): { statusRaw?: string; due?: string } => {
    const rawStatus = frontmatter['Status'];
    const statusCandidate = Array.isArray(rawStatus)
        ? String(rawStatus[0] ?? '').trim()
        : (typeof rawStatus === 'string' ? rawStatus.trim() : '');

    const rawDue = frontmatter['Due'];
    const due = typeof rawDue === 'string' ? rawDue.trim() : '';

    return {
        statusRaw: statusCandidate || undefined,
        due: due || undefined
    };
};

export const countSynopsisWords = (content: string): number => {
    const trimmed = content.trim();
    if (!trimmed) return 0;
    const matches = trimmed.match(/[A-Za-z0-9]+(?:['’'-][A-Za-z0-9]+)*/g);
    return matches ? matches.length : 0;
};

/**
 * Read the authoritative `words` value from frontmatter (written by manuscript export).
 * Returns null if the field is absent or unparseable, so the caller can fall back to
 * a live count that aligns with the export algorithm (cleanEvidenceBody + whitespace split).
 */
export const readFrontmatterWordCount = (
    frontmatter: Record<string, unknown>
): number | null => {
    const raw = frontmatter['Words'] ?? frontmatter['words'];
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
    if (typeof raw === 'string') {
        const parsed = parseFloat(raw.replace(/,/g, '').trim());
        if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
    }
    return null;
};

export const getOrdinalSuffix = (day: number): string => {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    const mod10 = day % 10;
    if (mod10 === 1) return 'st';
    if (mod10 === 2) return 'nd';
    if (mod10 === 3) return 'rd';
    return 'th';
};

export const formatPendingEditsTargetsTooltip = (labels: string[]): string => {
    if (!labels.length) return 'No pending edits';
    return `Write to Pending Edits: ${labels.join(', ')}`;
};

export const formatPendingEditsSuccessMessage = (labels: string[]): string => {
    if (!labels.length) return t('inquiry.interaction.pendingEditsUpdatedDefault');
    return `Pending Edits updated for ${labels.join(', ')}.`;
};

export const formatSessionProviderModel = (session: InquirySession): string => {
    const model = (session.result.aiModelResolved || session.result.aiModelRequested || '').trim();
    if (!model) return 'Engine unknown';
    return getModelDisplayName(model);
};

export const formatSessionTime = (session: InquirySession): string => {
    const timestamp = session.createdAt || session.lastAccessed;
    const date = new Date(timestamp);
    const formatted = date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    return formatted.replace(/\s+(AM|PM)/i, (_, m) => m.toLowerCase());
};

export const formatSessionScope = (session: InquirySession): string => {
    const scopeLabel = session.result.scope === 'saga' ? 'Saga' : 'Book';
    const focus = session.result.scopeLabel || '';
    return `${scopeLabel} ${focus}`.trim();
};

export const formatSessionOverrides = (session: InquirySession): string | null => {
    const result = session.result;
    if (!result?.corpusOverridesActive) return null;
    const summary = result.corpusOverrideSummary;
    if (!summary) return 'Overrides on';
    return `Overrides ${summary.classCount}c/${summary.itemCount}i`;
};

export const formatTokenUsageVisibility = (
    known: boolean,
    scope?: InquiryTokenUsageScope
): string => {
    if (!known) return 'unknown';
    if (scope === 'full') return 'full multi-pass';
    if (scope === 'partial') return 'partial multi-pass';
    if (scope === 'synthesis_only') return 'synthesis-only';
    return 'known';
};

export const formatApiErrorClassification = (result: InquiryResult): string => {
    const status = result.aiStatus || 'unknown';
    const reason = result.aiReason;
    const reasonText = reason ? `${status} (${reason})` : status;
    const executionBits: string[] = [];
    if (result.executionState) executionBits.push(`state=${result.executionState}`);
    if (result.executionPath) executionBits.push(`path=${result.executionPath}`);
    if (result.failureStage) executionBits.push(`stage=${result.failureStage}`);
    if (typeof result.tokenUsageKnown === 'boolean') {
        executionBits.push(`usage=${formatTokenUsageVisibility(result.tokenUsageKnown, result.tokenUsageScope)}`);
    }
    return executionBits.length
        ? `${reasonText} [${executionBits.join(', ')}]`
        : reasonText;
};

export const formatApiErrorReason = (result: InquiryResult): string => {
    const classification = formatApiErrorClassification(result);
    if (result.aiErrorDetail) {
        return `${classification}\n${result.aiErrorDetail}`;
    }
    return classification;
};

export const formatAuthorFacingErrorHero = (result: InquiryResult): string => {
    const status = result.aiStatus;
    const reason = result.aiReason;
    if (status === 'rejected' && reason === 'spend_cap') return 'Monthly spend cap reached.';
    if (status === 'rejected' && reason === 'quota_exceeded') return 'OpenAI API quota exceeded.';
    if (status === 'rejected' && reason === 'invalid_response') return 'Briefing received with errors.';
    if (status === 'rejected' && reason === 'citation_binding_failed') return 'AI response could not be matched to this corpus.';
    if (status === 'rejected' && reason === 'multi_pass_failed') return 'Multi-pass analysis could not complete.';
    if (status === 'rejected' && reason === 'unsupported_param') return 'Request rejected by provider.';
    if (status === 'rejected') return 'Request rejected by provider.';
    if (status === 'auth') return 'Authentication failed.';
    if (status === 'timeout') return 'Request timed out.';
    if (status === 'rate_limit') return 'Rate limit reached. Try again shortly.';
    if (status === 'unavailable') return 'Provider unavailable.';
    return 'Inquiry could not complete.';
};

export const extractSpendCapResetDate = (detail?: string | null): string | null => {
    if (!detail) return null;
    const match = detail.match(/on\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+(\d{2}:\d{2})\s+UTC)?/i);
    if (!match) return null;
    return match[2] ? `${match[1]} ${match[2]} UTC` : match[1];
};

/**
 * Distill a provider countTokens failure message into a short reason
 * suitable for an inline chip (e.g. "HTTP 404: Model not found").
 *
 * Input shape from `aiClient.ts` `tokenCountAttemptWarnings`:
 *   `google countTokens failed for model "gemini-3.5-flash": Gemini
 *    countTokens failed for "gemini-3.5-flash" — NOT_FOUND (HTTP 404):
 *    Model not found.`
 *
 * Strategy:
 *   - Prefer the canonical "<STATUS_NAME> (HTTP nnn): <message>" segment
 *     when present (added by `countGeminiTokens` after our diagnostic
 *     improvement).
 *   - Otherwise, strip the noisy prefix and truncate to ~60 chars.
 *   - Empty when no usable message exists — caller falls back to a
 *     generic "provider token count failed" label.
 */
export const formatTokenCountFailureReason = (message: string | undefined | null): string => {
    if (!message || typeof message !== 'string') return '';
    const canonical = message.match(/([A-Z_]+\s*\(HTTP\s*\d+\)[^.]*)/);
    if (canonical) {
        const reason = canonical[1].trim().replace(/\s+/g, ' ');
        return reason.length > 90 ? `${reason.slice(0, 87)}…` : reason;
    }
    const httpOnly = message.match(/HTTP\s*\d+[^.]*/);
    if (httpOnly) {
        const reason = httpOnly[0].trim().replace(/\s+/g, ' ');
        return reason.length > 90 ? `${reason.slice(0, 87)}…` : reason;
    }
    // Fall back to the message after the FIRST colon — the provider prefix
    // (`<provider> countTokens failed for model "<model>":`) ends there, so
    // the remainder is the real explanation. Splitting on the LAST colon
    // instead chopped a trailing clock time (`14:00 UTC`) at its own colon
    // and surfaced a meaningless fragment like "00 UTC" (which the caller
    // template then turned into "00 UTC..").
    const firstColon = message.indexOf(':');
    const tail = (firstColon >= 0 ? message.slice(firstColon + 1) : message).trim();
    if (!tail) return '';
    // Drop a trailing period so the caller's own sentence period doesn't double.
    const cleaned = tail.replace(/\s+/g, ' ').replace(/\.+$/, '');
    return cleaned.length > 90 ? `${cleaned.slice(0, 87)}…` : cleaned;
};

export const formatRunDurationEstimate = (minSeconds: number, maxSeconds: number): string => {
    const min = Math.max(1, Math.round(minSeconds));
    const max = Math.max(min, Math.round(maxSeconds));
    if (max < 60) {
        if (min === max) {
            return `${min} ${min === 1 ? 'second' : 'seconds'}`;
        }
        return `${min}-${max} seconds`;
    }
    const minMinutes = Math.max(1, Math.round(min / 60));
    const maxMinutes = Math.max(minMinutes, Math.round(max / 60));
    if (minMinutes === maxMinutes) {
        return `${minMinutes} ${minMinutes === 1 ? 'minute' : 'minutes'}`;
    }
    return `${minMinutes}-${maxMinutes} minutes`;
};

export const formatInquiryBriefTimestamp = (
    date: Date,
    options?: { includeSeconds?: boolean }
): string => {
    if (!Number.isFinite(date.getTime())) {
        return 'Unknown date';
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const am = hours < 12;
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const minuteText = String(minutes).padStart(2, '0');
    const includeSeconds = options?.includeSeconds ?? false;
    const secondText = includeSeconds ? `.${String(seconds).padStart(2, '0')}` : '';
    return `${month} ${day} ${year} @ ${hours}.${minuteText}${secondText}${am ? 'am' : 'pm'}`;
};

export const formatElapsedRunClock = (elapsedMs: number): string => {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const formatCacheCountdown = (remainingMs: number): string => {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const formatInquiryId = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}.${minutes}.${seconds}`;
};

export const formatAuthorFacingErrorDetail = (result: InquiryResult): string => {
    if (result.aiReason === 'spend_cap') {
        const reset = extractSpendCapResetDate(result.aiErrorDetail);
        const resetLine = reset ? ` Resets ${reset}.` : '';
        return `This is your own monthly spending cap in the Anthropic Console (Limits → Spend limits) — not an API tier rate limit.${resetLine} Raise it in Console → Limits, or wait for the reset.`;
    }
    if (result.aiReason === 'quota_exceeded') {
        return 'Your OpenAI API account has run out of quota, credits, or billing allowance. Add funds or raise the API billing limit in the OpenAI dashboard, then retry. ChatGPT subscription quota is separate from API billing.';
    }
    if (result.aiErrorDetail) return result.aiErrorDetail;
    if (result.aiReason === 'citation_binding_failed') return 'No findings could be placed on the minimap.';
    if (result.aiReason === 'invalid_response') return 'Invalid structured response from AI.';
    return '';
};

export const buildStaleShortLabel = (reasons: InquiryStaleReason[]): string => {
    // Prefer the most specific, highest-signal reason.
    const edited = reasons.find(r => r.kind === 'scenes_edited');
    if (edited) {
        return edited.paths.length === 1 ? '1 scene edited' : `${edited.paths.length} scenes edited`;
    }
    const added = reasons.find(r => r.kind === 'scenes_added');
    if (added) {
        return added.paths.length === 1 ? '1 scene added' : `${added.paths.length} scenes added`;
    }
    const removed = reasons.find(r => r.kind === 'scenes_removed');
    if (removed) {
        return removed.paths.length === 1 ? '1 scene removed' : `${removed.paths.length} scenes removed`;
    }
    if (reasons.some(r => r.kind === 'inclusion_changed')) return 'inclusion changed';
    if (reasons.some(r => r.kind === 'target_changed')) return 'targets changed';
    return 'corpus changed';
};

export const buildStaleTooltipLines = (reasons: InquiryStaleReason[]): string[] => {
    const lines: string[] = [];
    const sceneLabel = (path: string): string => {
        const name = path.split('/').pop() ?? path;
        return name.replace(/\.md$/i, '');
    };
    const summarize = (label: string, paths: string[]): string => {
        if (paths.length <= 3) return `${label}: ${paths.map(sceneLabel).join(', ')}`;
        return `${label}: ${paths.slice(0, 3).map(sceneLabel).join(', ')} +${paths.length - 3} more`;
    };
    for (const reason of reasons) {
        switch (reason.kind) {
            case 'scenes_edited': lines.push(summarize('Edited', reason.paths)); break;
            case 'scenes_added': lines.push(summarize('Added', reason.paths)); break;
            case 'scenes_removed': lines.push(summarize('Removed', reason.paths)); break;
            case 'inclusion_changed': lines.push(summarize('Inclusion changed', reason.paths)); break;
            case 'target_changed': lines.push(summarize('Target changed', reason.paths)); break;
            case 'corpus_changed': lines.push('Corpus changed (details unavailable for this run)'); break;
        }
    }
    return lines;
};

export const getCorpusClassShort = (className: string): string => {
    switch (className) {
        case 'outline-saga': return SIGMA_CHAR;
        case 'character': return 'C';
        case 'scene': return 'S';
        case 'outline': return 'O';
        default: {
            const first = className.trim().charAt(0).toUpperCase();
            return first || 'C';
        }
    }
};

export const getCorpusCcOrderNumber = (label: string, className: string): number | null => {
    const normalized = label.toLowerCase();
    const patterns: RegExp[] = [];
    const isOutline = className === 'outline' || className === 'outline-saga';

    if (className === 'scene') {
        patterns.push(/^\s*(?:scene|sc)\s*#?\s*(\d+)/);
        patterns.push(/^\s*s(\d+)\b/);
        patterns.push(/^\s*(\d+)\b/);
        patterns.push(/\bscene\s*#?\s*(\d+)/);
    } else if (isOutline) {
        patterns.push(/^\s*(?:book|bk)\s*#?\s*(\d+)/);
        patterns.push(/\bbook\s*#?\s*(\d+)/);
        patterns.push(/^\s*(\d+)\b/);
    } else {
        patterns.push(/^\s*(\d+)\b/);
    }

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match) continue;
        const num = Number.parseInt(match[1], 10);
        if (Number.isFinite(num)) return num;
    }

    return null;
};

export const sanitizeInquirySummary = (rawSummary?: string | null): string => {
    const fallback = 'Summary unavailable.';
    if (!rawSummary) return fallback;
    let text = stripInquiryReferenceArtifacts(rawSummary).replace(/\s+/g, ' ').trim();
    if (!text) return fallback;
    const prefixes: RegExp[] = [
        /^(summary(?: of)?|executive summary)\s*/i,
        /^(here(?:'s| is) (?:a )?(?:summary|overview)(?: of)?)\s*/i,
        /^(a (?:summary|overview) of)\s*/i,
        /^(in summary|overall|in conclusion|to summarize|to sum up|in short|in brief|in essence|in overview)\s*/i,
        /^(this (?:inquiry|analysis|assessment|report|result)s?)(?:\s+(?:suggests|shows|indicates|points|implies|reveals|finds|highlights|notes))?(?:\s+that)?\s*/i,
        /^(the (?:inquiry|analysis|assessment|results?) (?:suggests|shows|indicates|points|implies|reveals|finds|highlights|notes))(?:\s+that)?\s*/i,
        /^(based on (?:the|this) (?:inquiry|analysis|assessment|results?))\s*/i,
        /^(it (?:appears|seems|looks))(?:\s+that)?\s*/i
    ];

    let changed = true;
    while (changed) {
        changed = false;
        for (const prefix of prefixes) {
            const next = text.replace(prefix, '').trim();
            if (next !== text) {
                text = next.replace(/^[^\w\s]+/, '').trim();
                changed = true;
                break;
            }
        }
    }

    return text || fallback;
};

export const resolveFindingChipLabel = (
    finding: InquiryFinding,
    result: InquiryResult,
    items: InquiryCorpusItem[]
): string | null => {
    const refId = finding.refId?.trim();
    if (!refId) return null;
    const refLower = refId.toLowerCase();

    const displayMatch = items.find(item => item.displayLabel.toLowerCase() === refLower);
    if (displayMatch) return displayMatch.displayLabel;

    const idMatch = items.find(item => item.id === refId || item.id.toLowerCase() === refLower);
    if (idMatch) return idMatch.displayLabel;

    const sceneIdMatch = items.find(item => typeof item.sceneId === 'string' && item.sceneId.toLowerCase() === refLower);
    if (sceneIdMatch) return sceneIdMatch.displayLabel;

    const pathMatch = items.find(item => item.filePaths?.some(path => path === refId));
    if (pathMatch) return pathMatch.displayLabel;

    const scopePrefix = result.scope === 'saga' ? 'B' : 'S';
    const pattern = new RegExp(`^${scopePrefix}\\d+$`, 'i');
    if (pattern.test(refId)) {
        return refId.toUpperCase();
    }

    return null;
};
