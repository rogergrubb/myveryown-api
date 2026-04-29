// ════════════════════════════════════════════════════════════════
// X (Twitter) API v2 client
// ────────────────────────────────────────────────────────────────
// OAuth 1.0a User Context — required for posting tweets and reading
// public_metrics on tweets you authored. Reads four env vars:
//
//   X_API_KEY              (consumer key)
//   X_API_SECRET           (consumer secret)
//   X_ACCESS_TOKEN         (access token, USER context)
//   X_ACCESS_TOKEN_SECRET  (access token secret)
//
// Without all four set, isConfigured() returns false and the
// scheduler stays in dry-run mode. Setup at https://developer.x.com.
// Free tier: 1,500 posts/month + read self.
// ════════════════════════════════════════════════════════════════

import { TwitterApi, TweetV2 } from 'twitter-api-v2';

let cached: TwitterApi | null = null;
let cachedHandle: string | null = null;

export function isConfigured(): boolean {
  return !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
}

function client(): TwitterApi {
  if (cached) return cached;
  if (!isConfigured()) {
    throw new Error('X API credentials not configured');
  }
  cached = new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
  });
  return cached;
}

/**
 * Resolve and cache the authenticated user's handle (@whatever) so we
 * can build correct tweet URLs without hardcoding it.
 */
async function authenticatedHandle(): Promise<string> {
  if (cachedHandle) return cachedHandle;
  const me = await client().v2.me();
  cachedHandle = me.data.username;
  return cachedHandle;
}

export type PostResult = {
  ok: boolean;
  tweet_id?: string;
  url?: string;
  error?: string;
};

/**
 * Post a single tweet. Returns the new tweet's id and canonical URL.
 * If the X API rejects (rate limit, duplicate, etc.) the error is
 * surfaced without throwing so the scheduler can mark the row and
 * continue with the next slot.
 */
export async function postTweet(text: string): Promise<PostResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'X API credentials not configured' };
  }
  if (!text || text.length === 0) {
    return { ok: false, error: 'empty tweet text' };
  }
  // X's maximum tweet length is 280 characters as of 2025
  if (text.length > 280) {
    return { ok: false, error: `tweet too long: ${text.length} > 280` };
  }
  try {
    const c = client();
    const result = await c.v2.tweet({ text });
    const tweetId = result.data.id;
    const handle = await authenticatedHandle();
    return {
      ok: true,
      tweet_id: tweetId,
      url: `https://x.com/${handle}/status/${tweetId}`,
    };
  } catch (err: any) {
    // Common shapes:
    //   - 403 + "duplicate content" — a near-identical tweet was posted recently
    //   - 429 — rate limit (15-min window)
    //   - 401 — auth (creds bad)
    const message = err?.data?.detail || err?.message || String(err);
    return { ok: false, error: message };
  }
}

export type EngagementMetrics = {
  likes: number;
  retweets: number;
  replies: number;
  impressions: number | null;
};

/**
 * Pull the most recent public_metrics for a list of tweet ids that
 * we authored. Batched up to 100 per request. impression_count is
 * available only on tweets you authored AND only via the X API v2
 * non_public_metrics field — gated to OAuth 2.0 user context. With
 * OAuth 1.0a we get public_metrics.impression_count which IS public
 * for self-authored tweets.
 */
export async function fetchEngagement(tweetIds: string[]): Promise<Record<string, EngagementMetrics>> {
  if (!isConfigured() || tweetIds.length === 0) return {};
  const out: Record<string, EngagementMetrics> = {};
  try {
    const c = client();
    // Batch in chunks of 100
    for (let i = 0; i < tweetIds.length; i += 100) {
      const chunk = tweetIds.slice(i, i + 100);
      const res = await c.v2.tweets(chunk, {
        'tweet.fields': ['public_metrics'],
      });
      const tweets: TweetV2[] = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
      for (const t of tweets) {
        const m = (t as any).public_metrics || {};
        out[t.id] = {
          likes: Number(m.like_count || 0),
          retweets: Number(m.retweet_count || 0),
          replies: Number(m.reply_count || 0),
          impressions: typeof m.impression_count === 'number' ? m.impression_count : null,
        };
      }
    }
  } catch (err) {
    console.warn('[twitter] fetchEngagement failed', (err as Error).message);
  }
  return out;
}
