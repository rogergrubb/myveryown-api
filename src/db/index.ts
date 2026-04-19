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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_tokens(email);
    CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_lookup ON usage(session_or_user_id, created_at);
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
