// ════════════════════════════════════════════════════════════════
// VISIT TRACKING + BOT DETECTION
// ════════════════════════════════════════════════════════════════
// Anonymous visit logging for the /dashboard view. Captures IP (from
// Vercel/edge headers if present, X-Forwarded-For otherwise), geo
// from Vercel's edge-injected headers, UA, referrer, path, persona
// context. Hashes IP for privacy-safe long-term aggregation while
// still keeping the full IP short-term for ops debugging.
// ════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { Request } from 'express';
import { db } from './db/index.js';

const IP_HASH_SALT = process.env.IP_HASH_SALT || 'mvo-2026-rotate-this-eventually';

// Heuristic bot detection — fast first-pass via UA + header signals.
const BOT_UA_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /scrape/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i, /whatsapp/i,
  /slackbot/i, /discord/i, /telegrambot/i, /pinterest/i, /redditbot/i,
  /googlebot/i, /bingbot/i, /yandexbot/i, /baiduspider/i, /duckduckbot/i,
  /applebot/i, /amazonbot/i, /semrushbot/i, /ahrefsbot/i, /mj12bot/i,
  /chatgpt/i, /gptbot/i, /claudebot/i, /anthropic/i, /perplexity/i, /ccbot/i,
  /headless/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i,
  /python-requests/i, /node-fetch/i, /curl/i, /wget/i, /httpie/i,
  /lighthouse/i, /pagespeed/i, /pingdom/i,
];

type BotResult = { isBot: boolean; reason: string | null };

function detectBot(ua: string | undefined, accept: string | undefined): BotResult {
  if (!ua) return { isBot: true, reason: 'missing UA' };
  for (const re of BOT_UA_PATTERNS) {
    if (re.test(ua)) return { isBot: true, reason: `UA match: ${re.source}` };
  }
  // Headless markers
  if (/HeadlessChrome|electron/i.test(ua)) return { isBot: true, reason: 'headless browser' };
  // No Accept header at all — usually scripts
  if (!accept) return { isBot: true, reason: 'missing Accept header' };
  return { isBot: false, reason: null };
}

function clientIp(req: Request): string {
  // Order of trust:
  //   1. Vercel/proxy headers (immediate upstream)
  //   2. X-Forwarded-For (first IP — original client)
  //   3. Express's req.ip (fallback)
  const headers = req.headers;
  const vercelIp = (headers['x-real-ip'] || headers['x-vercel-forwarded-for']) as string | undefined;
  if (vercelIp) return Array.isArray(vercelIp) ? vercelIp[0] : vercelIp;
  const fwd = headers['x-forwarded-for'] as string | undefined;
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || 'unknown';
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + IP_HASH_SALT).digest('hex').slice(0, 32);
}

export type VisitMeta = {
  path?: string;
  persona?: string;
  sessionId?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  campaign_slug?: string;
};

/**
 * Log a visit to the database. Pulls IP, geo, UA from request headers
 * (most populated when behind Vercel; tolerates missing fields).
 */
