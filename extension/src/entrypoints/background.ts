import { cleanUrl } from '@/lib/url-utils';
import {
  BADGE_COLOR,
  fetchOnlineCount,
  formatBadgeText,
  LIVE_BADGE_ALARM_NAME,
  LIVE_BADGE_POLL_PERIOD_MINUTES,
} from '@/lib/live-badge';

/**
 * Aktualisiert den Badge für einen spezifischen Tab
 */
async function updateBadgeForTab(
  tabId: number,
  rawUrl?: string,
  options?: { bypassCache?: boolean },
) {
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

  const count = await fetchOnlineCount(url, { bypassCache: options?.bypassCache });
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

async function refreshActiveTabBadge(bypassCache = false) {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;
  await updateBadgeForTab(tab.id, tab.url, { bypassCache });
}

export default defineBackground(() => {
  // Chrome-only: Side Panel (Firefox nutzt sidebar_action im Manifest)
  const sidePanel = chrome.sidePanel;
  if (sidePanel?.setPanelBehavior) {
    sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.error('Fehler bei setPanelBehavior:', error));
  }

  browser.alarms
    .create(LIVE_BADGE_ALARM_NAME, { periodInMinutes: LIVE_BADGE_POLL_PERIOD_MINUTES })
    .catch((error: unknown) => console.error('[WepChat] live badge alarm create:', error));

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== LIVE_BADGE_ALARM_NAME) return;
    void refreshActiveTabBadge(true);
  });

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
