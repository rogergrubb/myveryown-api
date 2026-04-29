import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_URL = process.env.DATABASE_URL || 'file:./data/myveryown.db';
const dbPath = DB_URL.replace(/^file:/, '');

// Ensure data directory exists
try {
  mkdirSync(dirname(dbPath), { recursive: true });
} catch {}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  db.exec(`
    -- Users (authenticated accounts)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      auth_provider TEXT NOT NULL,    -- 'magic', 'google', 'apple'
      auth_provider_id TEXT,           -- google sub, apple sub, or null for magic
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      anonymous_session_id TEXT        -- links to pre-signup session if migrated
    );

    -- Anonymous sessions (the 7-day free trial)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,                       -- what the user told us to call them
      persona TEXT NOT NULL,           -- 'kpop', 'scarlet', etc.
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,     -- created_at + 7 days
      user_id TEXT,                    -- set when they sign up
      message_count INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Magic link tokens (one-time email auth)
    CREATE TABLE IF NOT EXISTS magic_tokens (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      session_id TEXT,                 -- optional session to migrate
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );

    -- Subscriptions
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,             -- stripe subscription id
      user_id TEXT NOT NULL,
      stripe_customer_id TEXT NOT NULL,
      persona TEXT NOT NULL,
      tier TEXT NOT NULL,              -- 'kpop_monthly', 'kpop_annual', etc.
      status TEXT NOT NULL,            -- 'active', 'past_due', 'canceled', etc.
      current_period_end INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Usage tracking (for rate limits + cost monitoring)
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_or_user_id TEXT NOT NULL,
      persona TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost_usd_millis INTEGER DEFAULT 0,   -- thousandths of a dollar
      created_at INTEGER NOT NULL
    );

    -- Visit tracking (anonymous traffic logs for /dashboard)
    -- ip_full kept short-term for ops debugging; ip_hash for long-term aggregation.
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_full TEXT,                    -- full client IP (best-effort from X-Forwarded-For)
      ip_hash TEXT NOT NULL,           -- SHA-256 of ip+salt for privacy-safe aggregation
      ua TEXT,
      country TEXT,
      city TEXT,
      region TEXT,
      lat REAL,
      lon REAL,
      referrer TEXT,
      path TEXT,
      persona TEXT,                    -- if visit is on a /chat/:persona or /start/:persona route
      session_id TEXT,                 -- if user has a session
      is_bot INTEGER DEFAULT 0,        -- 0 = human, 1 = detected bot
      bot_reason TEXT,                 -- why we flagged it (UA match, headless, etc.)
      created_at INTEGER NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_tokens(email);
    CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_lookup ON usage(session_or_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
    CREATE INDEX IF NOT EXISTS idx_visits_ip_hash ON visits(ip_hash);
    CREATE INDEX IF NOT EXISTS idx_visits_country ON visits(country);
    CREATE INDEX IF NOT EXISTS idx_visits_bot ON visits(is_bot);

    -- Auto-generated marketing content queue (the viral hype pipeline).
    -- Each row is one ready-to-post variation. The dashboard surfaces
    -- them; the operator copies + posts; status flips when posted/archived.
    CREATE TABLE IF NOT EXISTS content_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persona TEXT,                      -- primary persona this targets ('iron', 'kpop', 'multi', etc.)
      archetype TEXT NOT NULL,           -- 'founder_confession', 'contrarian_take', etc.
      format TEXT NOT NULL,              -- 'single_tweet', 'thread_starter', 'reply_hook', etc.
      hook TEXT,                         -- 1-line summary for the dashboard card
      body TEXT NOT NULL,                -- the actual post copy
      suggested_image TEXT,              -- e.g. '/og/iron.png'
      tone_tags TEXT,                    -- comma-sep, for filtering ('vulnerable,raw' etc)
      generated_at INTEGER NOT NULL,
      generated_seed INTEGER,            -- so we can reproduce / debug
      status TEXT DEFAULT 'pending',     -- 'pending', 'posted', 'archived', 'rejected'
      posted_at INTEGER,
      posted_url TEXT,                   -- optional: paste the live tweet URL after posting
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_content_status ON content_queue(status, generated_at);
    CREATE INDEX IF NOT EXISTS idx_content_archetype ON content_queue(archetype);
  `);
  console.log('[db] schema initialized at', dbPath);
}

export type User = {
  id: string;
  email: string;
  display_name: string | null;
  auth_provider: 'magic' | 'google' | 'apple';
  auth_provider_id: string | null;
  created_at: number;
  last_seen_at: number | null;
  anonymous_session_id: string | null;
};

export type Session = {
  id: string;
  name: string | null;
  persona: string;
  created_at: number;
  expires_at: number;
  user_id: string | null;
  message_count: number;
};

export type Subscription = {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  persona: string;
  tier: string;
  status: string;
  current_period_end: number;
  created_at: number;
  updated_at: number;
};
