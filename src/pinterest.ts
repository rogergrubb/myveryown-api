// ════════════════════════════════════════════════════════════════
// Pinterest API v5 client
// ────────────────────────────────────────────────────────────────
// Reads access token from env. Pinterest uses a single bearer token
// (not OAuth 1.0a like X). Roger generates this once via the
// Pinterest Developer console: https://developers.pinterest.com/
//
//   PINTEREST_ACCESS_TOKEN  — long-lived bearer (60 days, refreshable)
//   PINTEREST_DEFAULT_BOARD_ID  — board id pins land in by default
//
// Without both, isConfigured() returns false. The scheduler still
// records the pin into content_queue with platform='pinterest' but
// won't try to publish.
// ════════════════════════════════════════════════════════════════

const API_BASE = 'https://api.pinterest.com/v5';

export function isConfigured(): boolean {
  return !!(process.env.PINTEREST_ACCESS_TOKEN && process.env.PINTEREST_DEFAULT_BOARD_ID);
}

export type PinResult =
  | { ok: true; pin_id: string; url: string }
  | { ok: false; error: string };

/**
 * Create a Pin on the configured default board.
 *
 * @param title       Pin title — under 100 chars, keyword-rich
 * @param description Pin body — under 500 chars, link-promoting
 * @param link        Destination URL (where a click takes the user)
 * @param imageUrl    Public URL of the pin image (usually a /og/<persona>.png on the site)
 * @param altText     Accessibility text for the pin image
 */
export async function postPin(params: {
  title: string;
  description: string;
  link: string;
  imageUrl: string;
  altText?: string;
  boardId?: string;
}): Promise<PinResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'Pinterest API credentials not configured' };
  }
  // Pinterest enforces these caps; surface clear errors so the caller can fix upstream.
  if (params.title.length > 100) return { ok: false, error: `pin title too long: ${params.title.length} > 100` };
  if (params.description.length > 500) return { ok: false, error: `pin description too long: ${params.description.length} > 500` };

  const boardId = params.boardId || process.env.PINTEREST_DEFAULT_BOARD_ID!;
  const body = {
    board_id: boardId,
    link: params.link,
    title: params.title,
    description: params.description,
    alt_text: params.altText || params.title,
    media_source: {
      source_type: 'image_url',
      url: params.imageUrl,
    },
  };

  try {
    const res = await fetch(`${API_BASE}/pins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Pinterest API ${res.status}: ${text.slice(0, 300)}` };
    }
    const data: any = await res.json();
    const pinId = data.id;
    if (!pinId) return { ok: false, error: 'Pinterest returned no pin id' };
    return { ok: true, pin_id: pinId, url: `https://www.pinterest.com/pin/${pinId}/` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Pinterest post failed' };
  }
}

/**
 * Fetch a pin's analytics. Pinterest exposes saves, clicks, impressions, etc.
 */
export async function fetchPinMetrics(pinId: string): Promise<{
  saves?: number;
  clicks?: number;
  impressions?: number;
} | null> {
  if (!isConfigured()) return null;
  try {
    // Pinterest analytics endpoint — last 30 days lifetime metrics
    const res = await fetch(`${API_BASE}/pins/${pinId}/analytics?metric_types=SAVE,PIN_CLICK,IMPRESSION&start_date=${new Date(Date.now() - 30*24*3600_000).toISOString().slice(0,10)}&end_date=${new Date().toISOString().slice(0,10)}`, {
      headers: { Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const m = data.all?.lifetime_metrics || data.lifetime_metrics || {};
    return {
      saves: m.SAVE,
      clicks: m.PIN_CLICK,
      impressions: m.IMPRESSION,
    };
  } catch {
    return null;
  }
}

/**
 * List boards the authenticated user has access to. Used during setup
 * to help Roger pick which board id to write to.
 */
export async function listBoards(): Promise<Array<{ id: string; name: string }>> {
  if (!process.env.PINTEREST_ACCESS_TOKEN) return [];
  try {
    const res = await fetch(`${API_BASE}/boards?page_size=50`, {
      headers: { Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}` },
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.items || []).map((b: any) => ({ id: b.id, name: b.name }));
  } catch {
    return [];
  }
}
