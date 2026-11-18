# Feature certification — anthropic/claude-fable-5-2

- Generated at: 2026-11-18T00:53:00.088Z
- Corpus: Pride & Prejudice (/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault AI Certification)
- Result: FAIL
- Estimated spend: $8.9210

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:16 Wickham's Story | PASS | 11.9 | 16265 | 1258 | $0.1804 | Parsed and validated by the production Pulse parser. |
| pulse:30 Bingley Returns | PASS | 10.6 | 13959 | 1174 | $0.1586 | Parsed and validated by the production Pulse parser. |
| pulse:44 Invitation and Visit | PASS | 12.1 | 20995 | 1376 | $0.2230 | Parsed and validated by the production Pulse parser. |
| summary:21 Bingleys Depart | FAIL | 8.4 | 6568 | 728 | $0.0817 | Synopsis ran 31 words, over the 30-word cap. |
| summary:41 Lydia Invited to Brighton | PASS | 8.2 | 7288 | 817 | $0.0910 | Summary 299 words (target 200); Synopsis 27 words (cap 30); both passed the production parsers. |
| gossamer:momentum | PASS | 17.2 | 239579 | 1545 | $3.8931 | All 15 beats scored and validated (61 scenes, 121693 words). |
| inquiry:payoff-abandoned-threads | PASS | 92.0 | 244866 | 9391 | $4.2932 | Inquiry returned 10 finding(s) over 61 scenes; verdict and refs passed the production result builder. |
