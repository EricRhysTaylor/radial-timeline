/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.
import { requestUrl } from 'obsidian';
import { modelSupportsRequestTemperature, modelSupportsRequestTopP } from '../ai/registry/modelRequestProfiles';
import { warnLegacyAccess } from './legacyAccessGuard';
import type { SourceCitation, TokenCountResult } from '../ai/types';

interface GeminiPart { text?: string }
interface GeminiContent { parts?: GeminiPart[]; role?: string }
interface GeminiSearchTool {
  google_search: Record<string, never>;
}

interface GeminiGroundingWebSource {
  uri?: string;
  title?: string;
}

interface GeminiGroundingChunk {
  web?: GeminiGroundingWebSource;
  retrievedContext?: GeminiGroundingWebSource;
}

interface GeminiGroundingSupport {
  segment?: {
    text?: string;
    startIndex?: number;
    endIndex?: number;
  };
  groundingChunkIndices?: number[];
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[];
}

interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  groundingMetadata?: GeminiGroundingMetadata;
}

interface GeminiGenerateSuccess {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

interface GeminiErrorResponse {
  error?: { message?: string; status?: string };
}

export interface GeminiApiResponse {
  success: boolean;
  content: string | null;
  responseData: unknown;
  requestPayload?: unknown;
  citations?: SourceCitation[];
  error?: string;
}

function dedupeGeminiCitations(citations: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  const deduped: SourceCitation[] = [];
  citations.forEach(citation => {
    const key = [
      citation.attributionType,
      'sourceId' in citation ? citation.sourceId ?? '' : '',
      'url' in citation ? citation.url ?? '' : '',
      'sourceLabel' in citation ? citation.sourceLabel : '',
      citation.citedText ?? '',
      citation.startCharIndex ?? '',
      citation.endCharIndex ?? ''
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(citation);
  });
  return deduped;
}

export function extractGeminiGroundingCitations(responseData: unknown): SourceCitation[] {
  if (!responseData || typeof responseData !== 'object') return [];
  const data = responseData as GeminiGenerateSuccess;
  const citations: SourceCitation[] = [];

  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  candidates.forEach(candidate => {
    const metadata = candidate.groundingMetadata;
    const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
    const supports = Array.isArray(metadata?.groundingSupports) ? metadata.groundingSupports : [];

    const buildCitation = (
      chunk: GeminiGroundingChunk | undefined,
      support?: GeminiGroundingSupport
    ): SourceCitation | null => {
      const source = chunk?.web ?? chunk?.retrievedContext;
      const url = typeof source?.uri === 'string' && source.uri.trim() ? source.uri.trim() : undefined;
      const title = typeof source?.title === 'string' && source.title.trim() ? source.title.trim() : undefined;
      if (!url && !title) return null;
      const citedText = typeof support?.segment?.text === 'string' && support.segment.text.trim()
        ? support.segment.text.trim()
        : undefined;
      const startCharIndex = typeof support?.segment?.startIndex === 'number' ? support.segment.startIndex : undefined;
      const endCharIndex = typeof support?.segment?.endIndex === 'number' ? support.segment.endIndex : undefined;
      return {
        attributionType: 'grounded',
        sourceLabel: title ?? url ?? 'Grounded source',
        sourceId: url ?? title,
        url,
        title,
        citedText,
        startCharIndex,
        endCharIndex
      };
    };

    if (supports.length) {
      supports.forEach(support => {
        const indices = Array.isArray(support.groundingChunkIndices)
          ? support.groundingChunkIndices
          : [];
        indices.forEach(index => {
          const citation = buildCitation(chunks[index], support);
          if (citation) citations.push(citation);
        });
      });
    } else {
      chunks.forEach(chunk => {
        const citation = buildCitation(chunk);
        if (citation) citations.push(citation);
      });
    }
  });

  return dedupeGeminiCitations(citations);
}

// Gemini's responseSchema accepts a limited OpenAPI 3.0 subset and rejects
// standard JSON-Schema keys like `additionalProperties`, `$schema`, `$ref`,
// and `allOf`/`oneOf`/`not`. RT's schemas are authored for OpenAI strict mode
// (which requires `additionalProperties: false`), so we strip unsupported
// keys before dispatch. See https://ai.google.dev/gemini-api/docs/structured-output
const GEMINI_SCHEMA_SUPPORTED_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'items',
  'propertyOrdering',
  'anyOf',
  'title',
  'default'
]);

