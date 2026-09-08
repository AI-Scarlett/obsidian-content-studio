import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { BrowserBridge, type BrowserArticle } from "../src/core/browser-bridge";
const extensionId = "a".repeat(32);
const article: BrowserArticle = {
  format: "mogao-article",
  version: 1,
  title: "标题 <img src=x>",
  platform: "wechat",
  html: "<p>Only this draft</p>",
  source: "studio",
};
async function fixture() {
  const bridge = new BrowserBridge();
  const port = await bridge.start();
  const messages: string[] = [];
  const draft = structuredClone(article);
  const url = bridge.publish(draft, (text) => messages.push(text));
  const endpoint = url.replace("/publish/", "/v1/jobs/");
  const headers = {
    "X-Mogao-Extension": extensionId,
    "X-Mogao-Run": randomUUID(),
    Origin: `chrome-extension://${extensionId}`,
    "Content-Type": "application/json",
  };
  return { bridge, port, url, endpoint, messages, draft, headers };
}
test("handoff exposes only one immutable article and rejects web origins, forged Host, and vault APIs", async () => {
  const f = await fixture();
  try {
    f.draft.html = "changed after click";
    assert.equal((await fetch(f.endpoint)).status, 403);
    assert.equal(
      (
        await fetch(f.endpoint, {
          headers: { ...f.headers, Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const code = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        f.url,
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(code, 403);
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${f.port}/v1/files`, {
          headers: f.headers,
        })
      ).status,
      404,
    );
    const response = await fetch(f.endpoint, { headers: f.headers });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).article, article);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    f.bridge.stop();
  }
});
test("one controller claims delivery; duplicate windows and other extensions cannot reuse it", async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.endpoint, { headers: f.headers })).status, 200);
    assert.equal(
      (
        await fetch(f.endpoint, {
          headers: { ...f.headers, "X-Mogao-Run": randomUUID() },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await fetch(f.endpoint, {
          headers: {
            ...f.headers,
            "X-Mogao-Extension": "b".repeat(32),
            Origin: `chrome-extension://${"b".repeat(32)}`,
          },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(f.endpoint, { headers: f.headers })).status, 200);
    assert.equal(
      (
        await fetch(f.endpoint, {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify({ status: "图片上传完成", done: true }),
        })
      ).status,
      200,
    );
    assert.deepEqual(f.messages, ["图片上传完成"]);
    assert.equal((await fetch(f.endpoint, { headers: f.headers })).status, 404);
  } finally {
    f.bridge.stop();
  }
});
test("both launch and recovery pages reconnect without claiming a missing extension or exposing article body", async () => {
  const f = await fixture();
  try {
    const page = await (await fetch(f.url)).text();
    assert.ok(page.includes("&lt;img src=x&gt;"));
    assert.ok(!page.includes("Only this draft"));
    assert.ok(page.includes("/launch.js"));
    const script = await (
      await fetch(`http://127.0.0.1:${f.port}/launch.js`)
    ).text();
    assert.ok(!script.includes("location.replace"));
    const install = await (
      await fetch(f.url.replace("/publish/", "/install/publish/"))
    ).text();
    assert.match(install, /尚未上架/);
    assert.match(install, /href="\/extension.zip"/);
    assert.match(install, /重新连接/);
    assert.match(install, /\/launch.js/);
    assert.ok(!install.includes("先安装墨稿"));
    assert.ok(!install.includes("Only this draft"));
  } finally {
    f.bridge.stop();
  }
});
test("progress requires claim and valid bounded JSON; expired jobs are removed", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await fetch(f.endpoint, {
          method: "POST",
          headers: f.headers,
          body: "{}",
        })
      ).status,
      409,
    );
    await fetch(f.endpoint, { headers: f.headers });
    for (const body of [
      "[]",
      "broken",
      JSON.stringify({ status: "x".repeat(301) }),
    ])
      assert.equal(
        (await fetch(f.endpoint, { method: "POST", headers: f.headers, body }))
          .status,
        400,
      );
    assert.deepEqual(f.messages, []);
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 31 * 60 * 1000;
      assert.equal(
        (await fetch(f.endpoint, { headers: f.headers })).status,
        404,
      );
    } finally {
      Date.now = originalNow;
    }
  } finally {
    f.bridge.stop();
  }
});
test("multiple vaults use separate ports and cannot consume each other's delivery", async () => {
  const a = await fixture(),
    b = await fixture();
  try {
    assert.notEqual(a.port, b.port);
    assert.equal(
      (
        await fetch(a.endpoint.replace(String(a.port), String(b.port)), {
          headers: a.headers,
        })
      ).status,
      404,
    );
    a.bridge.stop();
    assert.throws(() => a.bridge.publish(article), /未启动/);
    assert.equal((await fetch(b.endpoint, { headers: b.headers })).status, 200);
  } finally {
    a.bridge.stop();
    b.bridge.stop();
  }
});
