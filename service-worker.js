// Service Worker for Gemini Bulk Studio Extension
chrome.action.onClicked.addListener(async () => {
  // Check if studio tab is already open
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('studio.html') });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') });
  }
});
