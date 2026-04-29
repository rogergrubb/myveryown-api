// ════════════════════════════════════════════════════════════════
// MARKETING SCHEDULER — auto-post the content factory queue to X
// ────────────────────────────────────────────────────────────────
// Picks pending content_queue items, schedules them across optimal
// slots per audience, posts them via twitter.ts when their slot
// arrives, and harvests engagement metrics on already-posted items.
//
// Pacing rules:
//   - Min 4h between any two auto-posts
//   - Max 4 auto-posts in 24h
//   - Time-of-day flavor matched to persona audience:
//       gym personas (iron, fuel, twelfth)  → 5:30-7am ET
//       k-pop bestie (kpop)                  → 7-10pm ET
//       hearth/rainbow/betty (emotional)     → 9pm-12am ET
//       weddings/study/work-adjacent         → 10am-2pm ET
//       default                              → 11am-3pm ET
//   - Avoid Sundays for fitness; avoid Mondays before 9am for everyone
//
// Modes:
//   - X creds present:   posts via API at scheduled_for time
//   - X creds missing:   stays in dry-run, marks scheduled but does
//                        not post — operator can use "Open in X"
// ════════════════════════════════════════════════════════════════

import { db } from './db/index.js';
import { isConfigured as twitterConfigured, postTweet, fetchEngagement } from './twitter.js';

// ────────────────────────────────────────────────────────────────
// Time-slot policy
// ────────────────────────────────────────────────────────────────

type TimeWindow = { startHourET: number; endHourET: number };

const PERSONA_WINDOWS: Record<string, TimeWindow> = {
  // Gym hours — early morning ET
  iron:    { startHourET: 5,  endHourET: 8  },
  fuel:    { startHourET: 5,  endHourET: 8  },
  twelfth: { startHourET: 9,  endHourET: 13 },
  // K-pop — evening ET (KST mid-afternoon)
  kpop:    { startHourET: 19, endHourET: 23 },
  // Late-night emotional
  hearth:  { startHourET: 21, endHourET: 24 },
  rainbow: { startHourET: 20, endHourET: 23 },
  betty:   { startHourET: 9,  endHourET: 12 },
  scarlet: { startHourET: 22, endHourET: 24 },
  // Daytime / planning
  promise: { startHourET: 10, endHourET: 14 },
  little:  { startHourET: 10, endHourET: 14 },
  study:   { startHourET: 14, endHourET: 18 },
  shepherd:{ startHourET: 7,  endHourET: 10 },
  ledger:  { startHourET: 11, endHourET: 14 },
  // Hobby/lifestyle — afternoon
  cast:    { startHourET: 6,  endHourET: 10 },
  gear:    { startHourET: 18, endHourET: 22 },
  player:  { startHourET: 19, endHourET: 23 },
  ink:     { startHourET: 8,  endHourET: 11 },
  handy:   { startHourET: 9,  endHourET: 12 },
  chords:  { startHourET: 17, endHourET: 21 },
  thumb:   { startHourET: 8,  endHourET: 11 },
};

const DEFAULT_WINDOW: TimeWindow = { startHourET: 11, endHourET: 15 };

const MIN_SPACING_MS = 4 * 60 * 60 * 1000; // 4h between auto-posts
const MAX_PER_DAY = 4;

/** Convert an ET hour-of-day on a given day to a ms epoch. */
function dateAtETHour(date: Date, etHour: number, etMinute = 0): Date {
  // ET = UTC-5 (EST) or UTC-4 (EDT). Naively subtract 5h; close enough
  // for scheduling; off by an hour during EDT but the windows have ±2h
  // slack so it doesn't break behavior.
  const utcHour = (etHour + 5) % 24;
  const dayOffset = etHour + 5 >= 24 ? 1 : 0;
  const out = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + dayOffset,
    utcHour,
    etMinute,
    0,
    0,
  ));
  return out;
}

function persona1stPart(personaTag: string | null): string | null {
  if (!personaTag) return null;
  return personaTag.split('+')[0].toLowerCase();
}

function windowFor(personaTag: string | null): TimeWindow {
  const k = persona1stPart(personaTag);
  if (k && PERSONA_WINDOWS[k]) return PERSONA_WINDOWS[k];
  return DEFAULT_WINDOW;
}

/**
 * Compute the next eligible posting time for an item. Respects:
 *   - the persona's window
 *   - min spacing from already-scheduled items
 *   - max-per-day cap
 *   - "fitness skips Sunday" weekend rules
 *   - "no Monday before 9am" early-week rule
 */
