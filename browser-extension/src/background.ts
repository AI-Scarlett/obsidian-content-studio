import { handoffUrl } from "./handoff";
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined
  )
    return;
  if (message?.op !== "publish") return;
  const url = handoffUrl(message.url);
  if (!url || sender.url !== url.href || sender.tab.url !== url.href) return;
  // Reuse the one handoff tab; the controller will open a fresh platform draft.
  void chrome.tabs
    .update(sender.tab.id, {
      url: chrome.runtime.getURL(
        `importer.html?job=${encodeURIComponent(url.href)}`,
      ),
    })
    .then(() => respond({ ok: true }))
    .catch(() => respond({ ok: false }));
  return true;
});
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("importer.html") });
});
