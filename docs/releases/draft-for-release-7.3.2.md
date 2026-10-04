## Radial Timeline 7.3.2

Desk Lamps show when your writing friends are at their desks, Inquiry's corpus reads at a glance, and the Pride & Prejudice demo vault is a free download.

### Desk Lamps

- **See when your writing friends are at their desks.** Desk Lamps are close writing friends you add on the Community. When one of them starts a session in Radial Timeline and shares it with you, their lamp comes on: a lamp beside the **Mailbox** counts the friends at their desks, and its menu lists each one with their city, the kind of writing (drafting, revising, editing, or planning), and how long they've been at it. The freshest change is on top, and a friend who just stopped shows "lamp off after 2 h 10 min" for half an hour.
- **Your lamp, your choice, every session.** The **Begin Session** panel lists your Desk Lamps with checkboxes; tick who sees this session, and Radial Timeline remembers the choice for next time. While you write, the panel shows who your lamp is lit for, and you can change the list or turn the lamp off. **Pause** shows your friends "on a break"; saving or discarding the session turns the lamp off.
- **No book, no scenes, no words.** Friends see your name, your city from your Community profile, the kind of writing, and how long, in five-minute steps. Nothing else leaves the vault, and the server keeps no record once the lamp goes off. Desk Lamps works at every sharing level, Private included; pausing sharing turns your lamp off.
- **Add Desk Lamps on the Community.** On a writer's Community page, click **Add to Desk Lamps**. They accept on your page or under **My Share → Desk Lamps**, and either of you can remove the other at any time without notice. To hide the lamp and keep yours off, turn off **Show Desk Lamps** in **Settings → Advanced**.