export function logVisit(req: Request, meta: VisitMeta = {}): void {
  try {
    const ip = clientIp(req);
    const ua = (req.headers['user-agent'] as string | undefined) || '';
    const accept = req.headers['accept'] as string | undefined;
    const country = (req.headers['x-vercel-ip-country'] as string | undefined) || null;
    const city = (req.headers['x-vercel-ip-city'] as string | undefined) || null;
    const region = (req.headers['x-vercel-ip-country-region'] as string | undefined) || null;
    const latStr = req.headers['x-vercel-ip-latitude'] as string | undefined;
    const lonStr = req.headers['x-vercel-ip-longitude'] as string | undefined;
    const lat = latStr ? Number(latStr) : null;
    const lon = lonStr ? Number(lonStr) : null;

    const bot = detectBot(ua, accept);

    db.prepare(`
      INSERT INTO visits (
        ip_full, ip_hash, ua, country, city, region, lat, lon,
        referrer, path, persona, session_id,
        is_bot, bot_reason,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, campaign_slug,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ip,
      hashIp(ip),
      ua || null,
      country,
      city,
      region,
      isFinite(lat as number) ? lat : null,
      isFinite(lon as number) ? lon : null,
      decodeURIComponent(meta.referrer || (req.headers.referer as string) || '') || null,
      meta.path || null,
      meta.persona || null,
      meta.sessionId || null,
      bot.isBot ? 1 : 0,
      bot.reason,
      meta.utm_source || null,
      meta.utm_medium || null,
      meta.utm_campaign || null,
      meta.utm_content || null,
      meta.utm_term || null,
      meta.campaign_slug || null,
      Date.now(),
    );
  } catch (err) {
    // Never fail user requests because of analytics
    console.error('[track] logVisit failed', err);
  }
}

// ────────────────────────────────────────────────────────────────
// Dashboard aggregations
// ────────────────────────────────────────────────────────────────

export type DashboardStats = {
  generated_at: number;
  totals: {
    all_time: { visits: number; unique: number; humans: number; bots: number };
    last_24h: { visits: number; unique: number; humans: number; bots: number };
    last_7d:  { visits: number; unique: number; humans: number; bots: number };
  };
  top_countries: { country: string; visits: number; unique: number }[];
  top_paths: { path: string; visits: number }[];
  top_personas: { persona: string; visits: number }[];
  top_campaigns: { campaign: string; channel: string | null; visits: number; unique: number }[];
  top_utm_sources: { source: string; visits: number; unique: number }[];
  globe_points: { lat: number; lon: number; city: string | null; country: string | null; visits: number }[];
  recent_visits: {
    ts: number; ip: string; country: string | null; city: string | null;
    ua: string | null; path: string | null; persona: string | null;
    is_bot: number; bot_reason: string | null;
    utm_source: string | null; campaign_slug: string | null;
  }[];
  top_bot_uas: { ua: string; visits: number }[];
};

export function getDashboardStats(): DashboardStats {
  const now = Date.now();
  const day = now - 24 * 60 * 60 * 1000;
  const week = now - 7 * 24 * 60 * 60 * 1000;

  const totalsFor = (since: number | null) => {
    const where = since ? 'WHERE created_at > ?' : '';
    const params = since ? [since] : [];
    const row = db.prepare(`
      SELECT
        COUNT(*) AS visits,
        COUNT(DISTINCT ip_hash) AS unique_,
        SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS humans,
        SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bots
      FROM visits ${where}
    `).get(...params) as any;
    return {
      visits: Number(row.visits || 0),
      unique: Number(row.unique_ || 0),
      humans: Number(row.humans || 0),
      bots: Number(row.bots || 0),
    };
  };

  const top_countries = db.prepare(`
    SELECT country, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_
    FROM visits
    WHERE country IS NOT NULL AND created_at > ?
    GROUP BY country
    ORDER BY visits DESC
    LIMIT 20
  `).all(week) as any[];

  const top_paths = db.prepare(`
    SELECT path, COUNT(*) AS visits
    FROM visits
    WHERE path IS NOT NULL AND created_at > ?
    GROUP BY path
    ORDER BY visits DESC
    LIMIT 20
  `).all(week) as any[];

  const top_personas = db.prepare(`
    SELECT persona, COUNT(*) AS visits
    FROM visits
    WHERE persona IS NOT NULL AND created_at > ?
    GROUP BY persona
    ORDER BY visits DESC
    LIMIT 20
  `).all(week) as any[];

  // Globe points: cluster by lat/lon (rounded) for visual weight
  const globe_points = db.prepare(`
    SELECT
      ROUND(lat, 1) AS lat,
      ROUND(lon, 1) AS lon,
      city,
      country,
      COUNT(*) AS visits
    FROM visits
    WHERE lat IS NOT NULL AND lon IS NOT NULL AND is_bot = 0 AND created_at > ?
    GROUP BY ROUND(lat, 1), ROUND(lon, 1), city, country
    ORDER BY visits DESC
    LIMIT 500
  `).all(week) as any[];

  const top_campaigns = db.prepare(`
    SELECT
      COALESCE(v.campaign_slug, v.utm_campaign) AS campaign,
      c.channel AS channel,
      COUNT(*) AS visits,
      COUNT(DISTINCT v.ip_hash) AS unique_
    FROM visits v
    LEFT JOIN outreach_campaigns c ON c.slug = v.campaign_slug
    WHERE (v.campaign_slug IS NOT NULL OR v.utm_campaign IS NOT NULL)
      AND v.created_at > ?
    GROUP BY campaign, channel
    ORDER BY visits DESC
    LIMIT 15
  `).all(week) as any[];

  const top_utm_sources = db.prepare(`
    SELECT utm_source AS source, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_
    FROM visits
    WHERE utm_source IS NOT NULL AND created_at > ?
    GROUP BY utm_source
    ORDER BY visits DESC
    LIMIT 12
  `).all(week) as any[];

  const recent_visits = db.prepare(`
    SELECT created_at AS ts, ip_full AS ip, country, city, ua, path, persona, is_bot, bot_reason,
           utm_source, campaign_slug
    FROM visits
    ORDER BY created_at DESC
    LIMIT 100
  `).all() as any[];

  const top_bot_uas = db.prepare(`
    SELECT ua, COUNT(*) AS visits
    FROM visits
    WHERE is_bot = 1 AND ua IS NOT NULL AND created_at > ?
    GROUP BY ua
    ORDER BY visits DESC
    LIMIT 20
  `).all(week) as any[];

  return {
    generated_at: now,
    totals: {
      all_time: totalsFor(null),
      last_24h: totalsFor(day),
      last_7d:  totalsFor(week),
    },
    top_countries: top_countries.map(r => ({ country: r.country, visits: Number(r.visits), unique: Number(r.unique_) })),
    top_paths: top_paths.map(r => ({ path: r.path, visits: Number(r.visits) })),
    top_personas: top_personas.map(r => ({ persona: r.persona, visits: Number(r.visits) })),
    top_campaigns: top_campaigns.map(r => ({
      campaign: r.campaign || '(none)',
      channel: r.channel,
      visits: Number(r.visits),
      unique: Number(r.unique_),
    })),
    top_utm_sources: top_utm_sources.map(r => ({ source: r.source, visits: Number(r.visits), unique: Number(r.unique_) })),
    globe_points: globe_points.map(r => ({ lat: r.lat, lon: r.lon, city: r.city, country: r.country, visits: Number(r.visits) })),
    recent_visits: recent_visits.map(r => ({ ...r, ts: Number(r.ts), is_bot: Number(r.is_bot) })),
    top_bot_uas: top_bot_uas.map(r => ({ ua: r.ua, visits: Number(r.visits) })),
  };
}
