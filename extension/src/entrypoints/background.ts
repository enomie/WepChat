export default defineBackground(() => {
  // Chrome-only: Side Panel (Firefox nutzt sidebar_action im Manifest)
  const sidePanel = chrome.sidePanel;
  if (sidePanel?.setPanelBehavior) {
    sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.error('Fehler bei setPanelBehavior:', error));
  }

  browser.action.setBadgeText({ text: '' }).catch(() => {});

  // Fallback: Falls setPanelBehavior nicht sofort greift
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.windowId && sidePanel?.open) {
      await sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
  });
});
