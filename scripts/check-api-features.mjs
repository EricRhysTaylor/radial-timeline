#!/usr/bin/env node
/**
 * Provider API Feature Audit Script (v2)
 *
 * Loads provider-capabilities.json and plugin-feature-integration.json,
 * validates schemas, scans source files for implementation markers,
 * verifies implementation evidence, cross-references claimed status
 * against reality, scores and ranks gaps, and produces a
 * decision-ready gap analysis report.
 *
 * Runs every build (no network calls). Purely local analysis.
 *
 * Usage:
 *   node scripts/check-api-features.mjs              (standard audit)
 *   node scripts/check-api-features.mjs --issues      (also generate GitHub issue stubs)
 *   node scripts/check-api-features.mjs --strict      (fail on violations — use in CI)
 *   node scripts/check-api-features.mjs --summary     (compact output for backup pipeline)
 *   node scripts/check-api-features.mjs --quiet       (suppress console, write report only)
 */
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { snapshotContentChanged } from './modelSnapshotUtils.mjs';

// ── Paths ──────────────────────────────────────────────────────────────────────

const CAPABILITIES_FILE = path.resolve('scripts/models/provider-capabilities.json');
const INTEGRATIONS_FILE = path.resolve('scripts/models/plugin-feature-integration.json');
const AUDIT_REPORT_FILE = path.resolve('scripts/models/feature-audit.json');
const ISSUES_DIR = path.resolve('.github/issues');

// ── ANSI colors ────────────────────────────────────────────────────────────────

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const WHITE = '\x1b[37m';

// ── Allowed enum values ────────────────────────────────────────────────────────

const ALLOWED_MATURITY = new Set(['experimental', 'beta', 'preview', 'ga', 'deprecated', 'removed']);
const ALLOWED_COMPLEXITY = new Set(['low', 'medium', 'high', 'architectural']);
const ALLOWED_ROI = new Set(['cost', 'quality', 'latency', 'capability', 'developer-experience']);
const ALLOWED_CATEGORY = new Set(['cost-optimization', 'capability', 'quality', 'performance', 'developer-experience', 'deprecation', 'protocol']);
const ALLOWED_STATUS = new Set(['not_implemented', 'partial', 'complete', 'not_applicable', 'deferred']);
const ALLOWED_PRIORITY = new Set(['p0', 'p1', 'p2', 'p3']);
const ALLOWED_IMPACT = new Set(['high', 'medium', 'low', 'none']);
const ALLOWED_RT_IMPACT_LEVEL = new Set(['high', 'medium', 'low']);
const ALLOWED_RT_RECOMMENDATION = new Set(['implement now', 'next', 'defer', 'ignore']);

// ── CLI flags ──────────────────────────────────────────────────────────────────

const doGenerateIssues = process.argv.includes('--issues');
const strictMode = process.argv.includes('--strict');
const summaryMode = process.argv.includes('--summary');
const quietMode = process.argv.includes('--quiet');

function log(msg = '') {
    if (!quietMode) console.log(msg);
}

function hasAuditFailures(validationErrors, evidenceFailures) {
    return validationErrors.length > 0 || evidenceFailures.length > 0;
}

function printSummaryAlert(analytics, validationErrors, evidenceFailures) {
    if (validationErrors.length > 0) {
        console.log(`${RED}[api-features] ALERT: ${validationErrors.length} validation error(s) in provider feature audit. See scripts/models/feature-audit.json.${RESET}`);
        return;
    }
    if (evidenceFailures.length > 0) {
        console.log(`${YELLOW}[api-features] ALERT: ${evidenceFailures.length} implementation evidence failure(s) in provider feature audit. See scripts/models/feature-audit.json.${RESET}`);
        return;
    }
    if (analytics.topPriorities.length > 0) {
        console.log(`${YELLOW}[api-features] ALERT: ${analytics.topPriorities.length} RT-relevant provider feature gap(s) need attention. See scripts/models/feature-audit.json.${RESET}`);
    }
}

// ── Load registries ────────────────────────────────────────────────────────────

function loadJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`[api-features] Failed to parse ${path.basename(filePath)}: ${e.message}`);
        return null;
    }
}

// ── Schema validation ──────────────────────────────────────────────────────────

