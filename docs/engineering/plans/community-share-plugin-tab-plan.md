# Community Share Plugin Tab Plan

## Status

Implementation started. The website product contract, backend schema plan, and
edge-function pipeline have been reviewed together; the first plugin slice is
now in place as a local, privacy-first settings surface.

Implemented on 2026-06-27:

- Added a top-level `Community` settings tab between `Social` and `Inquiry`.
- Added persisted `communityShare` settings types and defaults.
- Added a `CommunityShareSection` UI shell with master opt-in, launch audience
  and tier controls, field-by-field opt-ins, Complete Preview checklist, and
  publish/revoke/delete/disconnect safety controls.
- Wired the website activation-token confirmation flow to the live
  `community-activation-confirm` edge function.
- Added a local random installation id stored in Obsidian Secret Storage and
  sent only as a SHA-256 hash.
- Stored the returned connection secret only in Obsidian Secret Storage; local
  settings keep only non-secret metadata and a secret id reference.
- Aligned plugin field policy keys with the backend public report allow-list
  (`project.*`, `activity.*`, sensitive future fields disabled).
- Added Complete Preview generation with canonical payload/preview hashes,
  public book metadata only, and aggregate writing-range stats.
- Wired manual publish to the live `community-share-publish` edge function,
  locked behind connection, public audience, launch tier, selected fields, and
  ready Complete Preview hashes.
- Manual publish rebuilds the preview before sending and blocks if the reviewed
  preview is stale.
- Wired revoke, delete shared report data, and disconnect to the live edge
  functions. Delete and disconnect require local confirmation. Disconnect
  removes the local connection secret from Obsidian Secret Storage.
- Added focused settings normalizer and tab-wiring tests.
- Pause remains disabled; no launch backend pause endpoint is wired in the
  plugin yet.
- Verified with `npx vitest run src/communityShare/communityShareSettings.test.ts
  src/communityShare/communityShareClient.test.ts
  src/communityShare/communitySharePreview.test.ts src/settings/SettingsTab.test.ts`
  and `SKIP_BACKUP=1 npm run build`.

Still pending:

- Live end-to-end test against a real website-created activation token/settings
  row/report definition.
- Optional pause/resume handling if it stays in launch scope.
- Broader UI/behavior tests once activation and publish actions are live.

Community Share must ship as an explicit author publish flow, not as background
sync. The launch contract is:

- No plugin-origin data leaves the device before account activation, local
  plugin confirmation, field opt-ins, Complete Preview, and manual publish.
- No manuscript text.
- No scene paths, note paths, file names, folder paths, or vault paths.
- No raw per-session rows.
- No exact public timestamps.
- Every new field defaults off.
- V1 supports public manual reports only.
- Scheduled publish, relationship audiences, and Working Now presence are
  future/dormant.

## Source Contracts

- `/Users/ericrhystaylor/Documents/Radial Timeline LLC/Platform/COMMUNITY-SHARE-PRODUCT-CONTRACT.md`
- `/Users/ericrhystaylor/Documents/Radial Timeline LLC/Platform/radial-timeline-platform/COMMUNITY-SHARE-BACKEND-SCHEMA-PLAN.md`
- `docs/engineering/standards/writing-session-privacy.md`
- `src/services/WritingSessionLog.ts`
- `src/services/WritingSessionLog.privacy.test.ts`
- Existing Settings Social/APR patterns in `src/settings/SettingsTab.ts` and
  `src/settings/sections/AuthorProgressSection.ts`

## Placement

Add a new top-level settings tab named `Community` between `Social` and
`Inquiry`.

Reasoning:

- `Social` is the local APR/social graphic setup surface.
- `Community` has account connection, privacy gates, remote publish history,
  revoke/delete/disconnect controls, and destructive remote state. It should
  not feel like a subpanel of APR styling.
- The tab should still reuse the Social/APR lesson: place the action beside the
  setup surface that enables it. Manual publish belongs next to Complete Preview
  status, not in a separate hidden modal path.

Implementation targets:

- `src/settings/settingsAnchors.ts`
  - Done: added `community` to `RadialTimelineSettingsTabId`.
- `src/types/settings.ts`
  - Done: added `community` to `SettingsTabId`.
  - Done: added `communityShare?: CommunityShareSettings`.
