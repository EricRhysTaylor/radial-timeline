/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.
import { requestUrl } from 'obsidian';
import { warnLegacyAccess } from './legacyAccessGuard';
import { CACHE_BREAK_DELIMITER } from '../ai/prompts/composeEnvelope';
import { modelSupportsAdaptiveThinking, modelThinkingDefaultsOn, modelUsesAlwaysOnThinking } from '../ai/registry/modelRequestProfiles';
import type { AnthropicCacheTtl, EvidenceDocument, TokenCountResult } from '../ai/types';

export type AnthropicTextBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: AnthropicCacheTtl };
};

export type AnthropicDocumentBlock = {
  type: 'document';
  source: { type: 'text'; media_type: 'text/plain'; data: string };
  title?: string;
  citations: { enabled: true };
  cache_control?: { type: 'ephemeral'; ttl?: AnthropicCacheTtl };
};

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicDocumentBlock;

type AnthropicToolDefinition = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

type AnthropicToolChoice = {
  type: 'tool';
  name: string;
};

export interface BuildAnthropicUserContentInput {
  userPrompt: string;
  citationsEnabled?: boolean;
  evidenceDocuments?: { title: string; content: string }[];
  cacheTtl?: AnthropicCacheTtl;
}

interface AnthropicResponseCitation {
  type: string;
  cited_text: string;
  document_index: number;
  document_title?: string;
  start_char_index?: number;
  end_char_index?: number;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicSuccessResponse {
  content: ({ type: string; text?: string; thinking?: string; citations?: AnthropicResponseCitation[] } | AnthropicToolUseBlock)[];
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: Record<string, number>;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}
interface AnthropicErrorResponse {
  type: string;
  error: { type: string; message: string };
}

interface AnthropicTokenCountSuccessResponse {
  input_tokens?: number;
  total_tokens?: number;
}
export interface AnthropicApiResponse {
  success: boolean;
  content: string | null;
  responseData: unknown;
  requestPayload?: unknown;
  error?: string;
  citations?: { citedText: string; documentIndex: number; documentTitle?: string;
                startCharIndex?: number; endCharIndex?: number }[];
}

export interface AnthropicDispatchDiagnostics {
  requestedCacheTtl: AnthropicCacheTtl | 'none';
  hasCacheablePrefix: boolean;
  cachePrefixFingerprint: string;
  stableTextFingerprint: string;
  stableTextChars: number;
  documentBlockCount: number;
  documentChars: number;
  volatileTextFingerprint: string;
  volatileTextChars: number;
  blockShape: string;
}

function mapAnthropicResponseCitations(
  textBlocks: Array<{ type: string; text?: string; citations?: AnthropicResponseCitation[] }>
): AnthropicApiResponse['citations'] {
  const responseCitations = textBlocks.flatMap(b => b.citations ?? []);
  if (!responseCitations.length) return undefined;
  return responseCitations.map(c => ({
    citedText: c.cited_text,
    documentIndex: c.document_index,
    documentTitle: c.document_title,
    startCharIndex: c.start_char_index,
    endCharIndex: c.end_char_index
  }));
}

interface BuildAnthropicMessageRequestInput {
  mode: 'generate' | 'count';
  modelId: string;
  systemPrompt: string | null;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  thinkingBudgetTokens?: number;
  citationsEnabled?: boolean;
  evidenceDocuments?: EvidenceDocument[];
  cacheTtl?: AnthropicCacheTtl;
  jsonSchema?: Record<string, unknown>;
}

type AnthropicMessageRequestBody = {
  model: string;
  messages: { role: string; content: AnthropicContentBlock[] }[];
  system?: AnthropicTextBlock[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  thinking?:
    | { type: 'enabled'; budget_tokens: number }
    | { type: 'adaptive' }
    | { type: 'disabled' };
  output_config?: {
    effort?: 'low' | 'medium' | 'high';
    format?: { type: 'json_schema'; schema: Record<string, unknown> };
  };
  tools?: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice;
};

// output_config.format json_schema does NOT support numeric constraints
// (minimum/maximum/multipleOf) or string-length constraints
// (minLength/maxLength), and requires additionalProperties:false on every
// object. We strip the unsupported keywords (client-side validation still
// enforces them) and stamp additionalProperties before sending.
const UNSUPPORTED_JSON_SCHEMA_KEYWORDS = new Set([
  'minimum',
  'maximum',
  'multipleOf',
  'minLength',
  'maxLength'
]);

export function sanitizeAnthropicOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === 'object') {
      const source = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(source)) {
        if (UNSUPPORTED_JSON_SCHEMA_KEYWORDS.has(key)) continue;
        out[key] = walk(value);
      }
      // Every object node must declare additionalProperties:false.
      if (out.type === 'object' || out.properties !== undefined) {
        out.additionalProperties = false;
      }
      return out;
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}

