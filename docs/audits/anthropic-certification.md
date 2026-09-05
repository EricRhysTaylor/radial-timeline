# Anthropic Certification

- Generated at: 2026-04-15T19:41:52.670Z
- Provider: anthropic
- Model: claude-sonnet-4-6

| Case | Result | Summary |
| --- | --- | --- |
| prepared_count_matches_provider_count | PASS | Prepared estimate used Anthropic count_tokens and matched the direct provider count exactly. |
| one_pass_text_success | PASS | One-pass text run succeeded with exact input token accounting. |
| one_pass_json_success | PASS | One-pass JSON run succeeded with exact input token accounting and valid structured output. |
| document_citations_text_run | PASS | Inquiry-style text run used Anthropic document blocks and returned direct manuscript citations. |
| provider_cache_create | PASS | First cacheable Anthropic run created provider-side cached input. |
| provider_cache_hit_repeat | PASS | Second identical Anthropic run hit provider-side cached input. |
| fresh_run_bypass | PASS | Fresh-run bypass disabled both RT cache reuse and Anthropic provider reuse. |

## prepared_count_matches_provider_count
- Result: PASS
- Duration: 1385ms
- Summary: Prepared estimate used Anthropic count_tokens and matched the direct provider count exactly.
```json
{
  "tokenEstimateMethod": "anthropic_count",
  "preparedInputTokens": 6936,
  "providerCountInputTokens": 6936
}
```

## one_pass_text_success
- Result: PASS
- Duration: 1307ms
- Summary: One-pass text run succeeded with exact input token accounting.
```json
{
  "content": "ACK",
  "preparedInputTokens": 163,
  "actualInputTokens": 163,
  "validation": {
    "schemaVersion": 1,
    "feature": "AnthropicCertification",
    "task": "AnthropicCertificationText",
    "provider": "anthropic",
    "modelRequested": "claude-sonnet-4-6",
    "modelResolved": "claude-sonnet-4-6",
    "returnType": "text",
    "status": "success",
    "servedFromCache": false,
    "bypassedInMemoryCache": true,
    "bypassedProviderReuse": true,
    "providerReuseCapable": true,
    "providerReuseRequested": false,
    "reuseState": "idle",
    "evidenceTransport": "inline_prompt",
    "schemaMode": "none",
    "citationsRequested": false,
    "citationsReturned": 0,
    "requestPayloadCaptured": true,
    "actualUsageCaptured": true,
    "sanitizationNotes": [],
    "adapterNotes": [],
    "submittedAt": "2026-04-15T19:41:22.283Z",
    "returnedAt": "2026-04-15T19:41:23.421Z",
    "durationMs": 1138
  }
}
```

## one_pass_json_success
- Result: PASS
- Duration: 1286ms
- Summary: One-pass JSON run succeeded with exact input token accounting and valid structured output.
```json
{
  "parsed": {
    "answer": "ACK"
  },
  "preparedInputTokens": 896,
  "actualInputTokens": 896,
  "validation": {
    "schemaVersion": 1,
    "feature": "AnthropicCertification",
    "task": "AnthropicCertificationJson",
    "provider": "anthropic",
    "modelRequested": "claude-sonnet-4-6",
    "modelResolved": "claude-sonnet-4-6",
    "returnType": "json",
    "status": "success",
    "servedFromCache": false,
    "bypassedInMemoryCache": true,
    "bypassedProviderReuse": true,
    "providerReuseCapable": true,
    "providerReuseRequested": false,
    "reuseState": "idle",
    "evidenceTransport": "inline_prompt",
    "schemaMode": "json_schema",
    "citationsRequested": false,
    "citationsReturned": 0,
    "requestPayloadCaptured": true,
    "actualUsageCaptured": true,
    "sanitizationNotes": [],
    "adapterNotes": [],
    "submittedAt": "2026-04-15T19:41:23.658Z",
    "returnedAt": "2026-04-15T19:41:24.707Z",
    "durationMs": 1049
  }
}
```

