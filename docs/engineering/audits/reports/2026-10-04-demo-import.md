# Demo library import — feature audit

October 4, 2026. Scope: the welcome entry, settings demo shelf, shared catalog, demo import plan/orchestrator, ERT chooser, nested Inquiry artifacts/session hydration, and sample-source initialization. This is the post-feature read-only audit report; implementation fixes listed below were completed before this pass.

## Result and checks

No release-blocking code defect was found in the reviewed surface. Build-only, TypeScript, the complete test suite, the pinned public P&P/Odyssey ZIPs, and the exact Sherlock candidate import plan passed. Full-suite verification with all three archive integrations enabled: **365 test files passed, 3 skipped; 3,991 tests passed, 3 skipped**. Skipped tests are the existing live-provider certifications and optional PDF assembly. No provider calls were made. All 15 repository gates passed.

The real chooser renderer was inspected in a browser harness at 1,100, 760 and 390 pixels: three/two/one columns, no horizontal overflow, resolved ERT gap/padding tokens, correct disabled Sherlock action, busy status, failed-download explanation and restored retry controls. The harness mocked Obsidian IO and icons; this does not certify the installed Obsidian network/import/indexing lifecycle.

## Cleanup, ownership and behavior

- One catalog owns book definitions, public availability and pinned download integrity. The obsolete website-only discovery constant was removed.
- The existing sample Inquiry source setup was extracted once and reused. Existing source choices and AI/provider settings remain intact; only an unconfigured source setup gets defaults.
- New chrome uses ErtModal, ERT panels and existing button classes. No new dependencies, background workers or scene operational YAML were added.
- Import preparation is separate from vault IO and the modal. Manuscript IDs, quotes, scores and binary assets remain intact; paths and book scope keys are rebased.
- Unique staging, integrity validation, duplicate-ID refusal and destination refusal protect existing content. Retry opens the existing project without another download or duplicate profiles. An interrupted setup leaves a complete folder; incomplete installed projects are explained and preserved.
- Curated Inquiry results remain canonical in each demo project and are excluded from author-root writes and history pruning. Runtime origin is stripped by serialization. Failed hydration disarms writes, including after an earlier successful hydration; corrupt root artifacts cannot be replaced by an empty cache.
- Existing author profile IDs/order/Saga choices survive import; new demos are excluded from an existing author saga. No public plugin release or Framer publication was performed.

## Risks, deferred verification and follow-up

Low-priority report-only lint findings remain on the staging-folder type assertion and explicit system-trash cleanup. Folder creation establishes the folder type; cleanup targets only the uniquely owned staging folder, never author content. These do not fail the enforced lint baseline. No additional code changes were made during this read-only audit.

1. **Acceptance still required:** reload the installed plugin and exercise a real empty Obsidian vault: add P&P, add Odyssey, switch books, inspect all timeline modes and saved Inquiry answers with AI off, close/reopen and repeat Open demo. Browser/mocked tests cannot prove native request redirects or metadata indexing.
2. **Sherlock publication dependency:** the four-novel candidate passed import preparation (56 chapters, 41 beats, 12 saved answers), but remains unavailable in the chooser until fresh-vault acceptance and a verified public URL/digest are recorded in the catalog.
3. **Reviewed-edition policy:** replacing a remote ZIP without updating the catalog will intentionally fail integrity verification. A revised ZIP requires a catalog update; no unreviewed automatic upgrade or overwrite exists.
4. **User-customized Inquiry sources:** imports intentionally preserve them. Custom sources that exclude a demo's manuscript may require a user adjustment before generating new analysis; saved question lookup remains scoped by manuscript folder.

Recommended next work is the native Obsidian acceptance above, then the separately authorized public plugin release and Sherlock artifact publication. The implemented direct import/manual ZIP behavior is preserved, and existing website acquisition routes remain unchanged.
