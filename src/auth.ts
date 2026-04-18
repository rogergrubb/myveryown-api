import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import nodemailer from 'nodemailer';
import { db, User } from './db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL = '30d';

// ────────────────────────────────
// JWT helpers
// ────────────────────────────────
export type JwtPayload = { userId: string; email: string };

export function signSession(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: SESSION_TTL });
}

export function verifySession(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ────────────────────────────────
// Magic link flow
// ────────────────────────────────
let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) {
    console.warn('[auth] SMTP not configured, magic links will be logged to console');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

export async function sendMagicLink(email: string, sessionId?: string): Promise<void> {
  const token = nanoid(48);
  const expiresAt = Date.now() + MAGIC_LINK_TTL_MS;
  db.prepare(`
    INSERT INTO magic_tokens (token, email, session_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, email, sessionId || null, expiresAt);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${frontendUrl}/auth/magic?token=${token}`;

  const t = getTransporter();
  if (!t) {
    console.log(`[MAGIC LINK for ${email}]: ${link}`);
    return;
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || 'hello@myveryown.page',
    to: email,
    subject: 'Your My Very Own sign-in link ✨',
    html: `
      <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 0 auto; padding: 40px 20px; color: #222;">
        <h1 style="font-weight: 700; font-size: 28px; margin: 0 0 16px;">Welcome back ✨</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #555;">Tap the button below to sign in. This link expires in 15 minutes.</p>
        <p style="margin: 32px 0;">
          <a href="${link}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #ffd700, #ff6b35); color: #08080c; font-weight: 700; text-decoration: none; border-radius: 30px;">Sign in now →</a>
        </p>
        <p style="font-size: 13px; color: #888;">If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}

export function consumeMagicToken(token: string): { email: string; sessionId: string | null } | null {
  const row = db.prepare(`
    SELECT email, session_id as sessionId, expires_at as expiresAt, used_at as usedAt
    FROM magic_tokens WHERE token = ?
  `).get(token) as { email: string; sessionId: string | null; expiresAt: number; usedAt: number | null } | undefined;

  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt < Date.now()) return null;

  db.prepare('UPDATE magic_tokens SET used_at = ? WHERE token = ?').run(Date.now(), token);
  return { email: row.email, sessionId: row.sessionId };
}

// ────────────────────────────────
// Google OAuth (server-side verify of ID token)
// ────────────────────────────────
export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string; sub: string; name?: string } | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!res.ok) return null;
    const data = await res.json() as { email: string; sub: string; name?: string; aud: string };
    if (process.env.GOOGLE_CLIENT_ID && data.aud !== process.env.GOOGLE_CLIENT_ID) {
      console.warn('[auth] Google ID token audience mismatch');
      return null;
    }
    return { email: data.email, sub: data.sub, name: data.name };
  } catch (err) {
    console.error('[auth] Google verify error', err);
    return null;
  }
}

// ────────────────────────────────
// Apple OAuth (similar pattern — verify ID token via Apple's JWKS)
// Stub for now: we'd fetch https://appleid.apple.com/auth/keys and verify signature
// ────────────────────────────────
export async function verifyAppleIdToken(idToken: string): Promise<{ email: string; sub: string } | null> {
  // Simplified: decode without full JWKS verify for MVP
  // Production: use jose or jsonwebtoken with public key from Apple JWKS
  try {
    const payload = jwt.decode(idToken) as any;
    if (!payload || !payload.email || !payload.sub) return null;
    return { email: payload.email, sub: payload.sub };
  } catch {
    return null;
  }
}

// ────────────────────────────────
// User creation / lookup
// ────────────────────────────────
export function findOrCreateUser(params: {
  email: string;
  authProvider: 'magic' | 'google' | 'apple';
  authProviderId?: string;
  displayName?: string;
  sessionId?: string;
}): User {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(params.email) as User | undefined;
  if (existing) {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), existing.id);
    return { ...existing, last_seen_at: Date.now() };
  }
  const id = `user_${nanoid(16)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (id, email, display_name, auth_provider, auth_provider_id, created_at, last_seen_at, anonymous_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.email, params.displayName || null, params.authProvider, params.authProviderId || null, now, now, params.sessionId || null);

  // Link the anonymous session if provided
  if (params.sessionId) {
    db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(id, params.sessionId);
  }
  return {
    id, email: params.email, display_name: params.displayName || null,
    auth_provider: params.authProvider, auth_provider_id: params.authProviderId || null,
    created_at: now, last_seen_at: now, anonymous_session_id: params.sessionId || null,
  };
}
