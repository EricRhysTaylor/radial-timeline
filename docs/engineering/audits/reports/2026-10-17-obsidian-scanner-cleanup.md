# Obsidian scanner cleanup — 2026-10-17

## Reviewed evidence

The public Radial Timeline scorecard reports **Caution / 68 findings** against
release **7.5.1**, commit `20ab5fb0a466…`. GitHub's latest published release is
already **7.6.0**, published October 17. Do not present fixes on `main`, or a
successful local gate, as a completed public review.

The public Editorialist 3.0.2 scorecard is already **Satisfactory / 4 findings**:
custom-license classification, settings-search support, vault enumeration and
clipboard access. No Editorialist code changes are needed for this batch.

## Changes

- Update the locked transitive `fast-uri` dependency from 3.1.2 to 3.1.8.
  The scanner's GHSA-v2hh-gcrm-f6hx advisory identifies 3.1.4 as patched.
- Use the existing desktop provider transport for local `/models` discovery.
  Remove the raw browser fetch, its separate stream reader, and the
  non-cancellable `requestUrl` fallback. The common socket already handles
  CORS-independent requests, actual disconnects, a wall-clock deadline and
  response-size limits. Discovery retains its 2,000,000-byte cap and one attempt.
- Honor cancellation and withdrawn request permission during discovery.
- Remove the two flagged YAML object assertions while keeping each parsed value
  explicitly typed `unknown`. The third flagged assertion in Timetable is
  already absent from current source.
- Remove the runtime-fetch exception from the review-readiness gate rather than
  suppressing a scanner finding.

## Verification

All 15 release gates pass, including production build, full test suite,
compliance, lint and i18n readiness. The focused transport/YAML suite passes
40 tests. Ten new real loopback tests exercise model discovery: Unicode JSON
without CORS headers, timeout, cancellation, permission withdrawal, oversized
responses, cancellation before connecting, malformed/unexpected JSON and HTTP
errors. Failed probes disconnect and are not retried.

Production dependencies have zero `npm audit --omit=dev` findings. This is not a
claim that development tooling is advisory-free; the separate all-dependency
audit reports 16 development dependency findings.

Official report lint now has one settings-definition warning and zero errors.
An additional full-source unnecessary-assertion lint pass is clean.

## Remaining work and decisions

| Public finding | Count | Required treatment |
| --- | ---: | --- |
| Text-decoration compatibility | 38 | Inspect affected underlines, multiline links and hover states before changing CSS. Preserve readable link/annotation affordances. |
| Multicolumn compatibility | 6 | Verify actual two-column content and reading order before replacing layout. |
| `display: contents` compatibility | 4 | Check each wrapper's grid/flex behavior and accessibility before replacing it. |
| Settings definitions | 1 | Migrate to the 1.13 API with real searchable controls and native navigation/lifecycle checks. Returning an empty array only to silence the scanner is not a fix. |
| Bundle exceeds 5 MB | 1 | Investigate catalog/embedded-asset packaging; keep all languages and export assets available in an ordinary three-file install. |
| Custom license | 1 | Preserve the owner's source-available terms. Changing legal permissions requires an explicit licensing decision. |
| Filesystem and shell execution | 2 | Existing desktop export capabilities. Do not remove export features or hide API usage to improve a label. |
| Vault enumeration, clipboard, dynamic code | 3 | Existing capabilities; review necessity and attribution. AJV compiles validation schemas. |

The size investigation measured a production bundle around 12.1 MB: embedded
assets account for 2.39 MB and language catalogs for 5.72 MB. Merely changing
Unicode output encoding does not bring the bundle under 5 MB. No languages,
fonts or export templates were removed.

Native verification is blocked by the locked Mac. CSS/settings UI changes are
not included in this batch. Resume in the separate QA vault after unlock, then
request a Community preview scan of the pushed commit. The public Caution label
has **not** been cleared or reclassified by this work.
