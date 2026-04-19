import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import { db, initSchema, Session } from './db/index.js';
import { getPersona, PERSONAS } from './personas.js';
import { streamChat, ChatMessage } from './llm.js';
import { nsKey, recordMemory, recallMemories, formatMemoriesForPrompt, migrateNamespace } from './memory.js';
import {
  signSession, verifySession, sendMagicLink, consumeMagicToken,
  verifyGoogleIdToken, verifyAppleIdToken, findOrCreateUser,
} from './auth.js';
import { createCheckoutSession, handleStripeWebhook, hasActiveSubscription, isStripeConfigured } from './billing.js';

initSchema();

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
// SESSIONS — anonymous 7-day free trials
//
// Users land, pick a persona, type their name, and get 7 days of
// unrestricted access before hitting a paywall. The theory is that
// someone needs roughly a week of interactions to form a genuine
// attachment to an AI companion — this is the "fall in love" window.
// ═══════════════════════════════════════
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

app.post('/api/session', (req, res) => {
  const { name, persona } = req.body || {};
  if (!persona || !getPersona(persona)) {
    return res.status(400).json({ error: 'Invalid persona' });
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
  const { sessionId, messages } = req.body || {};
  if (!sessionId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'sessionId and messages required' });
  }

  // Load session
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Session | undefined;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Check expiration + subscription
  const now = Date.now();
  const isAuthed = !!session.user_id;
  const isSubscribed = isAuthed && hasActiveSubscription(session.user_id!, session.persona);

  if (!isAuthed && session.expires_at < now) {
    return res.status(402).json({ error: 'Session expired', code: 'SESSION_EXPIRED', requiresAuth: true });
  }
  if (isAuthed && !isSubscribed) {
    // Authenticated but no subscription — soft paywall at 10 messages
    if (session.message_count >= 10) {
      return res.status(402).json({ error: 'Trial limit reached', code: 'NEEDS_SUBSCRIPTION', persona: session.persona });
    }
  }

  const persona = getPersona(session.persona);
  if (!persona) return res.status(400).json({ error: 'Invalid persona' });

  // Get user name and latest message
  const latestUser = messages[messages.length - 1] as ChatMessage | undefined;
  if (!latestUser || latestUser.role !== 'user' || !latestUser.content) {
    return res.status(400).json({ error: 'Last message must be user message' });
  }

  // Recall memory
  const namespace = nsKey(session.persona, session.user_id || session.id);
  const memories = await recallMemories(namespace, latestUser.content, 5);
  const memoryBlock = formatMemoriesForPrompt(memories);

  // Build the system prompt with memory + user name
  let systemPrompt = persona.systemPrompt;
  if (session.name) systemPrompt += `\n\nThe user's name is ${session.name}. Use it naturally, but don't overuse it.`;
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
      session.persona,
      usageData.model,
      usageData.inputTokens,
      usageData.outputTokens,
      usageData.costMillis,
      Date.now()
    );

    recordMemory(namespace, latestUser.content, fullResponse).catch(err => console.error('[memory] record failed', err));

    res.write(`data: ${JSON.stringify({ type: 'done', usage: usageData, messageCount: session.message_count + 1 })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('[chat] stream error', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Stream failed' })}\n\n`);
    res.end();
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
