# Book copy safety — development validation

## Behavior

- Create book copy offers Submission snapshot (default) and Working draft.
- Both create ordinary editable notes in a sibling folder. There is no lock or read-only enforcement.
- A snapshot leaves the active book unchanged. A working draft switches only when requested.
- Each copy has a new book profile ID, versioned copy metadata, and the source book ID. Scene IDs remain unchanged as lineage identifiers.
- Copies start excluded from saga scope. Book cards expose Include in saga separately from activation and show the copy type.
- Existing profiles retain their previous inclusion behavior; names such as Draft are not treated as metadata.

## Protections

- Timeline and Inquiry saga membership share the profile inclusion rule; single-book Inquiry can still analyze excluded copies.
- Inquiry selection keys qualify scene IDs with their owning book ID. Unknown or ambiguous book ownership uses file-path identity.
- AI references containing a scene ID present on different paths in one corpus remain unbound. Source attribution does not choose the first matching copy. Analyze one version at a time for reliable scene binding; a fully book-qualified AI reference protocol is not implemented here.
- Copying preserves bytes, verifies source membership and source/destination content, and registers only after verification. Existing destinations are not reused. Failures retain partial files for inspection.
- Copy profiles rebase note entries in book-page order and clear inherited export filenames and transient history.
- Duplicate-ID repair is labeled within this book and presents a confirmation preview. Changing the active book while that preview is open aborts repair.

## Limits and remaining validation

Obsidian provides no transaction across an entire folder or settings save. Verification detects observed changes during copying but cannot prevent edits immediately afterward. Copies are editable by design. Note text and links are preserved verbatim; explicit links into the original folder still point there. File bytes are buffered in memory, so very large attachment collections can require substantial memory.

Type checking, selected Obsidian lint, code-quality checks, ERT lock checks, and diff whitespace checks passed. The full suite passed 3,533 tests with two existing skips; an additional source-attribution regression and the copy tests then passed (18 targeted tests).

The new modal and card controls still require visual validation in a development vault. No plugin build was installed and no live manuscript was changed. Commit and push were subsequently authorized; no release was requested.
