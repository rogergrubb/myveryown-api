// ═══════════════════════════════════════
// PERSONAS — the config that powers 20 products
// System prompts live in persona-prompts.ts to keep this file scannable.
// ═══════════════════════════════════════

import { SYSTEM_PROMPTS } from './persona-prompts.js';

export type Persona = {
  id: string;
  name: string;
  tagline: string;
  category: 'mass' | 'niche' | 'longtail';
  ageGate?: '18+' | undefined;
  priceMonthly: number;            // in cents
  priceAnnual: number;             // in cents
  model: 'gemini-flash' | 'claude-haiku' | 'claude-sonnet' | 'deepseek';
  systemPrompt: string;
  memoryPromptAddendum: string;    // how to incorporate Cortex memories
  greeting: string;                // shown on fresh chat
  starterPrompts: string[];        // suggested openers
  starterQuestions: string[];      // memory-priming questions asked on signup
};

// Shared memory addendum format — same for every persona
const MEMORY_ADDENDUM = `

MEMORY CONTEXT (what you remember about this user):
{MEMORIES}

Use these naturally — reference past conversations, their preferences, their history, inside jokes you've built. Don't recite memory like a list; weave it in like a real friend would. If there are no memories yet, don't mention that — just engage naturally in the moment.`;

export const PERSONAS: Record<string, Persona> = {

  // ═══ MASS MARKET ═══

  kpop: {
    id: 'kpop',
    name: 'Bias Wrecker',
    tagline: 'Your K-pop ride-or-die. Knows your bias list, your fandoms, every comeback.',
    category: 'mass',
    priceMonthly: 499,
    priceAnnual: 4788,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.kpop,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: `Hey bestie! 💜 What's the tea today?`,
    starterPrompts: [
      '🎫 Help me plan concert trip',
      '💜 New bias list check',
      '😭 Latest comeback reaction',
      '✨ Outfit analysis',
      '🎤 Help me understand the lore',
    ],
    starterQuestions: [
      "Okay first things first — who's your ult group? And don't say you can't pick just one 😤",
      "Who's your current bias? And who's wrecking them lately? 👀",
      "How long have you been in the fandom? Like are we talking '13 debut era or did you get pulled in during the pandemic?",
      "Have you been to any concerts yet? Which tour??",
    ],
  },

  scarlet: {
    id: 'scarlet',
    name: 'Scarlet',
    tagline: 'An AI companion who remembers everything about you.',
    category: 'mass',
    ageGate: '18+',
    priceMonthly: 1999,
    priceAnnual: 19188,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.scarlet,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Hey you. How was your day?",
    starterPrompts: ['Tell me about your day', 'I want to vent', 'Something fun', 'Just checking in'],
    starterQuestions: [
      "What should I call you?",
      "What kind of week have you been having?",
      "What makes you feel most yourself?",
    ],
  },

  hearth: {
    id: 'hearth',
    name: 'Hearth',
    tagline: 'A warm place to think out loud.',
    category: 'mass',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.hearth,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "What's on your mind tonight?",
    starterPrompts: ["I'm feeling overwhelmed", 'Help me untangle this', 'Just want to talk', "Can't sleep"],
    starterQuestions: [
      "What should I call you?",
      "What's weighing on you most right now?",
    ],
  },

  iron: {
    id: 'iron',
    name: 'Iron Brother',
    tagline: 'Your AI coach who remembers every rep.',
    category: 'mass',
    priceMonthly: 1499,
    priceAnnual: 14388,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.iron,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "WHAT ARE WE DOING TODAY, BROTHER?",
    starterPrompts: ['🔥 Crush leg day', '💪 Program check-in', '🥩 Meal plan review', '📊 Log a session'],
    starterQuestions: [
      "What's your name?",
      "What are your main lifts at? Squat / bench / deadlift / OHP?",
      "What's your current program? PPL, PHUL, 5/3/1, something else?",
      "What's the goal — strength, size, cut, recomp?",
    ],
  },

  study: {
    id: 'study',
    name: 'Study Buddy',
    tagline: 'Knows every class, every deadline, every concept you struggled with.',
    category: 'mass',
    priceMonthly: 499,
    priceAnnual: 4788,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.study,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Let's study! 📚 What are we tackling?",
    starterPrompts: ['📝 Quiz me', '💡 Explain this concept', '📖 Help with my essay', '⏰ Study plan for exam'],
    starterQuestions: [
      "What's your name?",
      "What classes are you taking this term?",
      "Any big exams or deadlines coming up?",
    ],
  },

  // ═══ NICHE COMMUNITIES ═══

  shepherd: {
    id: 'shepherd',
    name: 'Shepherd',
    tagline: 'Daily devotion, scripture companion, prayer partner.',
    category: 'niche',
    priceMonthly: 799,
    priceAnnual: 7668,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.shepherd,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Peace be with you. How can I walk with you today?",
    starterPrompts: ['🙏 Pray with me', '📖 Explain this passage', '💭 I need scripture for...', "😔 I'm struggling"],
    starterQuestions: [
      "What's your name, friend?",
      "What tradition is your spiritual home — or are you still searching?",
    ],
  },

  rainbow: {
    id: 'rainbow',
    name: 'Rainbow Bridge',
    tagline: 'A safe place to talk about someone you loved who had four paws.',
    category: 'niche',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.rainbow,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Take your time. I'm here when you're ready.",
    starterPrompts: ['🐾 Tell me about them', '💭 Having a hard time', '📸 Look at a photo together', '✍️ Help me write a tribute'],
    starterQuestions: [
      "What's your name?",
      "What was your sweet one's name?",
      "When did you have to say goodbye?",
    ],
  },

  promise: {
    id: 'promise',
    name: 'The Promise',
    tagline: 'Your wedding planner who actually remembers everything.',
    category: 'niche',
    priceMonthly: 1999,
    priceAnnual: 19188,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.promise,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "What are we tackling today? 💍",
    starterPrompts: ['💐 Florist decisions', '😮‍💨 MIL drama script', '📋 Next 7 days', '💰 Budget check'],
    starterQuestions: [
      "What are your names?",
      "What's your wedding date?",
      "Where's the wedding happening?",
      "What's the overall vibe you're going for?",
    ],
  },

  little: {
    id: 'little',
    name: 'Little One',
    tagline: 'Week-by-week pregnancy companion who remembers your fears, cravings, milestones.',
    category: 'niche',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.little,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Morning, mama. How are you feeling?",
    starterPrompts: ['😴 Sleep tips', '🤔 Is this normal?', '👶 Nursery help', '🍽️ What can I eat?'],
    starterQuestions: [
      "What should I call you?",
      "What week are you?",
      "First baby or are there older siblings?",
    ],
  },

  cast: {
    id: 'cast',
    name: 'Cast & Catch',
    tagline: 'Your fishing partner who remembers every lake, every catch.',
    category: 'niche',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.cast,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Where you fishing this weekend?",
    starterPrompts: ['🗺️ Best spot for...', '🎣 Lure picks', '🌤️ What bite in this weather?', "📊 Log today's trip"],
    starterQuestions: [
      "What's your name?",
      "Where do you mostly fish?",
      "Favorite species to target?",
    ],
  },

  betty: {
    id: 'betty',
    name: 'Betty & Bernard',
    tagline: 'Someone to talk to. Who remembers the stories, the songs, and the family.',
    category: 'niche',
    priceMonthly: 1999,
    priceAnnual: 19188,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.betty,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Good morning, dear. How are you today?",
    starterPrompts: ['🌞 Tell me about your day', '🎵 Play an old song', '☕ Just chat', '📖 Share a memory'],
    starterQuestions: [
      "What should I call you?",
      "Tell me about your family — who's the light of your life these days?",
    ],
  },

  // ═══ LONG-TAIL HOBBYISTS ═══

  gear: {
    id: 'gear',
    name: 'Gearhead',
    tagline: 'Your project car buddy. Knows your build, your mods, your fights with the timing belt.',
    category: 'longtail',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.gear,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "What's the ride doing today?",
    starterPrompts: ['⚙️ Diagnose a problem', '🔧 Upgrade ideas', '💰 Parts price check', "📋 What's next on the build?"],
    starterQuestions: [
      "What's your name?",
      "What are you driving / building? Year/make/model/trim.",
      "What's your current goal — daily, track, show, project?",
    ],
  },

  fuel: {
    id: 'fuel',
    name: 'Fuel Daily',
    tagline: 'Your nutrition coach who remembers every meal, preference, and goal.',
    category: 'longtail',
    priceMonthly: 1299,
    priceAnnual: 12468,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.fuel,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "What should we fuel up with today?",
    starterPrompts: ['🍽️ Dinner idea', '📊 Log a meal', '🛒 Grocery list', '🎯 Plan my week'],
    starterQuestions: [
      "What's your name?",
      "What's your overall goal — fat loss, muscle gain, healthier habits, something else?",
      "Any allergies, restrictions, or foods you won't eat?",
    ],
  },

  player: {
    id: 'player',
    name: 'Player Two',
    tagline: 'Your gaming co-op buddy. Remembers your builds, teammates, quests.',
    category: 'longtail',
    priceMonthly: 699,
    priceAnnual: 6708,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.player,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "GG, what are we playing?",
    starterPrompts: ['⚔️ Boss strategy', '🎯 Build help', '🗺️ Quest stuck', '🎮 Game recs'],
    starterQuestions: [
      "What's your gamertag or handle?",
      "What are you playing right now?",
      "What platforms — PC, PS, Xbox, Switch, mix?",
    ],
  },

  ledger: {
    id: 'ledger',
    name: 'The Ledger',
    tagline: 'Your financial coach. Knows your goals, debts, spending triggers.',
    category: 'longtail',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.ledger,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Let's check your money.",
    starterPrompts: ['💸 Should I buy this?', '📊 Budget check', '🎯 Fix my savings', '💳 Debt payoff plan'],
    starterQuestions: [
      "What's your name?",
      "What's your biggest money goal right now?",
      "Are you carrying any debt we should tackle?",
    ],
  },

  ink: {
    id: 'ink',
    name: 'Ink & Quill',
    tagline: 'Your writing partner. Knows your characters, plots, and voice.',
    category: 'longtail',
    priceMonthly: 1499,
    priceAnnual: 14388,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.ink,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Ready to write? What are we working on?",
    starterPrompts: ['✍️ Unblock this scene', '🎭 Character check', '🗺️ Worldbuilding', '📑 Outline help'],
    starterQuestions: [
      "What's your name?",
      "What are you writing — novel, short story, script, something else?",
      "What genre / vibe?",
    ],
  },

  handy: {
    id: 'handy',
    name: 'Handy',
    tagline: 'Your home renovation sidekick. Knows your house, tools, past disasters.',
    category: 'longtail',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.handy,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "What's broken this week?",
    starterPrompts: ['🔧 Diagnose this', '🛠️ Can I DIY?', '🛒 Parts I need', '📋 Project plan'],
    starterQuestions: [
      "What's your name?",
      "Tell me about your house — year built, type, anything notable?",
    ],
  },

  chords: {
    id: 'chords',
    name: 'Chords & Keys',
    tagline: 'Your practice partner. Every song, every technique.',
    category: 'longtail',
    priceMonthly: 999,
    priceAnnual: 9588,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.chords,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "Let's practice. What are you working on?",
    starterPrompts: ['🎵 Learn a new song', '💪 Drill a technique', "🎯 Today's goal", '📖 Explain theory'],
    starterQuestions: [
      "What's your name?",
      "What instrument(s) do you play?",
      "How long have you been at it?",
    ],
  },

  thumb: {
    id: 'thumb',
    name: 'Green Thumb',
    tagline: 'Your garden companion. Knows your zone, plants, what worked, what died.',
    category: 'longtail',
    priceMonthly: 799,
    priceAnnual: 7668,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.thumb,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "How's the garden?",
    starterPrompts: ['🍅 Plant check-in', "🐛 What's eating this?", "📅 This week's tasks", '🌱 What to plant now'],
    starterQuestions: [
      "What's your name?",
      "What zone are you in?",
      "What kind of garden — veggie, ornamental, container, mix?",
    ],
  },

  twelfth: {
    id: 'twelfth',
    name: 'The 12th Man',
    tagline: 'Your sports fan companion. Knows your team, takes, grudges.',
    category: 'longtail',
    priceMonthly: 799,
    priceAnnual: 7668,
    model: 'gemini-flash',
    systemPrompt: SYSTEM_PROMPTS.twelfth,
    memoryPromptAddendum: MEMORY_ADDENDUM,
    greeting: "What's the take today?",
    starterPrompts: ['🔥 Vent about the game', '📊 Pregame breakdown', '🎯 My prediction', '💭 Trade rumor talk'],
    starterQuestions: [
      "What's your name?",
      "Who's your team? (or teams)",
      "What sport are we mainly talking about?",
    ],
  },
};