- `src/settings/SettingsTab.ts`
  - Done: added the tab button, tab content container, persistence wiring, and guarded
    render call.
  - Current tab order: `Core`, `Social`, `Community`, `Inquiry`, `Publish`,
    `AI`, `Advanced`, `PRO`.
- `src/settings/sections/CommunityShareSection.ts`
  - Done: new renderer for the Community tab.
- `src/communityShare/communityShareSettings.ts`
  - Done: settings defaults and normalizer.
- `src/i18n/locales/en.ts`
  - Pending: move first-slice user-facing copy under `settings.communityShare`
    once the activation/publish copy stabilizes.

Use the existing ERT settings shell:

- `ert-settings-tab-content`
- `ert-scope--settings`
- `ert-ui`
- `ERT_CLASSES.STACK`, `ERT_CLASSES.PANEL`, `ERT_CLASSES.CARD`,
  `ERT_CLASSES.ROW`, `ERT_CLASSES.INLINE`

Do not add broad unscoped CSS. Any new CSS should use `ert-` classes and live
under the settings scope.

## Account And Project Connection UI

The Community tab starts disconnected for every installation and every book.

Connection sequence:

1. Author creates or signs into a website account.
2. Website creates a short-lived activation token for a chosen public profile
   and website project shell.
3. Author pastes the activation token or opens an activation link in the plugin.
4. Plugin shows a local confirmation screen before contacting the activation
   endpoint.
5. Plugin confirms activation and receives a connection secret once.
6. Plugin stores only the connection id, non-secret display metadata, and the
   raw connection secret in the existing local/private credential storage path
   used for secrets.
7. Connection confirmation publishes no progress data.

The confirmation screen must show:

- Website account/profile display identity.
- Website project shell identity.
- Local book being mapped.
- Connection scope: `community_share`.
- What the website can request: publish/revoke/delete/disconnect calls only
  through explicit plugin actions.
- What the website cannot access: manuscript text, scenes, vault files, paths,
  raw session logs, API keys, license keys, billing state, device names.
- A clear statement: no progress report has been published yet.

Activation failure states:

- Token expired.
- Token already used.
- Token revoked.
- Profile/project mismatch.
- Network unavailable.
- Backend rejects scope.
- Backend unavailable.

No retry attempt may send progress payload data. Activation sends only the
activation token and local confirmation metadata required by the backend
contract.

## Local Book Profile To Website Project Mapping

Mapping is per local `BookProfile`, not global.

Store mapping by stable local book id:

- `localBookId`
- local display title for UI only
- website `profileId`
- website `projectId`
- public project alias selected by the author
- website project title returned by activation
- connection id
- connection status

Privacy rules:

- Do not send `BookProfile.sourceFolder`.
- Do not send vault name, vault path, folder path, local file names, or local
  machine/user identifiers.
- Do not copy the local book title to the website project title unless the
  author has explicitly chosen it as a public title/alias.
- The default public project label should be empty or a user-entered alias, not
  inferred from paths.

UI requirements:

- Show active local book and mapped website project.
- Let the author switch or reconnect the mapping through a fresh activation.
- If the active book is unmapped, keep publish controls disabled and show the
  connection action.
- If the connected website project differs from the active local book mapping,
  block publish with a project identity mismatch state.

## Sharing Tier Controls

Implement the tier model in settings now, but only allow v1 publish behavior.

Recommended tier labels:

- Tier 0: Off / private.
- Tier 1: Public author profile.
- Tier 2: Public project card.
- Tier 3: Daily activity strip.
- Tier 4: Public progress report.
- Tier 5: Rich progress report, future.

V1 behavior:

- Default tier is `0`.
- Publishable launch tier should be the public manual report subset. Treat it
  as a constrained Tier 4 profile that uses only safe public fields.
- Tier 5 controls can be displayed as future/disabled or omitted until the
  backend accepts them.
- Changing tier invalidates the current Complete Preview hash.
- Lowering tier disables fields that are no longer allowed.
- Raising tier does not auto-enable any field.

## Audience Controls

The UI should model the full contract but launch with public manual reports
only.

Audience values:

- `private_draft`
- `public`
- `community_authors`
- `followers`
- `trusted_authors`
- `private_link`

