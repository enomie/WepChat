export function createUrlState() {
  let url = $state<string>('');

  function cleanUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.protocol.startsWith('http')) return '';
      return parsed.origin + parsed.pathname;
    } catch {
      return '';
    }
  }

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
