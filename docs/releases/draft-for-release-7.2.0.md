## Radial Timeline 7.2.0

Manuscript onboarding for everyone — with the price on the label.

### Onboarding: cloud engine + cost forecast

- **Cloud engine option** — manuscript onboarding can now run on a cloud model: the same pipeline, frontier grade. The local-LLM path remains, but a 30B-class model and the hardware to run it are no longer the price of admission.
- **Live spend forecast** — when onboarding uses a paid model, a forecast pill in the header shows what the run is expected to cost, updating live as it works. The shared estimator carries the same forecast, and onboarding defaults to **Haiku** — the economical lane — unless you choose otherwise.

### Model support

- Added **Claude Sonnet 5** and **Claude Haiku 4.5**.
- Inquiry no longer silently upgrades a pinned model — the model you pinned is the model that runs.

### More Improvements

- The AI preview card shows a heartbeat while a connection check is running, and the provider dropdown reflects what is true now rather than when Settings opened.
- Credential states are named in words, not color alone.
- Copy clarity pass: the control that decides where your manuscript goes says so, export destinations sit with the export descriptions, and the Welcome screen names the plugin's own Community tab.

### Fixes

- **Add scene** inserts a decimal scene number after the anchor instead of renumbering against the whole manuscript.
- Scene times in exports are treated as wall-clock times, not UTC instants — no more shifted times across time zones.
