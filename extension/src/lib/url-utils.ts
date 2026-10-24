/**
 * Liste bekannter Tracking- und Session-Parameter, die niemals
 * identitätsstiftend für den Inhalt einer Seite sind.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'ref_',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_eid',
  'zanpid',
  'igshid',
  'si', // Spotify / YouTube share tracker
  'feature', // YouTube share tracker
  'spm_id_from', // Bilibili tracker
  'from_source',
  'session_id',
  'sessionId',
]);

const LOCALHOST_NAMES = new Set(['localhost', 'localhost.localdomain']);

/** Max byte length for chat room URLs after normalization (server: MAX_URL_LEN). */
export const MAX_CHAT_URL_LEN = 2048;

export type TabChatUrlState =
  | { kind: 'none' }
  | { kind: 'unsupported' }
  | { kind: 'ready'; url: string };

function parseIpv4Octets(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Host blocklist for chat rooms (local/private only, not content categories). */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (LOCALHOST_NAMES.has(host)) return true;
  if (host === '0.0.0.0') return true;

  if (host.includes(':')) {
    if (host === '::1') return true;
    if (host.startsWith('fe80:')) return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true;
    return false;
  }

  const octets = parseIpv4Octets(host);
  if (!octets) return false;

  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;

  return false;
}

export function isChatEligibleParsedUrl(parsed: URL): boolean {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return !isPrivateOrLocalHost(parsed.hostname);
}

export function resolveTabChatUrl(rawUrl: string | undefined): TabChatUrlState {
  if (!rawUrl?.trim()) return { kind: 'none' };
  try {
    const parsed = new URL(rawUrl);
    if (!isChatEligibleParsedUrl(parsed)) {
      return { kind: 'unsupported' };
    }
  } catch {
    return { kind: 'none' };
  }

  const url = cleanUrl(rawUrl);
  if (!url) return { kind: 'none' };
  return { kind: 'ready', url };
}

/**
 * Normalisiert eine Web-URL semantisch:
 * 1. Nur öffentliche http(s)-URLs (siehe url-eligibility.md)
 * 2. Plattform-Ausnahmen (YouTube, Amazon, etc.)
 * 3. Bereinigung von Tracking- und Session-Parametern
 * 4. Entfernung von URL-Hashes (#anchors)
 */
export function cleanUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!isChatEligibleParsedUrl(parsed)) return '';

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    // 1. YouTube
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        const videoId = parsed.searchParams.get('v');
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
      // YouTube Shorts: https://www.youtube.com/shorts/{id}
      if (parsed.pathname.startsWith('/shorts/')) {
        const parts = parsed.pathname.split('/');
        const id = parts[2];
        if (id) {
          return `https://www.youtube.com/watch?v=${id}`;
        }
      }
    } else if (hostname === 'youtu.be') {
      // youtu.be/ID Shortlink
      const id = parsed.pathname.replace(/^\//, '').split('/')[0];
      if (id) {
        return `https://www.youtube.com/watch?v=${id}`;
      }
    }

    // 2. Amazon (amazon.de, amazon.com, etc.)
    if (hostname.includes('amazon.')) {
      const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      const asin = asinMatch?.[1];
      if (asin) {
        return `https://${hostname}/dp/${asin.toUpperCase()}`;
      }
    }

    // 3. Google Suche
    if (hostname.includes('google.') && parsed.pathname === '/search') {
      const query = parsed.searchParams.get('q');
      if (query) {
        return `https://${hostname}/search?q=${encodeURIComponent(query)}`;
      }
    }

    // 4. Reddit
    if (hostname.includes('reddit.com')) {
      const redditMatch = parsed.pathname.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
      const subreddit = redditMatch?.[1];
      const postId = redditMatch?.[2];
      if (subreddit && postId) {
        return `https://www.reddit.com/r/${subreddit.toLowerCase()}/comments/${postId}/`;
      }
    }

    // 5. Generischer Standard-Pfad:
    // Tracking-Parameter entfernen, alle anderen (z. B. ?id=123, ?page=2) sortiert behalten
    const searchParams = new URLSearchParams();
    parsed.searchParams.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (!TRACKING_PARAMS.has(lowerKey) && !lowerKey.startsWith('utm_')) {
        searchParams.append(key, val);
      }
    });

    searchParams.sort();
    const query = searchParams.toString();

    // Trailing Slash entfernen (außer bei Root "/")
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const result = `${parsed.origin}${pathname}${query ? `?${query}` : ''}`;
    if (result.length > MAX_CHAT_URL_LEN) return '';
    return result;
  } catch {
    return '';
  }
}
