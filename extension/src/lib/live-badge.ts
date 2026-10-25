import { escapeSqlStringLiteral } from './sql-literal-escape.ts';

export const SPACETIMEDB_SQL_URL =
  'https://maincloud.spacetimedb.com/v1/database/wepchat/sql';
export const BADGE_COLOR = '#2563EB';
export const LIVE_BADGE_CACHE_TTL_MS = 10_000;
export const LIVE_BADGE_POLL_PERIOD_MINUTES = 1;
export const LIVE_BADGE_ALARM_NAME = 'wepchat-live-badge-poll';

type CacheEntry = { count: number; timestamp: number };

const countCache = new Map<string, CacheEntry>();

/**
 * Formatiert den Badge-Text:
 * <= 1: leer (kein visueller Lärm)
 * 2 - 999: genaue Zahl
 * >= 1000: "99+"
 */
export function formatBadgeText(count: number): string {
  if (count <= 1) return '';
  if (count > 999) return '99+';
  return String(count);
}

export function parseOnlineCountSqlResponse(data: unknown): number {
  const raw = (data as { rows?: unknown[][] }[])?.[0]?.rows?.[0]?.[0];
  const count = Number(raw ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export function buildOnlineCountSql(url: string): string {
  return `SELECT count(*) as total FROM user_session WHERE current_url = '${escapeSqlStringLiteral(url)}'`;
}

export function getCachedOnlineCount(
  url: string,
  now: number = Date.now(),
  ttlMs: number = LIVE_BADGE_CACHE_TTL_MS,
): number | null {
  const cached = countCache.get(url);
  if (!cached || now - cached.timestamp >= ttlMs) return null;
  return cached.count;
}

export function setCachedOnlineCount(url: string, count: number, now: number = Date.now()): void {
  countCache.set(url, { count, timestamp: now });
}

/** Test helper: clears in-memory URL cache. */
export function clearOnlineCountCache(): void {
  countCache.clear();
}

export interface FetchOnlineCountOptions {
  bypassCache?: boolean;
  now?: number;
}

/**
 * Fragt die SpacetimeDB per leichtem HTTP-SQL-Endpoint ab.
 */
export async function fetchOnlineCount(
  url: string,
  options: FetchOnlineCountOptions = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  if (!options.bypassCache) {
    const cached = getCachedOnlineCount(url, now);
    if (cached !== null) return cached;
  }

  const query = buildOnlineCountSql(url);

  try {
    const response = await fetch(SPACETIMEDB_SQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    });

    if (!response.ok) return 0;
    const data = await response.json();
    const count = parseOnlineCountSqlResponse(data);

    setCachedOnlineCount(url, count, now);
    return count;
  } catch (err) {
    console.warn('[WepChat Background] Fehler beim Abrufen des Online-Counts:', err);
    return 0;
  }
}
