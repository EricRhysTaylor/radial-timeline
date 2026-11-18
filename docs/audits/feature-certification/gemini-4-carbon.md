# Feature certification — google/gemini-4-carbon

- Generated at: 2026-11-18T00:59:26.586Z
- Corpus: Pride & Prejudice (/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault AI Certification)
- Result: PASS
- Estimated spend: $1.0075

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:16 Wickham's Story | PASS | 16.5 | 11438 | 995 | $0.0328 | Parsed and validated by the production Pulse parser. |
| pulse:30 Bingley Returns | PASS | 48.9 | 9738 | 981 | $0.0293 | Parsed and validated by the production Pulse parser. |
| pulse:44 Invitation and Visit | PASS | 53.6 | 14613 | 707 | $0.0363 | Parsed and validated by the production Pulse parser. |
| summary:21 Bingleys Depart | PASS | 131.8 | 4382 | 2587 | $0.0346 | Summary 246 words (target 200); Synopsis 27 words (cap 30); both passed the production parsers. |
| summary:41 Lydia Invited to Brighton | PASS | 17.9 | 4819 | 661 | $0.0162 | Summary 247 words (target 200); Synopsis 29 words (cap 30); both passed the production parsers. |
| gossamer:momentum | PASS | 57.6 | 166592 | 3691 | $0.3701 | All 15 beats scored and validated (61 scenes, 121693 words). |
| inquiry:payoff-abandoned-threads | PASS | 218.6 | 170302 | 14751 | $0.4881 | Inquiry returned 11 finding(s) over 61 scenes; verdict and refs passed the production result builder. |
