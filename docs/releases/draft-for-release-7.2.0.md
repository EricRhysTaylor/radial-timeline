## Radial Timeline 7.2.0

Manuscript onboarding for everyone — with the price on the label.

### Onboarding: cloud engine + cost forecast

- **Cloud engine option** — manuscript onboarding can now run on a cloud model: the same pipeline, frontier grade. The local-LLM path remains, but a 30B-class model and the hardware to run it are no longer the price of admission.
- **Live spend forecast** — when onboarding uses a paid model, a forecast pill in the header shows what the run is expected to cost, updating live as it works. The shared estimator carries the same forecast, and onboarding defaults to **Haiku** — the economical lane — unless you choose otherwise.
- **Local model: tested on Qwen3-Next-80B** — local onboarding is now tested and verified with **Qwen3-Next-80B-A3B-Instruct (4-bit)**, the recommended model. The previously verified **Qwen3-30B-A3B-2507 (4-bit)** still performs, though results are not as strong.

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/bc9a1dbe/wiki/images/preview-80B-local.png" alt="Local LLM preview card validating Qwen3-Next-80B-A3B-Instruct 4-bit" width="600"></p>

### Model support

- Added **Claude Sonnet 5** and **Claude Haiku 4.5**.
- Inquiry no longer silently upgrades a pinned model — the model you pinned is the model that runs.

### More Improvements

- The AI preview card shows a heartbeat while a connection check is running, and the provider dropdown reflects what is true now rather than when Settings opened.
- Credential states are named in words, not color alone.
- Copy clarity pass: the AI provider dropdown now states where your manuscript goes for the selected provider (nothing leaves your machine on Local LLM; a cloud provider receives it under that provider's terms), export destinations sit with the export descriptions, and the Welcome screen names the plugin's own Community tab.

### Fixes

- **Add scene** inserts a decimal scene number after the anchor instead of renumbering against the whole manuscript.
- Scene times in exports are treated as wall-clock times, not UTC instants — no more shifted times across time zones.
