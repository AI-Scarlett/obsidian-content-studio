import { handoffUrl } from "./handoff";
const url = handoffUrl(location.href);
if (url && window.top === window) {
  // A handshake is acknowledged only after the background accepts this exact tab URL.
  void chrome.runtime
    .sendMessage({ op: "publish", url: url.href })
    .then((reply) => {
      if (reply?.ok)
        window.postMessage({ type: "mogao-extension-ready" }, location.origin);
    })
    .catch(() => {
      /* local launcher will show installation onboarding */
    });
}
