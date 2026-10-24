import { cleanUrl } from './url-utils';

export { cleanUrl };

export function createUrlState() {
  let url = $state<string>('');

  async function updateActiveUrl() {
    if (typeof browser !== 'undefined' && browser.tabs) {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          url = cleanUrl(tab.url);
        }
      } catch (err) {
        console.error('Fehler beim Abrufen des Tabs:', err);
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
    get current() {
      return url;
    },
  };
}

export const urlState = createUrlState();
