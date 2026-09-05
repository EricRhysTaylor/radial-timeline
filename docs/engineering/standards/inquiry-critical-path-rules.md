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

### Provider Execution Count (internal)

Represents the actual tokens sent to the AI provider.

Includes:

- envelope
- instructions
- schema
- provider tokenization

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

## 12. No Key Is a Capability Limit, Not an Error

A missing/absent API key disables **running** a new Inquiry, but it is never an
error or an alert. Alert/red visuals are reserved for genuine run errors and
genuine misconfiguration (no books/sources, no scenes). Every alert/red surface
MUST exclude the no-key case so a keyless (e.g. demo) vault stays calm.

**Single source of truth:** `InquiryView.isInquiryApiKeyMissing()` — derived from
`plugin.credentialPresence`, a REAL stored secret (`hasSecret`), never the
always-present secret-ID alias (`rt.<provider>.api-key`).

**Display is separate from capability.** `guidanceState` answers "what is shown"
(`'results'` wins over `'no-api-key'` — a saved briefing renders normally without
a key). `isInquiryApiKeyMissing()` / `isInquiryRunDisabled()` answer "what can
run." These dimensions are orthogonal and must not be collapsed.

Surfaces that MUST stay calm when `isInquiryApiKeyMissing()`:

- ring colour (alert override) → red only for `not-configured` / `no-scenes`
- engine badge pulse (`is-engine-pulse-red`)
- minimap pressure / flow gauge (reset to neutral — no real estimate)
- engine popover readiness strip (`is-demo` calm state, not `is-error`)
- zone affordances: a saved briefing is the available result, not a foreign-model prior

These surfaces have *different* alert conditions by design (misconfig vs error vs
no-estimate), so they are deliberately NOT unified into one presentation value —
that would either change behaviour or merely relocate four conditions (a failed
refactor per the playbook). The only shared invariant is the no-key exclusion
above, enforced by the source-grep guard in `InquiryView.noKeyCalm.test.ts`.

---

## Philosophy

Inquiry is designed for **large manuscripts and sagas**.

Accuracy and transparency are more important than defensive fallbacks.
