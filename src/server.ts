import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import { db, initSchema, Session } from './db/index.js';
import { getPersona, PERSONAS, IMAGE_STYLE_HINTS } from './personas.js';
import { streamChat, generateImage, ChatMessage } from './llm.js';
import { nsKey, recordMemory, recallMemories, formatMemoriesForPrompt, migrateNamespace } from './memory.js';
import { logVisit, getDashboardStats } from './tracking.js';
import { generateBatch, listQueue, updateStatus, startContentCron } from './content-factory.js';
import { runStartupChecks } from './startup-checks.js';
import {
  scheduleItem, unscheduleItem, autoScheduleNext, startScheduler,
} from './scheduler.js';
import { isConfigured as twitterConfigured, postTweet } from './twitter.js';
import {
  signSession, verifySession, sendMagicLink, consumeMagicToken,
  verifyGoogleIdToken, verifyAppleIdToken, findOrCreateUser,
} from './auth.js';
import { createCheckoutSession, handleStripeWebhook, hasActiveSubscription, isStripeConfigured } from './billing.js';

runStartupChecks();
initSchema();
startContentCron();
startScheduler();

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ─── Middleware ───
// CORS — allow production domain + Vercel previews + localhost dev
const corsAllowlist = [
  'https://myveryown.page',
  'https://www.myveryown.page',
  'http://localhost:5173',     // Vite dev server
  'http://localhost:4173',     // Vite preview
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without origin (curl, server-to-server, mobile apps)
    if (!origin) return callback(null, true);
    // Allowlisted exact match
    if (corsAllowlist.includes(origin)) return callback(null, true);
    // Any Vercel preview for this project (vercel.app domain)
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return callback(null, true);
    // Reject others
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

// Stripe webhook needs raw body — must come BEFORE express.json()
app.post('/api/subscribe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    await handleStripeWebhook(req.body, sig);
    res.json({ received: true });
  } catch (err: any) {
    console.error('[webhook] error', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.use(express.json({ limit: '1mb' }));

// Global rate limit
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
}));

// Stricter limit for chat
const chatLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => (req.headers['x-session-id'] as string) || req.ip || '',
});

// ═══════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    stripe: isStripeConfigured(),
    gemini: !!process.env.GEMINI_API_KEY,
    cortex: !!process.env.CORTEX_URL,
  });
});

app.get('/api/personas', (_req, res) => {
  // Return public persona info (no system prompts)
  const publicPersonas = Object.values(PERSONAS).map(p => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    category: p.category,
    ageGate: p.ageGate,
    priceMonthly: p.priceMonthly,
    priceAnnual: p.priceAnnual,
    starterQuestions: p.starterQuestions,
  }));
  res.json({ personas: publicPersonas });
});

// ═══════════════════════════════════════
// VISIT TRACKING (anonymous logging for /dashboard)
// ═══════════════════════════════════════

// Public ingest — every page mount POSTs here. Trust client metadata
// minimally; the IP, geo, and UA come from request headers (server-side).
app.post('/api/track/visit', (req, res) => {
  const body = req.body || {};
  const s = (v: any, max = 96): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
  logVisit(req, {
    path: s(body.path, 256),
    persona: s(body.persona, 32),
    sessionId: s(body.sessionId, 64),
    referrer: s(body.referrer, 512),
    utm_source: s(body.utm_source, 64),
    utm_medium: s(body.utm_medium, 64),
    utm_campaign: s(body.utm_campaign, 96),
    utm_content: s(body.utm_content, 96),
    utm_term: s(body.utm_term, 96),
    campaign_slug: s(body.campaign_slug, 64),
  });
  res.status(204).end();
});

// ═══════════════════════════════════════
// OUTREACH CAMPAIGNS — CRUD for the dashboard
// ═══════════════════════════════════════