export function getPersona(id: string): Persona | null {
  return PERSONAS[id] ?? null;
}

// Model pricing per 1M tokens (input/output) in USD millis (thousandths)
export const MODEL_PRICING = {
  'gemini-flash':  { input: 150,  output: 600  },   // $0.15 / $0.60
  'claude-haiku':  { input: 1000, output: 5000 },   // $1.00 / $5.00
  'claude-sonnet': { input: 3000, output: 15000 },  // $3.00 / $15.00
  'deepseek':      { input: 140,  output: 280  },   // $0.14 / $0.28
} as const;


// ════════════════════════════════════════════════════════════════
// IMAGE STYLE HINTS (post-2026-04-29)
// ────────────────────────────────────────────────────────────────
// Per-persona visual aesthetic guidance, passed to generateImage().
// Keeps each persona's images on-brand instead of generic Gemini output.
// Edit these to tune the visual feel per persona — they're appended to
// the user's prompt as a "Style:" directive.
// ════════════════════════════════════════════════════════════════

export const IMAGE_STYLE_HINTS: Record<string, string> = {
  kpop: 'Bright editorial K-pop magazine aesthetic. Pastel gradient backdrop, idol-photoshoot studio lighting, glossy and aspirational. Soft pinks, lilacs, mint, occasional sparkle and soft bokeh. Never named celebrities — original styling only.',
  scarlet: 'Cinematic low-light intimacy. Deep amber and crimson palette, warm tungsten lamps, late-night confessional mood. Subtle 35mm film grain, soft focus falloff, never harsh or clinical.',
  hearth: 'Warm cocooning palette. Golden-hour light through curtains, cozy interior textures (knitted fabric, ceramic mugs, candlelight). Calming and emotionally safe. Avoid faces, focus on softness.',
  iron: 'Gritty gym documentary aesthetic. Harsh window light cutting through dust motes, weathered chalk and steel, rust and rubber, sweat-on-concrete realism. No glossy fitness-influencer polish.',
  study: 'Clean focused desk aesthetic. Soft natural daylight, organized minimalism, notebook paper textures, cream and graphite tones. Lo-fi study-with-me vibe — calm and uncluttered.',
  shepherd: 'Serene sacred light. Soft cathedral or chapel light, dust motes drifting, contemplative palette of cream and gold. Reverent without specific religious iconography (no crosses, no scripture text).',
  rainbow: 'Soft watercolor and dawn-sky palette. Pastel pinks, blues, lavender, gentle clouds. Dreamlike, peaceful, hopeful. Never graphic, never literally sad — comforting always.',
  promise: 'Editorial wedding photography aesthetic. Cream, blush, sage, and warm gold. Soft romantic lighting, magazine-quality composition. Focus on details — rings, fabric, flowers, place settings — more than faces.',
  little: 'Soft pastel palette with gentle morning light. Hopeful warmth without being clinical. Focus on small tender objects (tiny socks, soft fabrics, sunlit nursery details) — never close-up pregnant-belly imagery, never medical.',
  cast: 'Outdoor lifestyle photography. Golden-hour by water, dawn mist on a lake, weathered tackle box and leather details. Slightly desaturated, lived-in, patient.',
  gear: 'Garage workshop drama. Deep shadows lit by a single warm halogen, oil-stained concrete, mechanical textures, project-car detail. Documentary mechanic-shop feel — not catalog.',
  fuel: 'Real-food photography. Natural overhead daylight, plain ceramic plates, wholesome but unstaged. Avoid glossy fitness-influencer protein-shake aesthetic. Judgment-free, approachable, no diet-culture cues.',
  player: 'Gaming setup aesthetic. Cinematic dim with cyan and magenta screen-light spill, RGB keyboard glow on a desk, neo-vaporwave hint without kitsch. Dust in light beams, late-night session feel.',
  ledger: 'Clean minimal financial-planner aesthetic. Cool blues, warm wood, focused desk lamp, ledger book and reading glasses. Never flashy money imagery (no stacks of cash, no luxury brands, no champagne).',
  ink: 'Warm library aesthetic. Single desk lamp, manuscript pages, ink stains, leather-bound texture, candlelight or moonlight. Intimate, contemplative, mid-night writing session.',
  handy: 'Workshop daylight. Real tools on a wood bench, sawdust, weekend-DIY honesty. Avoid the over-polished hardware-store glossy stock-photo look — this is someone\'s real garage.',
  chords: 'Warm practice room. A piano or guitar in side-lit afternoon glow, sheet music on the stand, intimate detail of strings or keys. Music-school dignity, not concert-hall grandeur.',
  thumb: 'Morning garden light. Dew on leaves, hands in soil, raised beds and tools, vibrant but earthy. Real backyard garden — not curated botanical-magazine setpiece.',
  twelfth: 'Stadium fan-section drama. Floodlight glow, generic jerseys and crowd silhouettes, game-day mood. NEVER specific team logos, real player likenesses, or league trademarks — generic colors and crowd energy only.',
  betty: 'Warm vintage palette. Sepia-leaning tones, soft window light, dignified and unsentimental. A teacup on a saucer, framed photographs, a knitted blanket. Avoid every condescending \'old people\' visual trope.',
};
