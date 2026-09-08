chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void chrome.windows.create({
    url: chrome.runtime.getURL(`importer.html?tab=${tab.id}`),
    type: "popup",
    width: 520,
    height: 740,
  });
});