V1 launch:

- `public` is the only publishable viewer audience.
- `private_draft` is local preview/history only and is not a remote viewer
  audience.
- `community_authors`, `followers`, `trusted_authors`, and `private_link` are
  future/off. Selecting them should be disabled or should produce a clear
  `audience_not_launched` state before publish.
- Audience changes invalidate the Complete Preview hash.
- Audience changes must never expand the payload. Payload scope is controlled
  only by tier and field opt-ins.

## Field-By-Field Opt-In Controls

The Community tab must expose field-level controls. No broad "share my progress"
toggle is sufficient.

Each field policy entry should include:

- `enabled`
- `tier`
- `category`
- `precision`
- `sensitive`
- `label`
- `lastChangedAt`

Suggested categories:

- `profile`
- `project`
- `activity`
- `narrative`
- `sensitive_structure`

Profile fields, mostly website-origin:

- Display name.
- Handle.
- Avatar.
- Bio.
- Website URL.
- Social links.
- Primary tool.
- Author type marker.

Project fields:

- Public project title.
- Public project alias.
- Logline.
- Description.
- Cover image.
- Status.
- Genre level 1.
- Genre level 2.
- Genre level 3.
- Custom genre label.

Activity fields:

- Report period.
- Writing days.
- Total minutes, rounded.
- Words added, rounded.
- Session count, rounded by default.
- Mode mix.
- Scenes completed by stage, aggregate count only.
- Stage mix.
- Streak, if implemented from safe aggregate data.
- Previous-period comparison, if implemented from safe aggregate data.

Narrative fields:

- Author-written report note.
- Next goal.
- Blocker category.
- Focus area.
- Confidence or energy check-in.

Rules:

- Missing field policy means disabled.
- New fields default off for all existing settings and schedules.
- The plugin must not generate public narrative text from private session notes.
- Any author-written narrative field must be entered or approved in the
  Community tab and shown exactly in Complete Preview.
- Disabled fields must appear in preview as disabled/redacted labels, not be
  hidden from the author's understanding.

## Sensitive Field Warnings

Sensitive controls must be visually and logically separated from normal
activity fields.

Sensitive fields include:

- Real scene titles.
- Named act, arc, chapter, or section labels.
- Exact writing dates.
- Exact session count.
- Exact minutes.
- Exact words added.

Launch rule:

- V1 public manual reports must not publish these fields.
- The settings model may reserve policy entries, but they default off and the
  publish builder/validator must reject them for `audience = "public"`.

If future non-public audiences enable any sensitive field, the UI must require:

- Separate checkbox.
- Warning copy.
- Complete Preview regeneration.
- Manual publish confirmation.
- Hash coverage of the warning acknowledgement.

Sensitive warning copy must say plainly what could be inferred, for example:
exact dates can expose writing routines; real scene labels can reveal plot
structure; exact counts can imply manuscript size and cadence.

## Complete Preview Requirements

Complete Preview is the local privacy gate. It must be generated entirely on
device and must not call a preview endpoint with private data.

Preview must show:

- Connection state.
- Website profile identity.
- Website project identity.
- Local book mapping.
- Sharing tier.
- Audience.
- Manual/scheduled mode.
- Every field that will be sent.
- Every disabled field.
- Exact values for text fields.
- Rounded or bucketed values for numeric fields.
- Redaction labels for hidden/private fields.
- Destination platform in plain language.
- Preview generation timestamp, local only.
- Whether this is a first publish, an update, revoke, delete, or disconnect
  related state.
- Diff from the last successful publish when updating:
  - added fields
  - removed fields
  - changed values
  - audience changes
  - tier changes
  - schedule changes

Preview failure blocks publish. Failures include:

- Unrecognized field.
- Unsupported tier/field/audience combination.
- Missing audience.
- Missing connection.
- Missing local book mapping.
- Project identity mismatch.
- Stale activation/connection state.
- Schema validation failure.
- Redaction failure.
- Sensitive field rejected for public v1.
- Field value too long for public display.
- Payload contains a forbidden key or forbidden tracer.

Publish button state:

- Disabled until Complete Preview succeeds.
- Disabled whenever settings change after preview.
- Disabled when the local preview hash does not match the payload hash input.
- Disabled when connection is paused/revoked/disconnected.

