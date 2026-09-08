import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { browserLaunchScript } from "../src/core/browser-launch-page";

function fixture() {
  const dom = new JSDOM(
    '<p id="state"></p><p id="extension-version"></p><section id="recovery" hidden><button id="retry"></button></section>',
    {
      url: `http://127.0.0.1:54321/publish/${"a".repeat(64)}`,
      runScripts: "outside-only",
    },
  );
  const win = dom.window;
  const timers = new Map<number, () => void>();
  let sequence = 0;
  win.setTimeout = ((fn: () => void) => {
    const id = ++sequence;
    timers.set(id, fn);
    return id;
  }) as typeof win.setTimeout;
  win.clearTimeout = (id) => {
    timers.delete(id!);
  };
  const outbound: unknown[] = [];
  win.postMessage = (data) => {
    outbound.push(data);
  };
  win.eval(browserLaunchScript);
  return {
    win,
    outbound,
    state: () => win.document.getElementById("state")!.textContent!,
    recovery: () => !win.document.getElementById("recovery")!.hidden,
    tick: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
    message: (data: unknown, origin = win.location.origin, source = win) =>
      win.dispatchEvent(
        new win.MessageEvent("message", { data, origin, source }),
      ),
  };
}
test("no response stays on the same job and offers recovery without claiming not installed", () => {
  const f = fixture();
  try {
    const url = f.win.location.href;
    f.tick();
    assert.equal(f.win.location.href, url);
    assert.ok(f.recovery());
    assert.match(f.state(), /尚未连接/);
    assert.ok(!f.state().includes("先安装"));
    f.win.document.getElementById("retry")!.click();
    assert.ok(f.outbound.some((v: any) => v.type === "mogao-launch-retry"));
    assert.ok(!f.recovery());
  } finally {
    f.win.close();
  }
});
test("late extension response recovers and reports the actual version; stuck navigation keeps recovery available", () => {
  const f = fixture();
  try {
    f.tick();
    f.message({
      type: "mogao-extension-ready",
      version: "0.2.1",
      state: "connecting",
    });
    assert.ok(!f.recovery());
    assert.match(
      f.win.document.getElementById("extension-version")!.textContent!,
      /0.2.1/,
    );
    f.message({
      type: "mogao-extension-ready",
      version: "0.2.1",
      state: "opening",
    });
    assert.match(f.state(), /正在打开发送窗口/);
    f.tick();
    assert.match(f.state(), /已检测到扩展 0.2.1/);
    assert.ok(f.recovery());
  } finally {
    f.win.close();
  }
});
test("background and navigation errors remain visible; foreign-origin messages are ignored", () => {
  const f = fixture();
  try {
    f.message(
      { type: "mogao-extension-ready", version: "0.2.1", state: "opening" },
      "https://evil.example",
    );
    assert.ok(!f.state().includes("已连接"));
    for (const [error, label] of [
      ["worker-unavailable", "后台没有响应"],
      ["open-failed", "未能打开发送窗口"],
      ["tab-changed", "发布页面已经变化"],
    ]) {
      f.message({
        type: "mogao-extension-ready",
        version: "0.2.1",
        state: "error",
        error,
      });
      f.tick();
      assert.ok(f.state().includes(label));
      assert.ok(f.recovery());
    }
  } finally {
    f.win.close();
  }
});
