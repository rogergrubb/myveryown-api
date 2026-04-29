// ═══════════════════════════════════════
// CORTEX MEMORY CLIENT
// Connects to the Cortex instance deployed at Railway.
// Each persona × user combo gets its own memory namespace.
// ═══════════════════════════════════════

const CORTEX_URL = process.env.CORTEX_URL || '';
const CORTEX_API_KEY = process.env.CORTEX_API_KEY || '';

type MemoryEntry = {
  id: string;
  content: string;
  timestamp: number;
  relevance?: number;
};

/**
 * Build a namespace key. Two modes:
 *
 * UNIFIED (preferred, post-2026-04-26): one shared thread per user/session
 *   nsKey(sessionOrUserId)   ->  "session_abc123"
 *   - All 20 personas write into & read from the same namespace.
 *   - Each memory entry has the persona stamped in the content body
 *     ("[Iron Brother] User said ... / Iron Brother responded ...").
 *   - The LLM sees the full cross-persona history and can reason about
 *     who said what.
 *
 * LEGACY (kept for old call sites + old data): per-persona thread
 *   nsKey(persona, sessionOrUserId)  ->  "kpop:session_abc123"
 *   - Used for backwards-compat reads only; not used by /api/chat anymore.
 */
export function nsKey(personaOrId: string, sessionOrUserId?: string): string {
  if (sessionOrUserId === undefined) {
    // Unified mode — single arg = the user/session id only
    return personaOrId;
  }
  // Legacy two-arg mode
  return `${personaOrId}:${sessionOrUserId}`;
}

export async function recordMemory(
  namespace: string,
  userMessage: string,
  aiResponse: string,
  personaLabel?: string,        // e.g. "Iron Brother" — stamped into memory body
): Promise<void> {
  if (!CORTEX_URL) {
    console.warn('[cortex] CORTEX_URL not configured, skipping memory write');
    return;
  }
  // In unified mode every entry tells future readers WHICH persona spoke.
  const stamp = personaLabel ? `[${personaLabel}]\n` : '';
  try {
    const res = await fetch(`${CORTEX_URL}/api/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CORTEX_API_KEY ? { 'Authorization': `Bearer ${CORTEX_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        namespace,
        content: `${stamp}User: ${userMessage}\nAssistant: ${aiResponse}`,
        metadata: { timestamp: Date.now(), persona: personaLabel ?? null },
      }),
    });
    if (!res.ok) {
      console.error('[cortex] write failed', res.status, await res.text());
    }
  } catch (err) {
    console.error('[cortex] write error', err);
  }
}

export async function recallMemories(namespace: string, query: string, limit = 5): Promise<MemoryEntry[]> {
  if (!CORTEX_URL) return [];
  try {
    const url = new URL(`${CORTEX_URL}/api/memories/search`);
    url.searchParams.set('namespace', namespace);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url, {
      headers: { ...(CORTEX_API_KEY ? { 'Authorization': `Bearer ${CORTEX_API_KEY}` } : {}) },
    });
    if (!res.ok) {
      console.error('[cortex] recall failed', res.status);
      return [];
    }
    const data = await res.json() as { memories?: MemoryEntry[] };
    return data.memories ?? [];
  } catch (err) {
    console.error('[cortex] recall error', err);
    return [];
  }
}

/**
 * When an anonymous session signs up, migrate their memory namespace.
 * kpop:session_abc → kpop:user_xyz
 */
export async function migrateNamespace(fromNs: string, toNs: string): Promise<void> {
  if (!CORTEX_URL) return;
  try {
    await fetch(`${CORTEX_URL}/api/memories/migrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CORTEX_API_KEY ? { 'Authorization': `Bearer ${CORTEX_API_KEY}` } : {}),
      },
      body: JSON.stringify({ from: fromNs, to: toNs }),
    });
  } catch (err) {
    console.error('[cortex] migrate error', err);
  }
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '(no previous conversations yet — this is your first chat)';
  return memories
    .map((m, i) => `[${i + 1}] ${m.content}`)
    .join('\n\n');
}
