import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { randomUUID } from "node:crypto";
import { BrowserBridge } from "../../src/core/browser-bridge";
import { destinations } from "../src/handoff";
const bundle = await build({
  entryPoints: ["browser-extension/src/importer.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
});
const html = await readFile("browser-extension/importer.html", "utf8");
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
async function scenario({
  platform = "xiaohongshu" as keyof typeof destinations,
  editorUrl = "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&appmsgid=12345",
  nonempty = false,
  denied = false,
  cancelled = false,
} = {}) {
  const bridge = new BrowserBridge();
  await bridge.start();
  const status: string[] = [];
  const url = bridge.publish(
    {
      format: "mogao-article",
      version: 1,
      platform,
      title: "自动测试稿",
      source: "studio",
      html: `<p>开头</p><img src="${png}"><p>中间</p><img src="${png}"><p>结尾</p>`,
    },
    (text) => status.push(text),
  );
  const dom = new JSDOM(html, {
    url: `https://controller.example/?job=${encodeURIComponent(url)}`,
    runScripts: "outside-only",
  });
  const win = dom.window as any;
  win.TextEncoder = TextEncoder;
  win.AbortSignal = AbortSignal;
  win.crypto.randomUUID = randomUUID;
  win.fetch = fetch;
  const timeout = win.setTimeout.bind(win);
  win.setTimeout = (fn: () => void, ms: number) =>
    timeout(fn, Math.min(ms, 10));
  const commands: any[] = [],
    tabs: any[] = [],
    updates: any[] = [];
  let polls = 0;
  const probe = {
    platform,
    editor: "tiptap",
    empty: !nonempty,
    titleEmpty: !nonempty,
  };
  win.chrome = {
    runtime: { id: "a".repeat(32) },
    tabs: {
      create: async (options: any) => {
        tabs.push(options);
        return { id: 1 };
      },
      get: async () => {
        polls++;
        if (cancelled) win.document.getElementById("cancel").click();
        return {
          status: "complete",
          url: polls === 1 ? "https://login.example/" : destinations[platform],
        };
      },
      update: async (_id: number, options: any) => {
        updates.push(options);
      },
      sendMessage: async (_id: number, command: any) => {
        commands.push(command);
        if (command.op === "probe") return { ok: true, probe };
        if (denied && command.op === "image")
          return { ok: false, error: "图片上传被拒绝" };
        return {
          ok: true,
          progress: {
            text: "标题正文与 2 张图片已同步",
            done: command.op === "finish",
            navigate:
              platform === "wechat" && command.op === "finish"
                ? editorUrl
                : undefined,
          },
        };
      },
    },
    scripting: {
      executeScript: async (options: any) => {
        assert.equal(options.world, "MAIN");
        if (options.files) return [{ frameId: 0 }];
        return [
          {
            frameId: 0,
            result: await win.chrome.tabs.sendMessage(1, options.args[1]),
          },
        ];
      },
    },
  };
  try {
    win.eval(bundle.outputFiles[0].text);
    const deadline = Date.now() + 5000;
    while (
      !status.some((text) =>
        /已同步|已有内容|被拒绝|已停止|无法识别/.test(text),
      )
    ) {
      if (Date.now() > deadline)
        throw Error(win.document.getElementById("status").textContent);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      status,
      commands: structuredClone(commands),
      tabs: structuredClone(tabs),
      updates: structuredClone(updates),
      polls,
      text: win.document.body.textContent,
    };
  } finally {
    dom.window.close();
    bridge.stop();
  }
}
test("one Obsidian handoff automatically opens platform, waits for login, sends ordered images and separate title", async () => {
  const result = await scenario();
  assert.deepEqual(result.tabs, [
    { url: destinations.xiaohongshu, active: true },
  ]);
  assert.ok(result.polls >= 2);
  assert.ok(result.status.some((text) => /完成登录/.test(text)));
  assert.deepEqual(
    result.commands.filter((c) => c.op !== "probe").map((c) => c.op),
    ["begin", "image", "image", "finish"],
  );
  const begin = result.commands.find((c) => c.op === "begin");
  assert.equal(begin.plan.title, "自动测试稿");
  assert.deepEqual(begin.plan.textParts, ["开头", "中间", "结尾"]);
  assert.ok(!begin.plan.html.includes("data:image"));
  assert.equal(result.commands.filter((c) => c.op === "image").length, 2);
  assert.ok(!result.text.includes("选择 article"));
});
test("existing platform draft is preserved; no writing commands are sent", async () => {
  const result = await scenario({ nonempty: true });
  assert.ok(result.status.some((text) => /原稿没有被覆盖/.test(text)));
  assert.ok(result.commands.every((c) => c.op === "probe"));
});
test("upload failure stops further images and never reports success", async () => {
  const result = await scenario({ denied: true });
  assert.deepEqual(
    result.commands.filter((c) => c.op !== "probe").map((c) => c.op),
    ["begin", "image", "cancel"],
  );
  assert.ok(result.status.some((text) => /被拒绝/.test(text)));
  assert.ok(!result.status.some((text) => /已同步$/.test(text)));
});
test("cancelling during login does not write to the editor", async () => {
  const result = await scenario({ cancelled: true });
  assert.ok(!result.commands.some((c) => c.op === "begin"));
});

test("WeChat completion opens the exact returned draft ID instead of stopping at homepage", async () => {
  const result = await scenario({ platform: "wechat" });
  assert.deepEqual(result.tabs, [{ url: destinations.wechat, active: true }]);
  assert.deepEqual(result.updates, [
    {
      url: "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&appmsgid=12345",
      active: true,
    },
  ]);
});
test("WeChat refuses a publication or foreign redirect from the draft adapter", async () => {
  const result = await scenario({
    platform: "wechat",
    editorUrl:
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=publish&appmsgid=12345",
  });
  assert.equal(result.updates.length, 0);
  assert.ok(result.status.some((s) => s.includes("无法识别")));
});
test("X handoff opens Articles and sends title, structured body and files without manual import", async () => {
  const result = await scenario({ platform: "x" });
  assert.deepEqual(result.tabs, [{ url: destinations.x, active: true }]);
  assert.equal(
    result.commands.find((c) => c.op === "begin").plan.platform,
    "x",
  );
  assert.equal(result.commands.filter((c) => c.op === "image").length, 2);
});
