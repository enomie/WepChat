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

/**
 * Normalisiert eine Web-URL semantisch:
 * 1. Plattform-Ausnahmen (YouTube, Amazon, etc.), bei denen Parameter den Inhalt bestimmen
 * 2. Bereinigung von Tracking- und Session-Parametern
 * 3. Entfernung von URL-Hashes (#anchors)
 */
export function cleanUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.protocol.startsWith('http')) return '';

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

    return `${parsed.origin}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return '';
  }
}
