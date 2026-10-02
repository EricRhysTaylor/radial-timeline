# Inquiry access and AI permission

Owner-directed behavior change: Inquiry remains available whether AI is enabled
or disabled. Saved results are browsable; generating new analysis requires
explicit AI enablement and an available, configured engine.

## Change review

- Removed the view-opening gate, conditional ribbon visibility, and automatic
  tab closure. The AI settings toggle now refreshes open views in place.
- Expanded the existing no-key browsing path into a read-only capability check:
  AI off, missing credential, or blocked engine. This also covers a fresh Local
  LLM configuration without an eligible model.
- Kept saved-result display separate from run permission. Normal and forced
  question clicks open saved answers while read-only. No settings are changed
  implicitly by browsing.
- Guarded direct Omnibus execution, provider estimates, simulations, and
  pending-edit application. Client-job preparation requires the AI toggle,
  retaining its existing external-client configuration contract.
- Retained AIClient's independent master-switch enforcement for provider calls
  and token counting, including calls that reach it after asynchronous work.
- Renamed the presentation state from `no-api-key` to `read-only`; updated
  readiness copy so AI off is not misreported as a missing key.

No new settings, scene fields, persistence schema, CSS, or DOM elements were
introduced. No migration or alternate provider fallback was added. The deleted
visibility methods have no remaining callers. Existing run/corpus validation
and session persistence remain in place.

## Verification

- `npm run build-only` passed, including TypeScript and script typechecks,
  code-quality checks, asset checks, CSS checks, and production bundling.
- Full Vitest suite: **341 files passed; 3,778 tests passed; 3 optional tests
  skipped** (live provider certification and optional PDF assembly).
- Nine behavioral access tests cover opening with AI off/on, saved-answer
  browsing with valid credentials while AI is off, the unavailable Local LLM
  case, absent cloud credentials, forced rerun refusal, direct Omnibus and
  simulation refusal, provider-estimate suppression, pending-edit protection,
  and client-job opt-in.
- Existing no-key calm-state, pending-edit, session, and AIClient master-switch
  regression tests pass in the full suite.
- `git diff --check` passed.

No additional code changes are proposed by this post-change audit. There is no
new UI chrome requiring CSS token-scope validation. The implementation is
verified automatically and in the live desktop checks below.

## Live desktop verification — 2026-10-02

Tested in Obsidian 1.13.7 using the disposable `Inquiry always available
2026-10-01` vault, initially without plugin data.json. Its main.js SHA-256 was
`9966f50b479113af029f7f95c9781106a751706d1ed70ee218922d62ef223051`, matching
the verified implementation build from `f7b67753`.

- Inquiry's ribbon was present and opened the view with AI off, before book
  setup. It showed unresolved-book guidance rather than an AI access gate.
- The timeline welcome card detected Pride & Prejudice. Opening the sample
  established the book and its 61-scene Inquiry corpus.
- Setup (`Set1`), Pressure (`Pres1`), and Payoff (`Pay1`) each displayed their
  saved answer with AI off and the unchanged default Ollama selection. No
  credentials were entered and no model was configured.
- Enabling AI in this disposable profile showed Local LLM not reachable.
  Turning AI back off retained the Inquiry tab, ribbon, and displayed Payoff
  answer.
- Closing and reopening the QA vault restored the Inquiry tab. Clicking Setup
  loaded the saved answer again. Persisted `enableAiSceneAnalysis` remained
  false and the provider remained `ollama`.
- A structural comparison of the QA and canonical sessions.json found only a
  changed top-level `savedAt`; all session records and analysis content were
  unchanged.

These checks exercised saved-result browsing and view availability. Actual
provider execution was not part of this desktop test; execution refusal is
covered by the automated behavioral tests above. The finalized downloadable
demo package still needs its separate release acceptance test.

## Limits

This change does not regenerate or certify literary analyses, alter the demo
library's publication status, or publish a plugin release. It does not introduce
cancellation of a request already submitted before the author turns AI off;
subsequent provider calls still meet the independent master-switch guard.
