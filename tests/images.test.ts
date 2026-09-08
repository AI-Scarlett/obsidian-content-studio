import { installDomGlobals } from "./dom";
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { resolveImageAssets, isEmbeddedImage } from "../src/core/images";
import { Studio, type Host, type OutputFile } from "../src/ui/studio";
import { imageSources } from "../src/core/render";
import { DEFAULT_SETTINGS } from "../src/core/types";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.com",
});
installDomGlobals(dom);
const draft = (
  markdown = "开头\n\n![图一](https://example.com/one.png)\n\n中间\n\n![[two.png]]\n\n结尾",
) => ({ title: "图文测试", markdown, sourcePath: "Notes/test.md" });
function harness(read: (src: string) => Promise<string> = async () => png) {
  const root = document.createElement("div");
  document.body.append(root);
  const clips: { text: string; html?: string }[] = [],
    packages: OutputFile[][] = [],
    reads: string[] = [];
  const host: Host = {
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: async () => {},
    currentNote: async () => draft(),
    chooseNote: async () => draft(),
    learnUrl: async () => {
      throw Error("unused");
    },
    copy: async (text, html) => {
      clips.push({ text, html });
    },
    saveFiles: async (files) => {
      packages.push(files);
      return "output";
    },
    resolveImages: async (d, remote, options) => {
      assert.equal(remote, true);
      return resolveImageAssets(
        imageSources(d),
        async (src) => {
          reads.push(src);
          return read(src);
        },
        options,
      );
    },
  };
  const studio = new Studio(root, host);
  return { root, studio, clips, packages, reads };
}
async function click(h: ReturnType<typeof harness>, action: string) {
  h.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
  const end = Date.now() + 2500;
  while (h.root.getAttribute("aria-busy") === "true") {
    if (Date.now() > end) throw Error("UI operation timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("image loading is bounded to three concurrent requests and results keep source order", async () => {
  let active = 0,
    peak = 0;
  const sources = Array.from({ length: 9 }, (_, i) => `${i}.png`);
  const r = await resolveImageAssets(sources, async (src) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, src === "0.png" ? 15 : 1));
    active--;
    return png;
  });
  assert.equal(peak, 3);
  assert.deepEqual(Object.keys(r.assets), sources);
  assert.deepEqual(r.warnings, []);
});
test("cache avoids repeat downloads, duplicate sources resolve once, and stale assets are pruned", async () => {
  let calls = 0;
  const r = await resolveImageAssets(
    ["a", "b", "a"],
    async () => {
      calls++;
      return png;
    },
    { assets: { a: png, old: png } },
  );
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(r.assets), ["a", "b"]);
});
test("failed downloads and invalid data are identified by their actual source", async () => {
  const r = await resolveImageAssets(
    ["missing.jpg", "invalid.png"],
    async (src) => {
      if (src === "missing.jpg") throw Error("HTTP 403");
      return "data:text/html;base64,PHNjcmlwdD4=";
    },
  );
  assert.equal(Object.keys(r.assets).length, 0);
  assert.match(r.warnings[0], /missing.jpg.*403/);
  assert.match(r.warnings[1], /invalid.png.*数据无效/);
  assert.equal(isEmbeddedImage("data:image/svg+xml;base64,PHN2Zz4="), false);
});
test("image limit is explicit and reports incomplete progress", async () => {
  let count = 0,
    last: number[] = [];
  const r = await resolveImageAssets(
    Array.from({ length: 42 }, (_, i) => String(i)),
    async () => {
      count++;
      return png;
    },
    {
      onProgress: (...n) => {
        last = n;
      },
    },
  );
  assert.equal(count, 40);
  assert.deepEqual(last, [40, 42, 40]);
  assert.match(r.warnings[0], /40/);
});
test("opening a note automatically embeds local and remote images in their original positions", async () => {
  const h = harness();
  try {
    await h.studio.openDraft(draft());
    const article = h.root.querySelector(".mg-preview")!;
    assert.equal(article.querySelectorAll("img").length, 2);
    assert.match(
      h.root.querySelector(".mg-image-status")!.textContent!,
      /2 \/ 2/,
    );
    assert.deepEqual(
      [...article.querySelectorAll("p")].map((p) =>
        p.querySelector("img") ? "IMAGE" : p.textContent,
      ),
      ["开头", "IMAGE", "中间", "IMAGE", "结尾"],
    );
    await click(h, "copy");
    const copied = new JSDOM(h.clips[0].html).window.document;
    assert.equal(copied.images.length, 2);
    assert.ok(
      [...copied.images].every(
        (i) => i.src === png && i.style.maxWidth === "100%",
      ),
    );
    assert.equal(h.reads.length, 2);
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});
test("copy waits for a newly edited image even before the render debounce fires", async () => {
  const h = harness();
  try {
    await h.studio.openDraft(draft("初稿"));
    const input =
      h.root.querySelector<HTMLTextAreaElement>(".mg-markdown-input")!;
    input.value = "新稿\n\n![新图](new.png)";
    input.dispatchEvent(new dom.window.Event("input"));
    await click(h, "copy");
    assert.equal(h.reads.at(-1), "new.png");
    assert.match(h.clips[0].html!, /data:image\/png;base64/);
    assert.match(h.clips[0].text, /新稿/);
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});
test("missing images block rich copy and content package export, and retry recovers without changing prose", async () => {
  let fails = true;
  const h = harness(async (src) => {
    if (fails && src === "two.png") throw Error("附件找不到");
    return png;
  });
  try {
    await h.studio.openDraft(draft());
    await click(h, "copy");
    await click(h, "export");
    assert.equal(h.clips.length, 0);
    assert.equal(h.packages.length, 0);
    assert.match(h.root.querySelector(".mg-status")!.textContent!, /已暂停/);
    fails = false;
    await click(h, "images");
    await click(h, "copy");
    await click(h, "export");
    assert.equal(h.clips.length, 1);
    assert.equal(h.packages.length, 1);
    assert.match(h.clips[0].text, /结尾/);
    const files = h.packages[0];
    assert.equal(
      files.filter((f) => /^image-\d+\.png$/.test(f.name)).length,
      2,
    );
    assert.match(
      String(files.find((f) => f.name === "article.md")!.content),
      /image-01.png/,
    );
    assert.match(
      String(files.find((f) => f.name === "article.md")!.content),
      /image-02.png/,
    );
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});
test("late downloads for a previous draft cannot replace the current preview", async () => {
  let release!: (value: string) => void;
  const h = harness((src) =>
    src === "slow.png"
      ? new Promise((r) => (release = r))
      : Promise.resolve(png),
  );
  try {
    const old = h.studio.openDraft(draft("![旧](slow.png)"));
    // Exercise a change while a background image operation is pending.
    const input =
      h.root.querySelector<HTMLTextAreaElement>(".mg-markdown-input")!;
    input.value = "新正文";
    input.dispatchEvent(new dom.window.Event("input"));
    release(png);
    await old;
    await click(h, "copy");
    assert.equal(new JSDOM(h.clips[0].html).window.document.images.length, 0);
    assert.match(h.clips[0].text, /新正文/);
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});

test("title and rich body copy separately while the preview and package keep the complete article", async () => {
  const h = harness();
  try {
    await h.studio.openDraft(
      draft("第一段\n\n![图](one.png)\n\n# 正文中的一级标题\n\n最后一段"),
    );
    await click(h, "copy-title");
    assert.deepEqual(h.clips[0], { text: "图文测试", html: undefined });
    await click(h, "copy");
    const doc = new JSDOM(h.clips[1].html).window.document;
    assert.ok(!doc.body.textContent!.includes("图文测试"));
    assert.ok(!h.clips[1].text.includes("图文测试"));
    assert.equal(doc.querySelector("h1")!.textContent, "正文中的一级标题");
    assert.equal(doc.images.length, 1);
    assert.equal(
      h.root.querySelector(".mg-preview h1")!.textContent,
      "图文测试",
    );
    await click(h, "export");
    assert.match(
      String(h.packages[0].find((f) => f.name === "article.html")!.content),
      /图文测试/,
    );
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});
test("X thread copying omits the article title from both preview and copied payload", async () => {
  const h = harness();
  try {
    await h.studio.openDraft(draft("正文示例"));
    h.root.querySelector<HTMLButtonElement>('[data-platform="x"]')!.click();
    h.root.querySelector<HTMLButtonElement>('[data-mode="thread"]')!.click();
    assert.ok(
      !h.root.querySelector(".mg-tweet p")!.textContent!.includes("图文测试"),
    );
    await click(h, "copy");
    assert.equal(h.clips[0].text, "正文示例");
    assert.equal(h.clips[0].html, undefined);
    await click(h, "export");
    assert.equal(
      h.packages[0].find((f) => f.name === "thread-01.txt")!.content,
      "正文示例",
    );
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});

test("workspace gives editing its own surface and keeps draft changes when switching views and tools", async () => {
  const h = harness();
  try {
    await h.studio.openDraft(draft("初稿"));
    assert.equal(h.root.dataset.view, "edit");
    assert.equal(
      h.root.querySelector(".mg-drawer-backdrop")!.hasAttribute("hidden"),
      true,
    );
    assert.ok(h.root.querySelector(".mg-writing > .mg-markdown-input"));
    const editor =
      h.root.querySelector<HTMLTextAreaElement>(".mg-markdown-input")!;
    editor.value = "尚未保存的正文修改";
    editor.dispatchEvent(new dom.window.Event("input"));
    h.root.querySelector<HTMLButtonElement>('[data-view="preview"]')!.click();
    h.root.querySelector<HTMLButtonElement>('[data-view="edit"]')!.click();
    await click(h, "appearance");
    await click(h, "close-appearance");
    assert.equal(editor.value, "尚未保存的正文修改");
    await click(h, "copy");
    assert.equal(h.clips.at(-1)!.text, "尚未保存的正文修改");
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});
test("Xiaohongshu photo delivery saves numbered media plus separate title/body, with no fake image-copy success", async () => {
  const h = harness();
  try {
    await h.studio.openDraft(draft());
    h.root
      .querySelector<HTMLButtonElement>('[data-platform="xiaohongshu"]')!
      .click();
    await click(h, "copy");
    assert.equal(h.clips.at(-1)!.html, undefined);
    assert.match(
      h.root.querySelector(".mg-status")!.textContent!,
      /正文已复制/,
    );
    await click(h, "publish");
    h.root
      .querySelector<HTMLButtonElement>('[data-delivery="images"]')!
      .click();
    while (h.root.getAttribute("aria-busy") === "true")
      await new Promise((r) => setTimeout(r, 5));
    const files = h.packages.at(-1)!;
    assert.deepEqual(
      files.filter((f) => f.name.startsWith("image-")).map((f) => f.name),
      ["image-01.png", "image-02.png"],
    );
    assert.equal(
      files.find((f) => f.name === "title.txt")!.content,
      "图文测试",
    );
    assert.doesNotMatch(
      files.find((f) => f.name === "body.txt")!.content as string,
      /图文测试/,
    );
    assert.ok(h.root.querySelector("[data-reveal]"));
  } finally {
    h.studio.destroy();
    h.root.remove();
  }
});
