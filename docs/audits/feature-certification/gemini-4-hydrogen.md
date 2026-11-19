# Feature certification — google/gemini-4-hydrogen

- Generated at: 2026-11-19T19:38:18.138Z
- Corpus: Pride & Prejudice (../Test Vaults/Obsidian Vault AI Certification)
- Result: PASS
- Estimated spend: $0.8124

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:16 Wickham's Story | PASS | 10.2 | 11438 | 2161 | $0.0334 | Parsed and validated by the production Pulse parser. |
| pulse:30 Bingley Returns | PASS | 12.1 | 10439 | 2476 | $0.0342 | Parsed and validated by the production Pulse parser. |
| pulse:44 Invitation and Visit | PASS | 10.2 | 14613 | 2158 | $0.0381 | Parsed and validated by the production Pulse parser. |
| summary:21 Bingleys Depart | PASS | 20.2 | 4376 | 3696 | $0.0343 | Summary 247 words (target 200); Synopsis 25 words (cap 30); both passed the production parsers. |
| summary:41 Lydia Invited to Brighton | PASS | 24.2 | 4798 | 4575 | $0.0415 | Summary 238 words (target 200); Synopsis 26 words (cap 30); both passed the production parsers. |
| gossamer:momentum | PASS | 14.9 | 166592 | 2624 | $0.2696 | All 15 beats scored and validated (61 scenes, 121693 words). |
| inquiry:payoff-abandoned-threads | PASS | 71.3 | 170302 | 14120 | $0.3614 | Inquiry returned 6 finding(s) over 61 scenes; verdict and refs passed the production result builder. |
