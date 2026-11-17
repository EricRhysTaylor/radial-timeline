# Model onboarding test vault

A small, original manuscript for testing a model before it enters the catalog, and for catching bugs in the AI features themselves. *The Tidewater Ledger* is a novella of about 8,300 words in 12 scenes, with 15 Save The Cat beat notes, written for this vault. It is unpublished on purpose: a model cannot answer Inquiry from memory, so a corpus the plugin sends broken or cut short shows up as a bad answer.

## What is here

- `vault/The Tidewater Ledger/` — 12 scene notes (managed YAML fields only, Summary and Synopsis empty) and 15 beat notes.
- `answer-key.json` — three faults planted in the prose: two abandoned threads (the Box 14 key; Jonah, who promises to explain the night Elias died and then vanishes) and one continuity error (Elias drowned in March, but scene 8 says August). `tests/model-onboarding-fixture.test.ts` keeps the plants in place and the vault under 10,000 words.

## Live certification (scripted)

```sh
RT_CERT_PROVIDER=google RT_CERT_MODEL=gemini-4-hydrogen npm run certify:features
```

This runs 3 Pulse triplets, Summary and Synopsis on 2 scenes, Gossamer momentum and the Inquiry *Abandoned Threads* question through the production request builders and validators. It writes `docs/audits/feature-certification/<model>.md` with spend and which planted faults Inquiry found (reported, not gated). It needs the provider's API key.

The small corpus never reaches a long-context price tier (Haiku over 100K, OpenAI over 272K) or book-scale Gossamer, so before a release also run the full Pride & Prejudice book with `RT_CERT_VAULT` and `RT_CERT_BOOK` (see the harness header).

## By hand in Obsidian

`npm run model-vault:reset` copies the book into `Test Vaults/Obsidian Vault Model Onboarding` beside the repo, replacing everything there except `.obsidian`. `npm run deploy` installs the plugin in it. Set Source path to `The Tidewater Ledger`, choose the model, and run the features from the UI. Reset again before testing the next model.

## Editing the story

Keep the plants. If a change moves one, update `answer-key.json` in the same commit and run `npx vitest run tests/model-onboarding-fixture.test.ts`. A change to the corpus makes earlier certification reports incomparable, so say so in the commit.
