import { handoffPageUrl, publishUrl } from "./handoff";
import type { LaunchError, LaunchReply } from "./launch-protocol";

const opening = new Map<number, string>();
let waking: Promise<void> | undefined;
async function wakeStudio() {
  // Keep the current platform/draft tab intact. This page remains available if
  // the browser requires external-app confirmation or Obsidian is not installed.
  const page = await chrome.tabs.create({
    url: chrome.runtime.getURL("open-studio.html"),
  });
  if (page.id !== undefined)
    await chrome.tabs.update(page.id, { url: "obsidian://content-studio" });
}
const accepted = (): LaunchReply => ({
  ok: true,
  version: chrome.runtime.getManifest().version,
});
async function launch(
  tabId: number,
  page: URL,
  respond: (reply: LaunchReply) => void = () => {},
) {
  if (opening.has(tabId)) {
    respond(
      opening.get(tabId) === page.href
        ? accepted()
        : { ok: false, error: "tab-changed" },
    );
    return;
  }
  opening.set(tabId, page.href);
  let error: LaunchError = "open-failed";
  let acknowledged = false;
  try {
    const current = await chrome.tabs.get(tabId);
    // Validate the actual current page, not the potentially stale sender.tab snapshot.
    if (
      current.url !== page.href ||
      (current.pendingUrl && current.pendingUrl !== page.href)
    ) {
      error = "tab-changed";
      throw new Error(error);
    }
    // Acknowledge before navigation destroys the content-script message channel.
    respond(accepted());
    acknowledged = true;
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(
        `importer.html?job=${encodeURIComponent(publishUrl(page).href)}`,
      ),
    });
  } catch {
    if (!acknowledged) respond({ ok: false, error });
    await chrome.tabs
      .sendMessage(tabId, { op: "mogao-launch-error", error }, { frameId: 0 })
      .catch(() => {});
  } finally {
    opening.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined
  )
    return;
  if (
    !message ||
    typeof message !== "object" ||
    !("op" in message) ||
    message.op !== "publish" ||
    !("url" in message)
  )
    return;
  const page = handoffPageUrl(message.url);
  if (!page || sender.url !== page.href) return;
  void launch(sender.tab.id, page, respond);
  return true;
});
chrome.action.onClicked.addListener((tab) => {
  const page = handoffPageUrl(tab.url);
  if (page && tab.id !== undefined) {
    // Resume this draft even on an old installation guide with no injected launcher.
    void launch(tab.id, page);
  } else {
    waking ??= wakeStudio()
      // The opening page provides a normal clickable URI for a manual retry.
      .catch(() => {})
      .finally(() => {
        waking = undefined;
      });
  }
});