## Local Preview Hash And Payload Hash Strategy

Use deterministic canonical JSON. Do not hash raw object insertion order.

Add a small canonical serialization helper for Community Share only unless a
repo-wide helper already exists at implementation time:

- Sort object keys recursively.
- Preserve array order where order is meaningful.
- Normalize absent optional fields by omitting them.
- Normalize dates in payload to allowed public precision only.
- Reject `undefined`, functions, symbols, `Date` objects, and non-finite
  numbers before serialization.

Local hashes:

- `previewHash`
  - sha256 of canonical Complete Preview JSON.
  - Includes schema version, connection id, profile id, project id, local book
    id, tier, audience, field manifest, redaction manifest, display payload,
    preview timestamp bucket, and warning acknowledgements.
  - Does not include the raw connection secret.
  - Does not include vault paths or local filesystem metadata.
- `payloadHash`
  - sha256 of canonical publish payload plus field manifest, redaction
    manifest, tier, audience, profile id, project id, and report period.
  - Computed locally for history and recomputed server-side by
    `community-share-publish`.

Publish validation:

- The payload sent to the backend must be exactly the payload shown in Complete
  Preview.
- Any settings change after preview invalidates `previewHash`.
- Backend rejects publish if `preview_hash` does not match the accepted payload,
  manifest, tier, audience, and project/profile identifiers.
- Local history stores both hashes for author audit.

## Manual Publish Flow

Manual publish is the only launch publish mode.

Flow:

1. Author connects account/project and confirms locally.
2. Author maps a local book to the website project.
3. Author chooses tier and audience.
4. Author opts into specific fields.
5. Plugin builds a local Complete Preview using safe projection functions.
6. Author reviews the preview.
7. Author clicks Publish.
8. Plugin sends only the previewed display payload, field manifest, redaction
   manifest, `previewHash`, connection id, and authenticated connection secret.
9. Plugin writes a local publish history entry for attempted publish.
10. Backend writes remote history and returns publish/version ids on success.
11. Plugin updates local history and connection state.

Retries:

- Retrying after failure must regenerate or revalidate the preview.
- Network retry must not mutate payload contents.
- Failed attempts still create local history entries with no live publish id.

## Local Publish History Model

Every attempted state transition must leave a local entry.

Suggested type:

```ts
interface CommunitySharePublishHistoryEntry {
    id: string;
    localBookId: string;
    connectionId?: string;
    websitePublishId?: string;
    websiteVersionId?: string;
    profileId?: string;
    profileLabel?: string;
    projectId?: string;
    projectLabel?: string;
    tier: CommunityShareTier;
    audience: CommunityShareAudience;
    mode: 'manual' | 'scheduled';
    action: 'previewed' | 'manual_publish' | 'pause' | 'unpause' | 'revoke' | 'delete' | 'disconnect';
    status: 'preview_ready' | 'success' | 'failed' | 'paused' | 'revoked' | 'deleted' | 'disconnected' | 'superseded';
    previewedAt?: string;
    attemptedAt?: string;
    completedAt?: string;
    fieldList: string[];
    previewHash?: string;
    payloadHash?: string;
    previousPublishId?: string;
    errorCode?: string;
    errorMessage?: string;
}
```

Local history must not store:

- Raw connection secret.
- Manuscript text.
- Scene paths.
- Vault paths.
- Raw per-session rows.
- Deleted remote payload content after delete.

History UI must answer:

- What did I publish?
- Who could see it?
- What happened after I changed my mind?

## Pause, Revoke, Delete, Disconnect

Pause:

- Stops future publishes.
- Keeps live reports live.
- Disables manual publish until unpaused.
- Does not delete local settings or history.

Revoke:

- Removes viewer access to live report immediately.
- Keeps author-visible local and remote history.
- Keeps metadata and hashes.
- Requires explicit confirmation.

Delete:

- Requests remote payload deletion and tombstone creation.
- Local history should mark deleted and retain only metadata/hashes.
- Must not retain deleted remote payload content in local history snapshots.
- Requires stronger confirmation than revoke.

Disconnect:

