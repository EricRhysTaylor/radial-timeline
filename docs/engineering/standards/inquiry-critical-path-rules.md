# Inquiry Critical Path Rules

This document governs the runtime architecture for:

- Inquiry
- Gossamer
- AI Strategy forecasting
- AI execution routing

These systems are part of the **AI critical path** and must remain deterministic.

---

## 1. Two Counting Systems Only

The system intentionally maintains **two token counts**.

### RT Corpus Count (UI)

Represents the manuscript material being analyzed.

Properties:

- deterministic
- provider independent
- identical across Inquiry / Gossamer / Settings

Formula:

```
tokens = ceil(evidenceChars / 4)
```

Must NOT include:

- prompt envelope
- system instructions
- transport structure
- provider tokenization differences

This number is the **only number shown to authors**.

---

### Local Execution Estimate (internal)

Estimates the complete request locally. It never contacts a provider or reads an API key. Actual provider token usage is a separate post-execution fact.

Includes:

- envelope
- instructions
- schema
- locally estimated request overhead

Used only for:

- preflight checks
- single vs multi-pass packaging
- overflow blocking

Must NOT replace the UI corpus number.

---

## 2. Multi-pass Must Never Be Blocked

If packaging mode allows multi-pass:

```
automatic
segmented
```

then:

```
overflow -> multi-pass
```

Never reject due to single-pass limits.

Only `singlePassOnly` may block.

---

## 3. Provider Failures Are Packaging Failures

If chunking fails:

- invalid JSON
- malformed response
- chunk execution failure
- synthesis failure

The system must report:

```
packaging_failed
```

Never suggest switching providers unless the provider truly cannot perform the task.

---

## 4. No Fabricated Model Capabilities

If the system cannot determine a model capability:

- contextWindow
- maxOutput
- reasoning support

The system must display:

```
unknown
```

Never fabricate placeholder values.

---

## 5. Snapshot Is the Single Estimate Source

`InquiryEstimateSnapshot` is the authoritative estimate.

All UI surfaces must read from it:

- Inquiry popover
- token pills
- minimap pressure
- readiness panel
- AI Strategy forecast

No other estimate path may exist.

---

## 6. Hover Must Not Recompute Estimates

Token estimates must be stable.

UI behavior must be:

```
state change -> compute snapshot once
hover -> reuse snapshot
```

Hover must never trigger:

- heuristic recomputation
- provider token counting
- estimate drift

---

## 7. Chunking Must Be Budget-Aware

Chunk planning must derive from:

```
safeInputBudget
expectedPassCount
prefixOverhead
```

Fixed constants like:

```
6000 token chunks
```

are forbidden.

---

## 8. Error States Are Valid UX

If the system cannot compute something, show:

```
Estimating...
Unavailable
Blocked
```

Never substitute incorrect numbers.

---

## 9. Local Models

Local models are treated as **unknown capability providers**.

Inquiry may only run if:

```
user supplies explicit model limits
```

Otherwise:

```
Inquiry = blocked
```

---

## 10. Logs May Show Both Counts

Logs are allowed to display:

```
Corpus estimate: 147k
Provider estimate: 316k
```

UI must show only the corpus estimate.

---

## 11. No Speculative Capability Handling

Provider capabilities must only exist when they are implemented.

Do not add:

- placeholder capability flags
- unimplemented capability branches
- future provider scaffolding

Capabilities are added only when the feature exists and is wired end-to-end.

---

## 12. Viewing Inquiry Is Independent of AI Permission

Inquiry's ribbon, command, and view remain available regardless of the AI toggle.
Turning AI off must not close the view or discard a displayed saved result.
Opening Inquiry or browsing packaged sessions never enables AI or changes the
selected provider. This is the owner-directed behavior as of 2026-10-01.

**Permission and configuration gate execution.** `InquiryView.isInquiryReadOnly()`
is the shared predicate: AI is not explicitly enabled, the selected provider has
no usable credential, or the engine is blocked/unavailable. It gates new analyses,
force-reruns, Omnibus, simulations, pending-edit application, and provider
execution. All estimates, including Settings comparisons, are local and send
nothing to any provider. Client-job preparation requires explicit AI enablement,
but keeps
its existing external-client contract (no API key required). AIClient independently
enforces the master switch at the request boundary.

**Display is separate from capability.** A displayed saved briefing remains a
`results` view. Otherwise the `read-only` guidance explains how to enable and
configure new analysis. Saved questions remain clickable and model-agnostic in
read-only mode, including the fresh Local LLM default with no available server.

**No key is a capability limit, not an error.** Credential presence comes from
`isInquiryApiKeyMissing()`, using the resolved engine's real credential state,
never an always-present secret-ID alias. The broader read-only predicate also
keeps these surfaces calm while AI is off or unavailable:

- engine badge pulse and readiness strip;
- minimap pressure / flow gauge (neutral, with no provider estimate request);
- zone affordances (a saved briefing is available, not a foreign-model prior).

Ring alerts retain their distinct book/source/scene configuration conditions.
These presentation conditions must not be collapsed into a single UI state.
The source invariant guard and behavioral access tests enforce this boundary.

---

## Philosophy

Inquiry is designed for **large manuscripts and sagas**.

Accuracy and transparency are more important than defensive fallbacks.


## 13. Estimates Send Nothing (owner decision 2026-10-10)

All estimates and forecasts are local, including Inquiry snapshots, Settings
comparisons, preflight packaging, and client-job preparation. Never call remote
count-token endpoints, read credentials, refresh remote metadata, or probe a
model server while preparing an estimate. Count the same cleaned material and
request envelope used by execution, label the result as a local estimate, and
reserve output capacity in the context budget. Non-ASCII execution estimates
reserve UTF-8 bytes rather than applying the UI corpus chars/4 metric to scripts
that tokenize differently. These remain conservative local estimates. Provider-count methods retained
in persisted types describe historical runs only. Actual usage is recorded
after an explicitly authorized analysis, never inferred as an exact preflight
count. This replaces the earlier remote-count requirement.
