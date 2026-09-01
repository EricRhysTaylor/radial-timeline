## Radial Timeline 7.2.0

Manuscript onboarding for everyone.

### Onboarding: cloud engine, cost forecast, or local on an 80B

- **Cloud engine option** — manuscript onboarding can now run on a cloud model: the same pipeline, frontier-grade. The local-LLM path remains.
- **Live spend forecast** — when onboarding uses a paid model, a forecast pill in the header shows what the run is expected to cost, updating live as it works. The shared estimator carries the same forecast, and onboarding defaults to **Haiku** — the economical lane — unless you choose otherwise.
- **Local model: tested on Qwen3-Next-80B** — local onboarding is now tested and verified with **Qwen3-Next-80B-A3B-Instruct (4-bit)**, the recommended model. The previously verified **Qwen3-30B-A3B-2507 (4-bit)** still performs, though results are not as strong. Suggested 64GB RAM configuration.

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/bc9a1dbe/wiki/images/preview-80B-local.png" alt="Local LLM preview card validating Qwen3-Next-80B-A3B-Instruct 4-bit" width="600"></p>

### Model support

- Added **Claude Sonnet 5** and **Claude Haiku 4.5**.
- Inquiry no longer silently upgrades a pinned model — the model you pinned is the model that runs.

### Community

Radial Timeline Community is open at [community.radialtimeline.com](https://community.radialtimeline.com). It is a small room right now: me, posting daily from an Author-stage revision round on a longform novel, and an archive shelf (Jane Austen's *Pride and Prejudice*). Communities this size are shaped by whoever shows up first, and the dialogue here is anchored to real, scene-level progress rather than announcements.

If you write longform in Obsidian, sign in, take a handle, and connect this plugin from **Settings → Community**. Joining asks for one book — a title and a logline — because a profile here is an author with a manuscript rather than an empty account. Your manuscript stays on your machine. What travels is the shared data you publish on purpose; **Pause** and **Disconnect** sit in Settings, and taking anything offline for good lives in **My Share** on the site.

What is most useful to me at this stage is friction: where you stalled, what you expected instead, what looked broken. Say so in the room or open an issue.

### More Improvements

- The AI preview card shows a dot animation while a connection check is running, and the provider dropdown reflects what is true now rather than when Settings opened.
- Credential states are named in words, not color alone.
- Copy clarity pass: the AI provider dropdown now states where your manuscript goes for the selected provider (nothing leaves your machine on Local LLM; a cloud provider receives it under that provider's terms), export destinations sit with the export descriptions.

### Fixes

- **Add scene** inserts a decimal scene number after the anchor instead of renumbering against the whole manuscript.
- Scene times in exports are treated as local times, not UTC instants — no more shifted times across time zones.