- Invalidates the plugin connection and stops scheduled publish.
- Does not silently revoke or delete existing live reports.
- Must present explicit modes:
  - disconnect only, live reports remain
  - disconnect and pause
  - disconnect and revoke live reports
  - disconnect and delete live reports
- After disconnect, publish controls are disabled until fresh activation.

Disconnected with live reports is a first-class UI state. The tab must clearly
show that the plugin can no longer update the website, while prior reports may
still be visible until revoked or deleted.

## Scheduled Publish

Scheduled publish is future and off by default.

Settings model may reserve schedule fields, but launch UI should show scheduled
publish as disabled/future or hidden behind a non-interactive "coming later"
state.

Future prerequisites:

- Connected account.
- At least one successful manual publish.
- Field opt-ins selected.
- Complete Preview succeeds.
- Author explicitly enables schedule.
- Schedule policy covered by preview hash.

No scheduled publish worker should be implemented for v1.

## Working Now Presence

Working Now is future and excluded from launch.

V1 plugin must not:

- Send presence heartbeats.
- Include presence in activation scope.
- Include current working scene or current manuscript location.
- Join Community Share settings to any `community_presence` behavior.
- Display Working Now as an enabled audience or field.

If shown at all, mark it as future/off and explain that Progress Reports are
manual publishes, not live presence.

## Safe Reuse Of WritingSessionLog Projections

`src/services/WritingSessionLog.ts` is the sanctioned boundary for session data.

Community Share must reuse:

- `buildCommunityDailyLog()`
- `projectCommunityDaily()`
- `redactTime(..., 'community')`

Rules:

- Community Share must never call `projectPrivate()` for outgoing payloads.
- Community Share must never use `projectFriends()` for public v1 payloads.
- Community Share must never transmit `WritingSessionRecord[]`.
- Community Share must never include row ids from private session records.
- Community Share must never include `scenePaths`, `scenesCompletedPaths`,
  `scenesActivity`, `note`, `bookId`, `startedAt`, `endedAt`, or raw
  `sessionDate`.
- Community Share may aggregate daily rows further into report-period totals,
  weekly summaries, rounded words, rounded minutes, mode mix, writing-day
  counts, and aggregate stage counts.
- Public display should prefer report-period labels such as "this week" or
  "last 30 days" over exact public dates where possible.

If implementation needs a richer public report projection, add a new pure
projection in or near `WritingSessionLog.ts` and update
`writing-session-privacy.md` before wiring UI or network calls.

## Required New Settings Fields And Types

Add a single optional root field:

```ts
communityShare?: CommunityShareSettings;
```

Suggested types:

```ts
type CommunityShareTier = 0 | 1 | 2 | 3 | 4 | 5;

type CommunityShareAudience =
    | 'private_draft'
    | 'public'
    | 'community_authors'
    | 'followers'
    | 'trusted_authors'
    | 'private_link';

type CommunityShareConnectionStatus =
    | 'off'
    | 'pending'
    | 'active'
    | 'paused'
    | 'disconnected'
    | 'revoked';

type CommunitySharePrecision = 'hidden' | 'rounded' | 'bucketed' | 'coarse' | 'exact';

interface CommunityShareFieldPolicy {
    enabled: boolean;
    tier: CommunityShareTier;
    category: 'profile' | 'project' | 'activity' | 'narrative' | 'sensitive_structure';
    precision: CommunitySharePrecision;
    sensitive: boolean;
    warningAcknowledgedAt?: string;
}

interface CommunityShareRedactionPolicy {
    words: 'rounded_50' | 'rounded_100' | 'bucketed' | 'hidden';
    minutes: 'rounded_5' | 'rounded_15' | 'bucketed' | 'hidden';
    sessions: 'rounded' | 'bucketed' | 'hidden';
    dates: 'period_label' | 'day' | 'hidden';
}

interface CommunityShareBookMapping {
    localBookId: string;
    profileId?: string;
    profileLabel?: string;
    projectId?: string;
    projectLabel?: string;
    publicProjectAlias?: string;
    connectionId?: string;
    status: CommunityShareConnectionStatus;
    connectedAt?: string;
    disconnectedAt?: string;
    lastSeenAt?: string;
}

interface CommunityShareScheduleSettings {
    enabled: boolean;
    frequency?: 'weekly' | 'monthly';
    timeWindow?: string;
    lastScheduledPublishAt?: string;
}

interface CommunitySharePreviewState {
    status: 'empty' | 'ready' | 'invalid' | 'stale';
    generatedAt?: string;
    localBookId?: string;
    tier?: CommunityShareTier;
    audience?: CommunityShareAudience;
    fieldList?: string[];
    previewHash?: string;
    payloadHash?: string;
    errorCode?: string;
}

interface CommunityShareSettings {
    schemaVersion: 1;
    status: 'off' | 'active' | 'paused';
    selectedLocalBookId?: string;
    activeConnectionId?: string;
    tier: CommunityShareTier;
    audience: CommunityShareAudience;
    manualPublishEnabled: boolean;
    scheduledPublish: CommunityShareScheduleSettings;
    fieldPolicy: Record<string, CommunityShareFieldPolicy>;
    redactionPolicy: CommunityShareRedactionPolicy;
    bookMappings: CommunityShareBookMapping[];
    preview?: CommunitySharePreviewState;
    publishHistory: CommunitySharePublishHistoryEntry[];
    lastSuccessfulPublishAt?: string;
    lastFailedPublishAt?: string;
}
```

