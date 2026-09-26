# Feature certification — google/gemini-3.8-flash

- Generated at: 2026-09-26T17:50:46.998Z
- Corpus: Pride & Prejudice (/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault AI Certification)
- Result: PASS
- Estimated spend: $0.3259

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:16 Wickham's Story | PASS | 4.5 | 10569 | 969 | $0.0065 | Parsed and validated by the production Pulse parser. |
| pulse:30 Bingley Returns | PASS | 9.4 | 8878 | 2289 | $0.0105 | Parsed and validated by the production Pulse parser. |
| pulse:44 Invitation and Visit | PASS | 4.2 | 13756 | 784 | $0.0133 | Parsed and validated by the production Pulse parser. |
| gossamer:momentum | PASS | 17.4 | 166297 | 4171 | $0.1404 | All 15 beats scored and validated (61 scenes, 121693 words). |
| inquiry:setup-core | PASS | 27.5 | 169847 | 7427 | $0.1552 | Inquiry returned 9 finding(s) over 61 scenes; verdict and refs passed the production result builder. |
