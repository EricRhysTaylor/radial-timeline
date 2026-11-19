# Feature certification — anthropic/claude-fable-5-2

- Generated at: 2026-11-19T19:37:48.159Z
- Corpus: Pride & Prejudice (../Test Vaults/Obsidian Vault AI Certification)
- Result: PASS
- Estimated spend: $8.9196

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:16 Wickham's Story | PASS | 11.9 | 16265 | 1258 | $0.1804 | Parsed and validated by the production Pulse parser. |
| pulse:30 Bingley Returns | PASS | 10.6 | 13959 | 1174 | $0.1586 | Parsed and validated by the production Pulse parser. |
| pulse:44 Invitation and Visit | PASS | 12.1 | 20995 | 1376 | $0.2230 | Parsed and validated by the production Pulse parser. |
| summary:21 Bingleys Depart | PASS | 9.9 | 6555 | 721 | $0.0813 | Summary 272 words (target 200); Synopsis 30 words (cap 30); both passed the production parsers. |
| summary:41 Lydia Invited to Brighton | PASS | 9.1 | 7264 | 798 | $0.0900 | Summary 296 words (target 200); Synopsis 27 words (cap 30); both passed the production parsers. |
| gossamer:momentum | PASS | 17.2 | 239579 | 1545 | $3.8931 | All 15 beats scored and validated (61 scenes, 121693 words). |
| inquiry:payoff-abandoned-threads | PASS | 92.0 | 244866 | 9391 | $4.2932 | Inquiry returned 10 finding(s) over 61 scenes; verdict and refs passed the production result builder. |
