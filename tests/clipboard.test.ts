import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installDomGlobals } from "./dom";
import { copyContent, copyPng, imagePng } from "../src/core/clipboard";

const png = "data:image/png;base64,AQID";
function setup() {
  const dom = new JSDOM(
    '<!doctype html><body><textarea>保留正在编辑的草稿</textarea><div id="root"></div></body>',
  );
  installDomGlobals(dom);
  const win = dom.window;
  const writes: Record<string, Blob>[] = [];
  let native = 0;
  class ClipboardItem {
    constructor(public data: Record<string, Blob | Promise<Blob>>) {}
  }
  Object.assign(win, { ClipboardItem });
  Object.defineProperty(win.navigator, "clipboard", {
    value: {
      write: async (items: ClipboardItem[]) => {
        writes.push(
          Object.fromEntries(
            await Promise.all(
              Object.entries(items[0].data).map(async ([k, v]) => [k, await v]),
            ),
          ),
        );
      },
      writeText: async (text: string) => {
        writes.push({ "text/plain": new Blob([text]) });
      },
      read: () => {
        throw Error("Must never read clipboard");
      },
      readText: () => {
        throw Error("Must never read clipboard");
      },
    },
  });
  win.HTMLImageElement.prototype.decode = async function () {};
  win.document.execCommand = () => {
    native++;
    return false;
  };
  return {
    dom,
    win,
    root: win.document.querySelector<HTMLElement>("#root")!,
    writes,
    native: () => native,
  };
}

test("native copy selects complete sanitized body with images and restores editor selection", async () => {
  const h = setup();
  h.win.navigator.clipboard.write = async () => {
    throw Error("async clipboard unavailable");
  };
  const editor = h.win.document.querySelector("textarea")!;
  editor.focus();
  editor.setSelectionRange(2, 6, "backward");
  h.win.document.execCommand = (command) => {
    assert.equal(command, "copy");
    const fragment = h.win.getSelection()!.getRangeAt(0).cloneContents();
    assert.equal(fragment.querySelectorAll("img").length, 2);
    assert.equal(
      fragment.querySelectorAll("button,script,[onerror]").length,
      0,
    );
    assert.equal(fragment.textContent, "开头中间结尾");
    assert.equal(fragment.querySelector("p")!.style.color, "red");
    return true;
  };
  await copyContent(
    "开头中间结尾",
    `<section><p style="color:red">开头<img src="${png}" onerror="evil()"></p><p>中间<img src="${png}"></p><p>结尾</p><button>复制这张图</button><script>evil()</script></section>`,
    h.root,
  );
  assert.equal(
    h.writes.length,
    0,
    "successful native copy must not be overwritten",
  );
  assert.equal(h.win.document.querySelector(".mg-copy-stage"), null);
  assert.equal(h.win.document.activeElement, editor);
  assert.deepEqual(
    [editor.selectionStart, editor.selectionEnd, editor.selectionDirection],
    [2, 6, "backward"],
  );
});

test("HTML API uses the owning window and does not select the editor when it succeeds", async () => {
  for (const throws of [false, true]) {
    const h = setup();
    if (throws)
      h.win.document.execCommand = () => {
        throw Error("unavailable");
      };
    await copyContent(
      " 正文 ",
      `<section><p>正文</p><img src="${png}"></section>`,
      h.root,
    );
    assert.equal(h.writes.length, 1);
    assert.equal(await h.writes[0]["text/plain"].text(), "正文");
    assert.match(
      await h.writes[0]["text/html"].text(),
      /data:image\/png;base64,AQID/,
    );
    assert.equal(h.win.document.querySelector(".mg-copy-stage"), null);
  }
});

test("when both copy paths fail, failure is visible and the temporary selection is removed", async () => {
  for (const throws of [false, true]) {
    const h = setup();
    h.win.navigator.clipboard.write = async () => {
      throw Error("blocked");
    };
    h.win.document.execCommand = () => {
      if (throws) throw Error("blocked");
      return false;
    };
    await assert.rejects(
      copyContent("正文", `<p>正文<img src="${png}"></p>`, h.root),
      /图文复制失败/,
    );
    assert.equal(h.win.document.querySelector(".mg-copy-stage"), null);
    assert.equal(h.win.getSelection()!.rangeCount, 0);
  }
});

test("corrupt and unresolved images block copying before any clipboard write", async () => {
  for (const source of [png, "https://example.com/not-embedded.png"]) {
    const h = setup();
    h.win.HTMLImageElement.prototype.decode = async () => {
      throw Error("bad image");
    };
    await assert.rejects(
      copyContent("正文", `<p>正文<img src="${source}"></p>`, h.root),
      /图片/,
    );
    assert.equal(h.writes.length, 0);
    assert.equal(h.native(), 0);
    assert.equal(h.win.document.querySelector(".mg-copy-stage"), null);
  }
});

test("image copy carries PNG bytes with no competing HTML or plain-text format", async () => {
  const h = setup();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await copyPng(async () => new Blob([bytes], { type: "image/png" }), h.root);
  assert.deepEqual(Object.keys(h.writes[0]), ["image/png"]);
  assert.deepEqual(
    new Uint8Array(await h.writes[0]["image/png"].arrayBuffer()),
    bytes,
  );
  await assert.rejects(
    copyPng(async () => {
      throw Error("encode failed");
    }, h.root),
    /encode failed/,
  );
  assert.equal(h.writes.length, 1);
  await assert.rejects(imagePng("file:///private/image.png", h.root), /先载入/);
});

test("title/plain copy uses only the explicit text and never selects the page", async () => {
  const h = setup();
  await copyContent("独立标题", undefined, h.root);
  assert.equal(h.native(), 0);
  assert.deepEqual(Object.keys(h.writes[0]), ["text/plain"]);
  assert.equal(await h.writes[0]["text/plain"].text(), "独立标题");
});
