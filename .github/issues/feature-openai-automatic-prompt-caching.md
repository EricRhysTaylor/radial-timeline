---
title: "Implement Automatic Prompt Caching (openai)"
labels: ai-feature, openai, p0
---

## Feature: Automatic Prompt Caching

**Provider:** openai
**Category:** cost-optimization
**Maturity:** ga
**ROI Category:** cost
**Implementation Complexity:** low
**Priority Score:** 7

## Description

Automatic 50% discount on cached input tokens for prompts >1024 tokens with identical prefixes. Requires stable system message prefix — currently defeated by system/user concatenation.

## Documentation

https://platform.openai.com/docs/guides/prompt-caching

## Relevant Plugin Features

- gossamer
- inquiry
- sceneAnalysis

## Implementation Notes

OpenAI automatically caches prompts >1024 tokens with stable prefixes (50% discount). Currently DEFEATED because openaiApi.ts line 82 concatenates system+user into a single user message. Fix: separate into system and user messages for non-reasoning models.

## Source Files

- `src/api/openaiApi.ts`

## Blockers

None

## Definition of Done

### Request Shape
- [ ] API request body matches provider documentation


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
