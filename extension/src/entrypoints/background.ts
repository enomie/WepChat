import { cleanUrl } from '@/lib/url-utils';
import { escapeSqlStringLiteral } from '@/lib/sql-literal-escape';

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

  const query = `SELECT count(*) as total FROM user_session WHERE current_url = '${escapeSqlStringLiteral(url)}'`;

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
  if (!tabId || tabId === browser.tabs.TAB_ID_NONE) return;

  if (!rawUrl) {
    try {
      const tab = await browser.tabs.get(tabId);
      rawUrl = tab?.url;
    } catch {
      return;
    }
  }

  const url = cleanUrl(rawUrl || '');
  if (!url) {
    browser.action.setBadgeText({ text: '', tabId }).catch(() => {});
    return;
  }

  const count = await fetchOnlineCount(url);
  const badgeText = formatBadgeText(count);

  try {
    await browser.action.setBadgeText({ text: badgeText, tabId });
    if (badgeText) {
      await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
    }
  } catch {
    // Tab eventuell schon geschlossen
  }
}

export default defineBackground(() => {
  // Chrome-only: Side Panel (Firefox nutzt sidebar_action im Manifest)
  const sidePanel = chrome.sidePanel;
  if (sidePanel?.setPanelBehavior) {
    sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.error('Fehler bei setPanelBehavior:', error));
  }

  // Fallback: Falls setPanelBehavior nicht sofort greift
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.windowId && sidePanel?.open) {
      await sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
  });

  browser.tabs.onActivated.addListener(async (activeInfo) => {
    await updateBadgeForTab(activeInfo.tabId);
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      await updateBadgeForTab(tabId, tab.url);
    }
  });
});
