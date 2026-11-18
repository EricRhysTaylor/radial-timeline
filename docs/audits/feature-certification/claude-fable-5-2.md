# Feature certification — anthropic/claude-fable-5-2

- Generated at: 2026-11-18T00:19:53.948Z
- Corpus: The Tidewater Ledger (/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline/tests/fixtures/model-onboarding/vault)
- Result: PASS
- Estimated spend: $1.4936

Planted faults (inquiry:payoff-abandoned-threads; reported, not gated):

- found: box-14-key — Wren finds a brass key tagged "Box 14" hidden in the ledger's back cover and vows to find what it opens. It is mentioned once more and never resolved.
- found: jonah-vanishes — Jonah Marsh, the deckhand, says Elias was not alone the night he died and promises to tell Wren everything on Friday at six. He never appears or is mentioned again, and the meeting never happens.
- found: death-month — Elias drowned in March (scenes 1, 2, 9, 10), but scene 8 calls it "the August night he drowned".

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:4 A Number That Does Not Answer | PASS | 18.9 | 7592 | 1978 | $0.1399 | Parsed and validated by the production Pulse parser. |
| pulse:6 Sunset Cruise | PASS | 11.9 | 7618 | 1247 | $0.1108 | Parsed and validated by the production Pulse parser. |
| pulse:8 Grounded | PASS | 12.4 | 7574 | 1326 | $0.1136 | Parsed and validated by the production Pulse parser. |
| summary:5 No Sale | PASS | 7.9 | 3894 | 641 | $0.0568 | Summary 309 words (target 200); Synopsis 29 words (cap 30); both passed the production parsers. |
| summary:9 The Papers on the Desk | PASS | 7.7 | 3873 | 694 | $0.0587 | Summary 316 words (target 200); Synopsis 28 words (cap 30); both passed the production parsers. |
| gossamer:momentum | PASS | 23.0 | 18448 | 2187 | $0.3807 | All 15 beats scored and validated (12 scenes, 7707 words). |
| inquiry:payoff-abandoned-threads | PASS | 75.5 | 20785 | 7522 | $0.6331 | Inquiry returned 9 finding(s) over 12 scenes; verdict and refs passed the production result builder. Planted faults found: 3/3. |