export function buildAnthropicUserContent(input: BuildAnthropicUserContentInput): AnthropicContentBlock[] {
  const delimIndex = input.userPrompt.indexOf(CACHE_BREAK_DELIMITER);
  const hasDelimiter = delimIndex > 0;
  const stableText = hasDelimiter
    ? input.userPrompt.slice(0, delimIndex).trimEnd()
    : input.userPrompt;
  const volatileText = hasDelimiter
    ? input.userPrompt.slice(delimIndex + CACHE_BREAK_DELIMITER.length).trimStart()
    : '';
  if (input.evidenceDocuments?.length) {
    const docs = input.evidenceDocuments;
    const lastIndex = docs.length - 1;

    if (input.citationsEnabled) {
      // Per-scene document blocks with citations enabled.
      // Instructions/rules stay in the stable text block; evidence goes in document blocks.
      // cache_control on last document only — caches entire evidence prefix.
      const docBlocks: AnthropicContentBlock[] = docs.map((doc, i) => ({
        type: 'document' as const,
        source: { type: 'text' as const, media_type: 'text/plain' as const, data: doc.content },
        title: doc.title,
        citations: { enabled: true as const },
        ...(i === lastIndex && input.cacheTtl
          ? { cache_control: { type: 'ephemeral' as const, ttl: input.cacheTtl } }
          : {})
      }));
      return [
        { type: 'text', text: stableText },
        ...docBlocks,
        ...(volatileText ? [{ type: 'text' as const, text: volatileText }] : []),
      ];
    }

    // Citations disabled: evidence is sent as plain text blocks. The corpus
    // must still reach the model — the toggle controls source-anchor
    // metadata, not whether the manuscript is included. cache_control on the
    // last evidence block keeps the prefix cacheable.
    const evidenceTextBlocks: AnthropicTextBlock[] = docs.map((doc, i) => ({
      type: 'text' as const,
      text: `## ${doc.title}\n${doc.content}`,
      ...(i === lastIndex && input.cacheTtl
        ? { cache_control: { type: 'ephemeral' as const, ttl: input.cacheTtl } }
        : {})
    }));
    return [
      { type: 'text', text: stableText },
      ...evidenceTextBlocks,
      ...(volatileText ? [{ type: 'text' as const, text: volatileText }] : []),
    ];
  }

  if (!hasDelimiter) {
    return [{ type: 'text', text: input.userPrompt }];
  }

  // Standard caching path (no citations, no evidence docs)
  return [
    { type: 'text', text: stableText, cache_control: { type: 'ephemeral' as const, ...(input.cacheTtl ? { ttl: input.cacheTtl } : {}) } },
    { type: 'text', text: volatileText },
  ];
}