function validateCapabilities(data) {
    const errors = [];
    const warnings = [];
    if (!data || (data.schemaVersion !== 1 && data.schemaVersion !== 2)) {
        errors.push('provider-capabilities.json: missing or invalid schemaVersion');
        return { errors, warnings };
    }
    if (!Array.isArray(data.capabilities)) {
        errors.push('provider-capabilities.json: capabilities must be an array');
        return { errors, warnings };
    }
    const ids = new Set();
    for (const cap of data.capabilities) {
        if (!cap.id) { errors.push('Capability missing id'); continue; }
        if (ids.has(cap.id)) errors.push(`${cap.id}: duplicate capability id`);
        ids.add(cap.id);
        if (!cap.provider) errors.push(`${cap.id}: missing provider`);
        if (!cap.name) errors.push(`${cap.id}: missing name`);
        if (cap.category && !ALLOWED_CATEGORY.has(cap.category)) {
            errors.push(`${cap.id}: invalid category '${cap.category}'`);
        }
        if (cap.maturity && !ALLOWED_MATURITY.has(cap.maturity)) {
            errors.push(`${cap.id}: invalid maturity '${cap.maturity}'`);
        }
        if (cap.implementationComplexity && !ALLOWED_COMPLEXITY.has(cap.implementationComplexity)) {
            errors.push(`${cap.id}: invalid implementationComplexity '${cap.implementationComplexity}'`);
        }
        if (cap.roiCategory && !ALLOWED_ROI.has(cap.roiCategory)) {
            errors.push(`${cap.id}: invalid roiCategory '${cap.roiCategory}'`);
        }
        // Provider reality guardrails
        if (!cap.availableSince || cap.availableSince === 'TODO') {
            warnings.push(`${cap.id}: missing availableSince (required for provider reality)`);
        }
        if (!cap.documentationUrl || cap.documentationUrl === 'TODO') {
            warnings.push(`${cap.id}: missing documentationUrl (required for provider reality)`);
        }
        if (cap.requiredApiVersion === undefined) {
            warnings.push(`${cap.id}: missing requiredApiVersion (use null with note if not versioned)`);
        }
    }
    return { errors, warnings };
}

function validateIntegrations(data, capabilityIds) {
    const errors = [];
    const warnings = [];
    if (!data || (data.schemaVersion !== 1 && data.schemaVersion !== 2)) {
        errors.push('plugin-feature-integration.json: missing or invalid schemaVersion');
        return { errors, warnings };
    }
    if (!Array.isArray(data.integrations)) {
        errors.push('plugin-feature-integration.json: integrations must be an array');
        return { errors, warnings };
    }
    const ids = new Set();
    for (const int of data.integrations) {
        if (!int.id) { errors.push('Integration missing id'); continue; }
        if (ids.has(int.id)) errors.push(`${int.id}: duplicate integration id`);
        ids.add(int.id);
        if (!capabilityIds.has(int.id)) {
            errors.push(`${int.id}: no matching capability in provider-capabilities.json`);
        }
        if (int.implementationStatus && !ALLOWED_STATUS.has(int.implementationStatus)) {
            errors.push(`${int.id}: invalid implementationStatus '${int.implementationStatus}'`);
        }
        if (int.priority && !ALLOWED_PRIORITY.has(int.priority)) {
            errors.push(`${int.id}: invalid priority '${int.priority}'`);
        }
        if (int.impactAssessment && !ALLOWED_IMPACT.has(int.impactAssessment)) {
            errors.push(`${int.id}: invalid impactAssessment '${int.impactAssessment}'`);
        }
        // RT-specific impact validation
        if (int.rtImpact) {
            for (const axis of ['authorTrust', 'runtimeReliability', 'costTransparency', 'passPrediction', 'citationTrust']) {
                if (int.rtImpact[axis] && !ALLOWED_RT_IMPACT_LEVEL.has(int.rtImpact[axis])) {
                    errors.push(`${int.id}: invalid rtImpact.${axis} '${int.rtImpact[axis]}'`);
                }
            }
        } else {
            warnings.push(`${int.id}: missing rtImpact (required for RT-specific scoring)`);
        }
        if (int.rtRecommendation && !ALLOWED_RT_RECOMMENDATION.has(int.rtRecommendation)) {
            errors.push(`${int.id}: invalid rtRecommendation '${int.rtRecommendation}'`);
        }
    }
    // Orphaned capabilities
    for (const capId of capabilityIds) {
        if (!ids.has(capId)) {
            errors.push(`${capId}: capability exists but has no integration entry`);
        }
    }
    return { errors, warnings };
}

// ── Implementation evidence verification ──────────────────────────────────────

