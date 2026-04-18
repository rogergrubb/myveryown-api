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
 * Build a namespace key for this user-persona combination.
 * Anonymous sessions: kpop:session_abc123
 * Authenticated users: kpop:user_xyz789
 */
export function nsKey(persona: string, sessionOrUserId: string): string {
  return `${persona}:${sessionOrUserId}`;
}

export async function recordMemory(namespace: string, userMessage: string, aiResponse: string): Promise<void> {
  if (!CORTEX_URL) {
    console.warn('[cortex] CORTEX_URL not configured, skipping memory write');
    return;
  }
  try {
    const res = await fetch(`${CORTEX_URL}/api/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CORTEX_API_KEY ? { 'Authorization': `Bearer ${CORTEX_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        namespace,
        content: `User: ${userMessage}\nAssistant: ${aiResponse}`,
        metadata: { timestamp: Date.now() },
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