## document_citations_text_run
- Result: PASS
- Duration: 3822ms
- Summary: Inquiry-style text run used Anthropic document blocks and returned direct manuscript citations.
```json
{
  "content": "The codename that appears in the manuscript evidence is AURORA-LATTICE-baseline-mo0ghl95.",
  "citations": [
    {
      "citedText": "Codename AURORA-LATTICE-baseline-mo0ghl95 appears in the manuscript evidence and should be cited directly.\n\n",
      "documentIndex": 0,
      "documentTitle": "Scene S1",
      "startCharIndex": 0,
      "endCharIndex": 108
    }
  ],
  "validation": {
    "schemaVersion": 1,
    "feature": "InquiryMode",
    "task": "AnthropicCertificationCitations",
    "provider": "anthropic",
    "modelRequested": "claude-sonnet-4-6",
    "modelResolved": "claude-sonnet-4-6",
    "returnType": "text",
    "status": "success",
    "servedFromCache": false,
    "bypassedInMemoryCache": true,
    "bypassedProviderReuse": true,
    "providerReuseCapable": true,
    "providerReuseRequested": false,
    "reuseState": "idle",
    "evidenceTransport": "document_blocks",
    "schemaMode": "none",
    "citationsRequested": true,
    "citationsReturned": 1,
    "requestPayloadCaptured": true,
    "actualUsageCaptured": true,
    "sanitizationNotes": [],
    "adapterNotes": [],
    "submittedAt": "2026-04-15T19:41:26.581Z",
    "returnedAt": "2026-04-15T19:41:28.530Z",
    "durationMs": 1949
  }
}
```

## provider_cache_create
- Result: PASS
- Duration: 2770ms
- Summary: First cacheable Anthropic run created provider-side cached input.
```json
{
  "requestPayload": {
    "requestBody": {
      "model": "claude-sonnet-4-6",
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "Project Context:\n(none)\n\nFeature Mode Instructions:\nAnswer only from the attached manuscript evidence.\n\nUser Input:\nUse the attached evidence only.\n\nOutput Schema / Formatting Rules:\nReturn plain text only."
            },
            {
              "type": "document",
              "source": {
                "type": "text",
                "media_type": "text/plain",
                "data": "Codename AURORA-LATTICE-cache-repeat-mo0ghl95 appears in the manuscript evidence and should be cited directly.\n\nStable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. \n\nThe answer should remain grounded in the attached evidence document."
              },
              "title": "Scene S1",
              "citations": {
                "enabled": true
              },
              "cache_control": {
                "type": "ephemeral",
                "ttl": "1h"
              }
            },
            {
              "type": "text",
              "text": "User Question (highest priority):\nWhat codename appears in evidence? Reply with the codename AURORA-LATTICE-cache-repeat-mo0ghl95."
            }
          ]
        }
      ],
      "system": [
        {
          "type": "text",
          "text": "System Role Template:\nTemplate: Commercial Genre Fiction (Balanced Depth)\nAct as a developmental editor for a commercial genre novel. Prioritize pacing, clarity, and emotional stakes. Ensure each scene moves the plot or deepens character conflict. Keep prose lean; prefer tension and subtext to exposition. Focus feedback on momentum, scene purpose, and reader engagement."
        }
      ],
      "max_tokens": 3000,
      "temperature": 0.1
    },
    "dispatchDiagnostics": {
      "requestedCacheTtl": "1h",
      "hasCacheablePrefix": true,
      "cachePrefixFingerprint": "62574600",
      "stableTextFingerprint": "eac14f6c",
      "stableTextChars": 206,
      "documentBlockCount": 1,
      "documentChars": 16022,
      "volatileTextFingerprint": "2eb7b6db",
      "volatileTextChars": 130,
      "blockShape": "text>document*>text"
    }
  },
  "usage": {
    "inputTokens": 6940,
    "outputTokens": 46,
    "totalTokens": 6986,
    "rawInputTokens": 40,
    "cacheReadInputTokens": 0,
    "cacheCreationInputTokens": 6900,
    "cacheCreation5mInputTokens": 0,
    "cacheCreation1hInputTokens": 6900
  },
  "validation": {
    "schemaVersion": 1,
    "feature": "InquiryMode",
    "task": "AnthropicCertificationCacheRepeat",
    "provider": "anthropic",
    "modelRequested": "claude-sonnet-4-6",
    "modelResolved": "claude-sonnet-4-6",
    "returnType": "text",
    "status": "success",
    "servedFromCache": false,
    "bypassedInMemoryCache": true,
    "bypassedProviderReuse": false,
    "providerReuseCapable": true,
    "providerReuseRequested": true,
    "reuseState": "eligible",
    "providerCacheStatus": "created",
    "evidenceTransport": "document_blocks",
    "schemaMode": "none",
    "citationsRequested": true,
    "citationsReturned": 1,
    "requestPayloadCaptured": true,
    "actualUsageCaptured": true,
    "sanitizationNotes": [],
    "adapterNotes": [],
    "submittedAt": "2026-04-15T19:41:29.463Z",
    "returnedAt": "2026-04-15T19:41:31.300Z",
    "durationMs": 1837
  }
}
```

