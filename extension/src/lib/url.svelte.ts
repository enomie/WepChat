import { cleanUrl, resolveTabChatUrl, type TabChatUrlState } from './url-utils';

export { cleanUrl, type TabChatUrlState };

export function createUrlState() {
  let tabState = $state<TabChatUrlState>({ kind: 'none' });

  async function updateActiveUrl() {
    if (typeof browser !== 'undefined' && browser.tabs) {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabState = resolveTabChatUrl(tab?.url);
      } catch (err) {
        console.error('Fehler beim Abrufen des Tabs:', err);
        tabState = { kind: 'none' };
      }
    }
  }

  updateActiveUrl();

  if (typeof browser !== 'undefined' && browser.tabs) {
    browser.tabs.onActivated.addListener(() => updateActiveUrl());
    browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.url) updateActiveUrl();
    });
  }

  return {
    get tab() {
      return tabState;
    },
    get current() {
      return tabState.kind === 'ready' ? tabState.url : '';
    },
  };
}

export const urlState = createUrlState();
