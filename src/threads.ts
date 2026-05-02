// ════════════════════════════════════════════════════════════════
// Meta Threads API client
// ────────────────────────────────────────────────────────────────
// Threads publishing is two-step:
//   1. Create a media container with text/image
//   2. Publish the container by id
//
// Reads two env vars:
//   THREADS_ACCESS_TOKEN  — long-lived user access token
//   THREADS_USER_ID       — numeric Threads user id
//
// Setup: https://developers.facebook.com/ → app with Threads API → OAuth.
// Long-lived tokens last 60 days; refreshable.
// ════════════════════════════════════════════════════════════════

const API_BASE = 'https://graph.threads.net/v1.0';

export function isConfigured(): boolean {
  return !!(process.env.THREADS_ACCESS_TOKEN && process.env.THREADS_USER_ID);
}

export type ThreadResult =
  | { ok: true; thread_id: string; url: string }
  | { ok: false; error: string };

/**
 * Post a text-only Threads post. Limit 500 chars.
 */
export async function postThread(text: string): Promise<ThreadResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'Threads API credentials not configured' };
  }
  if (text.length > 500) {
    return { ok: false, error: `thread too long: ${text.length} > 500` };
  }
  const userId = process.env.THREADS_USER_ID!;
  const token = process.env.THREADS_ACCESS_TOKEN!;

  try {
    // Step 1 — create media container
    const createUrl = `${API_BASE}/${encodeURIComponent(userId)}/threads`;
    const createBody = new URLSearchParams({
      media_type: 'TEXT',
      text,
      access_token: token,
    });
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
    });
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
      return { ok: false, error: `Threads create ${createRes.status}: ${t.slice(0, 300)}` };
    }
    const createData: any = await createRes.json();
    const containerId = createData.id;
    if (!containerId) return { ok: false, error: 'Threads returned no container id' };

    // Step 2 — publish container
    const pubUrl = `${API_BASE}/${encodeURIComponent(userId)}/threads_publish`;
    const pubBody = new URLSearchParams({
      creation_id: containerId,
      access_token: token,
    });
    const pubRes = await fetch(pubUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: pubBody.toString(),
    });
    if (!pubRes.ok) {
      const t = await pubRes.text().catch(() => '');
      return { ok: false, error: `Threads publish ${pubRes.status}: ${t.slice(0, 300)}` };
    }
    const pubData: any = await pubRes.json();
    const threadId = pubData.id;
    if (!threadId) return { ok: false, error: 'Threads returned no thread id' };

    // Resolve handle for the URL — best-effort
    let handle = '';
    try {
      const meRes = await fetch(`${API_BASE}/me?fields=username&access_token=${encodeURIComponent(token)}`);
      const me: any = await meRes.json();
      handle = me?.username || '';
    } catch { /* non-fatal */ }
    const url = handle
      ? `https://www.threads.net/@${handle}/post/${threadId}`
      : `https://www.threads.net/post/${threadId}`;

    return { ok: true, thread_id: threadId, url };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Threads post failed' };
  }
}

/**
 * Fetch engagement metrics for a posted thread.
 */
export async function fetchThreadMetrics(threadId: string): Promise<{
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
} | null> {
  if (!isConfigured()) return null;
  try {
    const url = `${API_BASE}/${threadId}/insights?metric=views,likes,replies,reposts&access_token=${encodeURIComponent(process.env.THREADS_ACCESS_TOKEN!)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const out: any = {};
    for (const m of data.data || []) {
      const value = m.values?.[0]?.value;
      if (m.name === 'views') out.views = value;
      if (m.name === 'likes') out.likes = value;
      if (m.name === 'replies') out.replies = value;
      if (m.name === 'reposts') out.reposts = value;
    }
    return out;
  } catch {
    return null;
  }
}
