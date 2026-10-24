export default defineBackground(() => {
  // Öffnet das Sidepanel bei Klick auf das Extension-Icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error('Fehler bei setPanelBehavior:', error));
  }

  // Fallback: Falls setPanelBehavior nicht sofort greift
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.windowId && chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
  });
});
