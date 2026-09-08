import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const bundles = await Promise.all(
  ["background", "launcher"].map(async (name) => {
    const result = await build({
      entryPoints: [`browser-extension/src/${name}.ts`],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "chrome120",
    });
    return result.outputFiles[0].text;
  }),
);
const extension = "a".repeat(32);
const publish = `http://127.0.0.1:54321/publish/${"b".repeat(64)}`;
const recovery = publish.replace("/publish/", "/install/publish/");
const importer = `chrome-extension://${extension}/importer.html`;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function background(page = publish, fails = false) {
  let onMessage: any, onClick: any;
  const order: string[] = [],
    updates: any[] = [],
    notices: any[] = [],
    created: any[] = [];
  const current: any = { id: 1, url: page };
  const chrome = {
    runtime: {
      id: extension,
      getManifest: () => ({ version: "0.2.1" }),
      getURL: (path: string) => `chrome-extension://${extension}/${path}`,
      onMessage: {
        addListener: (fn: any) => {
          onMessage = fn;
        },
      },
    },
    action: {
      onClicked: {
        addListener: (fn: any) => {
          onClick = fn;
        },
      },
    },
    tabs: {
      get: async () => current,
      update: async (id: number, options: any) => {
        order.push("navigate");
        updates.push({ id, ...options });
        if (fails) throw new Error("navigation failed");
        current.url = options.url;
      },
      create: async (options: any) => {
        created.push(options);
      },
      sendMessage: async (...args: any[]) => {
        notices.push(args);
      },
    },
  };
  vm.runInNewContext(bundles[0], { chrome, URL });
  const responses: any[] = [];
  return {
    current,
    order,
    updates,
    notices,
    created,
    responses,
    click: (tab = { id: 1, url: page }) => onClick(tab),
    message: (
      message: any = { op: "publish", url: page },
      sender: any = {
        id: extension,
        frameId: 0,
        tab: { id: 1, url: page },
        url: page,
      },
    ) =>
      onMessage(message, sender, (response: any) => {
        order.push("acknowledge");
        responses.push(response);
      }),
  };
}
test("background acknowledges before navigation; publish and recovery pages hand off the same job", async () => {
  for (const page of [publish, recovery]) {
    const f = background(page);
    assert.equal(f.message(), true);
    await settle();
    assert.deepEqual(f.order, ["acknowledge", "navigate"]);
    assert.equal(f.responses[0].version, "0.2.1");
    assert.equal(new URL(f.updates[0].url).searchParams.get("job"), publish);
    assert.equal(f.created.length, 0);
  }
});
test("toolbar resumes the current recovery page; concurrent auto-start never navigates twice", async () => {
  const f = background(recovery);
  f.click();
  f.message();
  f.click();
  await settle();
  assert.equal(f.updates.length, 1);
  assert.equal(new URL(f.updates[0].url).searchParams.get("job"), publish);
  assert.equal(f.created.length, 0);
  f.click({ id: 1, url: f.updates[0].url });
  assert.equal(f.created.length, 0);
  f.click({ id: 2, url: "https://example.com/" });
  assert.equal(f.created[0].url, importer);
});
test("navigation failures are delivered separately after acknowledgement", async () => {
  const f = background(publish, true);
  f.message();
  await settle();
  assert.equal(f.responses.length, 1);
  assert.equal(f.responses[0].ok, true);
  assert.equal(f.notices[0][1].error, "open-failed");
});
test("background validates sender and live tab ownership, including pending navigation", async () => {
  const sender = {
    id: extension,
    frameId: 0,
    tab: { id: 1, url: publish },
    url: publish,
  };
  for (const changes of [
    { id: "b".repeat(32) },
    { frameId: 1 },
    { url: recovery },
  ]) {
    const f = background();
    assert.equal(
      f.message({ op: "publish", url: publish }, { ...sender, ...changes }),
      undefined,
    );
    await settle();
    assert.equal(f.updates.length, 0);
  }
  for (const changes of [
    { url: "https://example.com/" },
    { pendingUrl: "https://example.com/" },
  ]) {
    const f = background();
    Object.assign(f.current, changes);
    f.message();
    await settle();
    assert.equal(f.responses[0].error, "tab-changed");
    assert.equal(f.updates.length, 0);
  }
  const f = background();
  f.message(
    { op: "publish", url: publish },
    { ...sender, tab: { id: 1, url: "stale snapshot" } },
  );
  await settle();
  assert.equal(f.updates.length, 1);
});

