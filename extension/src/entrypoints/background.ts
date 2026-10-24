import { cleanUrl } from '@/lib/url-utils';

const SPACETIMEDB_SQL_URL = 'https://maincloud.spacetimedb.com/v1/database/wepchat/sql';
const BADGE_COLOR = '#2563EB'; // WepChat Blau

// Kurzer In-Memory Cache pro URL (10s), um redundante Requests beim schnellen Hin- und Herwechseln zu minimieren
const countCache = new Map<string, { count: number; timestamp: number }>();
const CACHE_TTL_MS = 10_000;

/**
 * Fragt die SpacetimeDB per leichtem HTTP-SQL-Endpoint ab
 */
async function fetchOnlineCount(url: string): Promise<number> {
  const cached = countCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.count;
  }

  // Escape einfaches Anführungszeichen für SQL
  const escapedUrl = url.replace(/'/g, "''");
  const query = `SELECT count(*) as total FROM user_session WHERE current_url = '${escapedUrl}'`;

  try {
    const response = await fetch(SPACETIMEDB_SQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    });

    if (!response.ok) return 0;
    const data = await response.json();
    const count = Number(data?.[0]?.rows?.[0]?.[0] ?? 0);

    countCache.set(url, { count, timestamp: Date.now() });
    return count;
  } catch (err) {
    console.warn('[WepChat Background] Fehler beim Abrufen des Online-Counts:', err);
    return 0;
  }
}

/**
 * Formatiert den Badge-Text:
 * <= 1: leer (kein visueller Lärm)
 * 2 - 999: genaue Zahl
 * >= 1000: "99+"
 */
function formatBadgeText(count: number): string {
  if (count <= 1) return '';
  if (count > 999) return '99+';
  return String(count);
}

/**
 * Aktualisiert den Badge für einen spezifischen Tab
 */
async function updateBadgeForTab(tabId: number, rawUrl?: string) {
  if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) return;

  if (!rawUrl) {
    try {
      const tab = await chrome.tabs.get(tabId);
      rawUrl = tab?.url;
    } catch {
      return;
    }
  }

  const url = cleanUrl(rawUrl || '');
  if (!url) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    return;
  }

  const count = await fetchOnlineCount(url);
  const badgeText = formatBadgeText(count);

  try {
    await chrome.action.setBadgeText({ text: badgeText, tabId });
    if (badgeText) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
    }
  } catch (err) {
    // Tab eventuell schon geschlossen
  }
}

export default defineBackground(() => {
  // 1. Öffnet das Sidepanel bei Klick auf das Extension-Icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.error('Fehler bei setPanelBehavior:', error));
  }

  // Fallback: Falls setPanelBehavior nicht sofort greift
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.windowId && chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
  });

  // 2. Tab-Wechsel: Nutzer aktiviert einen anderen Tab
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await updateBadgeForTab(activeInfo.tabId);
  });

  // 3. Tab-Update: URL hat sich im Tab geändert oder Seite ist fertig geladen
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      await updateBadgeForTab(tabId, tab.url);
    }
  });
});