const EVIDENCE_FAILURE_LABELS = {
    feature_missing: 'feature missing',
    evidence_matcher_stale: 'evidence matcher stale',
    feature_present_different_seam: 'feature present but now implemented through a different seam'
};

function normalizeEvidenceRule(rawRule, integration) {
    if (typeof rawRule === 'string') {
        return {
            label: `/${rawRule}/`,
            sourceFiles: integration.sourceFiles || [],
            allOf: [rawRule],
            anyOf: [],
            minAny: 0
        };
    }
    if (!rawRule || typeof rawRule !== 'object') {
        return { invalidReason: `invalid evidence rule: ${JSON.stringify(rawRule)}` };
    }
    const rule = rawRule;
    const sourceFiles = Array.isArray(rule.sourceFiles) && rule.sourceFiles.length > 0
        ? rule.sourceFiles
        : (integration.sourceFiles || []);
    const allOf = Array.isArray(rule.allOf) ? rule.allOf : [];
    const anyOf = Array.isArray(rule.anyOf) ? rule.anyOf : [];
    const minAny = typeof rule.minAny === 'number'
        ? rule.minAny
        : (anyOf.length > 0 ? 1 : 0);
    return {
        label: typeof rule.label === 'string' && rule.label.trim()
            ? rule.label.trim()
            : `custom evidence rule for ${integration.id}`,
        sourceFiles,
        allOf,
        anyOf,
        minAny
    };
}

function compileEvidenceRegex(pattern) {
    try {
        return new RegExp(pattern);
    } catch {
        return null;
    }
}

function readEvidenceSources(sourceFiles) {
    return (sourceFiles || []).map(srcFile => {
        const fullPath = path.resolve(srcFile);
        const exists = fs.existsSync(fullPath);
        return {
            srcFile,
            exists,
            content: exists ? fs.readFileSync(fullPath, 'utf8') : null
        };
    });
}

function evaluateEvidencePatternSet(patterns, sources) {
    const missingPatterns = [];
    let matchedCount = 0;
    for (const pattern of patterns) {
        const regex = compileEvidenceRegex(pattern);
        if (!regex) {
            return {
                ok: false,
                kind: 'evidence_matcher_stale',
                reason: `invalid regex pattern: ${pattern}`
            };
        }
        const matched = sources.some(source => typeof source.content === 'string' && regex.test(source.content));
        if (matched) {
            matchedCount += 1;
        } else {
            missingPatterns.push(pattern);
        }
    }
    return {
        ok: missingPatterns.length === 0,
        matchedCount,
        totalCount: patterns.length,
        missingPatterns
    };
}

function buildEvidenceFailure(id, kind, reason, rule, sourceFiles) {
    return {
        id,
        kind,
        reason,
        rule: rule?.label,
        sourceFiles
    };
}

export function verifyEvidence(integrations) {
    const failures = [];
    for (const int of integrations) {
        if (int.implementationStatus !== 'complete') continue;
        const rawRules = int.implementationEvidence;
        if (!rawRules || rawRules.length === 0) {
            failures.push(buildEvidenceFailure(
                int.id,
                'evidence_matcher_stale',
                '"complete" status with no implementationEvidence patterns',
                null,
                int.sourceFiles || []
            ));
            continue;
        }
        for (const rawRule of rawRules) {
            const rule = normalizeEvidenceRule(rawRule, int);
            if (rule.invalidReason) {
                failures.push(buildEvidenceFailure(
                    int.id,
                    'evidence_matcher_stale',
                    rule.invalidReason,
                    null,
                    int.sourceFiles || []
                ));
                continue;
            }

            if (rule.allOf.length === 0 && rule.anyOf.length === 0) {
                failures.push(buildEvidenceFailure(
                    int.id,
                    'evidence_matcher_stale',
                    `${rule.label}: no allOf/anyOf matchers configured`,
                    rule,
                    rule.sourceFiles
                ));
                continue;
            }

            const sources = readEvidenceSources(rule.sourceFiles);
            const existingSources = sources.filter(source => source.exists && typeof source.content === 'string');
            if (existingSources.length === 0) {
                failures.push(buildEvidenceFailure(
                    int.id,
                    'feature_present_different_seam',
                    `${rule.label}: evidence still points at missing source files (${rule.sourceFiles.join(', ')})`,
                    rule,
                    rule.sourceFiles
                ));
                continue;
            }

            if (rule.allOf.length > 0) {
                const allResult = evaluateEvidencePatternSet(rule.allOf, existingSources);
                if (!allResult.ok) {
                    failures.push(buildEvidenceFailure(
                        int.id,
                        allResult.kind || (allResult.matchedCount > 0 ? 'evidence_matcher_stale' : 'feature_missing'),
                        allResult.reason
                            || `${rule.label}: missing required evidence ${allResult.missingPatterns.map(pattern => `/${pattern}/`).join(', ')}`,
                        rule,
                        rule.sourceFiles
                    ));
                    continue;
                }
            }

            if (rule.anyOf.length > 0) {
                const anyResult = evaluateEvidencePatternSet(rule.anyOf, existingSources);
                if (!anyResult.ok) {
                    failures.push(buildEvidenceFailure(
                        int.id,
                        anyResult.kind || 'evidence_matcher_stale',
                        anyResult.reason || `${rule.label}: invalid anyOf matcher`,
                        rule,
                        rule.sourceFiles
                    ));
                    continue;
                }
                if ((anyResult.matchedCount || 0) < rule.minAny) {
                    failures.push(buildEvidenceFailure(
                        int.id,
                        (anyResult.matchedCount || 0) > 0 ? 'evidence_matcher_stale' : 'feature_missing',
                        `${rule.label}: expected ${rule.minAny} matching seam(s), found ${anyResult.matchedCount || 0}`,
                        rule,
                        rule.sourceFiles
                    ));
                }
            }
        }
    }
    return failures;
}

