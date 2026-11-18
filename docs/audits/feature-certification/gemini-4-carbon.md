# Feature certification — google/gemini-4-carbon

- Generated at: 2026-11-18T00:23:08.956Z
- Corpus: The Tidewater Ledger (/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline/tests/fixtures/model-onboarding/vault)
- Result: PASS
- Estimated spend: $0.3227

Planted faults (inquiry:payoff-abandoned-threads; reported, not gated):

- found: box-14-key — Wren finds a brass key tagged "Box 14" hidden in the ledger's back cover and vows to find what it opens. It is mentioned once more and never resolved.
- found: jonah-vanishes — Jonah Marsh, the deckhand, says Elias was not alone the night he died and promises to tell Wren everything on Friday at six. He never appears or is mentioned again, and the meeting never happens.
- missed: death-month — Elias drowned in March (scenes 1, 2, 9, 10), but scene 8 calls it "the August night he drowned".

| Case | Result | Seconds | Input tok | Output tok | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| pulse:4 A Number That Does Not Answer | PASS | 11.2 | 5570 | 703 | $0.0182 | Parsed and validated by the production Pulse parser. |
| pulse:6 Sunset Cruise | PASS | 57.1 | 5510 | 2430 | $0.0353 | Parsed and validated by the production Pulse parser. |
| pulse:8 Grounded | PASS | 29.9 | 5452 | 2397 | $0.0349 | Parsed and validated by the production Pulse parser. |
| summary:5 No Sale | PASS | 54.4 | 2659 | 4397 | $0.0493 | Summary 261 words (target 200); Synopsis 27 words (cap 30); both passed the production parsers. |
| summary:9 The Papers on the Desk | PASS | 63.0 | 2574 | 3423 | $0.0394 | Summary 264 words (target 200); Synopsis 29 words (cap 30); both passed the production parsers. |
| gossamer:momentum | PASS | 47.4 | 13079 | 1943 | $0.0456 | All 15 beats scored and validated (12 scenes, 7707 words). |
| inquiry:payoff-abandoned-threads | PASS | 85.2 | 14719 | 7067 | $0.1001 | Inquiry returned 6 finding(s) over 12 scenes; verdict and refs passed the production result builder. Planted faults found: 2/3. |
