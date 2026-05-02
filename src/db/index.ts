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
      cancelled_at INTEGER,            -- when customer.subscription.deleted fired (refund/cancel flow)
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ALTER TABLE for existing deployments — safe on SQLite (no-op if col exists)
    -- Wrap in try/catch at runtime since SQLite doesn't have IF NOT EXISTS for columns.

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
      persona TEXT,
      session_id TEXT,
      is_bot INTEGER DEFAULT 0,
      bot_reason TEXT,
      utm_source TEXT,                 -- e.g. 'twitter', 'reddit', 'producthunt'
      utm_medium TEXT,                 -- e.g. 'social', 'organic', 'paid'
      utm_campaign TEXT,               -- e.g. 'kpop-launch-thread'
      utm_content TEXT,                -- e.g. 'tweet-id-abc123'
      utm_term TEXT,                   -- free-form
      campaign_slug TEXT,              -- our normalized campaign id (joins outreach_campaigns.slug)
      created_at INTEGER NOT NULL
    );

    -- Outreach campaigns — operator-tracked launch pushes (a tweet,
    -- a Reddit post, a podcast appearance, etc.). Used by /dashboard
    -- to attribute visits and signups to their source.
    CREATE TABLE IF NOT EXISTS outreach_campaigns (
      slug TEXT PRIMARY KEY,           -- 'kpop-launch-thread', 'iron-brother-thread', etc.
      label TEXT NOT NULL,             -- human-readable label
      channel TEXT NOT NULL,           -- 'x', 'reddit', 'producthunt', 'indiehackers', 'hn', 'email', 'podcast', 'other'
      persona TEXT,                    -- which persona this campaign primarily targets (or 'multi')
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      url TEXT,                        -- the live link (the tweet, the PH listing, etc.)
      notes TEXT,
      status TEXT DEFAULT 'planned',   -- 'planned', 'live', 'paused', 'archived'
      launched_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_visits_utm_source ON visits(utm_source, created_at);
    CREATE INDEX IF NOT EXISTS idx_visits_campaign ON visits(campaign_slug, created_at);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON outreach_campaigns(status, launched_at);

    -- Auto-generated marketing content queue (the viral hype pipeline).
    -- Each row is one ready-to-post variation. Status lifecycle:
    --   pending -> scheduled (scheduled_for set) -> posted (X API success)
    --   pending -> posted (manual via "Open in X")
    --   pending -> archived | rejected
    CREATE TABLE IF NOT EXISTS content_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persona TEXT,
      archetype TEXT NOT NULL,
      format TEXT NOT NULL,
      hook TEXT,
      body TEXT NOT NULL,
      suggested_image TEXT,
      tone_tags TEXT,
      generated_at INTEGER NOT NULL,
      generated_seed INTEGER,
      status TEXT DEFAULT 'pending',     -- 'pending', 'scheduled', 'posted', 'archived', 'rejected'
      scheduled_for INTEGER,             -- target post time (ms epoch); null until scheduled
      posted_at INTEGER,
      posted_url TEXT,
      posted_tweet_id TEXT,              -- X tweet ID, if auto-posted via API
      auto_posted INTEGER DEFAULT 0,     -- 1 if posted by scheduler vs. manual mark
      engagement_likes INTEGER,
      engagement_retweets INTEGER,
      engagement_replies INTEGER,
      engagement_impressions INTEGER,
      engagement_fetched_at INTEGER,
      campaign_slug TEXT,                -- ties to outreach_campaigns
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_content_status ON content_queue(status, generated_at);
    CREATE INDEX IF NOT EXISTS idx_content_archetype ON content_queue(archetype);
    CREATE INDEX IF NOT EXISTS idx_content_scheduled ON content_queue(status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_content_posted ON content_queue(posted_at) WHERE posted_tweet_id IS NOT NULL;
  `);
  // Idempotent ALTER for already-deployed databases. ignore "duplicate column" errors.
  try { db.exec(`ALTER TABLE subscriptions ADD COLUMN cancelled_at INTEGER`); } catch { /* column already exists */ }
  try { db.exec(`ALTER TABLE content_queue ADD COLUMN posted_pin_id TEXT`); } catch { /* column already exists */ }
  try { db.exec(`ALTER TABLE content_queue ADD COLUMN posted_thread_id TEXT`); } catch { /* column already exists */ }
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
