# 7.5.0 release screenshots

Captured October 12, 2026 in a separate Obsidian 1.14.4 instance using the 7.5.0 build and a working copy of the public Sherlock Holmes demo. The human demo and Author Vault manuscript were not edited.

| Image | Captured behavior |
|---|---|
| `release-7-5-scrivener-metadata.png` | Outline CSV assignments: Character, Act, POV, a retained custom Status field, and Subplot |
| `release-7-5-subplot-drag.png` | Actual pointer drag from Relationship to Investigation, with the target ring and membership preview; confirmation was canceled |
| `release-7-5-onboarding-cloud.png` | Chapter review for a roughly 43,000-word single Markdown file with the configured Claude Opus 5.5 cloud engine and estimate |
| `release-7-5-onboarding-local.png` | The same chapter review with the validated local Qwen3 Next 80B model and no API cost |
| `release-7-5-general-export-source.png` | Folder source outside RT book registration, title and author, saved selection of 14 Markdown notes |
| `release-7-5-publishing-proof.png` | Folder export controls beside an actual 141-page Professional PDF proof |
| `release-7-5-document-proof.png` | The PDF proof pane and page navigation |

These are native rendered captures, without AI image generation or invented UI. The folder and single-file inputs were staged from the demo’s public-domain prose, with demo bookkeeping removed from the plain-document inputs. The Scrivener-style fixture uses the demo’s exported scene properties. Cloud onboarding was prepared for a screenshot; no cloud manuscript generation was run. Local validation used its small JSON diagnostic. The screenshots do not imply that AI split or imported the manuscript.

During capture, the local server rejected the new socket transport with HTTP 411. Commit `35a77ced` fixes the POST framing by ending the request with its complete buffer, so Node supplies Content-Length. Two real-server regression cases failed before the fix and pass afterward, covering UTF-8 text and binary request bodies. The 24 focused transport/cancellation tests and all 14 repository gates passed. Native validation against Qwen3 Next 80B then reported basic completion and strict JSON success (4.8 seconds for the recorded probe).

The Obsidian preview scan must include this source fix before publication. Release images and wiki edits are documentation changes. The GitHub release remains a draft; finishing the release workflow will synchronize its final notes into the embedded bundle and tagged build.
