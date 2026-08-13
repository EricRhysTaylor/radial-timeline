/*
 * Plot System Presets for Gossamer Scoring
 */
import { normalizeBeatNameInput } from './beatsInputNormalize';
import type { BeatDefinition, BeatLibraryCategory } from '../types/settings';

export interface PlotBeatInfo {
  name: string;
  description: string;
  placement?: string; // Formerly location/percentageRange: where this beat typically lands
  range?: string;     // Formerly momentumRange: ideal momentum/score band (0-100)
  act?: number;       // Explicit act assignment (1, 2, 3)
  id?: string;        // Stable internal beat-definition id (e.g. "save-the-cat:midpoint")
}

/** Lowercase slug: spaces/special → hyphens, collapse, trim. */
export function slugifyBeat(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Deterministic internal beat-definition id: <system-slug>:<beat-slug> */
export function buildBuiltinBeatId(systemName: string, beatName: string): string {
  return `${slugifyBeat(systemName)}:${slugifyBeat(beatName)}`;
}

export interface PlotSystemPreset {
  name: string;
  category: BeatLibraryCategory;
  icon: string;
  beatCount: number;
  beats: string[];
  beatDetails: PlotBeatInfo[];
}

export const PLOT_SYSTEMS: Record<string, PlotSystemPreset> = {
  "Save The Cat": {
    name: "Save The Cat",
    category: 'narrative',
    icon: 'paw-print',
    beatCount: 15,
    beats: [
      "Opening Image",
      "Theme Stated",
      "Setup",
      "Catalyst",
      "Debate",
      "Break into Two",
      "B Story",
      "Fun and Games",
      "Midpoint",
      "Bad Guys Close In",
      "All Is Lost",
      "Dark Night of the Soul",
      "Break into Three",
      "Finale",
      "Final Image"
    ],
    beatDetails: [
      {
        name: "Opening Image",
        id: "save-the-cat:opening-image",
        act: 1,
        description: "The first impression of your story. A snapshot of the protagonist's life before the journey begins. This 'before' picture sets up the world and establishes what will change by the end. Show the protagonist in their everyday life, revealing the flaw or gap that will be addressed.",
        placement: "0-1%",
        range: "0-10"
      },
      {
        name: "Theme Stated",
        id: "save-the-cat:theme-stated",
        act: 1,
        description: "Someone (often not the protagonist) poses a question or statement that hints at what the story is really about. This thematic truth will be challenged and explored throughout the narrative. It's usually subtle and might go unnoticed by the protagonist initially.",
        placement: "5%",
        range: "5-15"
      },
      {
        name: "Setup",
        id: "save-the-cat:setup",
        act: 1,
        description: "Introduction to the protagonist's world, their relationships, routines, and the stakes. Show what's missing in their life and what they think they want. Establish the status quo that will be disrupted. Every element introduced here should have meaning or relevance to the story ahead.",
        placement: "1-10%",
        range: "10-20"
      },
      {
        name: "Catalyst",
        id: "save-the-cat:catalyst",
        act: 1,
        description: "The inciting incident that disrupts the protagonist's world. Something happens that presents a problem, opportunity, or challenge that cannot be ignored. This is the moment that sets the story in motion and introduces the central dramatic question.",
        placement: "10%",
        range: "25-35"
      },
      {
        name: "Debate",
        id: "save-the-cat:debate",
        act: 1,
        description: "The protagonist hesitates, questions, or resists the call to action. Internal conflict emerges as they weigh their options and wonder if they're ready for the journey ahead. This section builds tension as the audience anticipates the inevitable leap into Act Two.",
        placement: "10-20%",
        range: "20-30"
      },
      {
        name: "Break into Two",
        id: "save-the-cat:break-into-2",
        act: 2,
        description: "The protagonist makes a choice and crosses the threshold into a new world or situation. They commit to the journey, leaving the familiar behind. This decision propels them into Act Two and sets the main story in motion. There's no turning back.",
        placement: "20%",
        range: "30-40"
      },
      {
        name: "B Story",
        id: "save-the-cat:b-story",
        act: 2,
        description: "Introduction of a secondary storyline, often a relationship that provides emotional depth and thematic counterpoint to the main plot. This subplot typically explores the internal journey and helps the protagonist learn what they truly need (versus what they initially wanted).",
        placement: "22%",
        range: "35-45"
      },
      {
        name: "Fun and Games",
        id: "save-the-cat:fun-and-games",
        act: 2,
        description: "The promise of the premise. This is where the story delivers what the audience came for—the core concept in action. The protagonist explores the new world, enjoys initial successes, and we see the story's unique appeal. Tension exists but hasn't reached its peak yet.",
        placement: "20-50%",
        range: "40-55"
      },
      {
        name: "Midpoint",
        id: "save-the-cat:midpoint",
        act: 2,
        description: "A major turning point that raises the stakes and changes the direction of the story. Either a false victory (things seem great but complications loom) or a false defeat (things seem terrible but hope remains). Time clocks and deadlines often appear here, adding urgency.",
        placement: "50%",
        range: "60-70"
      },
      {
        name: "Bad Guys Close In",
        id: "save-the-cat:bad-guys-close-in",
        act: 2,
        description: "The opponent's forces regroup and push back harder. Internal and external pressures mount. The protagonist's flaws or weaknesses are exposed. Relationships may fray. The easy wins from Fun and Games evaporate as real obstacles emerge and consequences become clear.",
        placement: "50-75%",
        range: "65-80"
      },
      {
        name: "All Is Lost",
        id: "save-the-cat:all-is-lost",
        act: 2,
        description: "The lowest point. The protagonist loses everything or believes they do. The goal seems impossible. This is often the moment of greatest despair, where hope appears lost. Something or someone important may be literally or figuratively lost. The 'whiff of death' moment.",
        placement: "75%",
        range: "75-85"
      },
      {
        name: "Dark Night of the Soul",
        id: "save-the-cat:dark-night-of-the-soul",
        act: 2,
        description: "A moment of reflection and wallowing in defeat. The protagonist processes the loss, questions everything, and confronts their deepest fears. This quiet, internal moment allows both character and audience to feel the full weight of All Is Lost before the final push begins.",
        placement: "75-80%",
        range: "70-80"
      },
      {
        name: "Break into Three",
        id: "save-the-cat:break-into-3",
        act: 2,
        description: "The protagonist has an epiphany or receives crucial information that provides a solution. They synthesize what they've learned from both the A Story and B Story. Armed with new understanding, they formulate a plan and commit to one final attempt. Hope returns with newfound wisdom.",
        placement: "80%",
        range: "75-85"
      },
      {
        name: "Finale",
        id: "save-the-cat:finale",
        act: 3,
        description: "The climactic confrontation where the protagonist applies everything they've learned. They must prove they've changed by using new skills, wisdom, or perspective gained through the journey. The A Story and B Story threads come together. The central question is answered, and the theme is proven.",
        placement: "80-99%",
        range: "85-100"
      },
      {
        name: "Final Image",
        id: "save-the-cat:final-image",
        act: 3,
        description: "The 'after' snapshot that mirrors and contrasts with the Opening Image. Show how the protagonist and their world have transformed. This closing image should demonstrate that real change has occurred and reflect the thematic journey. The story comes full circle.",
        placement: "99-100%",
        range: "30-50"
      }
    ]
  },
  "Hero's Journey": {
    name: "Hero's Journey",
    category: 'narrative',
    icon: 'route',
    beatCount: 12,
    beats: [
      "Ordinary World",
      "Call to Adventure",
      "Refusal of the Call",
      "Meeting the Mentor",
      "Crossing the Threshold",
      "Tests, Allies, Enemies",
      "Approach to the Inmost Cave",
      "Ordeal",
      "Reward (Seizing the Sword)",
      "The Road Back",
      "Resurrection",
      "Return with the Elixir"
    ],
    beatDetails: [
      {
        name: "Ordinary World",
        id: "hero-s-journey:ordinary-world",
        act: 1,
        description: "The hero's normal life before the adventure begins. Establish who they are, what they believe, their relationships, and their routine. Show what's lacking or incomplete in their life. This familiar world will be contrasted with the Special World they're about to enter.",
        placement: "0-10%",
        range: "0-15"
      },
      {
        name: "Call to Adventure",
        id: "hero-s-journey:call-to-adventure",
        act: 1,
        description: "The hero is presented with a problem, challenge, or adventure. Something disrupts their Ordinary World and beckons them toward the unknown. This call may come from external events or internal yearning, but it demands a response and offers the possibility of change.",
        placement: "10%",
        range: "20-30"
      },
      {
        name: "Refusal of the Call",
        id: "hero-s-journey:refusal-of-the-call",
        act: 1,
        description: "The hero hesitates or declines the adventure, usually out of fear, obligation, or insecurity. They may feel unworthy, unprepared, or unwilling to leave their comfort zone. This reluctance makes them relatable and human, building anticipation for when they finally accept.",
        placement: "10-15%",
        range: "15-25"
      },
      {
        name: "Meeting the Mentor",
        id: "hero-s-journey:meeting-the-mentor",
        act: 1,
        description: "The hero encounters someone who provides guidance, training, gifts, or confidence needed for the journey. The mentor may be a person, a memory, or even an object that inspires. This meeting gives the hero what they need to overcome their fear and commit to the adventure.",
        placement: "15-20%",
        range: "25-35"
      },
      {
        name: "Crossing the Threshold",
        id: "hero-s-journey:crossing-the-threshold",
        act: 1,
        description: "The hero leaves the Ordinary World and enters the Special World of the adventure. This is the point of no return where they commit fully to the journey. The rules change, stakes rise, and the hero must adapt to this new and unfamiliar environment.",
        placement: "20-25%",
        range: "35-45"
      },
      {
        name: "Tests, Allies, Enemies",
        id: "hero-s-journey:tests-allies-enemies",
        act: 2,
        description: "The hero faces challenges, makes friends, identifies enemies, and learns the rules of the Special World. Through trials and encounters, they develop new skills and understanding. This section establishes the landscape of Act Two and builds toward greater challenges ahead.",
        placement: "25-50%",
        range: "40-60"
      },
      {
        name: "Approach to the Inmost Cave",
        id: "hero-s-journey:approach-to-the-inmost-cave",
        act: 2,
        description: "The hero prepares for the major challenge ahead, often literally or metaphorically approaching the place of greatest danger. Plans are made, final preparations completed, and the hero steels themselves for the Ordeal. Tension builds as the supreme test draws near.",
        placement: "50-60%",
        range: "55-70"
      },
      {
        name: "Ordeal",
        id: "hero-s-journey:ordeal",
        act: 2,
        description: "The supreme test where the hero faces their greatest fear or most difficult challenge. This is a life-or-death moment (literally or symbolically) where everything hangs in the balance. The hero may appear to fail, die, or lose everything before emerging transformed.",
        placement: "60-70%",
        range: "75-90"
      },
      {
        name: "Reward (Seizing the Sword)",
        id: "hero-s-journey:reward-seizing-the-sword",
        act: 2,
        description: "Having survived the Ordeal, the hero claims their reward—knowledge, power, treasure, reconciliation, or love. They take possession of what they came for, though often it's different from what they originally sought. Success brings new understanding and confidence.",
        placement: "70-75%",
        range: "60-75"
      },
      {
        name: "The Road Back",
        id: "hero-s-journey:the-road-back",
        act: 2,
        description: "The hero begins the journey home but faces consequences or pursuit from their actions in the Special World. New complications arise, and forces may try to prevent their return. The hero must choose to complete the journey and bring their reward back to the Ordinary World.",
        placement: "75-80%",
        range: "70-80"
      },
      {
        name: "Resurrection",
        id: "hero-s-journey:resurrection",
        act: 3,
        description: "The climactic final test where the hero must use everything they've learned. This is a last purification or rebirth before returning home. The stakes are highest here—often involving life and death for more than just the hero. They must prove their transformation is complete.",
        placement: "80-95%",
        range: "85-100"
      },
      {
        name: "Return with the Elixir",
        id: "hero-s-journey:return-with-the-elixir",
        act: 3,
        description: "The hero returns to the Ordinary World transformed and bearing something (knowledge, treasure, wisdom, or experience) that benefits their community. The journey is complete, the hero has grown, and life is better than before. The story comes full circle with meaningful change.",
        placement: "95-100%",
        range: "35-55"
      }
    ]
  },
  "Classic Dramatic Structure": {
    name: "Classic Dramatic Structure",
    category: 'narrative',
    icon: 'zap',
    beatCount: 5,
    beats: [
      "Setup",
      "Complication",
      "Pressure",
      "Pivotal Choice",
      "Outcome"
    ],
    beatDetails: [
      {
        name: "Setup",
        id: "classic-dramatic-structure:setup",
        description: "Something disrupts the status quo and creates a problem that demands attention. Establishes what is at stake.",
        placement: "0-10%",
        range: "10-25"
      },
      {
        name: "Complication",
        id: "classic-dramatic-structure:complication",
        description: "Obstacles worsen the situation. Each complication raises the cost of action and narrows available options.",
        placement: "10-50%",
        range: "25-50"
      },
      {
        name: "Pressure",
        id: "classic-dramatic-structure:pressure",
        description: "Tension reaches its peak. The protagonist faces a forced choice between costly alternatives with no clean exit.",
        placement: "50-75%",
        range: "50-75"
      },
      {
        name: "Pivotal Choice",
        id: "classic-dramatic-structure:pivotal-choice",
        description: "An irreversible action answers the central question. The protagonist commits and the situation changes permanently.",
        placement: "75-90%",
        range: "75-100"
      },
      {
        name: "Outcome",
        id: "classic-dramatic-structure:outcome",
        description: "The new state after the decision. Shows cost, gain, and thematic meaning — what changed and why it matters.",
        placement: "90-100%",
        range: "50-80"
      }
    ]
  }
};

export const PLOT_SYSTEM_NAMES = Object.keys(PLOT_SYSTEMS);

/** Maps legacy system names to their current canonical names for migration. */
const LEGACY_SYSTEM_ALIASES: Record<string, string> = {
  'Story Grid': 'Classic Dramatic Structure',
};

export function getPlotSystem(name: string): PlotSystemPreset | null {
  const builtin = PLOT_SYSTEMS[name] ?? PLOT_SYSTEMS[LEGACY_SYSTEM_ALIASES[name] ?? ''];
  if (builtin) return builtin;

  // Resolve starter beat sets so all callers get a uniform PlotSystemPreset.
  const starter = STARTER_BEAT_SETS.find(s => s.name === name);
  if (!starter) return null;

  const beats = starter.beats
    .map(b => normalizeBeatNameInput(b.name, ''))
    .filter(n => n.length > 0);
  const beatDetails: PlotBeatInfo[] = starter.beats
    .map(b => ({ ...b, name: normalizeBeatNameInput(b.name, '') }))
    .filter(b => b.name.length > 0)
    .map(b => ({
      name: b.name,
      description: typeof b.purpose === 'string' ? b.purpose.trim() : '',
      range: typeof b.range === 'string' ? b.range.trim() : '',
      act: b.act,
      id: b.id,
    }));

  return { name: starter.name, category: starter.category, icon: starter.icon, beats, beatDetails, beatCount: beats.length };
}

// ─── Starter Beat Sets ────────────────────────────────────────────────
// Pre-built beat systems available in the Sets tab.
// Each includes beats, custom YAML fields, and hover metadata.

export interface StarterBeatSet {
  id: string;
  name: string;
  category: BeatLibraryCategory;
  icon: string;
  description: string;
  beats: BeatDefinition[];
  beatYamlAdvanced: string;
  beatHoverMetadataFields: { key: string; label: string; icon: string; enabled: boolean }[];
}

export const STARTER_BEAT_SETS: StarterBeatSet[] = [
  {
    id: 'starter:podcast_narrative',
    name: 'Podcast Narrative Arc',
    category: 'format',
    icon: 'mic',
    description: 'Design narrative tension for audio storytelling.\n\nThis structure is built for documentary and narrative podcast episodes where the hook must land fast and revelations unfold deliberately. Instead of focusing on character transformation alone, it tracks investigation, escalation, and emotional resonance across segments. Use this system to measure how curiosity builds, where tension peaks, and whether your final reflection lands with weight.\n\nBest for: narrative podcasts, investigative journalism, audio essays\nMomentum profile: Early spike → steady climb → late revelation → reflective close',
    beats: [
      // Act 1 — Hook & Context
      { name: 'Cold Open', act: 1, id: 'starter:podcast_narrative:cold-open', purpose: 'A vivid moment hooks curiosity and promises a payoff worth staying for.' },
      { name: 'Framing Question', act: 1, id: 'starter:podcast_narrative:framing-question', purpose: 'The episode states the core mystery or argument in human terms.' },
      { name: 'Context Setup', act: 1, id: 'starter:podcast_narrative:context-setup', purpose: 'Background arrives only as needed to make the stakes legible.' },
      { name: 'Personal Anchor', act: 1, id: 'starter:podcast_narrative:personal-anchor', purpose: 'A voice, character, or lived moment makes the story intimate and specific.' },
      // Act 2 — Investigation
      { name: 'First Lead', act: 2, id: 'starter:podcast_narrative:first-lead', purpose: 'The investigation begins with a concrete clue or first thread.' },
      { name: 'Complication', act: 2, id: 'starter:podcast_narrative:complication', purpose: 'A contradiction appears and the simple version of the story breaks.' },
      { name: 'Deep Dive', act: 2, id: 'starter:podcast_narrative:deep-dive', purpose: 'Evidence and interviews expand the world and tighten the problem.' },
      { name: 'Midpoint Revelation', act: 2, id: 'starter:podcast_narrative:midpoint-revelation', purpose: 'A key fact flips the audience\'s understanding and raises stakes.' },
      { name: 'Escalation', act: 2, id: 'starter:podcast_narrative:escalation', purpose: 'Consequences intensify; pressure builds on people and systems involved.' },
      { name: 'Major Obstacle', act: 2, id: 'starter:podcast_narrative:major-obstacle', purpose: 'Access is blocked, sources go quiet, or truth becomes harder to pin down.' },
      // Act 3 — Resolution
      { name: 'Turning Point', act: 3, id: 'starter:podcast_narrative:turning-point', purpose: 'A new approach opens the path toward resolution.' },
      { name: 'Climax Insight', act: 3, id: 'starter:podcast_narrative:climax-insight', purpose: 'The episode delivers the central explanation, discovery, or reckoning.' },
      { name: 'Consequence', act: 3, id: 'starter:podcast_narrative:consequence', purpose: 'What changes for the subjects and why it matters now.' },
      { name: 'Reflection', act: 3, id: 'starter:podcast_narrative:reflection', purpose: 'The host interprets meaning without preaching; ambiguity is handled honestly.' },
      { name: 'Closing Resonance', act: 3, id: 'starter:podcast_narrative:closing-resonance', purpose: 'A final line or image lands the emotional echo and closes the loop.' },
    ],
    beatYamlAdvanced: `Segment Type:\nEmotional Intensity:\nInformation Density:\nCliffhanger:`,
    beatHoverMetadataFields: [
      { key: 'Segment Type', label: 'Segment', icon: 'radio', enabled: true },
      { key: 'Emotional Intensity', label: 'Intensity', icon: 'activity', enabled: true },
      { key: 'Information Density', label: 'Density', icon: 'layers', enabled: false },
      { key: 'Cliffhanger', label: 'Cliffhanger', icon: 'alert-triangle', enabled: false },
    ],
  },
  {
    id: 'starter:youtube_explainer',
    name: 'YouTube Explainer Arc',
    category: 'format',
    icon: 'play-circle',
    description: 'Optimize clarity, escalation, and retention.\n\nDesigned for educational and thought-leadership content, this structure emphasizes value delivery, progressive insight, and strategic surprise. It mirrors how high-performing explainer videos sustain attention: hook hard, deepen understanding, escalate examples, then reward the viewer. Gossamer reveals where energy dips, where complexity spikes, and whether your twist earns its payoff.\n\nBest for: educational YouTube, commentary, business explainers\nMomentum profile: Hook → clarity plateau → acceleration → twist → payoff',
    beats: [
      // Act 1 — Capture Attention
      { name: 'Cold Hook', act: 1, id: 'starter:youtube_explainer:cold-hook', purpose: 'A bold claim, surprising image, or urgent question earns attention immediately.' },
      { name: 'Promise of Value', act: 1, id: 'starter:youtube_explainer:promise-of-value', purpose: 'The video states what the viewer will learn or gain by the end.' },
      { name: 'Stakes', act: 1, id: 'starter:youtube_explainer:stakes', purpose: 'The "why it matters" lands with clear consequences or payoff.' },
      // Act 2 — Build Understanding
      { name: 'Core Concept', act: 2, id: 'starter:youtube_explainer:core-concept', purpose: 'The main idea is defined simply, with one clean example.' },
      { name: 'Example', act: 2, id: 'starter:youtube_explainer:example', purpose: 'A concrete case shows the concept working in the real world.' },
      { name: 'Counterexample', act: 2, id: 'starter:youtube_explainer:counterexample', purpose: 'A failure case reveals nuance and prevents oversimplification.' },
      { name: 'Deep Insight', act: 2, id: 'starter:youtube_explainer:deep-insight', purpose: 'The hidden mechanism clicks; the viewer feels smarter.' },
      { name: 'Escalation Example', act: 2, id: 'starter:youtube_explainer:escalation-example', purpose: 'A higher-stakes application tests the idea under pressure.' },
      // Act 3 — Resolution & Reward
      { name: 'Unexpected Twist', act: 3, id: 'starter:youtube_explainer:unexpected-twist', purpose: 'A surprising constraint, tradeoff, or reversal keeps attention and reframes.' },
      { name: 'Synthesis', act: 3, id: 'starter:youtube_explainer:synthesis', purpose: 'The key points connect into one clear mental model.' },
      { name: 'Practical Takeaway', act: 3, id: 'starter:youtube_explainer:practical-takeaway', purpose: 'The viewer gets steps, rules of thumb, or actions they can use.' },
      { name: 'Call to Action', act: 3, id: 'starter:youtube_explainer:call-to-action', purpose: 'The video closes with a clean next step and a satisfying final note.' },
    ],
    beatYamlAdvanced: `Segment Type:\nAudience Value:\nEnergy Level:\nRetention Risk:`,
    beatHoverMetadataFields: [
      { key: 'Segment Type', label: 'Segment', icon: 'video', enabled: true },
      { key: 'Audience Value', label: 'Value', icon: 'lightbulb', enabled: true },
      { key: 'Energy Level', label: 'Energy', icon: 'activity', enabled: false },
      { key: 'Retention Risk', label: 'Retention', icon: 'eye', enabled: false },
    ],
  },
  {
    id: 'starter:historical_narrative',
    name: 'Documentary Narrative Arc',
    category: 'format',
    icon: 'clock',
    description: 'Shape real events into compelling narrative flow.\n\nHistorical and biographical writing often resists conventional three-act fiction models. This framework focuses on forces, pressure, crisis, and consequence — allowing you to track tension across political, cultural, or personal change. Use it to see whether escalation builds naturally and whether aftermath and legacy receive the structural weight they deserve.\n\nBest for: biography, memoir, historical nonfiction\nMomentum profile: Gradual rise → crisis compression → reflective descent',
    beats: [
      // Act 1 — Conditions
      { name: 'Historical Context', act: 1, id: 'starter:historical_narrative:historical-context', purpose: 'The era and forces are established so later choices make sense.' },
      { name: 'Character Introduction', act: 1, id: 'starter:historical_narrative:character-introduction', purpose: 'The central figure enters with desire, limitation, and social position.' },
      { name: 'Inciting Circumstance', act: 1, id: 'starter:historical_narrative:inciting-circumstance', purpose: 'A pressure point triggers change and sets the narrative in motion.' },
      { name: 'Early Friction', act: 1, id: 'starter:historical_narrative:early-friction', purpose: 'Resistance appears; the cost of action becomes visible.' },
      // Act 2 — Escalation
      { name: 'Rising Pressure', act: 2, id: 'starter:historical_narrative:rising-pressure', purpose: 'Systems tighten; events narrow the range of possible choices.' },
      { name: 'Political - Social Shift', act: 2, id: 'starter:historical_narrative:political-social-shift', purpose: 'A larger change reshapes the landscape and reframes priorities.' },
      { name: 'Midpoint Event', act: 2, id: 'starter:historical_narrative:midpoint-event', purpose: 'A defining incident alters trajectory and raises stakes.' },
      { name: 'Moral Complication', act: 2, id: 'starter:historical_narrative:moral-complication', purpose: 'Tradeoffs emerge; values collide with survival or ambition.' },
      { name: 'Crisis', act: 2, id: 'starter:historical_narrative:crisis', purpose: 'A breaking point forces irreversible action or loss.' },
      // Act 3 — Aftermath
      { name: 'Consequence', act: 3, id: 'starter:historical_narrative:consequence', purpose: 'Immediate fallout lands on individuals, institutions, and public memory.' },
      { name: 'Fallout', act: 3, id: 'starter:historical_narrative:fallout', purpose: 'Secondary effects spread; the situation stabilizes or fractures further.' },
      { name: 'Resolution', act: 3, id: 'starter:historical_narrative:resolution', purpose: 'The main arc reaches closure in outcome, not necessarily justice.' },
      { name: 'Legacy', act: 3, id: 'starter:historical_narrative:legacy', purpose: 'The long tail appears: how the event or person is absorbed into history.' },
      { name: 'Reflection', act: 3, id: 'starter:historical_narrative:reflection', purpose: 'The narrative ends with meaning, context, and a final frame.' },
    ],
    beatYamlAdvanced: `Historical Force:\nPrimary Actor:\nConflict Type:\nTension Level:\nDocumented Source:`,
    beatHoverMetadataFields: [
      { key: 'Historical Force', label: 'Force', icon: 'landmark', enabled: true },
      { key: 'Primary Actor', label: 'Actor', icon: 'user', enabled: true },
      { key: 'Conflict Type', label: 'Conflict', icon: 'swords', enabled: true },
      { key: 'Tension Level', label: 'Tension', icon: 'activity', enabled: false },
      { key: 'Documented Source', label: 'Source', icon: 'book-open', enabled: false },
    ],
  },
  {
    id: 'starter:romance_tropes',
    name: 'Romance Tropes Ladder',
    category: 'engine',
    icon: 'heart',
    description: 'Track emotional escalation with precision.\n\nRomance thrives on rhythm — attraction, complication, rupture, reunion. This system is built around emotional beats rather than plot mechanics, allowing you to measure chemistry, conflict, and payoff across the relationship arc. Gossamer highlights emotional valleys and surges, revealing whether the breakup lands hard enough and whether the reunion feels earned.\n\nBest for: contemporary romance, rom-com, genre romance\nMomentum profile: Emotional rise → rupture → valley → surge → commitment',
    beats: [
      // Act 1 — Attraction
      { name: 'Meet Cute', act: 1, id: 'starter:romance_tropes:meet-cute', purpose: 'The leads collide in a memorable way that sets the tone and hints at the core incompatibility or spark.' },
      { name: 'Spark', act: 1, id: 'starter:romance_tropes:spark', purpose: 'Attraction shows up through a small moment of vulnerability, humor, or competence that makes the connection real.' },
      { name: 'Growing Interest', act: 1, id: 'starter:romance_tropes:growing-interest', purpose: 'The leads choose proximity; the relationship shifts from accidental to intentional.' },
      // Act 2 — Complication
      { name: 'First Obstacle', act: 2, id: 'starter:romance_tropes:first-obstacle', purpose: 'A person, belief, or circumstance blocks progress and forces the leads to reveal what they fear.' },
      { name: 'Deepening Bond', act: 2, id: 'starter:romance_tropes:deepening-bond', purpose: 'Shared time creates intimacy; the leads start trusting each other with something that matters.' },
      { name: 'Midpoint Commitment', act: 2, id: 'starter:romance_tropes:midpoint-commitment', purpose: 'The relationship crosses a line (emotional or physical) that raises the stakes and makes retreat costly.' },
      { name: 'External Threat', act: 2, id: 'starter:romance_tropes:external-threat', purpose: 'Outside pressure challenges the bond and exposes conflicting needs or loyalties.' },
      { name: 'Breakup - Betrayal', act: 2, id: 'starter:romance_tropes:breakup-betrayal', purpose: 'A rupture happens; trust breaks, and the leads believe the relationship cannot survive.' },
      // Act 3 — Reunion
      { name: 'Self-Realization', act: 3, id: 'starter:romance_tropes:self-realization', purpose: 'At least one lead names the real problem and owns their part in the breakup.' },
      { name: 'Grand Gesture', act: 3, id: 'starter:romance_tropes:grand-gesture', purpose: 'A decisive action proves change and communicates value, not just desire.' },
      { name: 'Emotional Reunion', act: 3, id: 'starter:romance_tropes:emotional-reunion', purpose: 'The leads choose each other with clear terms; the relationship becomes mutual.' },
      { name: 'Commitment', act: 3, id: 'starter:romance_tropes:commitment', purpose: 'The story lands on a stable promise: a public choice, a plan, or a shared future.' },
    ],
    beatYamlAdvanced: `Relationship Stage:\nEmotional Intensity:\nChemistry Level:\nConflict Source:`,
    beatHoverMetadataFields: [
      { key: 'Relationship Stage', label: 'Stage', icon: 'heart', enabled: true },
      { key: 'Emotional Intensity', label: 'Intensity', icon: 'activity', enabled: true },
      { key: 'Chemistry Level', label: 'Chemistry', icon: 'flame', enabled: false },
      { key: 'Conflict Source', label: 'Conflict', icon: 'shield', enabled: false },
    ],
  },
  {
    id: 'starter:thriller_escalation',
    name: 'Thriller Escalation Ladder',
    category: 'engine',
    icon: 'trending-up',
    description: 'Engineer sustained tension and explosive payoff.\n\nThrillers demand relentless escalation. This structure focuses on threat signals, rising stakes, false victories, and catastrophic setbacks, ensuring momentum compounds rather than plateaus. Use it to visualize where danger intensifies, where stakes peak too early, or where the final confrontation needs more compression.\n\nBest for: thriller, suspense, action, crime\nMomentum profile: Steady escalation → compressed second half → explosive climax',
    beats: [
      // Act 1 — Threat Emerges
      { name: 'Ordinary World', act: 1, id: 'starter:thriller_escalation:ordinary-world', purpose: 'Normal life establishes what can be lost and what the protagonist avoids facing.' },
      { name: 'Threat Signal', act: 1, id: 'starter:thriller_escalation:threat-signal', purpose: 'A small anomaly signals danger and forces the protagonist to pay attention.' },
      { name: 'Denial', act: 1, id: 'starter:thriller_escalation:denial', purpose: 'The protagonist rationalizes the threat, delaying action and raising the eventual cost.' },
      { name: 'First Attack', act: 1, id: 'starter:thriller_escalation:first-attack', purpose: 'The threat turns real; safety is breached and the rules of the world change.' },
      // Act 2 — Escalation
      { name: 'Pursuit', act: 2, id: 'starter:thriller_escalation:pursuit', purpose: 'The protagonist investigates or runs; the threat responds and pressure increases.' },
      { name: 'Revelation', act: 2, id: 'starter:thriller_escalation:revelation', purpose: 'A key truth reframes what is happening and points to a more dangerous enemy or system.' },
      { name: 'Midpoint Disaster', act: 2, id: 'starter:thriller_escalation:midpoint-disaster', purpose: 'A major loss or failure removes a safety net and forces a new strategy.' },
      { name: 'Increased Stakes', act: 2, id: 'starter:thriller_escalation:increased-stakes', purpose: 'The threat expands; more people, places, or values become vulnerable.' },
      { name: 'False Victory', act: 2, id: 'starter:thriller_escalation:false-victory', purpose: 'The protagonist wins a battle and believes they are ahead, briefly.' },
      { name: 'Catastrophic Setback', act: 2, id: 'starter:thriller_escalation:catastrophic-setback', purpose: 'The threat counters hard; the protagonist\'s plan collapses and consequences hit.' },
      // Act 3 — Confrontation
      { name: 'Final Pursuit', act: 3, id: 'starter:thriller_escalation:final-pursuit', purpose: 'The protagonist commits to a last push with no clean exit.' },
      { name: 'Showdown', act: 3, id: 'starter:thriller_escalation:showdown', purpose: 'Confrontation resolves the central threat through sacrifice, ingenuity, or exposed truth.' },
      { name: 'Aftermath', act: 3, id: 'starter:thriller_escalation:aftermath', purpose: 'The new status quo lands; the cost is visible and the final echo lingers.' },
    ],
    beatYamlAdvanced: `Threat Level:\nDanger Type:\nStakes Escalation:\nCasualties:`,
    beatHoverMetadataFields: [
      { key: 'Threat Level', label: 'Threat', icon: 'alert-triangle', enabled: true },
      { key: 'Danger Type', label: 'Danger', icon: 'zap', enabled: true },
      { key: 'Stakes Escalation', label: 'Stakes', icon: 'trending-up', enabled: false },
      { key: 'Casualties', label: 'Casualties', icon: 'skull', enabled: false },
    ],
  },
];

// ─── Deprecated aliases (remove after v5.2) ─────────────────────────

/** @deprecated Use PlotSystemPreset */
export type PlotSystemTemplate = PlotSystemPreset;
