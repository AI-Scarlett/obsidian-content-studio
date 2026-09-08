import { handoffPageUrl } from "./handoff";
import {
  launchErrors,
  type LaunchError,
  type LaunchReply,
} from "./launch-protocol";

const page = handoffPageUrl(location.href);
if (page && window.top === window) {
  const version = chrome.runtime.getManifest().version;
  let state: "connecting" | "opening" | "error" = "connecting";
  let error: LaunchError | undefined;
  let pending = false;
  const announce = () => {
    window.postMessage(
      {
        type: "mogao-extension-ready",
        version,
        state,
        error,
      },
      location.origin,
    );
  };
  const fail = (reason: LaunchError) => {
    state = "error";
    error = reason;
    // Also make failures visible in the older /install page, which has no page script.
    const label =
      document.getElementById("state") || document.querySelector("h1");
    if (label) label.textContent = launchErrors[reason];
    announce();
  };
  const start = async () => {
    if (pending || state === "opening") {
      announce();
      return;
    }
    pending = true;
    state = "connecting";
    error = undefined;
    // Presence is independent of service-worker startup or navigation success.
    announce();
    let timeout: number | undefined;
    try {
      const reply: LaunchReply | undefined = await Promise.race([
        chrome.runtime.sendMessage({
          op: "publish",
          url: page.href,
        }) as Promise<LaunchReply | undefined>,
        new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error("worker-timeout")),
            8000,
          );
        }),
      ]);
      if (reply?.ok) {
        // A navigation error may arrive before the accepted response is delivered.
        if (!error) {
          state = "opening";
          announce();
        }
      } else fail(reply?.error || "worker-unavailable");
    } catch {
      fail("worker-unavailable");
    } finally {
      window.clearTimeout(timeout);
      pending = false;
    }
  };
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !event.data ||
      typeof event.data !== "object" ||
      !("type" in event.data)
    )
      return;
    if (event.data.type === "mogao-launch-probe") announce();
    if (event.data.type === "mogao-launch-retry") {
      // The user may retry a stuck navigation; the background rechecks the current tab.
      if (!pending) state = "connecting";
      void start();
    }
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      typeof message !== "object" ||
      !("op" in message) ||
      message.op !== "mogao-launch-error" ||
      !("error" in message)
    )
      return;
    if (
      typeof message.error === "string" &&
      Object.hasOwn(launchErrors, message.error)
    )
      fail(message.error as LaunchError);
  });
  void start();
}