See [Desk Lamps](https://github.com/EricRhysTaylor/radial-timeline/wiki/Desk-Lamps) in the wiki.

### Inquiry

- **The corpus reads at a glance.** Every scene in the corpus strip is now a page, the same page the minimap draws. Its fill and color show the material mode (green and filled for full, blue and outlined for summary, faded red for excluded), its outline shows the scene's status, and its text lines show how much material it holds, from three lines for substantive down to a blank page. A corner X flags a scene whose material is sketchy or empty, and a target scene gets an accent outline with a folded corner. Hover the asterisk above the strip for the legend.

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/5a04ecad/wiki/images/inquiry-corpus-pages.webp" alt="The corpus strip for The Odyssey beside its legend: green filled pages for full scenes, faded red pages for excluded scenes, and blue outlined pages with a corner X for summary scenes with thin summaries" width="440">

- **Inquiry opens with AI off.** The Inquiry view and its ribbon icon are there whether or not AI is turned on, so you can read saved sessions, including the demo vault's, without an API key. Running a new question needs AI turned on and a provider.
- **Saved questions read clearly in demo vaults.** Each saved question sits on a solid disc, so its number stays legible against the zone colors.

See [Reading the corpus](https://github.com/EricRhysTaylor/radial-timeline/wiki/Inquiry#corpus-pages) in the wiki.

### Demo vaults

- **The Pride & Prejudice demo vault is a free download.** The Welcome screen now opens with **Explore Pride & Prejudice**: all 61 chapters with saved Pulse analysis, four Gossamer signals, and three Inquiry sessions. **Get the free demo vault** opens the download page. No signup or API key needed.
- **Demo vaults in Settings → PRO.** The section formerly called Bonus vaults is now the demo library. **View demo & download** opens the Pride & Prejudice page on the website. *The Odyssey*, *Sherlock Holmes*, and *The Faerie Queene* are marked **Coming soon**.

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/5a04ecad/wiki/images/demo-vaults-shelf.webp" alt="Settings → PRO → Demo vaults: the Pride & Prejudice card with View demo & download, and The Odyssey card marked Coming soon" width="600">

- **A first look at The Odyssey.** The next demo vault maps Homer's epic, in Samuel Butler's prose translation, as 89 scenes across all 24 books, with 12 Hero's Journey beats and four motif rings beside the main plot. In Chronologue, Ulysses's own account of his wanderings moves back years, ahead of scene 1.

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/5a04ecad/wiki/images/odyssey-narrative.webp" alt="The Odyssey in Narrative mode: 89 scenes on the outer ring and four motif rings inside it" width="600">

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/5a04ecad/wiki/images/odyssey-chronologue.webp" alt="The Odyssey in Chronologue mode: the scenes of Ulysses's wanderings, numbered 28 to 45, sit at the start of the timeline" width="600">

See [Demo Vault: Pride & Prejudice](https://github.com/EricRhysTaylor/radial-timeline/wiki/Sample-Vault) and [Demo Vault: The Odyssey](https://github.com/EricRhysTaylor/radial-timeline/wiki/Odyssey-Demo-Vault) in the wiki.

### Community

- **Your book follows My Share.** Choose a different book with **Change book** on My Share and the next book sync picks it up: the Community Share preview and the connected book in settings both show the book you chose.
- **A mailbox in the title bar.** On a vault connected to the Community, a **Mailbox** button beside the writing-session control works like your account menu on the Community website. A gold number counts your requests the team has answered and your questions with new replies, and clicking it opens a menu of Requests and New replies to read them on the Community. To hide it, turn off **Show Community mailbox** in **Settings → Advanced**.
- **Export your timeline for sharing.** The **Timeline share export** command writes the file you upload on My Share to build your Interactive Timeline. Before anything is written, a dialog lists what the file contains, and nothing is shared until you upload it and activate the share.
- **Bug reports that carry the details.** Bug reports from the Community include your plugin version, Obsidian version, and platform, so fixes land faster. My Share shows the same line for the vault you connected.

### Getting help

- **Help lives in one place.** **GET HELP** in the corner of the timeline opens the Community help page, home to how-to answers, the Guide, private requests, and known issues. The Radial Timeline View title bar keeps a calmer, quieter layout.
- **The Welcome screen links to the Community**, where writers share setups and answer each other's questions.
- **Bug reports land on the right form.** **Report a bug** opens the new GitHub bug form with your plugin version, Obsidian version, platform, and view already filled in. The email route works as before.

### Timeline view

- **The title bar fits narrow panes.** The book selector and the small icons beside it no longer overlap. When the right side needs room, the mode buttons slide left to make it. In a narrower pane the command, print, bug, and settings icons fold into one menu button, then the search field and book selector get shorter, and only in the narrowest panes do inactive modes shrink to their number, such as **1 2 Narrative 3 4**.
- **In This Book leads the beat hover.** Beat notes gain an **In This Book** field for what the beat is in your novel. When it's filled, the beat hover opens with it and the beat system's generic Purpose drops beneath as a smaller line, and timeline search finds the beat by its words. Unfilled beats hover as before. To add the field to existing beat notes, run **Insert missing fields** from the beat audit in **Settings → Core → Story beats system**.

### AI

- **Prompt caching works on every provider.** On OpenAI models, the second and later questions in an Inquiry session read the manuscript from the provider's cache instead of paying to write it again, and one-off calls such as Pulse are no longer billed as cache writes. Gemini caches survive a plugin reload instead of being created a second time.
- **Re-runs ask again.** Running Summary scene refresh, Pulse, or a Gossamer score again within two minutes sends a new request instead of returning the previous answer. The Gossamer confirmation notes when that signal was already scored on the same unchanged manuscript in this session, so you can cancel an accidental repeat.
- **Summaries stay factual.** Summary scene refresh ignores your AI role template, so an editor persona no longer colors a scene's summary.
- **Pulse shows the batch total.** When a Pulse batch finishes, the card shows the batch's total cost. Cache use and per-scene costs sit under **AI prompt & context**.

### Model support

- **Claude Sonnet 5.5** replaces Sonnet 5 at the same price.
- **GPT-6.1 Sol** replaces GPT-6 Sol, with cached input at half the previous price.

### Scene time

- **Scene Time in your language.** The Scene Time dialogs, notices, tooltips, and title-bar badge follow your Obsidian language in German, Japanese, Korean, and Chinese. Durations are still typed in English, such as `10 hours` or `30 min`.

### Author progress report

- **The center number stands alone.** The large faded % behind the percentage in the center of the APR is gone, along with its color row in **Settings → Social**. The Community shows the new APR after your next upload.

### Commands

- **Set two hotkeys again.** **Open** and **Timeline date scaffold** have new IDs, so a hotkey you assigned to either needs to be assigned again in **Settings → Hotkeys**.
- **Names lead with the feature.** **Summary refresh** is now **Summary scene refresh**, **Manage subplots** is **Subplot manager**, **Search timeline** is **Timeline search**, and **Assign scene time to selection** is **Scene time assignment**, which now follows your Obsidian language.
- **Timeline date scaffold and Timeline date audit.** The two tools for your scenes' `When` dates now share a name: **Timeline scaffold** fills missing dates and is now **Timeline date scaffold**; **Timeline audit** checks the dates you have and is now **Timeline date audit**.
- **AI off keeps AI commands out of the way.** With **Enable AI LLM features** turned off, **Gossamer analysis** leaves the command palette like the other AI commands, and the Timeline date audit AI scan and the runtime estimator's AI mode tell you AI is off instead of running. To score Gossamer by hand, open **Gossamer score manager**, copy the prompt, and enter the scores yourself.

### Fixes

- **Inquiry citations keep your scene IDs.** Scenes with an `ID` you wrote yourself, rather than one Radial Timeline generated, keep their citations in Inquiry findings and saved results.
- **Gossamer reads in narrative order in every mode.** Switching to Chronologue no longer changes the Gossamer prompt or its cache.
- **Progress bars follow real runs.** Inquiry's estimate calibrates from your most recent run, and Gossamer's scales your last run's time to the length of the manuscript.
