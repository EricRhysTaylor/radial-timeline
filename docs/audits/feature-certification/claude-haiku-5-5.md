# Feature certification — anthropic/claude-haiku-5-5

- Generated at: 2026-10-12T17:31:35.095Z
- Corpus: Pride & Prejudice (/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault AI Certification)
- Result: PASS
- Estimated spend: $0.5209

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:16 Wickham's Story | PASS | 11.2 | 16265 | 1166 | $0.0022 | Parsed and validated by the production Pulse parser. |
| pulse:30 Bingley Returns | PASS | 12.3 | 13959 | 1172 | $0.0020 | Parsed and validated by the production Pulse parser. |
| pulse:44 Invitation and Visit | PASS | 12.7 | 20995 | 1190 | $0.0027 | Parsed and validated by the production Pulse parser. |
| gossamer:momentum | PASS | 23.3 | 239579 | 1279 | $0.2427 | All 15 beats scored and validated (61 scenes, 121693 words). |
| inquiry:setup-core | PASS | 102.4 | 244857 | 10616 | $0.2714 | Inquiry returned 24 finding(s) over 61 scenes; verdict and refs passed the production result builder. |
