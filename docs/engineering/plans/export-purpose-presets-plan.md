# Export by purpose: editor round, AI review, readers

Status: proposed 2026-10-07 (Eric). Owner: whoever is working on export presets in `ManuscriptOptionsModal`; coordinate before restructuring the modal.

## Problem

The export modal's cleanup posture follows the output format: Markdown keeps everything, PDF and Word strip everything (`cleanupFormatForOutputFormat` → reader defaults). That is right for readers and wrong for the most common Word export a working author makes: sending the manuscript to an editor. For that round the author must remember to:

- turn **on** SceneIDs in headings (so the editor's notes, and an AI formatting them, can anchor to scenes),
- turn **off** Strip author queries (so `%%query:` questions reach the editor, now as Word margin comments, `src/utils/authorQueryComments.ts`),
- keep **on** Strip comments (the author's private `%%notes%%` must not reach the editor),
- and leave links, callouts and block IDs stripped.

One wrong switch either leaks private notes or loses the questions and scene anchors. Saved presets help once a user has built one; nothing guides building it.

## Proposal

Ask who the export is for, first, and derive the settings from the answer. The individual toggles stay, folded under an **Advanced** disclosure, as overrides.

| Setting (`ExportProfile`) | Editor round (Word) | AI review (Markdown) | Readers / submission (Word or PDF) |
|---|---|---|---|
| `outputFormat` | `docx` | `markdown` | `docx` or `pdf` |
| `includeSceneIdInHeading` | **on** | on | off |
| `includeSceneIdInToc` | off | off | off |
| `cleanup.stripAiComments` (author queries) | **off** → margin comments | off → raw `%%query:` | on |
| `cleanup.stripComments` (private notes) | on | on | on |
| `cleanup.stripLinks` | on (label kept) | off | on |
| `cleanup.stripCallouts` | on | off | on |
| `cleanup.stripBlockIds` | on | off | on |
| `includeMatter` | off | off | as chosen |
| `saveMarkdownArtifact` | off | n/a | as chosen |
| `lineBreaksAsParagraphs` | per manuscript (not purpose) | n/a | per manuscript |

- Store the choice on the profile, e.g. `purpose?: 'editor-round' | 'ai-review' | 'readers' | 'custom'`. Any manual override flips it to `custom`, and the Advanced section shows which settings differ from the purpose's defaults. Existing saved presets migrate as `custom` with their settings untouched.
- Saved presets keep working as they do now (reopen on last preset, Reload). A purpose is a starting point, not a lock.

## Summary line before export

A one-line read-back above the Export button, from the sanitized text and the scene selection, so mistakes show before the file exists:

- Editor round: "34 scenes with IDs · 3 questions as margin comments · your notes stripped."
- Readers: a warning when anything review-only would still show: "3 author queries will appear as comments", "scene IDs are on".
- AI review: "34 scenes with IDs · 3 questions kept for review."

Counts: author queries from `AUTHOR_QUERY_PREFIX_PATTERN` matches in the compiled text (before conversion); scenes with IDs from the assembled scenes.

## The round trip it supports

1. Editor round export (Word): questions arrive as margin comments signed with the book's author; scene headings carry IDs.
2. The editor marks up with Track Changes and comments, replies in the question threads, and may send a separate letter.
3. In Editorialist: copy the formatting instructions from the review launcher and give them, with the returned file(s), to the author's chat client; paste the result back. Line edits land on their scenes, the letter becomes an Editorialism, answers land on their questions.
4. Next questions: the same Editor round export again.

## Acceptance

- Choosing a purpose sets every setting in the table; the Advanced toggles reflect it; changing one marks the export `custom`.
- Editor round never exports private `%%comments%%` unless the user overrides Strip comments in Advanced.
- Readers warns when queries or scene IDs would appear.
- Existing presets load unchanged.
- Tests: purpose → settings mapping (pure function), migration of existing profiles to `custom`, summary counts.
- Wiki: Manuscript Export gains a short "Who is it for?" section; the 7.4.x release notes get one bullet.