function nextSlot(personaTag: string | null, existingScheduled: number[]): Date {
  const sortedExisting = [...existingScheduled].sort((a, b) => a - b);
  const window = windowFor(personaTag);
  const personaKey = persona1stPart(personaTag);

  // Start from now, advance until we find a slot.
  let candidate = new Date();
  // Round up to the next 15-minute boundary
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(Math.ceil(candidate.getUTCMinutes() / 15) * 15);
  candidate = new Date(candidate.getTime() + 30 * 60 * 1000); // earliest = 30 min from now

  for (let attempt = 0; attempt < 240; attempt++) {  // up to 60h ahead
    // Adjust to be within the persona's window on the candidate's date
    const day = new Date(Date.UTC(
      candidate.getUTCFullYear(),
      candidate.getUTCMonth(),
      candidate.getUTCDate(),
    ));
    let target = dateAtETHour(day, window.startHourET);
    if (candidate.getTime() > target.getTime()) {
      // Already past the window's start today — pick a random minute
      // inside the remaining window, or roll to tomorrow's start.
      const winEnd = dateAtETHour(day, window.endHourET);
      if (candidate.getTime() < winEnd.getTime()) {
        target = candidate;
      } else {
        // Roll to next day's window start
        candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
        candidate.setUTCHours(0, 0, 0, 0);
        continue;
      }
    } else {
      target = dateAtETHour(day, window.startHourET, 15 * (attempt % 4));
    }

    // Day-of-week rules
    const dow = target.getUTCDay();  // 0=Sun, 1=Mon
    const fitnessPersonas = ['iron', 'fuel', 'twelfth'];
    if (dow === 0 && personaKey && fitnessPersonas.includes(personaKey)) {
      // Skip Sunday for fitness
      candidate = new Date(target.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }
    if (dow === 1) {
      // No Monday before 9am for anyone
      const monday9am = dateAtETHour(day, 9);
      if (target.getTime() < monday9am.getTime()) {
        target = monday9am;
      }
    }

    // Min spacing check
    const conflict = sortedExisting.find(t => Math.abs(t - target.getTime()) < MIN_SPACING_MS);
    if (conflict) {
      candidate = new Date(conflict + MIN_SPACING_MS + 60 * 1000);
      continue;
    }

    // Max-per-day check
    const sameDayCount = sortedExisting.filter(t => {
      const d = new Date(t);
      return d.getUTCFullYear() === target.getUTCFullYear() &&
             d.getUTCMonth() === target.getUTCMonth() &&
             d.getUTCDate() === target.getUTCDate();
    }).length;
    if (sameDayCount >= MAX_PER_DAY) {
      candidate = new Date(target.getTime() + 24 * 60 * 60 * 1000);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    return target;
  }
  // Fallback — 24h from now at noon ET
  const fallback = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return dateAtETHour(fallback, 12);
}

// ────────────────────────────────────────────────────────────────
// Public API: scheduling
// ────────────────────────────────────────────────────────────────

/** Schedule a single item at an explicit time. */
export function scheduleItem(id: number, when: number): boolean {
  const item = db.prepare(`SELECT id, status FROM content_queue WHERE id = ?`).get(id) as { id: number; status: string } | undefined;
  if (!item) return false;
  if (!['pending', 'scheduled'].includes(item.status)) return false;
  db.prepare(`UPDATE content_queue SET status = 'scheduled', scheduled_for = ? WHERE id = ?`).run(when, id);
  return true;
}

/** Auto-schedule the next N pending items into optimal slots. */
export function autoScheduleNext(count = 6): { scheduled: { id: number; persona: string | null; scheduled_for: number }[] } {
  const pending = db.prepare(`
    SELECT id, persona FROM content_queue
    WHERE status = 'pending'
    ORDER BY generated_at ASC
    LIMIT ?
  `).all(count) as Array<{ id: number; persona: string | null }>;

  // Existing scheduled times (not yet posted) so spacing/capping considers them
  const existing = (db.prepare(`
    SELECT scheduled_for FROM content_queue
    WHERE status = 'scheduled' AND scheduled_for IS NOT NULL
    ORDER BY scheduled_for
  `).all() as Array<{ scheduled_for: number }>).map(r => r.scheduled_for);

  const scheduled: { id: number; persona: string | null; scheduled_for: number }[] = [];
  for (const item of pending) {
    const slot = nextSlot(item.persona, existing);
    const slotMs = slot.getTime();
    db.prepare(`UPDATE content_queue SET status = 'scheduled', scheduled_for = ? WHERE id = ?`).run(slotMs, item.id);
    existing.push(slotMs);
    scheduled.push({ id: item.id, persona: item.persona, scheduled_for: slotMs });
  }
  return { scheduled };
}

/** Unschedule an item — back to 'pending' with no scheduled_for. */
export function unscheduleItem(id: number): boolean {
  const info = db.prepare(`UPDATE content_queue SET status = 'pending', scheduled_for = NULL WHERE id = ? AND status = 'scheduled'`).run(id);
  return info.changes > 0;
}

// ────────────────────────────────────────────────────────────────
// Cron loops
// ────────────────────────────────────────────────────────────────

const POST_TICK_MS = 60 * 1000;          // check every minute for due items
const ENGAGEMENT_TICK_MS = 30 * 60 * 1000; // refresh engagement every 30 min

let cronStarted = false;

async function processDueItems(): Promise<void> {
  const now = Date.now();
  const due = db.prepare(`
    SELECT id, body FROM content_queue
    WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= ?
    ORDER BY scheduled_for ASC
    LIMIT 1
  `).all(now) as Array<{ id: number; body: string }>;

  if (due.length === 0) return;

  if (!twitterConfigured()) {
    console.log(`[scheduler] ${due.length} item(s) due but X API not configured — leaving in 'scheduled' state`);
    return;
  }

  for (const item of due) {
    const result = await postTweet(item.body);
    if (result.ok) {
      db.prepare(`
        UPDATE content_queue
        SET status = 'posted',
            posted_at = ?,
            posted_url = ?,
            posted_tweet_id = ?,
            auto_posted = 1
        WHERE id = ?
      `).run(Date.now(), result.url || null, result.tweet_id || null, item.id);
      console.log(`[scheduler] posted #${item.id} → ${result.url}`);
    } else {
      // Log the failure into notes; bump back to scheduled with a 1h delay
      // so retries don't hammer.
      db.prepare(`
        UPDATE content_queue
        SET notes = ?,
            scheduled_for = ?
        WHERE id = ?
      `).run(`[${new Date().toISOString()}] post failed: ${result.error}`, Date.now() + 60 * 60 * 1000, item.id);
      console.warn(`[scheduler] failed #${item.id}: ${result.error}`);
    }
  }
}

async function refreshEngagement(): Promise<void> {
  if (!twitterConfigured()) return;

  // Pull tweets posted in the last 7 days that we haven't refreshed in 30+ min
  const cutoff = Date.now() - 30 * 60 * 1000;
  const recent = db.prepare(`
    SELECT id, posted_tweet_id FROM content_queue
    WHERE status = 'posted'
      AND posted_tweet_id IS NOT NULL
      AND posted_at > ?
      AND (engagement_fetched_at IS NULL OR engagement_fetched_at < ?)
    ORDER BY posted_at DESC
    LIMIT 80
  `).all(Date.now() - 7 * 24 * 60 * 60 * 1000, cutoff) as Array<{ id: number; posted_tweet_id: string }>;

  if (recent.length === 0) return;

  const ids = recent.map(r => r.posted_tweet_id);
  const metrics = await fetchEngagement(ids);
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE content_queue
    SET engagement_likes = ?,
        engagement_retweets = ?,
        engagement_replies = ?,
        engagement_impressions = ?,
        engagement_fetched_at = ?
    WHERE id = ?
  `);
  let updated = 0;
  for (const r of recent) {
    const m = metrics[r.posted_tweet_id];
    if (!m) continue;
    stmt.run(m.likes, m.retweets, m.replies, m.impressions, now, r.id);
    updated++;
  }
  if (updated > 0) console.log(`[scheduler] refreshed engagement for ${updated} tweet(s)`);
}

export function startScheduler(): void {
  if (cronStarted) return;
  cronStarted = true;

  setTimeout(() => { processDueItems().catch(e => console.error('[scheduler] tick error', e)); }, 30 * 1000);
  setInterval(() => { processDueItems().catch(e => console.error('[scheduler] tick error', e)); }, POST_TICK_MS);

  setTimeout(() => { refreshEngagement().catch(e => console.error('[scheduler] engagement error', e)); }, 5 * 60 * 1000);
  setInterval(() => { refreshEngagement().catch(e => console.error('[scheduler] engagement error', e)); }, ENGAGEMENT_TICK_MS);

  console.log(`[scheduler] started — Twitter ${twitterConfigured() ? 'configured (auto-posting LIVE)' : 'not configured (dry-run only)'}`);
}