// ── Source scanning ────────────────────────────────────────────────────────────

function readSourceFile(relativePath) {
    const fullPath = path.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf8');
}

function scanSources() {
    const findings = [];

    // ── Anthropic API ──
    const anthropicSrc = readSourceFile('src/api/anthropicApi.ts');
    if (anthropicSrc) {
        // Only flag if system is still plain string and NOT block array
        if ((anthropicSrc.includes('system?: string') && !anthropicSrc.includes('AnthropicTextBlock')) ||
            (/requestBody\.system\s*=\s*systemPrompt/.test(anthropicSrc) && !(/requestBody\.system\s*=\s*\[/.test(anthropicSrc)))) {
            findings.push({
                file: 'anthropicApi.ts',
                finding: 'system prompt is plain string (blocks prompt caching)',
                relatedFeatures: ['anthropic-system-content-blocks', 'anthropic-prompt-caching']
            });
        }
        if (!anthropicSrc.includes('anthropic-beta')) {
            findings.push({
                file: 'anthropicApi.ts',
                finding: 'no anthropic-beta headers configured',
                relatedFeatures: ['anthropic-prompt-caching', 'anthropic-extended-thinking']
            });
        }
        const versionMatch = anthropicSrc.match(/apiVersion\s*=\s*'([^']+)'/);
        if (versionMatch) {
            findings.push({
                file: 'anthropicApi.ts',
                finding: `anthropic-version header: ${versionMatch[1]}`,
                relatedFeatures: []
            });
        }
        const hasTemperature = anthropicSrc.includes('temperature') &&
            (anthropicSrc.includes('body.temperature') || anthropicSrc.includes('requestBody.temperature'));
        if (!hasTemperature) {
            findings.push({
                file: 'anthropicApi.ts',
                finding: 'temperature/topP not in request body',
                relatedFeatures: ['anthropic-temperature-topP']
            });
        }
    }

    // ── OpenAI API ──
    const openaiSrc = readSourceFile('src/api/openaiApi.ts');
    if (openaiSrc) {
        // Only flag concatenation if there's no separate system-role path alongside it.
        // The fallback concatenation is expected (for reasoning models / local endpoints).
        const hasSystemRole = /role:\s*['"]system['"]/.test(openaiSrc);
        if (!hasSystemRole) {
            findings.push({
                file: 'openaiApi.ts',
                finding: 'system+user concatenated into single message (defeats auto-caching)',
                relatedFeatures: ['openai-automatic-prompt-caching', 'openai-reasoning-model-system-role']
            });
        }
    }

    // ── Gemini API ──
    const geminiSrc = readSourceFile('src/api/geminiApi.ts');
    if (geminiSrc) {
        const hasCreateFunction = geminiSrc.includes('export async function createGeminiCache');
        if (hasCreateFunction) {
            const callerCount = countCallersInSrc('createGeminiCache', 'src/api/geminiApi.ts');
            findings.push({
                file: 'geminiApi.ts',
                finding: `createGeminiCache() has ${callerCount} callers in src/`,
                relatedFeatures: ['gemini-context-caching']
            });
        }
        // Check systemInstruction suppression when cachedContent is set
        if (geminiSrc.includes('!cachedContentName')) {
            findings.push({
                file: 'geminiApi.ts',
                finding: 'systemInstruction suppressed when cachedContentName is set (Gemini restriction)',
                relatedFeatures: ['gemini-context-caching']
            });
        }
    }
    const cacheManagerSrc = readSourceFile('src/api/geminiCacheManager.ts');
    if (cacheManagerSrc) {
        const aiClientSrc = readSourceFile('src/ai/runtime/aiClient.ts');
        const runtimeWired = !!aiClientSrc?.includes('peekGeminiCache');
        findings.push({
            file: 'aiClient.ts',
            finding: `Cache manager exists, canonical runtime wires it: ${runtimeWired}`,
            relatedFeatures: ['gemini-context-caching']
        });
    }

    return findings;
}

function countCallersInSrc(functionName, definitionFile) {
    const srcDir = path.resolve('src');
    if (!fs.existsSync(srcDir)) return 0;
    let count = 0;
    walkDir(srcDir, (filePath) => {
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
        if (path.resolve(filePath) === path.resolve(definitionFile)) return;
        const content = fs.readFileSync(filePath, 'utf8');
        const importMatch = content.match(new RegExp(`import.*${functionName}`, 'g'));
        if (importMatch) count += importMatch.length;
    });
    return count;
}

function walkDir(dir, callback) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            walkDir(fullPath, callback);
        } else {
            callback(fullPath);
        }
    }
}

