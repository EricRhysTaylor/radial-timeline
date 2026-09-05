---
title: "Implement Prompt Caching (anthropic)"
labels: ai-feature, anthropic, p0
---

## Feature: Prompt Caching

**Provider:** anthropic
**Category:** cost-optimization
**Maturity:** ga
**ROI Category:** cost
**Implementation Complexity:** medium
**Priority Score:** 7

## Description

Cache system prompts and large content blocks using cache_control markers. Subsequent requests pay only for cache reads (~90% cheaper). Requires content block array format for system prompt.

## Documentation

https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

## Relevant Plugin Features

- gossamer
- inquiry
- sceneAnalysis

## Implementation Notes

System prompt sent as plain string in anthropicApi.ts. Needs content block array with cache_control: { type: 'ephemeral' } on evidence blocks. Gossamer and Inquiry send identical evidence across calls — caching would save ~90% on input tokens.

## Source Files

- `src/api/anthropicApi.ts`
- `src/ai/providers/anthropicProvider.ts`
- `src/api/providerRouter.ts`

## Blockers

- Requires anthropic-system-content-blocks to be implemented first

## Definition of Done

### Request Shape
- [ ] API request body matches provider documentation

### Headers
- [ ] Header `anthropic-beta: prompt-caching-2024-07-31` sent in requests

### Tests
- [ ] Unit test covering request construction
- [ ] Integration test verifying response parsing

### Audit Evidence
- [ ] Add implementationEvidence patterns to registry
- [ ] `implementationStatus` set to `"complete"` in plugin-feature-integration.json
- [ ] `node scripts/check-api-features.mjs --strict` passes

### Obsidian Compatibility
- [ ] Works with `requestUrl()` (no browser-only APIs)
- [ ] Fallback behavior if feature unavailable (older API version, rate limit, mobile)