function fingerprintAnthropicText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildAnthropicDispatchDiagnostics(
  content: AnthropicContentBlock[],
  requestedCacheTtl?: AnthropicCacheTtl
): AnthropicDispatchDiagnostics {
  let cacheBoundaryIndex = -1;
  for (let index = content.length - 1; index >= 0; index--) {
    if (content[index]?.cache_control) {
      cacheBoundaryIndex = index;
      break;
    }
  }
  const cacheableBlocks = cacheBoundaryIndex >= 0
    ? content.slice(0, cacheBoundaryIndex + 1)
    : [];
  const volatileBlocks = cacheBoundaryIndex >= 0
    ? content.slice(cacheBoundaryIndex + 1)
    : content;
  const stableText = cacheableBlocks
    .filter((block): block is AnthropicTextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');
  const documentBlocks = cacheableBlocks.filter((block): block is AnthropicDocumentBlock => block.type === 'document');
  const documentChars = documentBlocks.reduce((total, block) => total + (block.source.data?.length ?? 0), 0);
  const volatileText = volatileBlocks
    .filter((block): block is AnthropicTextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');
  return {
    requestedCacheTtl: requestedCacheTtl ?? 'none',
    hasCacheablePrefix: cacheableBlocks.length > 0,
    cachePrefixFingerprint: cacheableBlocks.length > 0
      ? fingerprintAnthropicText(JSON.stringify(cacheableBlocks))
      : 'none',
    stableTextFingerprint: stableText.length > 0
      ? fingerprintAnthropicText(stableText)
      : 'none',
    stableTextChars: stableText.length,
    documentBlockCount: documentBlocks.length,
    documentChars,
    volatileTextFingerprint: volatileText.length > 0
      ? fingerprintAnthropicText(volatileText)
      : 'none',
    volatileTextChars: volatileText.length,
    blockShape: content
      .map(block => `${block.type}${block.cache_control ? '*' : ''}`)
      .join('>')
  };
}

function buildAnthropicMessageRequestBody(
  input: BuildAnthropicMessageRequestInput
): AnthropicMessageRequestBody {
  const userContent = buildAnthropicUserContent({
    userPrompt: input.userPrompt,
    citationsEnabled: input.citationsEnabled,
    evidenceDocuments: input.evidenceDocuments,
    cacheTtl: input.cacheTtl
  });

  const requestBody: AnthropicMessageRequestBody = {
    model: input.modelId,
    messages: [{ role: 'user', content: userContent }]
  };

  if (input.systemPrompt) {
    requestBody.system = [{ type: 'text', text: input.systemPrompt }];
  }

  // Citations and structured outputs are mutually exclusive on Anthropic:
  // citations attach only to text content blocks, but a forced tool call
  // returns its payload as `tool_use.input` with no text blocks for the
  // citation metadata to anchor to. When citations are enabled we therefore
  // skip the tool wrapper entirely and rely on the in-prompt schema instructions
  // (the runner already injects a verbatim schema example into the user prompt).
  // Anthropic docs:
  //   https://platform.claude.com/docs/en/docs/build-with-claude/citations
  //   ("Citations and Structured Outputs are incompatible.")
  const hasJsonSchema = !!input.jsonSchema && Object.keys(input.jsonSchema).length > 0;
  const alwaysOnThinking = modelUsesAlwaysOnThinking('anthropic', input.modelId);
  // Structured-output routing:
  //   - Legacy path (Opus 4.8/4.7 and every non-always-on model): forced tool
  //     + tool_choice. JSON returns in `tool_use.input`.
  //   - Always-on-thinking path (Fable 5): forced tool_choice is incompatible
  //     with active thinking, so we use output_config.format (json_schema).
  //     The JSON arrives in a normal text block and is parsed via the text
  //     path (same as the citations branch).
  const forceStructuredTool = hasJsonSchema && !input.citationsEnabled && !alwaysOnThinking;
  const useSchemaOutputFormat = hasJsonSchema && !input.citationsEnabled && alwaysOnThinking;
  if (forceStructuredTool) {
    // The tool description must be aggressively explicit because Opus 4.7+
    // observed (2026-05-23 Gossamer failure) wrapping its tool input in a
    // $PARAMETER_NAME envelope key instead of populating the schema
    // directly. The verbose description below tells the model that the
    // tool input IS the schema root, not a value nested inside an
    // envelope. Older Claude models tolerated the sparser description but
    // the new model needs the explicit instruction.
    requestBody.tools = [{
      name: 'record_structured_response',
      description: 'Submit the final structured response by populating the tool input directly. The "input" object you provide IS the response — it must have the schema\'s top-level keys (e.g. "beats", "overallAssessment") at its root. Do NOT wrap the response in any envelope, placeholder, or container key such as "$PARAMETER_NAME", "result", "response", or "data". The input you submit will be parsed verbatim against the schema.',
      input_schema: input.jsonSchema as Record<string, unknown>
    }];
    requestBody.tool_choice = {
      type: 'tool',
      name: 'record_structured_response'
    };
  }

  if (useSchemaOutputFormat) {
    // Sanitize (strip unsupported numeric/string constraints, stamp
    // additionalProperties:false) — client-side validation still enforces the
    // stripped constraints on the parsed result. Set here (before the count
    // return) so count_tokens reflects the same request shape.
    // Verified via smoke probe against claude-fable-5 on 2026-07-19 (Probe B):
    // output_config:{effort, format:{type:'json_schema', schema}} with a
    // nested-object schema (additionalProperties:false) returned HTTP 200,
    // stop_reason end_turn — the JSON arrived in a normal text block and
    // parsed valid with exactly the schema's required keys. This is the
    // working replacement for the forced-tool path (incompatible with the
    // always-on thinking Fable can't turn off).
    requestBody.output_config = {
      ...(requestBody.output_config ?? {}), // SAFE: spread of an optional request field; absent means no output_config has been set yet
      format: {
        type: 'json_schema',
        schema: sanitizeAnthropicOutputSchema(input.jsonSchema as Record<string, unknown>)
      }
    };
  }

  if (input.mode === 'count') {
    return requestBody;
  }

  const thinkingBudget = typeof input.thinkingBudgetTokens === 'number'
    ? input.thinkingBudgetTokens
    : 0;

  if (alwaysOnThinking) {
    // Fable 5: thinking is ALWAYS ON and non-configurable. Never emit the
    // `thinking` field (any shape → 400). Depth is set via output_config.effort,
    // which is emitted on EVERY path — including the schema path, where legacy
    // models would turn thinking off. Effort is mapped from the requested
    // budget, defaulting to 'medium'; mapBudgetToEffort caps at 'high', so the
    // default effort is never raised above 'high' (Fable can run many minutes
    // at higher effort).
    // Verified via smoke probe against claude-fable-5 on 2026-07-19:
    //   - Probe A: `thinking` omitted + output_config.effort='low' → HTTP 200,
    //     stop_reason end_turn (thinking defaults to adaptive when unspecified).
    //   - Probe D (negatives): thinking:{type:'disabled'} → 400
    //     "\"thinking.type.disabled\" is not supported for this model. Thinking
    //     defaults to adaptive mode when not specified"; temperature=0.7 → 400
    //     "`temperature` is deprecated for this model." Both match the registry
    //     constraint flags (thinkingAlwaysOn / supportsTemperature:false).
    const effort = thinkingBudget >= 1024 ? mapBudgetToEffort(thinkingBudget) : 'medium';
    requestBody.output_config = { ...(requestBody.output_config ?? {}), effort }; // SAFE: spread of an optional request field; absent means no output_config has been set yet
    // Thinking spends tokens inside max_tokens for these models, so apply
    // headroom on ALL paths (schema included). Floor the reasoning headroom so
    // a small base (e.g. 4000) isn't starved by the thinking spend, and clamp
    // to the model output ceiling so base+headroom can't exceed it and 400.
    const baseMaxTokens = typeof input.maxTokens === 'number' ? input.maxTokens : 4000;
    const headroom = Math.max(thinkingBudget, ALWAYS_ON_THINKING_MIN_HEADROOM_TOKENS);
    requestBody.max_tokens = Math.min(baseMaxTokens + headroom, ALWAYS_ON_THINKING_MAX_OUTPUT_TOKENS);
    // temperature/top_p are rejected while thinking is active — omit entirely.
    // (The dispatch sanitizer already strips them for Fable; this is the
    // defense-in-depth net so a direct caller can't reintroduce a 400.)
    return requestBody;
  }

  // Thinking is gated on the absence of any JSON-output path, not on tool_use
  // specifically. Two reasons:
  //   1. Mixing extended thinking with structured output (tool_use OR text-mode
  //      JSON for citations) made one citation run take ~3× the estimate and
  //      collide with the parse-retry path. Pre-Option-A behavior was "thinking
  //      off whenever JSON is requested" — preserve that contract.
  //   2. Citations + thinking has no documented compatibility guarantee from
  //      Anthropic; keep the surface narrow until empirically validated.
  const thinkingEnabled = !hasJsonSchema && thinkingBudget >= 1024;
  const baseMaxTokens = typeof input.maxTokens === 'number' ? input.maxTokens : 4000;

  requestBody.max_tokens = thinkingEnabled
    ? baseMaxTokens + thinkingBudget
    : baseMaxTokens;

  // When thinking is enabled, Anthropic requires temperature=1 (omit to let API default).
  if (!thinkingEnabled && typeof input.temperature === 'number') {
    requestBody.temperature = input.temperature;
  }
  // Anthropic extended-thinking models require top_p >= 0.95 OR unset. We omit
  // entirely when thinking is enabled (verified via smoke against Opus 4.7 on
  // 2026-05-23 — provider returned: "top_p must be greater than or equal to
  // 0.95 or unset when thinking is enabled").
  if (typeof input.topP === 'number' && !thinkingEnabled) {
    requestBody.top_p = input.topP;
  }
  if (thinkingEnabled) {
    // Anthropic changed the thinking-request shape in Opus 4.7+:
    //   legacy: { type: 'enabled', budget_tokens: N }
    //   modern: { type: 'adaptive' } + output_config.effort
    // Verified via smoke probe against Opus 4.7 on 2026-05-23 — provider
    // returns 400: "thinking.type.enabled is not supported for this model.
    // Use thinking.type.adaptive and output_config.effort to control
    // thinking behavior." Which shape a model wants is declared on its
    // record (ModelInfo.constraints.supportsAdaptiveThinking), not matched
    // on the model id here.
    if (modelSupportsAdaptiveThinking('anthropic', input.modelId)) {
      requestBody.thinking = { type: 'adaptive' };
      requestBody.output_config = { effort: mapBudgetToEffort(thinkingBudget) };
    } else {
      requestBody.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    }
  } else if (modelThinkingDefaultsOn('anthropic', input.modelId)) {
    // Claude Opus 5: omitting `thinking` runs ADAPTIVE thinking by default —
    // the opposite of Opus 4.8/4.7, where omission meant no thinking. RT's
    // non-thinking paths (forced-tool structured output, budget-less prose)
    // depend on thinking being off: thinking spends inside max_tokens (we add
    // no headroom here), and the forced tool_choice structured path was only
    // ever validated against non-thinking requests. Emit the explicit
    // disabled shape to preserve the Opus 4.8 contract. Per Anthropic docs,
    // thinking:{type:'disabled'} is accepted at effort `high` or below and
    // 400s at xhigh/max — safe here because these paths never emit
    // output_config.effort (the API default is `high`). mapBudgetToEffort
    // caps at 'high', so the thinking-enabled branch can never collide with
    // that constraint either.
    requestBody.thinking = { type: 'disabled' };
  }
  return requestBody;
}

// Always-on-thinking models spend reasoning tokens inside max_tokens, so we add
// headroom on top of the requested base output. Floor keeps a small base (e.g.
// 4000) from being starved; ceiling is the Fable 5 output cap (128k).
const ALWAYS_ON_THINKING_MIN_HEADROOM_TOKENS = 8000;
const ALWAYS_ON_THINKING_MAX_OUTPUT_TOKENS = 128_000;

/** Map a budget-token target to the closest adaptive effort level. */
function mapBudgetToEffort(budgetTokens: number): 'low' | 'medium' | 'high' {
  if (budgetTokens <= 1024) return 'low';
  if (budgetTokens <= 4096) return 'medium';
  return 'high';
}

// Keywords that signal a 400 names a concrete request-payload problem (a bad
// or unsupported parameter/field). When none are present, a Fable 5 400 with
// an otherwise-valid payload is likely the org's zero-data-retention config —
// Fable requires 30-day retention and returns 400 on EVERY request under ZDR.
const REQUEST_PARAM_ERROR_HINTS = [
  'temperature',
  'top_p',
  'top_k',
  'thinking',
  'max_tokens',
  'output_config',
  'schema',
  'tool',
  'field',
  'property',
  'required',
  'unexpected',
  'invalid value',
  'must be',
  'not supported',
  'unsupported'
];

function looksLikeRequestParamError(message: string): boolean {
  const normalized = message.toLowerCase();
  return REQUEST_PARAM_ERROR_HINTS.some(hint => normalized.includes(hint));
}

function annotateAnthropic400(modelId: string, status: number, message: string): string {
  if (status !== 400) return message;
  if (!modelUsesAlwaysOnThinking('anthropic', modelId)) return message;
  if (looksLikeRequestParamError(message)) return message;
  return `${message} — If your Anthropic organization is configured for zero data retention, ${modelId} returns 400 on every request regardless of payload: it requires 30-day data retention. Verify the organization's retention setting if the request itself looks correct.`;
}

function buildAnthropicBetaHeader(): string {
  // The legacy output-128k-2025-02-19 header was removed: 128k synchronous
  // max output is the default on every Anthropic model RT serves (all
  // Claude 4.x — Opus 4.6/4.7/4.8, Sonnet 4.5/4.6), so the header is a
  // no-op carried over from the 3.7-era. See models/overview and the 4.8
  // migration guide. Prompt caching is still gated behind a beta header.
  return 'prompt-caching-2024-07-31';
}

export function normalizeAnthropicTokenCountResponse(
  responseData: unknown,
  modelId: string
): TokenCountResult | null {
  const data = responseData as AnthropicTokenCountSuccessResponse;
  const inputTokens = typeof data?.input_tokens === 'number'
    ? data.input_tokens
    : undefined;
  if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens)) {
    return null;
  }
  return {
    provider: 'anthropic',
    modelId,
    inputTokens: Math.max(0, Math.floor(inputTokens)),
    source: 'provider_count'
  };
}
export async function callAnthropicApi(
  apiKey: string,
  modelId: string,
  systemPrompt: string | null,
  userPrompt: string,
  maxTokens: number = 4000,
  internalAdapterAccess?: boolean,
  temperature?: number,
  topP?: number,
  thinkingBudgetTokens?: number,
  citationsEnabled?: boolean,
  evidenceDocuments?: { title: string; content: string }[],
  jsonSchema?: Record<string, unknown>,
  cacheTtl?: AnthropicCacheTtl
): Promise<AnthropicApiResponse> {
  warnLegacyAccess('anthropicApi.callAnthropicApi', internalAdapterAccess);
  const apiUrl = 'https://api.anthropic.com/v1/messages';
  const apiVersion = '2023-06-01';
  if (!apiKey) {
    return { success: false, content: null, responseData: { type: 'error', error: { type: 'plugin_config_error', message: 'Anthropic API key not configured.' } }, error: 'Anthropic API key not configured.' };
  }
  if (!modelId) {
    return { success: false, content: null, responseData: { type: 'error', error: { type: 'plugin_config_error', message: 'Anthropic model ID not configured.' } }, error: 'Anthropic model ID not configured.' };  }
  const requestBody = buildAnthropicMessageRequestBody({
    mode: 'generate',
    modelId,
    systemPrompt,
    userPrompt,
    maxTokens,
    temperature,
    topP,
    thinkingBudgetTokens,
    citationsEnabled,
    evidenceDocuments,
    jsonSchema,
    cacheTtl
  });
  const dispatchDiagnostics = buildAnthropicDispatchDiagnostics(requestBody.messages[0]?.content ?? [], cacheTtl);

  let responseData: unknown;
  try {
    const response = await requestUrl({
      url: apiUrl,
      method: 'POST',
      headers: {
        'anthropic-version': apiVersion,
        'anthropic-beta': buildAnthropicBetaHeader(),
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      throw: false,
    });
    responseData = response.json;
    if (response.status >= 400) {
      const err = responseData as AnthropicErrorResponse;
      const rawMsg = err?.error?.message ?? response.text ?? `Anthropic error (${response.status})`; // SAFE: error-message composition — the request already failed; this only picks the most specific text available
      const msg = annotateAnthropic400(modelId, response.status, rawMsg);
      return {
        success: false,
        content: null,
        responseData,
        requestPayload: {
          requestBody,
          dispatchDiagnostics
        },
        error: msg
      };
    }
    const success = responseData as AnthropicSuccessResponse;
    // Skip thinking blocks — concatenate all text content blocks.
    // Handles both single-block (non-citation) and multi-block (citation) responses.
    const textBlocks = (success?.content ?? []).filter(
      (b: { type: string }) => b.type === 'text'
    ) as { type: string; text?: string; citations?: AnthropicResponseCitation[] }[];
    const mappedCitations = mapAnthropicResponseCitations(textBlocks);
    const toolUseBlock = (success?.content ?? []).find(
      (block): block is AnthropicToolUseBlock => block.type === 'tool_use'
    );
    if (toolUseBlock && toolUseBlock.input !== undefined) {
      return {
        success: true,
        content: JSON.stringify(toolUseBlock.input),
        responseData,
        requestPayload: {
          requestBody,
          dispatchDiagnostics
        },
        ...(mappedCitations?.length ? { citations: mappedCitations } : {})
      };
    }
    const content = textBlocks.map(b => b.text ?? '').join('').trim();
    if (content) {
      return {
        success: true,
        content,
        responseData,
        requestPayload: {
          requestBody,
          dispatchDiagnostics
        },
        citations: mappedCitations
      };
    }
    return {
      success: false,
      content: null,
      responseData,
      requestPayload: {
        requestBody,
        dispatchDiagnostics
      },
      error: 'Invalid response structure from Anthropic.'
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    responseData = { type: 'error', error: { type: 'network_or_execution_error', message: msg } };
    return {
      success: false,
      content: null,
      responseData,
      requestPayload: {
        requestBody,
        dispatchDiagnostics
      },
      error: msg
    };
  }
}

export async function countAnthropicTokens(
  apiKey: string,
  modelId: string,
  systemPrompt: string | null,
  userPrompt: string,
  citationsEnabled?: boolean,
  evidenceDocuments?: EvidenceDocument[],
  cacheTtl?: AnthropicCacheTtl,
  jsonSchema?: Record<string, unknown>
): Promise<TokenCountResult> {
  const apiUrl = 'https://api.anthropic.com/v1/messages/count_tokens';
  const apiVersion = '2023-06-01';

  if (!apiKey) {
    throw new Error('Anthropic API key not configured.');
  }
  if (!modelId) {
    throw new Error('Anthropic model ID not configured.');
  }

  const requestBody = buildAnthropicMessageRequestBody({
    mode: 'count',
    modelId,
    systemPrompt,
    userPrompt,
    citationsEnabled,
    evidenceDocuments,
    cacheTtl,
    jsonSchema
  });

  let responseData: unknown;
  try {
    const response = await requestUrl({
      url: apiUrl,
      method: 'POST',
      headers: {
        'anthropic-version': apiVersion,
        'anthropic-beta': buildAnthropicBetaHeader(),
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      throw: false,
    });
    responseData = response.json;
    if (response.status >= 400) {
      const err = responseData as AnthropicErrorResponse;
      const msg = err?.error?.message ?? response.text ?? `Anthropic token count error (${response.status})`;
      throw new Error(msg);
    }
    const normalized = normalizeAnthropicTokenCountResponse(responseData, modelId);
    if (normalized) return normalized;
    throw new Error('Invalid token count response from Anthropic.');
  } catch (e) {
    throw (e instanceof Error ? e : new Error(String(e)));
  }
}

// --- fetch models ---
interface AnthropicModel { id: string; } // API returns id field
interface AnthropicModelsResponse { data: AnthropicModel[]; }

export async function fetchAnthropicModels(apiKey: string): Promise<AnthropicModel[]> {
  if (!apiKey) throw new Error('Anthropic API key is required to fetch models.');

  const response = await requestUrl({
    url: 'https://api.anthropic.com/v1/models',
    method: 'GET',
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    throw: false,
  });
  if (response.status >= 400) {
    throw new Error(`Error fetching Anthropic models (${response.status})`);
  }
  const data = response.json as AnthropicModelsResponse;
  if (!Array.isArray(data?.data)) {
    // HTTP 200 with valid auth but unexpected body — key is valid
    return [];
  }
  return data.data.sort((a, b) => a.id.localeCompare(b.id));
} 
