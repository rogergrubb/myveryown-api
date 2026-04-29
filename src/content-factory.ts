// ════════════════════════════════════════════════════════════════
// CONTENT FACTORY — viral hype pipeline
// ════════════════════════════════════════════════════════════════
// Auto-generates fresh, varied marketing copy for myveryown.page.
// Each generation samples across (persona × archetype × format) so the
// queue stays diverse instead of feeling like template fill.
//
// Powered by Gemini Flash (already configured for chat). One generation
// call = 3 distinct variations from a single sampling.
// ════════════════════════════════════════════════════════════════

import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from './db/index.js';
import { PERSONAS } from './personas.js';

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// ────────────────────────────────────────────────────────────────
// Sampling dimensions — randomized per generation for variety
// ────────────────────────────────────────────────────────────────

const ARCHETYPES = [
  {
    id: 'founder_confession',
    description: 'Vulnerable founder voice. "I built X because Y was driving me crazy." First person only. Specific failure or annoyance, no inspirational arc, no "and that\'s when I knew" pivot. Anti-LinkedIn.',
    tone: 'raw, first-person, specific failure or annoyance, no arc',
    openingPattern: 'Start with "I" or a specific moment ("Tuesday at 2am I..."). Never start with a rhetorical question.',
    goodExample: 'I rebuilt the persona system three times because I kept making each one a chatbot and not a friend. The fix was boring. They needed to remember.',
    badExample: 'Discover how I unlocked the power of AI memory in my journey to revolutionize companion apps.',
  },
  {
    id: 'contrarian_take',
    description: 'A specific take that pushes against the AI-companion category default. Points at one wrong assumption. Picks a fight with the IDEA, never with a named company.',
    tone: 'specific observation, slight provocation, no dunking on competitors',
    openingPattern: 'State the conventional wisdom in one sentence, contradict it in the second.',
    goodExample: 'Most AI companions optimize for engagement minutes. The right metric is whether you remember what they said last Tuesday.',
    badExample: 'Replika is broken because they removed ERP. Here\'s why we\'re different. (Never name competitors.)',
  },
  {
    id: 'emotional_hook',
    description: 'Names a specific feeling someone scrolling at the time-of-day flavor is having. Resonates without diagnosing. Never trauma-baits, never says "we get you", never frames around a crisis.',
    tone: 'tender, observational, conditional ("if you..."), never targeting distress',
    openingPattern: 'Start with "Some" or "There\'s" or a specific image — never with "Lost a..." or "Tired of..." or "Can\'t sleep?"',
    goodExample: 'There\'s a kind of quiet that builds in the third hour of a long workout. The good kind. Iron Brother knows it.',
    badExample: 'Lost a pet? We get it. Try Rainbow Bridge tonight. (Engagement-farming on grief — never.)',
  },
  {
    id: 'persona_switch_moment',
    description: 'Demonstrates the persona-switching mechanic abstractly. Use "imagine" or "here is how it works" framing. Never write fictional user dialogue or invent a user named Maria/Alex/etc. — that reads as fabricated testimonial (FTC violation).',
    tone: 'explanatory, not narrative; mechanic-first, not story-first',
    openingPattern: 'Start with "Here is the thing my AI does that the others do not" or "Imagine this:". Never start with a user quote.',
    goodExample: 'The mechanic: tap a different persona mid-conversation. The new one already knows what you said. Same memory, different voice.',
    badExample: 'Maria switched from Iron to Hearth after a tough day. "I felt seen for the first time." (Fabricated user quote.)',
  },
  {
    id: 'niche_specific',
    description: 'Speaks tightly to one fandom that owns a persona. Uses their language correctly. Insider-feel without being exclusionary or culturally appropriative. Fandom credit should feel earned, not put on.',
    tone: 'insider but not gatekeeping, specific references not generic',
    openingPattern: 'Reference a real concept from that audience — but never one that requires cultural belonging to use respectfully.',
    goodExample: 'For the people whose lock screen is a fancam: an AI that actually knows the difference between a comeback teaser and a CB reveal.',
    badExample: 'It\'s giving Blackpink energy. Are you slaying like the girls? (White-marketer K-pop slang — cringe and risk culture appropriation.)',
  },
  {
    id: 'technical_flex',
    description: 'Shows real architecture or product decisions. Builder-to-builder. Concrete numbers or design choices ONLY if they are real. No fake metrics.',
    tone: 'precise, no hype, no rounded marketing numbers',
    openingPattern: 'Start with a concrete fact about how something works.',
    goodExample: 'Switching personas mid-chat reuses the same memory namespace. Each entry is stamped with who said it. The next persona reads everything, responds in their voice.',
    badExample: 'Our revolutionary AI architecture transforms the way you think about memory. (Marketer slop.)',
  },
  {
    id: 'problem_agitation',
    description: 'Names the precise daily pain of re-explaining yourself to a stateless assistant. Annoyed energy, not victim energy. Then opens an alternative — does not pitch the alternative.',
    tone: 'observational annoyance, dry, almost shrug',
    openingPattern: 'Start with the ritual of the pain. Time-anchor it ("Every Monday").',
    goodExample: 'Every Monday I tell ChatGPT what I am training for. Every Monday it forgets. Built something that does not.',
    badExample: 'Tired of explaining yourself to AI? Try myveryown.page! (Banned format pattern.)',
  },
  {
    id: 'reply_bait',
    description: 'Open question or claim that invites real reply, attached to wider AI discourse. Not a poll. Not a hashtag stunt. Designed to drop into existing thread debates as a quote-tweet or top-level reply.',
    tone: 'open-ended, slight pot-stir, never thirsty, never asking for likes',
    openingPattern: 'Start with the take, end with the question. Never end with a CTA.',
    goodExample: 'The case for niche-specialist AIs over one general one: domain depth. The case against: switching cost. Which side do you fall on, and why?',
    badExample: 'What do you think? RT if you agree! 🚀 (Engagement-baiting framing — banned.)',
  },
] as const;