## provider_cache_hit_repeat
- Result: PASS
- Duration: 6752ms
- Summary: Second identical Anthropic run hit provider-side cached input.
```json
{
  "requestPayload": {
    "requestBody": {
      "model": "claude-sonnet-4-6",
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "Project Context:\n(none)\n\nFeature Mode Instructions:\nAnswer only from the attached manuscript evidence.\n\nUser Input:\nUse the attached evidence only.\n\nOutput Schema / Formatting Rules:\nReturn plain text only."
            },
            {
              "type": "document",
              "source": {
                "type": "text",
                "media_type": "text/plain",
                "data": "Codename AURORA-LATTICE-cache-repeat-mo0ghl95 appears in the manuscript evidence and should be cited directly.\n\nStable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. \n\nThe answer should remain grounded in the attached evidence document."
              },
              "title": "Scene S1",
              "citations": {
                "enabled": true
              },
              "cache_control": {
                "type": "ephemeral",
                "ttl": "1h"
              }
            },
            {
              "type": "text",
              "text": "User Question (highest priority):\nWhat codename appears in evidence? Reply with the codename AURORA-LATTICE-cache-repeat-mo0ghl95."
            }
          ]
        }
      ],
      "system": [
        {
          "type": "text",
          "text": "System Role Template:\nTemplate: Commercial Genre Fiction (Balanced Depth)\nAct as a developmental editor for a commercial genre novel. Prioritize pacing, clarity, and emotional stakes. Ensure each scene moves the plot or deepens character conflict. Keep prose lean; prefer tension and subtext to exposition. Focus feedback on momentum, scene purpose, and reader engagement."
        }
      ],
      "max_tokens": 3000,
      "temperature": 0.1
    },
    "dispatchDiagnostics": {
      "requestedCacheTtl": "1h",
      "hasCacheablePrefix": true,
      "cachePrefixFingerprint": "62574600",
      "stableTextFingerprint": "eac14f6c",
      "stableTextChars": 206,
      "documentBlockCount": 1,
      "documentChars": 16022,
      "volatileTextFingerprint": "2eb7b6db",
      "volatileTextChars": 130,
      "blockShape": "text>document*>text"
    }
  },
  "usage": {
    "inputTokens": 6940,
    "outputTokens": 46,
    "totalTokens": 6986,
    "rawInputTokens": 40,
    "cacheReadInputTokens": 6900,
    "cacheCreationInputTokens": 0,
    "cacheCreation5mInputTokens": 0,
    "cacheCreation1hInputTokens": 0
  },
  "validation": {
    "schemaVersion": 1,
    "feature": "InquiryMode",
    "task": "AnthropicCertificationCacheRepeat",
    "provider": "anthropic",
    "modelRequested": "claude-sonnet-4-6",
    "modelResolved": "claude-sonnet-4-6",
    "returnType": "text",
    "status": "success",
    "servedFromCache": false,
    "bypassedInMemoryCache": true,
    "bypassedProviderReuse": false,
    "providerReuseCapable": true,
    "providerReuseRequested": true,
    "reuseState": "warm",
    "providerCacheStatus": "hit",
    "evidenceTransport": "document_blocks",
    "schemaMode": "none",
    "citationsRequested": true,
    "citationsReturned": 1,
    "requestPayloadCaptured": true,
    "actualUsageCaptured": true,
    "sanitizationNotes": [],
    "adapterNotes": [],
    "submittedAt": "2026-04-15T19:41:36.073Z",
    "returnedAt": "2026-04-15T19:41:38.052Z",
    "durationMs": 1979
  }
}
```