// ── RT-specific priority scoring ──────────────────────────────────────────────
//
// Score features by their impact on RT's actual product priorities:
// cache truth, pass prediction, citation trust, and large-corpus reliability.
// NOT by generic API completeness or feature-count.

const RT_IMPACT_SCORE = { high: 3, medium: 2, low: 1 };
const RT_AXIS_WEIGHTS = {
    authorTrust: 3,          // author-facing trust is the top priority
    runtimeReliability: 2,   // runtime correctness matters for large corpora
    costTransparency: 2,     // cache/cost truth is a core pillar
    passPrediction: 2,       // pass prediction accuracy
    citationTrust: 2         // citation/evidence visibility
};
const COMPLEXITY_PENALTY = { architectural: 3, high: 2, medium: 1, low: 0 };

function computeScore(cap, int) {
    const rt = int.rtImpact;
    if (!rt) return 0;
    let score = 0;
    for (const [axis, weight] of Object.entries(RT_AXIS_WEIGHTS)) {
        score += (RT_IMPACT_SCORE[rt[axis]] ?? 0) * weight;
    }
    const penalty = COMPLEXITY_PENALTY[cap.implementationComplexity] ?? 0;
    return score - penalty;
}

function rtPillarLabel(int) {
    const rt = int.rtImpact;
    if (!rt) return 'Unknown';
    // Return the highest-impact pillar for this feature
    const pillars = [
        ['Cache', rt.costTransparency],
        ['Passes', rt.passPrediction],
        ['Citations', rt.citationTrust],
        ['Trust', rt.authorTrust],
        ['Reliability', rt.runtimeReliability]
    ];
    const best = pillars.sort((a, b) => (RT_IMPACT_SCORE[b[1]] ?? 0) - (RT_IMPACT_SCORE[a[1]] ?? 0))[0];
    return best[0];
}

// ── Analytics ──────────────────────────────────────────────────────────────────

