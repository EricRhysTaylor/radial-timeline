# P&P release tooling and welcome-card audit

Scope: `scripts/demo-vaults/`, the sample-vault contract document, and the welcome card copy/order. Review performed after implementation; no additional architectural work proposed.

- One maintained content packager and one required validator; no plugin-side manifest, migrations, inference fallback, or API calls added.
- Explicit content inventory keeps private configuration and development material outside the public ZIP. Traversal, symlink, duplicate/missing include, credential-shaped content, unsafe sample IDs, existing outputs, and failed QA are refused.
- Four unit tests pass. Real-vault negative controls reject changed prose, pending Pulse flags, stale Inquiry IDs, and broken guide links. Two builds produce identical archive hashes.
- Welcome card leads the existing card layout, retains its existing hero treatment, uses the existing counted URL, and removes stale mandatory-signup copy. No new CSS, listeners, or state schema.
- `CI=true npm run build-only` passes (including TypeScript and script typechecks). Pulse usage tests pass; the separate cost-reporting change already has its own full test/audit record.
- Fresh content-only archive exercised with the locally built plugin, no credentials, AI disabled: sample detection/configuration, four modes, saved Setup/Pressure/Payoff, scene navigation, and reopening passed.

Release distinction: the new always-available Inquiry view and Pulse completion reporting are on main, not public 7.3.1. The download guide documents the 7.3.1 toggle requirement without requiring a key. A public plugin release is separate from this content publication.

No blocking findings in the implemented packaging/card change. Exact download checksums, content acceptance, and website publication state are recorded in the private release handoff, not inferred from this audit.