Defaults:

- `status: 'off'`
- `tier: 0`
- `audience: 'public'` only after the author enters the publish setup flow; no
  publish is possible while disconnected/off
- `manualPublishEnabled: true`
- `scheduledPublish.enabled: false`
- `fieldPolicy: {}`
- `bookMappings: []`
- `publishHistory: []`
- every new field absent/disabled

Add a normalizer:

- `normalizeCommunityShareSettings(input): CommunityShareSettings`
- Enforces defaults.
- Drops unknown statuses/audiences.
- Keeps new fields disabled.
- Caps local history length if needed.
- Never invents enabled sharing fields.

## Required UI States

Disconnected:

- No active connection.
- Shows activation entry point.
- All field controls can be edited locally if useful, but Preview/Publish are
  blocked until connection and mapping exist.
- Explicitly says no Community data has been published.

Connected, unpublished:

- Active connection and book mapping exist.
- No successful publish yet.
- Shows profile/project identity.
- Shows field/tier/audience setup.
- Publish disabled until Complete Preview is ready.

Preview-ready:

- Complete Preview succeeded.
- Preview hash and payload hash visible in compact form.
- Publish enabled only if settings have not changed since preview.
- Shows full outgoing payload and redactions.

Publish-success:

- Shows website publish/version id if available.
- Shows last successful publish time locally.
- Shows link to website report if backend returns it.
- History row added/updated.

Publish-failed:

- Shows error code and plain-language message.
- Keeps failed history entry.
- Publish requires retry with current preview or regenerated preview depending
  on error.

Paused:

- Connection exists but publish disabled.
- Live reports may remain live.
- Unpause is separate from publish.

Disconnected with live reports:

- Connection cannot update website.
- Existing live reports may still be visible.
- Show reconnect, revoke, delete, and disconnect-state explanation.
- Revoke/delete require website-authenticated owner path or a still-valid
  explicit backend mode if connection-secret flow permits it.

Revoked/deleted:

- Current report no longer viewer-visible.
- History and tombstone metadata remain.
- Publish requires a new preview and new manual publish.

## Implementation Slices

1. Types and defaults only.
   - Add settings types, defaults, normalizer, and tests.
   - No UI, no network.

2. Settings tab shell.
   - Add `Community` tab and placeholder disabled/off state.
   - Add tests that the tab id is wired in both settings tab unions.

3. Local policy and preview builder.
   - Build field registry, redaction policy, canonical serialization, preview
     hash, payload hash.
   - Use only safe session projections.
   - Add privacy tracer tests before any network calls exist.

4. Account/project activation.
   - Add activation token UI and confirmation modal.
   - Store connection secret via credential storage.
   - No publish endpoint yet.

5. Manual publish.
   - Send only previewed payload and manifests.
   - Record local history for attempt/success/failure.
   - Reject stale preview locally before request.

6. Revoke/delete/disconnect.
   - Add explicit remote state controls and local history.
   - Ensure disconnected-with-live-reports state is visible.

7. Future only.
   - Scheduled publish.
   - Relationship audiences.
   - Working Now presence.

## Tests Required Before Implementation Is Complete

