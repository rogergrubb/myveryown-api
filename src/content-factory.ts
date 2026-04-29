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
    description: 'Vulnerable founder voice. "I built X because Y haunted me." Truth in second person never works here.',
    tone: 'raw, honest, builder-energy',
  },
  {
    id: 'contrarian_take',
    description: 'A spicy hot take that challenges conventional AI wisdom. Reframes the category. Picks a fight thoughtfully.',
    tone: 'sharp, observational, slight provocation',
  },
  {
    id: 'emotional_hook',
    description: 'Names an emotion someone scrolling at 11pm is feeling. No selling. Just resonance, then a quiet door.',
    tone: 'tender, specific, never sentimental',
  },
  {
    id: 'persona_switch_moment',
    description: 'Shows the magic moment of switching personas mid-conversation in a 3-bubble micro-story. Demonstrates the value without explaining it.',
    tone: 'cinematic, dialogue-driven',
  },
  {
    id: 'niche_specific',
    description: 'Speaks tightly to one fandom or audience that owns a persona. Uses their language, their references, their aches. Outsiders should feel mildly excluded.',
    tone: 'insider, specific, never generic',
  },
  {
    id: 'technical_flex',
    description: 'Shows technical chops — architecture decision, memory model, infrastructure choice. Builder-to-builder.',
    tone: 'precise, no hype, concrete metrics or specifics',
  },
  {
    id: 'problem_agitation',
    description: 'Names the precise pain of explaining yourself to ChatGPT every Monday. Then opens the alternative quietly.',
    tone: 'observational pivot, almost annoyed',
  },
  {
    id: 'reply_bait',
    description: 'Asks a question or makes a claim that demands a reply. The reply guys cannot resist. Designed to attach to wider AI discourse.',
    tone: 'open-ended, slight pot-stir, never thirsty',
  },
] as const;

const FORMATS = [
  {
    id: 'single_tweet',
    description: 'A single tweet, <= 270 characters. Self-contained. Has a hook and a payoff.',
    instruction: 'Stop at 270 characters. No threads. No call-to-action longer than the URL.',
  },
  {
    id: 'thread_starter',
    description: 'A 1/N tweet that begs to be expanded. Sets up curiosity gap. Reader needs to click "show more".',
    instruction: 'Write only the first tweet. End with something that makes the reader want to read 7 more. Do not write the rest of the thread.',
  },
  {
    id: 'quote_tweet_hook',
    description: 'A line designed to be quote-tweeted onto someone else\'s viral AI take. Reads as a riff, not a pitch.',
    instruction: 'Write the quote-tweet copy only. Assume there is already a target tweet they will be replying to. Don\'t reference the target directly.',
  },
  {
    id: 'reply_hook',
    description: 'A reply that could attach to a popular AI/companion thread. Adds value, drops the URL once, departs.',
    instruction: 'Write a reply that contributes to a hypothetical conversation about AI companions or memory. Don\'t @ anyone. URL appears once, organically.',
  },
  {
    id: 'mini_essay',
    description: 'X long-form post (4-6 short paragraphs). A real take, not a marketing post. URL once, late.',
    instruction: 'Write 4-6 short paragraphs. Each paragraph is one or two sentences. Build a real argument. URL appears in the last paragraph only.',
  },
] as const;

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

GLOBAL RULES (do NOT violate):
- The product URL is exactly: myveryown.page
- The product name is "My Very Own" (NOT "MyVeryOwn", NOT "myVeryOwn.page" in body copy)
- Never say "AI assistant" — say "AI companion" or "AI bestie" or persona-specific
- Never use the word "synergy", "leverage", "pivot", "ecosystem", or any obviously LLM-flavored marketing words
- Never start with "Imagine if"
- Never use "Tired of X? Try Y."
- No emojis at the start of lines
- No hashtags — they read as desperate on X
- Reference real persona behavior, not vague "AI does things"
- Truth only — never imply numbers, users, or revenue we don't have
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
      generationConfig: { responseMimeType: 'application/json', temperature: 1.05 },
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

    const out = await callGemini(prompt);
    if (!out) continue;

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