## fresh_run_bypass
- Result: PASS
- Duration: 14618ms
- Summary: Fresh-run bypass disabled both RT cache reuse and Anthropic provider reuse.
```json
{
  "warmupValidation": {
    "schemaVersion": 1,
    "feature": "InquiryMode",
    "task": "AnthropicCertificationFreshBypassWarm",
    "provider": "anthropic",
    "modelRequested": "claude-sonnet-4-6",
    "modelResolved": "claude-sonnet-4-6",
    "returnType": "text",
    "status": "success",
    "servedFromCache": false,
    "bypassedInMemoryCache": true,
    "bypassedProviderReuse": false,
    "providerReuseCapable": true,
    "providerReuseRequested": true,
    "reuseState": "eligible",
    "providerCacheStatus": "created",
    "evidenceTransport": "document_blocks",
    "schemaMode": "none",
    "citationsRequested": true,
    "citationsReturned": 1,
    "requestPayloadCaptured": true,
    "actualUsageCaptured": true,
    "sanitizationNotes": [],
    "adapterNotes": [],
    "submittedAt": "2026-04-15T19:41:38.857Z",
    "returnedAt": "2026-04-15T19:41:45.702Z",
    "durationMs": 6845
  },
  "requestPayload": {
    "requestBody": {
      "model": "claude-sonnet-4-6",
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "Project Context:\n(none)\n\nFeature Mode Instructions:\nAnswer only from the attached manuscript evidence.\n\nUser Input:\nUse the attached evidence only.\n\nOutput Schema / Formatting Rules:\nReturn plain text only."
            },
            {
              "type": "document",
              "source": {
                "type": "text",
                "media_type": "text/plain",
                "data": "Codename AURORA-LATTICE-fresh-bypass-mo0ghl95 appears in the manuscript evidence and should be cited directly.\n\nStable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. Stable manuscript evidence paragraph for Anthropic cache certification. \n\nThe answer should remain grounded in the attached evidence document."
              },
              "title": "Scene S1",
              "citations": {
                "enabled": true
              }
            },
            {
              "type": "text",
              "text": "User Question (highest priority):\nWhat codename appears in evidence? Reply with the codename AURORA-LATTICE-fresh-bypass-mo0ghl95."
            }
          ]
        }
      ],
      "system": [
        {
          "type": "text",
          "text": "System Role Template:\nTemplate: Commercial Genre Fiction (Balanced Depth)\nAct as a developmental editor for a commercial genre novel. Prioritize pacing, clarity, and emotional stakes. Ensure each scene moves the plot or deepens character conflict. Keep prose lean; prefer tension and subtext to exposition. Focus feedback on momentum, scene purpose, and reader engagement."
        }
      ],
      "max_tokens": 3000,
      "temperature": 0.1
    },
    "dispatchDiagnostics": {
      "requestedCacheTtl": "none",
      "hasCacheablePrefix": false,
      "cachePrefixFingerprint": "none",
      "stableTextFingerprint": "none",
      "stableTextChars": 0,
      "documentBlockCount": 0,
      "documentChars": 0,
      "volatileTextFingerprint": "d7818cf9",
      "volatileTextChars": 337,
      "blockShape": "text>document>text"
    }
  },
  "usage": {
    "inputTokens": 6940,
    "outputTokens": 189,
    "totalTokens": 7129,
    "rawInputTokens": 6940,
    "cacheReadInputTokens": 0,
    "cacheCreationInputTokens": 0,
    "cacheCreation5mInputTokens": 0,
    "cacheCreation1hInputTokens": 0
  },
  "validation": {
    "schemaVersion": 1,
    "feature": "InquiryMode",
    "task": "AnthropicCertificationFreshBypassWarm",
    "provider": "anthropic",
    "modelRequested": "claude-sonnet-4-6",
    "modelResolved": "claude-sonnet-4-6",
    "returnType": "text",
    "status": "success",
    "servedFromCache": false,
    "bypassedInMemoryCache": true,
    "bypassedProviderReuse": true,
    "providerReuseCapable": true,
    "providerReuseRequested": false,
    "reuseState": "idle",
    "evidenceTransport": "document_blocks",
    "schemaMode": "none",
    "citationsRequested": true,
    "citationsReturned": 1,
    "requestPayloadCaptured": true,
    "actualUsageCaptured": true,
    "sanitizationNotes": [],
    "adapterNotes": [],
    "submittedAt": "2026-04-15T19:41:46.578Z",
    "returnedAt": "2026-04-15T19:41:52.670Z",
    "durationMs": 6092
  }
}
```