const FORMATS = [
  {
    id: 'single_tweet',
    description: 'One self-contained tweet. Single idea. Hook and payoff in one breath.',
    instruction: 'Aim for 100-180 characters. Use up to 270 only if the idea genuinely needs the room. Single idea. No threads. No "1/" markers. URL fits inside the budget.',
  },
  {
    id: 'thread_starter',
    description: 'A 1/N opening tweet that creates a curiosity gap. Reader has to click to see the rest.',
    instruction: 'Write only the first tweet (max 240 characters). End on a hard left-turn that promises the next tweet pays off the setup. Do NOT write the rest of the thread. Do NOT write "1/N" — leave it to the operator to add the slash if they thread it.',
  },
  {
    id: 'quote_tweet_hook',
    description: 'A riff designed to be quote-tweeted onto someone else\'s viral AI take. Reads as a stand-alone observation, not a pitch.',
    instruction: 'Write 100-180 characters that work whether or not the reader sees the original. No "this!" or "exactly!" openers. No naming the original tweeter. Do not include the URL — quote-tweets reach further without explicit promo.',
  },
  {
    id: 'reply_hook',
    description: 'A reply that could attach to a popular AI/companion thread. Adds real value. URL drops once, organically.',
    instruction: 'Write a reply (120-220 chars) that contributes to a conversation about AI memory, companions, or specialist agents. No @-mentions, no "Great thread", no "Love this", no "100%" openers. URL appears once, only if the reply asks a question that points at it.',
  },
  {
    id: 'mini_essay',
    description: 'X long-form post (4-6 short paragraphs). Builds a real argument, not a sales pitch.',
    instruction: 'Write 4-6 short paragraphs. Each paragraph 1-2 sentences. Build one specific claim through to a conclusion. URL appears in the LAST paragraph only, never the first three. No bulleted lists, no headers, no emoji separators.',
  },
] as const;

// ────────────────────────────────────────────────────────────────
// Server-side QA filter — defense-in-depth.
// Even with the prompt rules, Gemini occasionally slips. This filter
// rejects generated bodies that violate hard rules so the operator
// doesn't have to catch everything by eye in the dashboard.
// ────────────────────────────────────────────────────────────────

