import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Plugin } from "@tiptap/pm/state";
import { EditorSession, findEditor } from "../src/editor";
import { prepareArticle } from "../src/package";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";

function fixture(
  options: { upload?: boolean; content?: string; blob?: boolean } = {},
) {
  const dom = new JSDOM(
    '<textarea placeholder="输入标题"></textarea><div id="editor"></div>',
    {
      url: "https://creator.xiaohongshu.com/publish/publish?target=article",
      pretendToBeVisual: true,
    },
  );
  const win = dom.window;
  win.scrollBy = () => {};
  win.document.execCommand = (command: string) => {
    if (command !== "delete") return false;
    win.getSelection()?.getRangeAt(0).deleteContents();
    return true;
  };
  for (const name of [
    "window",
    "document",
    "Node",
    "NodeFilter",
    "HTMLElement",
    "Element",
    "Text",
    "MutationObserver",
    "DOMParser",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (win as any)[name],
    });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: win.navigator,
  });
  win.HTMLElement.prototype.getClientRects = function () {
    return [
      { top: 0, left: 0, bottom: 20, right: 300, width: 300, height: 20 },
    ] as any;
  };
  win.Range.prototype.getClientRects = function () {
    return [] as any;
  };
  win.Range.prototype.getBoundingClientRect = function () {
    return {
      top: 0,
      left: 0,
      bottom: 20,
      right: 300,
      width: 300,
      height: 20,
    } as any;
  };
  Object.defineProperty(win.HTMLImageElement.prototype, "complete", {
    get() {
      return (this as HTMLImageElement).src.startsWith("https:");
    },
  });
  Object.defineProperty(win.HTMLImageElement.prototype, "naturalWidth", {
    get() {
      return (this as HTMLImageElement).src.startsWith("https:") ? 800 : 0;
    },
  });
  class Transfer {
    data = new Map<string, string>();
    files: File[] = [];
    items = {
      add: (file: File) => {
        this.files.push(file);
        return null;
      },
      get length() {
        return 0;
      },
    };
    setData(type: string, value: string) {
      this.data.set(type, value);
    }
    getData(type: string) {
      return this.data.get(type) || "";
    }
    get types() {
      return [...this.data.keys(), ...(this.files.length ? ["Files"] : [])];
    }
  }
  (win as any).DataTransfer = Transfer;
  (win as any).ClipboardEvent = class extends win.Event {
    clipboardData: Transfer;
    constructor(type: string, init: any) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  };
  let uploads = 0;
  const uploader = Extension.create({
    name: "fixtureUploader",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handlePaste(view, event) {
              const file = event.clipboardData?.files[0];
              if (!file) return false;
              if (options.upload === false) return true;
              assert.equal(file.type, "image/png");
              assert.ok(file.size > 50);
              uploads++;
              // Real ProseMirror transactions simulate the platform upload completion; no remote requests.
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.create({
                    src: `blob:test-${uploads}`,
                  }),
                ),
              );
              if (!options.blob)
                win.setTimeout(() => {
                  view.state.doc.descendants((node, pos) => {
                    if (
                      node.type.name === "image" &&
                      node.attrs.src === `blob:test-${uploads}`
                    )
                      view.dispatch(
                        view.state.tr.setNodeMarkup(pos, undefined, {
                          ...node.attrs,
                          src: `https://sns-img.xhscdn.com/test-${uploads}.png`,
                        }),
                      );
                  });
                }, 30);
              return true;
            },
          },
        }),
      ];
    },
  });
  const editor = new Editor({
    element: win.document.getElementById("editor")!,
    extensions: [StarterKit, Image, uploader],
    content: options.content || "",
  });
  // jsdom does not implement browser selectionchange scheduling consistently.
  win.document.addEventListener("selectionchange", () => {});
  const target = findEditor(win.document)!;
  const plan = prepareArticle(
    {
      format: "mogao-article",
      version: 1,
      title: "整篇图文测试",
      platform: "xiaohongshu",
      html: `<h2>开头标题</h2><p>前文</p><img src="${png}"><p>图注与中间</p><img src="${png}"><p>结尾</p>`,
    },
    win as any,
  );
  const session = new EditorSession(
    target.root,
    "xiaohongshu",
    options.upload === false || options.blob ? 200 : 3000,
  );
  const begin = () => {
    const { images, ...body } = plan;
    return session.begin(
      body,
      images.map((img) => img.marker),
    );
  };
  const close = () => {
    session.cancel();
    editor.destroy();
    dom.window.close();
  };
  return {
    win,
    editor,
    target,
    plan,
    session,
    begin,
    close,
    uploads: () => uploads,
  };
}
test("real Tiptap document receives whole body, file uploads in place and separate title", async () => {
  const f = fixture();
  try {
    await f.begin();
    for (const image of f.plan.images) await f.session.image(image);
    assert.match(await f.session.finish(), /2 张平台图片/);
    const model = f.editor.getJSON();
    assert.equal(JSON.stringify(model).includes("MOGAOIMAGE"), false);
    assert.equal(f.uploads(), 2);
    const nodes = model.content!;
    assert.deepEqual(
      nodes.map((node) => node.type),
      ["heading", "paragraph", "image", "paragraph", "image", "paragraph"],
    );
    assert.equal(nodes[2].attrs!.src, "https://sns-img.xhscdn.com/test-1.png");
    assert.equal(nodes[4].attrs!.src, "https://sns-img.xhscdn.com/test-2.png");
    assert.equal(
      f.win.document.querySelector("textarea")!.value,
      "整篇图文测试",
    );
    // Recreate from the editor's model to show changes are more than rendered DOM.
    const json = structuredClone(model);
    f.editor.commands.setContent(json);
    assert.equal(
      f.editor.getJSON().content!.filter((node) => node.type === "image")
        .length,
      2,
    );
  } finally {
    f.close();
  }
});
test("existing drafts are rejected without mutating editor model", async () => {
  const f = fixture({ content: "<p>已有草稿</p>" });
  try {
    const before = f.editor.getJSON();
    await assert.rejects(f.begin(), /为空/);
    assert.deepEqual(f.editor.getJSON(), before);
    assert.equal(f.uploads(), 0);
  } finally {
    f.close();
  }
});
test("ignored file paste and unresolved blob uploads stop instead of claiming success", async () => {
  for (const options of [{ upload: false }, { blob: true }]) {
    const f = fixture(options);
    try {
      await f.begin();
      await assert.rejects(f.session.image(f.plan.images[0]), /未在/);
      await assert.rejects(f.session.finish(), /还没有全部/);
      assert.equal(f.win.document.querySelector("textarea")!.value, "");
    } finally {
      f.close();
    }
  }
});
test("cancelled import and incorrect image order cannot continue", async () => {
  const f = fixture();
  try {
    await f.begin();
    await assert.rejects(f.session.image(f.plan.images[1]), /顺序/);
    f.session.cancel();
    await assert.rejects(f.session.image(f.plan.images[0]), /停止/);
    assert.equal(f.uploads(), 0);
  } finally {
    f.close();
  }
});

test("an editor that reorders uploaded images fails final validation", async () => {
  const f = fixture();
  try {
    await f.begin();
    for (const image of f.plan.images) await f.session.image(image);
    const imageNodes: { pos: number; attrs: Record<string, unknown> }[] = [];
    f.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image")
        imageNodes.push({ pos, attrs: node.attrs });
    });
    const transaction = f.editor.state.tr;
    transaction.setNodeMarkup(
      imageNodes[0].pos,
      undefined,
      imageNodes[1].attrs,
    );
    transaction.setNodeMarkup(
      imageNodes[1].pos,
      undefined,
      imageNodes[0].attrs,
    );
    f.editor.view.dispatch(transaction);
    await assert.rejects(f.session.finish(), /顺序不一致/);
    assert.equal(f.win.document.querySelector("textarea")!.value, "");
  } finally {
    f.close();
  }
});
