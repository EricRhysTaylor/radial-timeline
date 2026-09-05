---
title: "Implement System Content Blocks (anthropic)"
labels: ai-feature, anthropic, p0
---

## Feature: System Content Blocks

**Provider:** anthropic
**Category:** capability
**Maturity:** ga
**ROI Category:** capability
**Implementation Complexity:** low
**Priority Score:** 6

## Description

Send system prompt as an array of typed content blocks instead of a plain string. Prerequisite for prompt caching and multi-part system instructions.

## Documentation

https://docs.anthropic.com/en/api/messages

## Relevant Plugin Features

- gossamer
- inquiry
- sceneAnalysis
- synopsis
- pulse

## Implementation Notes

callAnthropicApi sends system as a plain string (line 47: requestBody.system = systemPrompt). Must restructure to array of content blocks: [{ type: 'text', text: ... }]. Prerequisite for prompt caching.

## Source Files

- `src/api/anthropicApi.ts`

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
