# AI jobs — wiki-source copy (unpublished)

Held out of `wiki/Commands.md` while AI jobs is a development-only workflow
(Eric, 2026-10-01: hidden until he has tested it; the commands carry an
"(AI testing)" suffix and register only when beta commands are visible).
When it ships, restore this section to `wiki/Commands.md` under
`<a name="ai-jobs"></a>`, add the two commands back to the Command Index and
Conditional Visibility lists, and restore the pointer from the Summary refresh
section. The mailbox README written by `src/ai/jobs/aiJobStore.ts` already
points authors to "the Radial Timeline wiki, Commands".

## AI jobs

**Prepare AI jobs…** hands a book's AI work to an AI client you run yourself, such as Codex or Claude Code, so it runs within your ChatGPT or Claude subscription instead of API billing. Each job carries the prompt the built-in run sends, and each answer is checked and written by the built-in run's own code.

| Feature | Jobs | Choices |
| --- | --- | --- |
| Scene summaries | One per scene | Flagged `Summary Update: Yes`, without a Summary, or all |
| Pulse triplet analysis | One per scene, with the scenes before and after it | Flagged `Pulse Update: Yes`, not yet analyzed, or all |
| Gossamer scoring | One per signal, each carrying the whole manuscript | One signal or all four |
| Inquiry | One per enabled question, over the active book (Inquiry switches to it) or the saga, with Inquiry's target scenes | Questions without a current briefing, or all |

1. Make the book active. For Inquiry, set its scope and target scenes too.
2. Run **Prepare AI jobs…**, choose what to prepare, and click **Prepare**. Jobs go to `Radial Timeline/AI Jobs/Pending`.
3. Ask your AI client to work through the jobs in `Radial Timeline/AI Jobs`. The `AGENTS.md` and `CLAUDE.md` files there tell it how.
4. Each answer is checked and applied as soon as the client writes it while Obsidian is open, or the next time Obsidian opens. **Check for AI job results** runs the check on demand.

**Order.** Inquiry can read scene summaries. While Summary jobs for the book are pending, its Inquiry jobs wait (listed in `Waiting.json`) and are written once the last Summary answer is applied, so the client never answers a question against summaries that are about to change. The client finds them when it looks in `Pending` again.

**Who wrote it.** Accepted answers are written exactly as a built-in run writes them, credited to your AI client as it names itself. For example, `Summary Update: <date> by Claude app · Opus 5.5` (or `by local agent` if it gives no name), a Gossamer run labelled `Codex app · GPT-6 Sol`, or an Inquiry briefing whose model is `Claude app · Opus 5.5`. Built-in runs name the model that answered, for example `by Claude Opus 5.5 API` or `by Local model qwen3:80b`.

**Checks.** An answer that fails the built-in run's checks goes back to the client with the problems noted on the job. If what a job is about changes after it was written, the job is rebuilt from the new text and the earlier answer is discarded. That means the scene for a Summary, the scene or a neighbor for Pulse, and any scene for Gossamer and Inquiry. With `Also update Synopsis` on, applying a Summary creates the Synopsis job next. Inquiry jobs are answered in one pass, never multi-pass. An Inquiry answer none of whose findings cites a scene of the corpus is sent back. An answer for another book is kept until that book is active again, and an Inquiry answer also until Inquiry is back on the same scope and target scenes. A job is dropped only when its scene file or Inquiry question no longer exists. Preparing a job again with a changed prompt discards an answer written for the old one.

### Letting the client prepare a book itself

Your AI client can prepare jobs itself by opening a request link, so it can prepare a book, answer every job and move on to the next book without you:

`obsidian://radial-timeline-ai-jobs?vault=<vault name>&book=<book title>&prepare=all&scope=missing`

*   `prepare`: `all`, or any of `summary`, `pulse`, `gossamer`, `inquiry`, separated by commas.
*   `scope`: `missing` (the default), `flagged` or `all`. Inquiry has no flag, so for Inquiry `flagged` means `missing`.
*   `signals`: Gossamer signals separated by commas (`momentum`, `tension`, `activity`, `interiority`). All four when left out.
*   `book`: a book's title, id or source folder from Book Manager. It becomes the active book. Leave it out to use the active book.

A link Radial Timeline cannot read is refused with a notice, never guessed at. On a Mac the client opens a link with `open "<link>"`.

For example, to prep three demo novels, tell Claude Code: "For each of Pride and Prejudice, Frankenstein and Dracula: open `obsidian://radial-timeline-ai-jobs?vault=Demo&book=<title>&prepare=all`, then work through every job in `Radial Timeline/AI Jobs`, including those that appear after the summaries are applied, before moving to the next book."

Related: [Summary refresh](#summary-refresh), [Gossamer analysis](#gossamer-analysis), [Inquiry View](Inquiry), [AI Pulse Triplet Analysis](AI-Pulse-Analysis).