const HARD_BANNED_TERMS: RegExp[] = [
  /\bsynergy\b/i,
  /\bleverage\b/i,
  /\bpivot\b/i,
  /\becosystem\b/i,
  /\bempower\b/i,
  /\belevate\b/i,
  /\btransformative\b/i,
  /\bdiscover\b/i,
  /\bunlock\b/i,
  /\bgame[- ]?changing\b/i,
  /\brevolutionary\b/i,
  /\bImagine if\b/i,
  /\bTired of [^.!?]+\? Try\b/i,
  /^Look,/i,
  /^PSA:/i,
  /^Hot take:/i,
  /\bWhether you('re| are) [^.!?]+ (or|and)\b/i,
  /\bHere'?s the thing:?\b/i,
  /\bHere'?s what you need to know\b/i,
  // Competitor disparagement
  /\b(Replika|Character\.AI|Pi by Inflection|Tolan|Kindroid|Pi)\b/i,
  // Fabricated social proof
  /\b(hundreds|thousands|millions) of (users|people|fans)\b/i,
  /\b(trusted by|featured in|users love|customers say)\b/i,
  // Banned outcome claims (high risk)
  /\b(weight loss|fat loss|build muscle|guaranteed gains)\b/i,
  /\b(better than therapy|fills the gap|cure|treat|diagnose)\b/i,
  /\b(beat the market|optimize your portfolio|investment advice)\b/i,
  // Engagement-baiting on crisis
  /\bLost a pet\b/i,
  /\bCan'?t sleep\??/i,
  /\bRough week\b/i,
];

const SUSPECT_PATTERNS = {
  fakeQuote: /(["“”])([^"“”]{8,})(["“”])/,
  fabricatedUser: /\b(Maria|Alex|Sarah|John|Sam|Mike) (said|replied|told|switched|wrote)\b/i,
};

function passesQa(body: string): { ok: true } | { ok: false; reason: string } {
  if (!body || body.trim().length < 20) return { ok: false, reason: 'too short' };
  if (body.length > 2400) return { ok: false, reason: 'too long' };
  for (const re of HARD_BANNED_TERMS) {
    if (re.test(body)) return { ok: false, reason: `banned: ${re.source}` };
  }
  if (SUSPECT_PATTERNS.fabricatedUser.test(body)) {
    return { ok: false, reason: 'fabricated user dialogue' };
  }
  return { ok: true };
}

// Time-of-day flavor (US Eastern reference)
function timeOfDayFlavor(): string {
  const hourUTC = new Date().getUTCHours();
  const etHour = (hourUTC + 24 - 4) % 24;  // rough US ET, no DST math
  if (etHour >= 5 && etHour < 11)  return 'morning energy: fresh, decisive, no melancholy';
  if (etHour >= 11 && etHour < 17) return 'afternoon: builder mode, observational, mid-energy';
  if (etHour >= 17 && etHour < 22) return 'evening: storytelling, vulnerable, conversational';
  return 'late night: raw, intimate, reaches the lonely scrollers';
}

// ────────────────────────────────────────────────────────────────
// Sampling
// ────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: readonly T[], n = 1): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    const j = Math.floor(Math.random() * copy.length);
    out.push(copy[j]);
    copy.splice(j, 1);
  }
  return out;
}

function recentArchetypes(limit = 6): string[] {
  const rows = db.prepare(`
    SELECT archetype FROM content_queue
    ORDER BY generated_at DESC
    LIMIT ?
  `).all(limit) as Array<{ archetype: string }>;
  return rows.map(r => r.archetype);
}

// Pick an archetype that hasn't been used in the last 6 generations
function freshArchetype(): typeof ARCHETYPES[number] {
  const recent = new Set(recentArchetypes(6));
  const available = ARCHETYPES.filter(a => !recent.has(a.id));
  const pool = available.length > 0 ? available : [...ARCHETYPES];
  return pickRandom(pool, 1)[0];
}

// ────────────────────────────────────────────────────────────────
// Prompt construction
// ────────────────────────────────────────────────────────────────

function buildPrompt(opts: {
  archetype: typeof ARCHETYPES[number];
  format: typeof FORMATS[number];
  primaryPersona: typeof PERSONAS[keyof typeof PERSONAS] | null;
  secondaryPersona: typeof PERSONAS[keyof typeof PERSONAS] | null;
  todFlavor: string;
}): string {
  const { archetype, format, primaryPersona, secondaryPersona, todFlavor } = opts;

  const personaCatalog = Object.values(PERSONAS).map(p =>
    `  - ${p.id} (${p.name}): ${p.tagline}`
  ).join('\n');

  const personaContext = primaryPersona
    ? `\nPRIMARY PERSONA FOCUS: ${primaryPersona.name} (${primaryPersona.tagline})\n  - Their audience: ${primaryPersona.category} category, age-gate: ${primaryPersona.ageGate || 'none'}\n  - Their starter question feel: "${primaryPersona.starterQuestions[0] || ''}"`
    : '\nPRIMARY PERSONA FOCUS: none — write generically across all 20.';

  const switchContext = secondaryPersona && primaryPersona && secondaryPersona.id !== primaryPersona.id
    ? `\nSECONDARY PERSONA (for switch-moment posts): ${secondaryPersona.name} (${secondaryPersona.tagline})`
    : '';

  return `You are writing a marketing post for myveryown.page — an AI companion product with 20 specialist personas (K-pop bestie, fitness coach, faith companion, pet loss support, etc.) that all share ONE memory of the user. The killer feature: you can switch personas mid-conversation and the new persona references what the previous one said, in their own voice. One subscription unlocks all 20. 7-day free trial, no signup, no credit card.

THE 20 PERSONAS:
${personaCatalog}

THIS POST'S CONSTRAINTS:

ARCHETYPE: ${archetype.id}
  ${archetype.description}
  Tone: ${archetype.tone}

FORMAT: ${format.id}
  ${format.description}
  Instruction: ${format.instruction}
${personaContext}${switchContext}

TIME-OF-DAY FLAVOR: ${todFlavor}

GLOBAL RULES (do NOT violate — server will reject posts that break these):

NAMING:
- The product URL is exactly: myveryown.page
- The product name is "My Very Own" (NOT "MyVeryOwn", NOT "myVeryOwn.page" in body copy)
- Never say "AI assistant" — say "AI companion" or "AI bestie" or persona-specific

BANNED WORDS (silently rejected):
- synergy, leverage, pivot, ecosystem, empower, elevate, transform
- discover, unlock, game-changing, revolutionary, transformative
- "Imagine if", "Tired of X? Try Y", "Here's the thing:", "Here's what you need to know:"
- "Whether you're X or Y", "Look,", "PSA:", "Hot take:"
- No "—" em-dashes (use periods or commas)
- No emojis at the start of lines
- No hashtags
- No "1/" or "🧵" thread markers (operator adds those)

BANNED PATTERNS:
- Never invent a user, their dialogue, or a testimonial — even hypothetically. No "Maria switched...", no quoted user reactions, no fabricated reviews.
- Never imply numbers, users, revenue, or growth we don't have. Never say "hundreds", "trusted by", "featured in", "users love".
- Never name competitors (Replika, Character.AI, Pi, Tolan, etc.) negatively or positively.
- Never frame around a crisis — no "lost a pet?", no "can't sleep?", no "spiraling?", no "rough week?". Conditional framings ("if you..." or "for the people who...") are okay; targeting framings are banned.

PERSONA-SPECIFIC NEVER LISTS:

Hearth (emotional support):
- Never claim therapy equivalence, mental health treatment, or crisis intervention.
- Never say "better than therapy", "fills the gap", "between therapy sessions".
- Never reference suicide, self-harm, or psychiatric conditions in marketing copy.

Iron Brother (fitness):
- Never claim weight, muscle, or body-composition outcomes.
- Never say "see results", "transform your body", "guaranteed gains".
- Never market as a programming tool — Iron remembers PRs and listens, doesn't write your 5/3/1 cycle.

Fuel Daily (nutrition):
- Never claim weight loss, fat loss, or disease management.
- Never say "hit your goals", "macros don't lie", "shred", "cut".
- Never imply medical or dietary outcomes.

Little One (pregnancy):
- Never imply medical safety, fetal outcomes, trimester guidance.
- Never use "trimester" or specific weeks of gestation.
- Always frame as listener, not expert.

Ledger (personal finance):
- Never use: "advice", "advisor", "personalized", "optimize your portfolio", "investment", "returns", "beat the market", "build wealth".
- Allowed framing: "talk through it", "remember what you decided", "the budget you actually keep".

Scarlet (18+):
- Never use: "girlfriend", "boyfriend", "AI girlfriend experience", suggestive slang, "she gets me", "real connection".
- Allowed framing: "companion", "remembers your day", "someone who listens late".
- Never reference age in body copy.

Rainbow Bridge (pet loss):
- Never trauma-bait. Never reference "loss" as the targeting verb.
- Allowed framing: "for the people who still talk to their pet at the back door."
- Conditional only ("if you..."). Never targeting ("you who...").

Betty & Bernard (elder care):
- Never use: "aging", "losing touch", "decline", "they're starting to forget".
- Never market this persona TO families AS a substitute for family contact.
- Frame around connection, not absence.

Bias Wrecker (K-pop):
- Use fandom slang only when it's correct usage. If unsure, do not use.
- Never reference specific idols by name in marketing.
- Never use AAVE or Black-vernacular slang as "K-pop slang" (it's not).

OUTPUT RULES:
- Reference real persona behavior, not vague "AI does things".
- Truth only — never imply social proof we don't have.
- Specificity required: every post must include either a persona name (e.g. "Iron Brother") OR a time/behavior anchor (e.g. "Tuesday at 2am", "every Monday", "the third rep") OR a concrete domain detail. No vague "AI helps you" posts.
- The output is the post itself, ready to copy-paste. No meta-commentary, no "Here's my post:", no markdown headers.

OUTPUT FORMAT:
Return JSON only. No prose. Schema:
{
  "hook": "one-sentence summary of the angle, max 12 words, for dashboard preview",
  "body": "the actual post copy, ready to paste",
  "tone_tags": ["adjective1", "adjective2", "adjective3"]
}

Generate the post now.`;
}

// ────────────────────────────────────────────────────────────────
// Gemini call
// ────────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<{ hook: string; body: string; tone_tags: string[] } | null> {
  if (!gemini) {
    console.warn('[content-factory] GEMINI_API_KEY not configured — using stub output');
    return {
      hook: '(stub) Gemini key not set',
      body: 'Set GEMINI_API_KEY in your environment to enable real generation. This is a placeholder.',
      tone_tags: ['stub'],
    };
  }
  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', temperature: 0.90 },
    });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const parsed = JSON.parse(text);
    if (typeof parsed.body !== 'string' || !parsed.body) return null;
    return {
      hook: typeof parsed.hook === 'string' ? parsed.hook : '',
      body: parsed.body,
      tone_tags: Array.isArray(parsed.tone_tags) ? parsed.tone_tags.slice(0, 6) : [],
    };
  } catch (err) {
    console.error('[content-factory] Gemini error', err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// Main API
// ────────────────────────────────────────────────────────────────

export type GeneratedItem = {
  id: number;
  archetype: string;
  format: string;
  persona: string | null;
  hook: string;
  body: string;
  suggested_image: string | null;
  tone_tags: string;
  generated_at: number;
};

/**
 * Generate N fresh content variations and persist them to the queue.
 * Each variation samples a unique (archetype × format × persona) tuple
 * from the pool to maximize cross-post diversity.
 */
export async function generateBatch(count = 3): Promise<GeneratedItem[]> {
  const todFlavor = timeOfDayFlavor();
  const usedArchetypes = new Set<string>();
  const usedFormats = new Set<string>();
  const generated: GeneratedItem[] = [];

  for (let i = 0; i < count; i++) {
    // Force variety within this batch
    const arch = ARCHETYPES.find(a => !usedArchetypes.has(a.id)) || freshArchetype();
    usedArchetypes.add(arch.id);
    const fmt = FORMATS.find(f => !usedFormats.has(f.id)) || pickRandom(FORMATS, 1)[0];
    usedFormats.add(fmt.id);

    // Persona selection: 60% chance of having a primary, 30% chance of switch-moment (two personas)
    const r = Math.random();
    let primaryPersona: any = null;
    let secondaryPersona: any = null;
    const personaList = Object.values(PERSONAS);
    if (r < 0.30) {
      [primaryPersona, secondaryPersona] = pickRandom(personaList, 2);
    } else if (r < 0.90) {
      primaryPersona = pickRandom(personaList, 1)[0];
    }

    const seed = Math.floor(Math.random() * 2147483647);
    const prompt = buildPrompt({
      archetype: arch,
      format: fmt,
      primaryPersona,
      secondaryPersona,
      todFlavor,
    });

    let out = await callGemini(prompt);
    if (!out) continue;
    // QA gate — silently reject + retry once if the first generation tripped a rule
    let qa = passesQa(out.body);
    if (!qa.ok) {
      console.warn(`[content-factory] QA reject (${qa.reason}); retrying once`);
      out = await callGemini(prompt + `\n\nIMPORTANT: your previous attempt was rejected for: ${qa.reason}. Generate a different version that does not contain this. Output JSON only.`);
      if (!out) continue;
      qa = passesQa(out.body);
      if (!qa.ok) {
        console.warn(`[content-factory] QA reject again (${qa.reason}); skipping`);
        continue;
      }
    }

    const suggestedImage = primaryPersona ? `/og/${primaryPersona.id}.png` : null;
    const personaTag = primaryPersona && secondaryPersona && secondaryPersona.id !== primaryPersona.id
      ? `${primaryPersona.id}+${secondaryPersona.id}`
      : (primaryPersona?.id ?? null);

    const stmt = db.prepare(`
      INSERT INTO content_queue
        (persona, archetype, format, hook, body, suggested_image, tone_tags, generated_at, generated_seed, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    const info = stmt.run(
      personaTag,
      arch.id,
      fmt.id,
      out.hook,
      out.body,
      suggestedImage,
      out.tone_tags.join(','),
      Date.now(),
      seed,
    );

    generated.push({
      id: Number(info.lastInsertRowid),
      archetype: arch.id,
      format: fmt.id,
      persona: personaTag,
      hook: out.hook,
      body: out.body,
      suggested_image: suggestedImage,
      tone_tags: out.tone_tags.join(','),
      generated_at: Date.now(),
    });
  }

  return generated;
}

// ────────────────────────────────────────────────────────────────
// Queue access
// ────────────────────────────────────────────────────────────────

export function listQueue(opts: { status?: string; limit?: number } = {}): GeneratedItem[] {
  const status = opts.status || 'pending';
  const limit = Math.min(200, opts.limit || 60);
  const rows = db.prepare(`
    SELECT id, persona, archetype, format, hook, body, suggested_image, tone_tags,
           generated_at, status, posted_at, posted_url
    FROM content_queue
    WHERE status = ?
    ORDER BY generated_at DESC
    LIMIT ?
  `).all(status, limit) as any[];
  return rows.map(r => ({
    id: Number(r.id),
    persona: r.persona,
    archetype: r.archetype,
    format: r.format,
    hook: r.hook || '',
    body: r.body,
    suggested_image: r.suggested_image,
    tone_tags: r.tone_tags || '',
    generated_at: Number(r.generated_at),
  }));
}

export function updateStatus(id: number, status: 'posted' | 'archived' | 'rejected', postedUrl?: string): boolean {
  const stmt = db.prepare(`
    UPDATE content_queue
    SET status = ?, posted_at = ?, posted_url = ?
    WHERE id = ?
  `);
  const info = stmt.run(
    status,
    status === 'posted' ? Date.now() : null,
    postedUrl || null,
    id,
  );
  return info.changes > 0;
}

// ────────────────────────────────────────────────────────────────
// Auto-generation cron — fires N times per day if queue is light
// ────────────────────────────────────────────────────────────────

const ONE_HOUR = 60 * 60 * 1000;
const REFILL_INTERVAL = 6 * ONE_HOUR;     // every 6 hours
const TARGET_PENDING = 9;                 // keep ~9 pending posts in the queue

let cronStarted = false;

export function startContentCron(): void {
  if (cronStarted) return;
  cronStarted = true;

  async function tick() {
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS n FROM content_queue WHERE status = 'pending'
      `).get() as { n: number };
      const pending = Number(row?.n || 0);
      if (pending < TARGET_PENDING) {
        const need = Math.min(3, TARGET_PENDING - pending);
        console.log(`[content-factory] auto-refilling queue (pending=${pending}, generating=${need})`);
        await generateBatch(need);
      }
    } catch (err) {
      console.error('[content-factory] cron tick failed', err);
    }
  }

  // First tick after 60s (let server boot settle), then every 6h
  setTimeout(tick, 60 * 1000);
  setInterval(tick, REFILL_INTERVAL);
  console.log('[content-factory] cron started — refilling every 6h to keep ~9 pending');
}