Types/defaults:

- Default `communityShare` is off/private in practice: no active connection,
  tier 0, schedule disabled, empty field policy.
- Normalizer defaults unknown/missing field policies to disabled.
- Normalizer rejects unknown/dormant audience for launch publish state.
- `lastSettingsTab` accepts `community` and still restores correctly.

Settings UI:

- `SettingsTab.test.ts` verifies tab order includes `Community` between Social
  and Inquiry.
- Community content has disconnected, connected-unpublished, preview-ready,
  publish-success, publish-failed, paused, and disconnected-with-live-reports
  render states.
- Publish button is disabled until Complete Preview succeeds.
- Changing tier, audience, field policy, redaction policy, or mapping marks
  preview stale and disables publish.
- Scheduled publish controls are off/future by default.
- Working Now controls are absent or disabled/future.

Projection/privacy:

- Extend `WritingSessionLog.privacy.test.ts` or add
  `CommunitySharePreview.privacy.test.ts` with tracers for:
  - manuscript text
  - scene path
  - completed scene path
  - scene activity path
  - note text
  - book title when not opted in as public alias
  - vault path
  - local file name
  - raw started/ended timestamps
- Public v1 payload does not contain tracer strings.
- Public v1 payload does not contain arrays of sessions/records.
- Public v1 payload does not contain `id` values from session records.
- Community report builder uses `buildCommunityDailyLog()` or a documented
  safe projection only.
- Exact timestamps are absent from public payload.

Preview/hash:

- Canonical JSON hash is stable for object key order.
- Hash changes when enabled fields change.
- Hash changes when audience changes.
- Hash changes when tier changes.
- Hash changes when redaction precision changes.
- Publish builder refuses stale preview hash.
- Publish builder refuses payload keys not present in the enabled manifest.

Field policy:

- Every known field defaults disabled.
- Sensitive fields cannot be enabled for public v1 publish.
- Raising tier does not auto-enable fields.
- Lowering tier disables incompatible fields or blocks preview until resolved.
- Narrative fields must come from explicit author input, not session notes.

Connection/publish history:

- Activation confirmation stores no progress payload.
- Failed publish creates local history.
- Successful publish records website ids, hashes, field list, tier, audience,
  and status.
- Revoke/delete/disconnect create local history entries.
- Delete removes retained payload snapshot content from local history.
- Disconnect does not silently revoke/delete live reports.

Network boundary:

- No publish request can be constructed unless connection is active, selected
  local book is mapped, Complete Preview is ready, and manual publish is
  clicked.
- V1 publish request rejects dormant audiences locally before calling backend.
- Request payload excludes connection secret from logs/history/debug snapshots.

Build gates:

- `npx tsc --noEmit`
- Focused vitest files for new Community Share logic.
- Full relevant test suite before shipping.
- `npm run build` only after implementation work is actually complete and ready
  for the normal build/copy/backup flow.

## Open Decisions Before Coding

- Whether v1 public report should be named Tier 4 in UI or shown as a simpler
  "Public manual progress report" while storing `tier: 4`.
- Whether profile/project shell editing remains website-only for launch or the
  plugin can open website edit links.
- Whether local history should store a compact display snapshot for successful
  reports or only metadata plus hashes. If delete must scrub content, metadata
  only is safer.
- Whether activation uses device code, copy/paste token, deep link, or QR.
- Whether connection secret storage should reuse existing AI credential storage
  exactly or use a dedicated Community credential key namespace.

## Non-Negotiable Acceptance Criteria

- Fresh install has Community Share off.
- Existing users get every new Community field defaulted off.
- Website activation alone publishes nothing.
- Plugin confirmation publishes nothing.
- Complete Preview is local and mandatory.
- Manual publish sends only the previewed, display-ready payload.
- Public v1 supports only `audience = "public"`.
- No manuscript text, scene paths, vault paths, note paths, local file names,
  raw session rows, plugin logs, API keys, license keys, billing state, email
  address, or exact public timestamps leave the plugin.
- Revoke removes viewer access.
- Delete removes report payload content and leaves only metadata/tombstone
  state.
- Disconnect stops future publish but does not silently revoke/delete live
  reports.
- Scheduled publish and Working Now are future/off by default.