app.get('/api/campaigns', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const status = (req.query.status as string) || undefined;
    const rows = status
      ? db.prepare(`SELECT * FROM outreach_campaigns WHERE status = ? ORDER BY launched_at DESC, created_at DESC`).all(status)
      : db.prepare(`SELECT * FROM outreach_campaigns ORDER BY launched_at DESC, created_at DESC`).all();
    res.json({ items: rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

app.post('/api/campaigns', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const b = req.body || {};
    if (!b.slug || !b.label || !b.channel) {
      return res.status(400).json({ error: 'slug, label, channel required' });
    }
    const now = Date.now();
    db.prepare(`
      INSERT INTO outreach_campaigns
        (slug, label, channel, persona, utm_source, utm_medium, utm_campaign, url, notes, status, launched_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        label = excluded.label,
        channel = excluded.channel,
        persona = excluded.persona,
        utm_source = excluded.utm_source,
        utm_medium = excluded.utm_medium,
        utm_campaign = excluded.utm_campaign,
        url = excluded.url,
        notes = excluded.notes,
        status = excluded.status,
        launched_at = excluded.launched_at,
        updated_at = excluded.updated_at
    `).run(
      b.slug,
      b.label,
      b.channel,
      b.persona || null,
      b.utm_source || null,
      b.utm_medium || null,
      b.utm_campaign || null,
      b.url || null,
      b.notes || null,
      b.status || 'planned',
      b.status === 'live' ? (b.launched_at || now) : (b.launched_at || null),
      now,
      now,
    );
    res.json({ ok: true, slug: b.slug });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

app.delete('/api/campaigns/:slug', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    db.prepare(`DELETE FROM outreach_campaigns WHERE slug = ?`).run(req.params.slug);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

// Password-gated dashboard stats. Password is read from
// DASHBOARD_PASS env var; falls back to '999999999' if unset for
// dev convenience (rotate before launch). Client sends it via
// `x-dashboard-pass` header. Same protection level as the frontend
// gate — good enough for a stats-only view.
app.get('/api/dashboard/stats', (req, res) => {
  const expected = process.env.DASHBOARD_PASS || '999999999';
  const provided = req.headers['x-dashboard-pass'] as string | undefined;
  if (provided !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const stats = getDashboardStats();
    res.json(stats);
  } catch (err: any) {
    console.error('[dashboard] stats error', err);
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

// ═══════════════════════════════════════
// CONTENT FACTORY — viral hype pipeline
// ═══════════════════════════════════════
// Same password gate as the dashboard. The dashboard shows the queue,
// triggers fresh generations, and lets the operator mark items as posted.

function dashboardAuth(req: any, res: any): boolean {
  const expected = process.env.DASHBOARD_PASS || '999999999';
  const provided = req.headers['x-dashboard-pass'] as string | undefined;
  if (provided !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

app.get('/api/content/queue', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const status = (req.query.status as string) || 'pending';
    const limit = Number(req.query.limit) || 60;
    res.json({ items: listQueue({ status, limit }) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

app.post('/api/content/generate', async (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const count = Math.min(8, Math.max(1, Number(req.body?.count) || 3));
    const items = await generateBatch(count);
    res.json({ items, generated: items.length });
  } catch (err: any) {
    console.error('[content/generate] error', err);
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

app.put('/api/content/:id/status', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const id = Number(req.params.id);
    const status = req.body?.status as string;
    if (!['posted', 'archived', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be posted, archived, or rejected' });
    }
    const postedUrl = typeof req.body?.posted_url === 'string' ? req.body.posted_url : undefined;
    const ok = updateStatus(id, status as any, postedUrl);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

// ─── Scheduling ───
app.post('/api/content/:id/schedule', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const id = Number(req.params.id);
    const when = Number(req.body?.scheduled_for);
    if (!Number.isFinite(when) || when < Date.now()) {
      return res.status(400).json({ error: 'scheduled_for must be a future timestamp (ms)' });
    }
    const ok = scheduleItem(id, when);
    if (!ok) return res.status(404).json({ error: 'not found or wrong status' });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.post('/api/content/:id/unschedule', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const id = Number(req.params.id);
    const ok = unscheduleItem(id);
    if (!ok) return res.status(404).json({ error: 'not found or not scheduled' });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.post('/api/content/auto-schedule', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const count = Math.min(20, Math.max(1, Number(req.body?.count) || 6));
    const result = autoScheduleNext(count);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.post('/api/content/:id/post-now', async (req, res) => {
  if (!dashboardAuth(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!twitterConfigured()) {
      return res.status(503).json({ error: 'X API not configured — set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET' });
    }
    const item = (await import('./db/index.js')).db.prepare(`SELECT id, body, status FROM content_queue WHERE id = ?`).get(id) as any;
    if (!item) return res.status(404).json({ error: 'not found' });
    if (item.status === 'posted') return res.status(400).json({ error: 'already posted' });
    const result = await postTweet(item.body);
    if (!result.ok) return res.status(502).json({ error: result.error || 'post failed' });
    (await import('./db/index.js')).db.prepare(`
      UPDATE content_queue
      SET status = 'posted', posted_at = ?, posted_url = ?, posted_tweet_id = ?, auto_posted = 1
      WHERE id = ?
    `).run(Date.now(), result.url, result.tweet_id, id);
    res.json({ ok: true, tweet_id: result.tweet_id, url: result.url });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

// ─── Scheduler config visibility ───
app.get('/api/content/scheduler-status', (req, res) => {
  if (!dashboardAuth(req, res)) return;
  res.json({
    twitter_configured: twitterConfigured(),
    auto_posting: twitterConfigured(),
    setup_url: 'https://developer.x.com/',
    required_env: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'],
  });
});

// ════════════════════════════════════
// SESSIONS — anonymous 7-day free trials
//
// Users land, pick a persona, type their name, and get 7 days of
// unrestricted access before hitting a paywall. The theory is that
// someone needs roughly a week of interactions to form a genuine
// attachment to an AI companion — this is the "fall in love" window.
// ═══════════════════════════════════════
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

app.post('/api/session', (req, res) => {
  const { name, persona, ageVerified } = req.body || {};
  const personaObj = persona ? getPersona(persona) : null;
  if (!persona || !personaObj) {
    return res.status(400).json({ error: 'Invalid persona' });
  }
  // Age-gate enforcement — server-side. Frontend modal posts ageVerified=true
  // ONLY after the user attests they're 18+ (or completes a stronger flow).
  // Server requires the flag for any persona with an ageGate, regardless of
  // what the client sends back from the cookie/localStorage.
  if (personaObj.ageGate && !ageVerified) {
    return res.status(403).json({
      error: 'AGE_GATE_REQUIRED',
      message: `${personaObj.name} requires age verification before chat begins.`,
      ageGate: personaObj.ageGate,
    });
  }
  const id = `session_${nanoid(20)}`;
  const now = Date.now();
  const expires = now + TRIAL_DURATION_MS;
  db.prepare(`
    INSERT INTO sessions (id, name, persona, created_at, expires_at, message_count)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, name || null, persona, now, expires);
  res.json({ sessionId: id, expiresAt: expires, persona, name });
});

app.get('/api/session/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Session | undefined;
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({
    sessionId: s.id,
    name: s.name,
    persona: s.persona,
    messageCount: s.message_count,
    expiresAt: s.expires_at,
    expired: s.expires_at < Date.now(),
    userId: s.user_id,
  });
});

// ═══════════════════════════════════════
// AUTH
// ═══════════════════════════════════════
app.post('/api/auth/magic-link', async (req, res) => {
  const { email, sessionId } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  try {
    await sendMagicLink(email, sessionId);
    res.json({ ok: true, message: 'Check your inbox' });
  } catch (err) {
    console.error('[magic] send error', err);
    res.status(500).json({ error: 'Could not send magic link' });
  }
});

app.post('/api/auth/magic-link/verify', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token required' });
  const consumed = consumeMagicToken(token);
  if (!consumed) return res.status(400).json({ error: 'Invalid or expired token' });

  const user = findOrCreateUser({
    email: consumed.email,
    authProvider: 'magic',
    sessionId: consumed.sessionId || undefined,
  });

  // Migrate memory namespace if session had one
  if (consumed.sessionId) {
    const session = db.prepare('SELECT persona FROM sessions WHERE id = ?').get(consumed.sessionId) as { persona: string } | undefined;
    if (session) {
      await migrateNamespace(nsKey(session.persona, consumed.sessionId), nsKey(session.persona, user.id));
    }
  }

  const token_ = signSession(user.id, user.email);
  res.json({ token: token_, user: { id: user.id, email: user.email, displayName: user.display_name } });
});

app.post('/api/auth/google', async (req, res) => {
  const { idToken, sessionId } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  const verified = await verifyGoogleIdToken(idToken);
  if (!verified) return res.status(401).json({ error: 'Invalid Google token' });

  const user = findOrCreateUser({
    email: verified.email,
    authProvider: 'google',
    authProviderId: verified.sub,
    displayName: verified.name,
    sessionId,
  });

  if (sessionId) {
    const session = db.prepare('SELECT persona FROM sessions WHERE id = ?').get(sessionId) as { persona: string } | undefined;
    if (session) {
      await migrateNamespace(nsKey(session.persona, sessionId), nsKey(session.persona, user.id));
    }
  }

  const token = signSession(user.id, user.email);
  res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
});

app.post('/api/auth/apple', async (req, res) => {
  const { idToken, sessionId } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  const verified = await verifyAppleIdToken(idToken);
  if (!verified) return res.status(401).json({ error: 'Invalid Apple token' });

  const user = findOrCreateUser({
    email: verified.email,
    authProvider: 'apple',
    authProviderId: verified.sub,
    sessionId,
  });
  if (sessionId) {
    const session = db.prepare('SELECT persona FROM sessions WHERE id = ?').get(sessionId) as { persona: string } | undefined;
    if (session) {
      await migrateNamespace(nsKey(session.persona, sessionId), nsKey(session.persona, user.id));
    }
  }

  const token = signSession(user.id, user.email);
  res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
});

app.get('/api/auth/me', (req, res) => {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return res.status(401).json({ error: 'Not signed in' });
  const payload = verifySession(auth);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  const user = db.prepare('SELECT id, email, display_name as displayName FROM users WHERE id = ?').get(payload.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
});

// ═══════════════════════════════════════
// CHAT — streaming
// ═══════════════════════════════════════
app.post('/api/chat', chatLimit, async (req, res) => {
  // ─────────────────────────────────────────────────────────────
  // SHARED-THREAD ARCHITECTURE (post-2026-04-26)
  //
  // /api/chat takes ONE conversation (the messages[] array) and a
  // persona-of-the-moment (req.body.persona). The persona is the voice
  // that answers THIS turn. The session has a "default persona" stored
  // (mostly historical — the first one the user picked) but the request
  // overrides it. Memory is recorded into a single namespace per
  // session/user, with each entry stamped by which persona spoke.
  // ─────────────────────────────────────────────────────────────
  const { sessionId, messages, persona: bodyPersona, thread_mode: bodyThreadMode } = req.body || {};
  const threadMode: 'isolated' | 'shared' = bodyThreadMode === 'shared' ? 'shared' : 'isolated';
  if (!sessionId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'sessionId and messages required' });
  }

  // Load session
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Session | undefined;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Resolve which persona is responding to THIS turn.
  // Body persona wins; falls back to whatever was stored on the session.
  const personaId: string = (typeof bodyPersona === 'string' && getPersona(bodyPersona))
    ? bodyPersona
    : session.persona;
  const persona = getPersona(personaId);
  if (!persona) return res.status(400).json({ error: 'Invalid persona' });

  // Check expiration + subscription
  // Subscription unlock is now ANY active sub on the user (one sub = all 20).
  const now = Date.now();
  const isAuthed = !!session.user_id;
  const isSubscribed = isAuthed && hasActiveSubscription(session.user_id!, personaId);

  if (!isAuthed && session.expires_at < now) {
    return res.status(402).json({ error: 'Session expired', code: 'SESSION_EXPIRED', requiresAuth: true });
  }
  if (isAuthed && !isSubscribed) {
    // Authenticated but no subscription — soft paywall at 10 messages
    if (session.message_count >= 10) {
      return res.status(402).json({ error: 'Trial limit reached', code: 'NEEDS_SUBSCRIPTION', persona: personaId });
    }
  }

  // Get user name and latest message
  const latestUser = messages[messages.length - 1] as ChatMessage | undefined;
  if (!latestUser || latestUser.role !== 'user' || !latestUser.content) {
    return res.status(400).json({ error: 'Last message must be user message' });
  }

  // Memory namespace depends on thread mode.
  // - isolated (default): per-persona namespace ("kpop:user_abc"), so Scarlet's
  //   late-night thread doesn't bleed into Iron Brother's workout context.
  // - shared (opt-in): single namespace per user/session ("user_abc"), every
  //   persona reads + writes the same memory pool, with [PersonaName] stamps.
  // First-load fallback: if isolated is empty, also peek at the unified namespace
  // so users who built memory under the old shared model don't lose continuity.
  const userOrSessionId = session.user_id || session.id;
  const isolatedNs = nsKey(personaId, userOrSessionId);
  const sharedNs = nsKey(userOrSessionId);
  const namespace = threadMode === 'shared' ? sharedNs : isolatedNs;
  let memories = await recallMemories(namespace, latestUser.content, 5);
  if (threadMode === 'isolated' && memories.length === 0) {
    // Lazy fallback to legacy shared namespace so existing users see their history
    // for this persona until they build up new isolated memory.
    try {
      const legacy = await recallMemories(sharedNs, latestUser.content, 5);
      const personaTag = `[${persona.name}]`;
      memories = legacy.filter(m => m.content.startsWith(personaTag));
    } catch { /* swallow */ }
  }
  const memoryBlock = formatMemoriesForPrompt(memories);

  // Build the system prompt with memory + user name + cross-persona awareness
  let systemPrompt = persona.systemPrompt;
  if (session.name) systemPrompt += `\n\nThe user's name is ${session.name}. Use it naturally, but don't overuse it.`;
  // In shared-mind mode the memory may include entries from OTHER personas.
  // Tell the active persona how to handle that gracefully. In isolated mode
  // (default), the persona only sees its own thread, so no cross-persona
  // disclaimer needed — keeps the system prompt focused.
  if (threadMode === 'shared') {
    systemPrompt += `\n\nIMPORTANT: This user has ONE shared conversation thread that spans all 20 of our personas. The MEMORY CONTEXT below may include moments where a DIFFERENT persona spoke (entries are stamped with [PersonaName] at the top). You are now ${persona.name} responding. Reference what other personas covered when natural — like real friends comparing notes — but always stay in YOUR voice and YOUR domain. Don't pretend to be the other persona. If something is clearly outside your wheelhouse and another persona handled it well, you can naturally acknowledge that ("sounds like you and Iron Brother already covered the lifting side — for the food side, here's what I'd say...").`;
  }
  systemPrompt += persona.memoryPromptAddendum.replace('{MEMORIES}', memoryBlock);

  // Stream the response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const { stream, usage } = await streamChat({
      model: persona.model,
      systemPrompt,
      messages: messages as ChatMessage[],
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    }

    // Increment message count
    db.prepare('UPDATE sessions SET message_count = message_count + 1 WHERE id = ?').run(sessionId);

    // Record memory + usage (fire and forget)
    const usageData = await usage;
    db.prepare(`
      INSERT INTO usage (session_or_user_id, persona, model, input_tokens, output_tokens, cost_usd_millis, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.user_id || sessionId,
      personaId,                              // log THIS turn's persona (not session default)
      usageData.model,
      usageData.inputTokens,
      usageData.outputTokens,
      usageData.costMillis,
      Date.now()
    );

    // Memory entry tagged with the responding persona so future recalls
    // can reason about which persona said what across the shared thread.
    recordMemory(namespace, latestUser.content, fullResponse, persona.name)
      .catch(err => console.error('[memory] record failed', err));

    res.write(`data: ${JSON.stringify({ type: 'done', usage: usageData, messageCount: session.message_count + 1 })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('[chat] stream error', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Stream failed' })}\n\n`);
    res.end();
  }
});

app.post('/api/image/generate', chatLimit, async (req, res) => {
  const { sessionId, persona: bodyPersona, prompt } = req.body || {};
  if (!sessionId || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'sessionId and prompt required' });
  }
  if (prompt.length > 1000) {
    return res.status(400).json({ error: 'prompt too long (max 1000 chars)' });
  }

  // Same session/auth/limit gate as /api/chat
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Session | undefined;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const personaId: string = (typeof bodyPersona === 'string' && getPersona(bodyPersona))
    ? bodyPersona
    : session.persona;
  const persona = getPersona(personaId);
  if (!persona) return res.status(400).json({ error: 'Invalid persona' });

  const now = Date.now();
  const isAuthed = !!session.user_id;
  const isSubscribed = isAuthed && hasActiveSubscription(session.user_id!, personaId);
  if (!isAuthed && session.expires_at < now) {
    return res.status(402).json({ error: 'Session expired', code: 'SESSION_EXPIRED', requiresAuth: true });
  }
  if (isAuthed && !isSubscribed) {
    if (session.message_count >= 10) {
      return res.status(402).json({ error: 'Trial limit reached', code: 'NEEDS_SUBSCRIPTION', persona: personaId });
    }
  }

  try {
    const styleHint = IMAGE_STYLE_HINTS[personaId];
    const img = await generateImage({
      prompt: prompt.trim(),
      personaName: persona.name,
      personaStyleHint: styleHint,
    });
    // Each image generation counts as a message turn for trial accounting.
    db.prepare('UPDATE sessions SET message_count = message_count + 1 WHERE id = ?').run(sessionId);
    res.json({
      ok: true,
      dataUrl: img.dataUrl,
      mimeType: img.mimeType,
      bytes: img.bytes,
      model: img.model,
      caption: img.caption,
      messageCount: session.message_count + 1,
    });
  } catch (err: any) {
    console.error('[image] generation failed', err);
    res.status(502).json({ error: err?.message || 'Image generation failed' });
  }
});


// ═══════════════════════════════════════
// SUBSCRIBE / BILLING
// ═══════════════════════════════════════
app.post('/api/subscribe/checkout', async (req, res) => {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return res.status(401).json({ error: 'Sign in required' });
  const payload = verifySession(auth);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });

  const { persona, cadence } = req.body || {};
  if (!persona || !['monthly', 'annual'].includes(cadence)) {
    return res.status(400).json({ error: 'persona and cadence (monthly|annual) required' });
  }
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Billing not configured' });

  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const result = await createCheckoutSession({
      userId: payload.userId,
      userEmail: payload.email,
      persona,
      cadence,
      successUrl: `${frontendUrl}/account?subscribed=${persona}`,
      cancelUrl: `${frontendUrl}/chat/${persona}`,
    });
    res.json(result);
  } catch (err: any) {
    console.error('[checkout] error', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  MY VERY OWN API                         ║
║  Listening on :${String(PORT).padEnd(26)}║
║  Frontend: ${(process.env.FRONTEND_URL || 'http://localhost:5173').padEnd(30)}║
║  Gemini:   ${(process.env.GEMINI_API_KEY ? 'configured ✓' : 'MISSING ✗').padEnd(30)}║
║  Stripe:   ${(isStripeConfigured() ? 'configured ✓' : 'not configured').padEnd(30)}║
║  Cortex:   ${(process.env.CORTEX_URL ? 'configured ✓' : 'not configured').padEnd(30)}║
╚══════════════════════════════════════════╝
  `);
});