export function sanitizeGeminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};
  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!GEMINI_SCHEMA_SUPPORTED_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        props[propKey] = sanitizeGeminiSchema(propValue);
      }
      out.properties = props;
    } else if (key === 'items') {
      out.items = sanitizeGeminiSchema(value);
    } else if (key === 'anyOf' && Array.isArray(value)) {
      out.anyOf = value.map(entry => sanitizeGeminiSchema(entry));
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function callGeminiApi(
  apiKey: string,
  modelId: string,
  systemPrompt: string | null,
  userPrompt: string,
  maxTokens: number | null = 4000,
  temperature?: number,
  jsonSchema?: Record<string, unknown>,  // Optional JSON schema for structured output
  cachedContentName?: string, // Optional: name of cached content resource (e.g. "cachedContents/...")
  topP?: number,
  citationsEnabled?: boolean,
  internalAdapterAccess?: boolean
): Promise<GeminiApiResponse> {
  warnLegacyAccess('geminiApi.callGeminiApi', internalAdapterAccess);
  if (!apiKey) {
    return {
      success: false,
      content: null,
      responseData: { error: { message: 'Gemini API key not configured.' } },
      error: 'Gemini API key not configured.'
    };
  }
  if (!modelId) {
    return {
      success: false,
      content: null,
      responseData: { error: { message: 'Gemini model ID not configured.' } },
      error: 'Gemini model ID not configured.'
    };
  }

  // Handle potential "models/" prefix in the modelId to prevent double prefixing
  const cleanModelId = modelId.startsWith('models/') ? modelId.slice(7) : modelId;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  type GeminiRequest = {
    contents: { role: 'user'; parts: { text: string }[] }[];
    generationConfig: { 
      temperature?: number; 
      topP?: number;
      maxOutputTokens?: number;
      responseMimeType?: string;
      responseSchema?: Record<string, unknown>;
      thinkingConfig?: { mode: string };
    };
    systemInstruction?: { parts: { text: string }[] };
    cachedContent?: string;
    tools?: GeminiSearchTool[];
  };
  const body: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {},
  };
  if (cachedContentName) {
    body.cachedContent = cachedContentName;
  }
  if (systemPrompt && !cachedContentName) {
    // v1beta accepts systemInstruction as top-level.
    // When cachedContentName is set, systemInstruction is already inside the
    // cached content — Gemini rejects the combination. // SAFE: Gemini restriction
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  if (maxTokens !== null) {
    body.generationConfig.maxOutputTokens = maxTokens;
  }
  // Secondary safety net for temperature/topP on models with managed sampling.
  // Central sanitization in sanitizeDispatchParams is authoritative;
  // this guard prevents direct callGeminiApi callers from hitting API errors.
  if (typeof temperature === 'number' && modelSupportsRequestTemperature('google', cleanModelId)) {
    body.generationConfig.temperature = temperature;
  }
  if (typeof topP === 'number' && modelSupportsRequestTopP('google', cleanModelId)) {
    body.generationConfig.topP = topP;
  }
  // Enable JSON mode if schema provided
  if (jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = sanitizeGeminiSchema(jsonSchema);
  }
  // Secondary safety net: Gemini rejects tools + responseMimeType 'application/json'.
  // Central sanitization handles cacheVsCitationsExclusive; this guard handles
  // the tools-vs-JSON mutual exclusion at the API level.
  if (citationsEnabled && !jsonSchema) {
    body.tools = [{ google_search: {} }];
  }

  let responseData: unknown;
  try {
    const resp = await requestUrl({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      throw: false,
    });
    responseData = resp.json;
    if (resp.status >= 400) {
      const err = responseData as GeminiErrorResponse;
      const msg = err?.error?.message ?? resp.text ?? `Gemini error (${resp.status})`;
      return { success: false, content: null, responseData, requestPayload: body, error: msg };
    }
    const success = responseData as GeminiGenerateSuccess;
    // Detect safety block explicitly
    if (success?.promptFeedback && success.promptFeedback.blockReason) {
      const reason = success.promptFeedback.blockReason;
      return { success: false, content: null, responseData, requestPayload: body, error: `Gemini safety blocked: ${reason}` };
    }
    
    // Check for finish reasons that indicate incomplete response
    const candidate = success?.candidates?.[0];
    if (candidate?.finishReason) {
      if (candidate.finishReason === 'MAX_TOKENS') {
        return { 
          success: false, 
          content: null, 
          responseData, 
          requestPayload: body,
          error: 'Response exceeded maximum token limit. The output was truncated before completion. Try reducing the manuscript size or increasing maxOutputTokens.' 
        };
      }
      if (candidate.finishReason === 'SAFETY') {
        return { 
          success: false, 
          content: null, 
          responseData, 
          requestPayload: body,
          error: 'Response blocked by Gemini safety filters.' 
        };
      }
      if (candidate.finishReason === 'RECITATION') {
        return { 
          success: false, 
          content: null, 
          responseData, 
          requestPayload: body,
          error: 'Response blocked due to recitation concerns.' 
        };
      }
      // STOP is the normal finish reason, continue processing
    }
    
    const text = candidate?.content?.parts?.map(p => p.text || '').join('').trim();
    if (text) {
      const citations = extractGeminiGroundingCitations(responseData);
      return {
        success: true,
        content: text,
        responseData,
        requestPayload: body,
        ...(citations.length ? { citations } : {})
      };
    }
    
    // Invalid response structure - log minimal debug info
    console.error('[Gemini API] Invalid response structure:', {
      hasCandidates: !!success?.candidates,
      candidatesLength: success?.candidates?.length || 0,
      finishReason: candidate?.finishReason
    });
    
    return { success: false, content: null, responseData, requestPayload: body, error: 'Invalid response structure from Gemini.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    responseData = { error: { message: msg } };
    return { success: false, content: null, responseData, requestPayload: body, error: msg };
  }
}

/**
 * Create a cached content resource for Gemini
 * @param apiKey Gemini API key
 * @param modelId Model ID to associate with cache (e.g. "gemini-1.5-pro-001")
 * @param content Full text content to cache (as user-role contents)
 * @param ttlSeconds Time to live in seconds (default 3600 = 1 hour)
 * @param systemInstruction Optional system instruction to include in the cached content.
 *   When provided, the generate request must NOT also set systemInstruction
 *   (Gemini rejects the combination).
 * @returns Name of the cached content resource (e.g. "cachedContents/123...")
 */
export async function createGeminiCache(
  apiKey: string,
  modelId: string,
  content: string,
  ttlSeconds: number = 3600,
  systemInstruction?: string
): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is required to create cache.');

  const cleanModelId = modelId.startsWith('models/') ? modelId.slice(7) : modelId;
  const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${encodeURIComponent(apiKey)}`;

  const body: Record<string, unknown> = {
    model: `models/${cleanModelId}`,
    contents: [
      {
        role: 'user',
        parts: [{ text: content }]
      }
    ],
    ttl: `${ttlSeconds}s`
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const resp = await requestUrl({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    throw: false
  });

  if (resp.status >= 400) {
    const err = resp.json as GeminiErrorResponse;
    throw new Error(err?.error?.message ?? `Failed to create cache (${resp.status})`);
  }

  const data = resp.json as { name: string };
  if (!data.name) {
    throw new Error('Cache creation response missing name field');
  }
  
  return data.name;
}

/**
 * Count input tokens for a Gemini request using the provider's countTokens API.
 *
 * Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens
 *
 * The countTokens endpoint is free (no quota cost beyond the HTTP roundtrip)
 * and returns the exact tokenization the model would see, so this is the
 * authoritative source for input cost forecasting.
 *
 * Throws on network or API errors so callers can fall back to a heuristic.
 */
export async function countGeminiTokens(
  apiKey: string,
  modelId: string,
  systemPrompt: string | null,
  userPrompt: string
): Promise<TokenCountResult> {
  if (!apiKey) {
    throw new Error('Gemini API key not configured.');
  }
  if (!modelId) {
    throw new Error('Gemini model ID not configured.');
  }

  const cleanModelId = modelId.startsWith('models/') ? modelId.slice(7) : modelId;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModelId)}:countTokens?key=${encodeURIComponent(apiKey)}`;

  // The countTokens endpoint accepts two body shapes (per Google's
  // v1beta reference) and ONLY two:
  //   1. `{ contents: [...] }`               — counts message contents only.
  //   2. `{ generateContentRequest: { ... } }` — counts the full request
  //      (contents + systemInstruction + tools + ...).
  //
  // A top-level `systemInstruction` field — what we used to send
  // alongside `contents` — is an unknown field on this endpoint and
  // Google rejects the whole request with HTTP 400 INVALID_ARGUMENT
  // ("Invalid JSON payload received. Unknown name 'systemInstruction'…").
  // This silently broke Gemini countTokens for every Inquiry run with
  // a non-empty system prompt (i.e. almost every run).
  //
  // When the caller supplies a system prompt, wrap in
  // `generateContentRequest` so the system tokens are counted accurately.
  // When there's no system prompt, the simple `contents`-only form is
  // shorter and equivalent.
  const body: Record<string, unknown> = systemPrompt && systemPrompt.length > 0
    ? {
        generateContentRequest: {
          model: `models/${cleanModelId}`,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        }
      }
    : {
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
      };

  const resp = await requestUrl({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    throw: false
  });

  if (resp.status >= 400) {
    const err = resp.json as GeminiErrorResponse;
    // Always include status + status name + model so the dev console
    // diagnostic is actionable. Without status, "Model not found" looks
    // identical to "Quota exceeded" — both just say their message.
    const providerMessage = err?.error?.message ?? resp.text ?? 'no error message in response';
    const providerStatus = err?.error?.status ?? `HTTP ${resp.status}`;
    throw new Error(
      `Gemini countTokens failed for "${cleanModelId}" — ${providerStatus} (HTTP ${resp.status}): ${providerMessage}`
    );
  }

  const data = resp.json as { totalTokens?: number };
  const totalTokens = typeof data?.totalTokens === 'number' ? data.totalTokens : NaN;
  if (!Number.isFinite(totalTokens)) {
    throw new Error(`Invalid token count response from Gemini for "${cleanModelId}" — response had no numeric totalTokens field.`);
  }
  return {
    provider: 'google',
    modelId: cleanModelId,
    inputTokens: Math.max(0, Math.floor(totalTokens)),
    source: 'provider_count'
  };
}

// --- fetch models ---
interface GoogleModel { name: string; displayName?: string }
interface GoogleModelsResponse { models?: GoogleModel[] }

export async function fetchGeminiModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  if (!apiKey) throw new Error('Gemini API key is required to fetch models.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const resp = await requestUrl({ url, method: 'GET', throw: false });
  const data = resp.json as GoogleModelsResponse;
  if (resp.status >= 400 || !Array.isArray(data?.models)) {
    throw new Error(`Error fetching Gemini models (${resp.status})`);
  }
  // Map to simple ids (strip the 'models/' prefix)
  const mapped = data.models.map(m => {
    const id = m.name?.includes('/') ? m.name.split('/').pop() || m.name : m.name;
    return { id, name: m.displayName || id };
  });
  return mapped.sort((a, b) => a.id.localeCompare(b.id));
}
