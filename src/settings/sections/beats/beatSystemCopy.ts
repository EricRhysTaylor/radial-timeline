export const BEAT_SYSTEM_COPY: Record<string, {
    title: string;
    description: string;
    examples?: string;
    sourceLink?: { label: string; href: string };
}> = {
    'Save The Cat': {
        title: 'Save the Cat',
        description: 'Emphasizes clear emotional beats and audience engagement.\n\nUse it when you want clean turning points, visible reversals, and a strong sense of audience-facing momentum from setup through finale.\n\nBest for: commercial fiction, screenplays, high-concept genre\nMomentum profile: setup -> midpoint turn -> closing payoff',
        examples: 'Examples: The Hunger Games, The Martian, The Fault in Our Stars.',
        sourceLink: {
            label: "Jessica Brody's Save the Cat books",
            href: 'https://www.jessicabrody.com/save-the-cat-for-novels/'
        }
    },
    'Hero\'s Journey': {
        title: 'Hero\'s Journey',
        description: 'Tracks departure, transformation, ordeal, and return.\n\nUse it when you want a mythic or identity-driven arc with visible inner and outer transformation.\n\nBest for: quest stories, speculative fiction, coming-of-age, transformational journeys\nMomentum profile: departure -> trials -> ordeal -> return with change',
        examples: 'Examples: Star Wars, The Hobbit, A Wizard of Earthsea.',
        sourceLink: {
            label: "Christopher Vogler's The Writer's Journey",
            href: 'https://en.wikipedia.org/wiki/The_Writer%27s_Journey:_Mythic_Structure_for_Writers'
        }
    },
    'Classic Dramatic Structure': {
        title: 'Classic Dramatic Structure',
        description: 'Emphasizes scene pressure, turning points, pivotal choices, and consequential outcomes.\n\nUse it when you want to stress-test whether each scene creates movement through conflict and change.\n\nBest for: literary fiction, drama, tightly edited scene work, revision passes\nMomentum profile: setup → complication → pressure → pivotal choice → outcome',
        examples: 'Examples: Pride and Prejudice, Hamlet, The Godfather.',
    },
    'Podcast Narrative Arc': {
        title: 'Podcast Narrative Arc',
        description: 'Shapes spoken storytelling around hook, setup, development, and payoff.\n\nUse it when you want strong listener retention and clean verbal progression.\n\nBest for: podcasts, audio essays, monologues, narrated nonfiction\nMomentum profile: hook -> framing -> development -> payoff',
        examples: 'Examples: narrative podcast episodes, interview-led story episodes, documentary audio segments.',
    },
    'YouTube Explainer Arc': {
        title: 'YouTube Explainer Arc',
        description: 'Organizes teaching and explanation around curiosity, clarity, and progression.\n\nUse it when you want a viewer to understand something quickly while staying engaged.\n\nBest for: explainers, educational videos, commentary, tutorials\nMomentum profile: hook -> promise -> breakdown -> takeaway',
        examples: 'Examples: educational explainers, commentary channels, tutorial-driven storytelling.',
    },
    'Documentary Narrative Arc': {
        title: 'Documentary Narrative Arc',
        description: 'Balances chronology, context, stakes, and consequence in retold events.\n\nUse it when you need to guide the audience through real events without losing momentum.\n\nBest for: history writing, documentary structure, nonfiction storytelling, timelines\nMomentum profile: context -> buildup -> pivot -> consequence',
        examples: 'Examples: historical documentaries, narrative history chapters, event reconstructions.',
    },
    'Romance Tropes Ladder': {
        title: 'Romance Tropes Ladder',
        description: 'Tracks attraction, tension, vulnerability, rupture, and emotional payoff.\n\nUse it when the emotional relationship arc is the main engine of reader investment.\n\nBest for: romance, romantic subplots, character chemistry passes\nMomentum profile: spark -> tension -> vulnerability -> rupture -> union/decision',
        examples: 'Examples: enemies-to-lovers, forced proximity, slow burn.',
    },
    'Thriller Escalation Ladder': {
        title: 'Thriller Escalation Ladder',
        description: 'Builds pressure through danger, revelation, reversals, and narrowing options.\n\nUse it when you want every phase to tighten risk and reduce the protagonist\'s safe choices.\n\nBest for: thrillers, suspense, chase plots, survival narratives\nMomentum profile: threat -> pursuit -> reversal -> compression -> confrontation',
        examples: 'Examples: The Fugitive, Gone Girl, The Silence of the Lambs.',
    },
    'Custom': {
        title: 'Custom system',
        description: 'Design your own structural framework for this manuscript. Define the beats that matter to your story — whether they follow a classic arc or track genre-specific progression.\n\nCustom systems can represent tropes, thematic turns, investigative milestones, historical phases, or any structural rhythm you want to measure.',
        examples: 'Examples: custom novel workflows, bespoke revision systems, classroom structures.',
    },
    'Blank custom': {
        title: 'Blank custom',
        description: 'Starts empty so you can design your own structure from scratch.\n\nUse it when none of the library lenses match your process or you want a project-specific model.\n\nBest for: custom beat design, experimentation, hybrid structures, teaching your own method\nMomentum profile: author-defined',
        examples: 'Start with at least 3 beats. Name each beat by function, not theme. Use a clear progression such as opening -> pressure -> shift. Add or reorder beats only when each one serves a distinct structural purpose.',
    }
};