function buildAnalytics(capabilities, integrations) {
    const capMap = new Map(capabilities.map(c => [c.id, c]));
    const intMap = new Map(integrations.map(i => [i.id, i]));

    // Provider summaries — RT-focused: show what matters, not completeness %
    const providers = ['anthropic', 'openai', 'google'];
    const providerSummaries = {};
    for (const provider of providers) {
        const providerCaps = capabilities.filter(c => c.provider === provider);
        const providerInts = providerCaps.map(c => intMap.get(c.id)).filter(Boolean);
        const implemented = providerInts.filter(i => i.implementationStatus === 'complete').length;
        const total = providerCaps.length;
        // Count features that matter to RT's big 3 (cache, passes, citations)
        const rtRelevant = providerInts.filter(i => {
            const rt = i.rtImpact;
            if (!rt) return false;
            return rt.costTransparency === 'high' || rt.passPrediction === 'high' || rt.citationTrust === 'high';
        });
        const rtRelevantGaps = rtRelevant.filter(i => i.implementationStatus !== 'complete').length;
        providerSummaries[provider] = { total, implemented, rtRelevantGaps };
    }

    // All actionable gaps — scored by RT impact, not generic completeness
    const actionableGaps = integrations
        .filter(i => i.implementationStatus === 'not_implemented' || i.implementationStatus === 'partial')
        .filter(i => i.rtRecommendation !== 'ignore')
        .map(i => {
            const cap = capMap.get(i.id);
            if (!cap) return null;
            const score = computeScore(cap, i);
            return {
                id: i.id,
                name: cap.name,
                description: cap.description,
                provider: cap.provider,
                priority: i.priority,
                score,
                pillar: rtPillarLabel(i),
                complexity: cap.implementationComplexity,
                rtRecommendation: i.rtRecommendation,
                relevantPluginFeatures: i.relevantPluginFeatures,
                implementationNotes: i.implementationNotes,
                sourceFiles: i.sourceFiles,
                targetRelease: i.targetRelease,
                owner: i.owner
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    // Top priorities: "implement now" or "next" recommendations, sorted by score
    const topPriorities = actionableGaps
        .filter(g => g.rtRecommendation === 'implement now' || g.rtRecommendation === 'next')
        .slice(0, 5)
        .map(gap => {
            const notes = gap.implementationNotes || '';
            const actionHint = notes.split('.').find(s =>
                /needs|must|fix|separate|restructure|wire|add|change|replace|implement|improve|calibrat/i.test(s)
            )?.trim() || notes.split('.')[0]?.trim() || 'See implementation notes';
            const primaryFile = gap.sourceFiles?.[0] || 'TBD';
            return { ...gap, actionHint, primaryFile };
        });

    // Deferred: explicitly deferred or ignored
    const deferred = integrations
        .filter(i => i.rtRecommendation === 'defer' || i.rtRecommendation === 'ignore')
        .filter(i => i.implementationStatus !== 'complete' && i.implementationStatus !== 'not_applicable')
        .map(i => {
            const cap = capMap.get(i.id);
            return cap ? { id: i.id, name: cap.name, provider: cap.provider, reason: i.rtRecommendation } : null;
        })
        .filter(Boolean);

    return { providerSummaries, actionableGaps, topPriorities, deferred };
}

// ── Console output ─────────────────────────────────────────────────────────────

function printReport(analytics, sourceFindings, validationErrors, validationWarnings, evidenceFailures) {
    if (summaryMode) {
        if (hasAuditFailures(validationErrors, evidenceFailures) || analytics.topPriorities.length > 0) {
            printSummaryAlert(analytics, validationErrors, evidenceFailures);
        }
        return;
    }

    const now = new Date().toISOString().slice(0, 10);
    log(`\n${BOLD}[api-features] RT Provider Feature Audit (${now})${RESET}`);
    log(`${DIM}  Scoring: author trust, runtime reliability, cache/cost, passes, citations${RESET}\n`);

    // Validation errors
    if (validationErrors.length > 0) {
        log(`${RED}  VALIDATION ERRORS:${RESET}`);
        validationErrors.forEach(e => log(`  ${RED}x${RESET} ${e}`));
        log('');
    }

    // Validation warnings (strict mode)
    if (validationWarnings.length > 0 && strictMode) {
        log(`${YELLOW}  WARNINGS:${RESET}`);
        validationWarnings.forEach(w => log(`  ${YELLOW}?${RESET} ${w}`));
        log('');
    }

    // Evidence failures
    if (evidenceFailures.length > 0) {
        log(`${RED}  EVIDENCE FAILURES:${RESET}`);
        evidenceFailures.forEach(f => {
            const kindLabel = EVIDENCE_FAILURE_LABELS[f.kind] || f.kind || 'evidence failure';
            log(`  ${RED}x${RESET} ${f.id} [${kindLabel}]: ${f.reason}`);
        });
        log('');
    }

    // Provider summaries — RT-focused, not completeness %
    const providerNames = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };
    for (const [key, label] of Object.entries(providerNames)) {
        const summary = analytics.providerSummaries[key];
        if (!summary) continue;
        const gapNote = summary.rtRelevantGaps > 0
            ? `${RED}${summary.rtRelevantGaps} RT-relevant gap${summary.rtRelevantGaps > 1 ? 's' : ''}${RESET}`
            : `${GREEN}no RT-relevant gaps${RESET}`;
        log(`  ${label.padEnd(12)} ${summary.implemented}/${summary.total} integrated — ${gapNote}`);
    }
    log('');

    // ── TOP PRIORITIES ──
    if (analytics.topPriorities.length > 0) {
        log(`${WHITE}${BOLD}  TOP PRIORITIES:${RESET}`);
        analytics.topPriorities.forEach((action, i) => {
            const num = `${i + 1}.`;
            log(`  ${GREEN}${num}${RESET} ${action.id} ${DIM}(${action.pillar}, score: ${action.score})${RESET}`);
            log(`     ${action.actionHint}`);
            log(`     ${DIM}${action.primaryFile}${RESET}`);
        });
        log('');
    } else {
        log(`  ${GREEN}No actionable RT-relevant gaps remaining.${RESET}\n`);
    }

    // ── DEFERRED ──
    if (analytics.deferred.length > 0) {
        log(`${DIM}  DEFERRED:${RESET}`);
        analytics.deferred.forEach(d => {
            log(`  ${DIM}-${RESET} ${d.id} (${d.provider}) — ${d.reason}`);
        });
        log('');
    }

    // ── Verbose sections (skipped in --summary mode) ──
    if (!summaryMode) {
        // Source code findings
        if (sourceFindings.length > 0) {
            log(`${DIM}  SOURCE FINDINGS:${RESET}`);
            sourceFindings.forEach(f => {
                log(`  ${DIM}-${RESET} ${f.file}: ${f.finding}`);
            });
            log('');
        }
    }
}

// ── Issue generation ───────────────────────────────────────────────────────────

function generateIssueStubs(highImpactGaps, capMap, intMap) {
    if (!fs.existsSync(ISSUES_DIR)) {
        fs.mkdirSync(ISSUES_DIR, { recursive: true });
    }

    let generated = 0;
    for (const gap of highImpactGaps) {
        const cap = capMap.get(gap.id);
        const int = intMap.get(gap.id);
        if (!cap || !int) continue;
        if (int.implementationStatus !== 'not_implemented') continue;

        const filename = `feature-${gap.id}.md`;
        const filePath = path.join(ISSUES_DIR, filename);

        // Skip if already exists
        if (fs.existsSync(filePath)) continue;

        const features = (int.relevantPluginFeatures || []).map(f => `- ${f}`).join('\n');
        const sources = (int.sourceFiles || []).map(f => `- \`${f}\``).join('\n');
        const blockers = (int.blockers || []).length > 0
            ? int.blockers.map(b => `- ${b}`).join('\n')
            : 'None';

        // Build evidence patterns for DoD
        const evidencePatterns = (int.implementationEvidence || []).length > 0
            ? int.implementationEvidence.map(rule => {
                if (typeof rule === 'string') {
                    return `- [ ] Evidence pattern matches: \`/${rule}/\``;
                }
                if (!rule || typeof rule !== 'object') {
                    return `- [ ] Evidence rule updated: \`${JSON.stringify(rule)}\``;
                }
                const label = typeof rule.label === 'string' && rule.label.trim()
                    ? rule.label.trim()
                    : 'Custom evidence rule';
                const allOf = Array.isArray(rule.allOf) ? rule.allOf.map(pattern => `\`/${pattern}/\``) : [];
                const anyOf = Array.isArray(rule.anyOf) ? rule.anyOf.map(pattern => `\`/${pattern}/\``) : [];
                const joined = [
                    allOf.length ? `all of ${allOf.join(', ')}` : null,
                    anyOf.length ? `any of ${anyOf.join(', ')}` : null
                ].filter(Boolean).join(' + ');
                return `- [ ] ${label}${joined ? `: ${joined}` : ''}`;
            }).join('\n')
            : '- [ ] Add implementationEvidence patterns to registry';

        // Build required headers DoD items
        const headerItems = Object.entries(cap.requiredHeaders || {})
            .map(([k, v]) => `- [ ] Header \`${k}: ${v}\` sent in requests`)
            .join('\n');

        const content = `---
title: "Implement ${cap.name} (${cap.provider})"
labels: ai-feature, ${cap.provider}, ${int.priority || 'p2'}
---

## Feature: ${cap.name}

**Provider:** ${cap.provider}
**Category:** ${cap.category}
**Maturity:** ${cap.maturity}
**ROI Category:** ${cap.roiCategory}
**Implementation Complexity:** ${cap.implementationComplexity}
**Priority Score:** ${gap.score}

## Description

${cap.description}

## Documentation

${cap.documentationUrl}

## Relevant Plugin Features

${features || 'None specified'}

## Implementation Notes

${int.implementationNotes || 'No notes yet.'}

## Source Files

${sources || 'None identified'}

## Blockers

${blockers}

## Definition of Done

### Request Shape
- [ ] API request body matches provider documentation
${headerItems ? `\n### Headers\n${headerItems}` : ''}

### Tests
- [ ] Unit test covering request construction
- [ ] Integration test verifying response parsing

### Audit Evidence
${evidencePatterns}
- [ ] \`implementationStatus\` set to \`"complete"\` in plugin-feature-integration.json
- [ ] \`node scripts/check-api-features.mjs --strict\` passes

### Obsidian Compatibility
- [ ] Works with \`requestUrl()\` (no browser-only APIs)
- [ ] Fallback behavior if feature unavailable (older API version, rate limit, mobile)
`;
        fs.writeFileSync(filePath, content, 'utf8');
        generated += 1;
        log(`  ${GREEN}+${RESET} Generated issue stub: ${filename}`);
    }

    if (generated > 0) {
        log(`\n  ${GREEN}Generated ${generated} issue stub(s) in .github/issues/${RESET}\n`);
    }
}

// ── Report file ────────────────────────────────────────────────────────────────

function writeAuditReport(analytics, sourceFindings, validationErrors, validationWarnings, evidenceFailures) {
    const report = {
        generatedAt: new Date().toISOString(),
        scoringModel: 'rt-impact-v1',
        scoringAxes: ['authorTrust', 'runtimeReliability', 'costTransparency', 'passPrediction', 'citationTrust'],
        validationErrors,
        validationWarnings,
        evidenceFailures,
        providerSummaries: analytics.providerSummaries,
        topPriorities: analytics.topPriorities,
        deferred: analytics.deferred,
        allActionableGaps: analytics.actionableGaps,
        sourceFindings
    };

    const dir = path.dirname(AUDIT_REPORT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Only rewrite when a finding actually changed: generatedAt alone moving every
    // run made this file dirty on every build for no informational gain.
    const existing = fs.existsSync(AUDIT_REPORT_FILE)
        ? fs.readFileSync(AUDIT_REPORT_FILE, 'utf8')
        : null;
    if (snapshotContentChanged(existing, report)) {
        fs.writeFileSync(AUDIT_REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function main() {
    const capData = loadJson(CAPABILITIES_FILE);
    const intData = loadJson(INTEGRATIONS_FILE);

    if (!capData) {
        console.error('[api-features] Missing provider-capabilities.json — skipping audit.');
        return;
    }
    if (!intData) {
        console.error('[api-features] Missing plugin-feature-integration.json — skipping audit.');
        return;
    }

    // Validate
    const capResult = validateCapabilities(capData);
    const capabilityIds = new Set((capData.capabilities || []).map(c => c.id));
    const intResult = validateIntegrations(intData, capabilityIds);
    const validationErrors = [...capResult.errors, ...intResult.errors];
    const validationWarnings = [...capResult.warnings, ...intResult.warnings];

    // Evidence verification
    const evidenceFailures = verifyEvidence(intData.integrations || []);

    // Source scan
    const sourceFindings = scanSources();

    // Analytics
    const analytics = buildAnalytics(capData.capabilities || [], intData.integrations || []);

    // Console output
    printReport(analytics, sourceFindings, validationErrors, validationWarnings, evidenceFailures);

    // Write report
    writeAuditReport(analytics, sourceFindings, validationErrors, validationWarnings, evidenceFailures);

    // Issue generation
    if (doGenerateIssues) {
        const capMap = new Map((capData.capabilities || []).map(c => [c.id, c]));
        const intMap = new Map((intData.integrations || []).map(i => [i.id, i]));
        generateIssueStubs(analytics.topPriorities, capMap, intMap);
    }

    // Strict mode: exit with error if violations found
    if (strictMode) {
        const strictFailures = [];
        if (validationErrors.length > 0) strictFailures.push(`${validationErrors.length} validation error(s)`);
        if (validationWarnings.length > 0) strictFailures.push(`${validationWarnings.length} provider reality warning(s)`);
        if (evidenceFailures.length > 0) strictFailures.push(`${evidenceFailures.length} evidence failure(s)`);

        if (strictFailures.length > 0) {
            console.error(`[api-features] --strict: ${strictFailures.join(', ')}`);
            process.exit(1);
        }
    }
}

const isDirectRun = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    main();
}