function launcher(page = publish) {
  const dom = new JSDOM('<h1>先安装墨稿浏览器扩展</h1><p id="state"></p>', {
    url: page,
    runScripts: "outside-only",
  });
  const win = dom.window as any;
  const outbound: any[] = [],
    requests: any[] = [],
    replies: ((value: any) => void)[] = [];
  const timers = new Map<number, () => void>();
  let sequence = 0,
    onMessage: any;
  win.setTimeout = (fn: () => void) => {
    const id = ++sequence;
    timers.set(id, fn);
    return id;
  };
  win.clearTimeout = (id: number) => {
    timers.delete(id);
  };
  win.postMessage = (data: any) => {
    outbound.push(data);
  };
  win.chrome = {
    runtime: {
      id: extension,
      getManifest: () => ({ version: "0.2.1" }),
      sendMessage: (message: any) => {
        requests.push(message);
        return new Promise((resolve) => replies.push(resolve));
      },
      onMessage: {
        addListener: (fn: any) => {
          onMessage = fn;
        },
      },
    },
  };
  win.eval(bundles[1]);
  return {
    win,
    outbound,
    requests,
    replies,
    tick: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((fn) => fn());
    },
    error: (error: string) =>
      onMessage({ op: "mogao-launch-error", error }, { id: extension }),
    message: (type: string, origin = win.location.origin) =>
      win.dispatchEvent(
        new win.MessageEvent("message", {
          data: { type },
          source: win,
          origin,
        }),
      ),
  };
}
test("launcher reports presence before service worker replies and also runs on legacy install pages", async () => {
  for (const page of [publish, recovery]) {
    const f = launcher(page);
    try {
      assert.equal(f.outbound[0].state, "connecting");
      assert.equal(f.outbound[0].version, "0.2.1");
      assert.equal(f.requests[0].url, page);
      f.replies[0]({ ok: true, version: "0.2.1" });
      await settle();
      assert.equal(f.outbound.at(-1).state, "opening");
      f.message("mogao-launch-probe");
      assert.equal(f.outbound.at(-1).state, "opening");
      assert.equal(f.requests.length, 1);
    } finally {
      f.win.close();
    }
  }
});
test("worker timeout is explicit and retryable; late responses cannot overwrite an error", async () => {
  const f = launcher();
  try {
    f.tick();
    await settle();
    assert.equal(f.outbound.at(-1).error, "worker-unavailable");
    f.replies[0]({ ok: true });
    await settle();
    assert.equal(f.outbound.at(-1).state, "error");
    f.message("mogao-launch-retry", "https://evil.example");
    assert.equal(f.requests.length, 1);
    f.message("mogao-launch-retry");
    assert.equal(f.requests.length, 2);
    f.error("open-failed");
    f.replies[1]({ ok: true });
    await settle();
    assert.equal(f.outbound.at(-1).error, "open-failed");
    assert.match(
      f.win.document.getElementById("state").textContent,
      /未能打开发送窗口/,
    );
  } finally {
    f.win.close();
  }
});
test("launcher does nothing on unrelated localhost pages", () => {
  const f = launcher("http://127.0.0.1:54321/unrelated");
  try {
    assert.equal(f.requests.length, 0);
    assert.equal(f.outbound.length, 0);
  } finally {
    f.win.close();
  }
});
