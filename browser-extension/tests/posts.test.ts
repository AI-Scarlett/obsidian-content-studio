import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import Draft from "draft-js";
import { Editor, Node as TiptapNode } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { PostSession, postProbe } from "../src/platforms/posts";
import { prepareArticle, readArticle } from "../src/package";
import { prepareDestination } from "../src/navigation";
import { destinationUrl } from "../src/handoff";
import type { DraftHandle } from "../src/platforms/draftjs";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
function fixture(
  platform: "x" | "xiaohongshu",
  options: {
    failure?: boolean;
    pending?: boolean;
    duplicate?: boolean;
    topicUnavailable?: boolean;
  } = {},
) {
  const dom = new JSDOM(
    platform === "x"
      ? '<div data-testid="tweetTextarea_0" contenteditable="true">保留后台草稿</div><div role="dialog"><div role="progressbar" aria-valuenow="0"></div><div data-testid="tweetTextarea_0" contenteditable="true"></div><input type="file" data-testid="fileInput" multiple accept="image/png"><button data-testid="tweetButton">Post</button></div>'
      : '<div><input class="upload-input" type="file" multiple accept=".png,.jpg"></div>',
    { url: destinationUrl(platform, "post"), pretendToBeVisual: true },
  );
  const win = dom.window as any,
    doc = win.document as Document;
  win.HTMLElement.prototype.getClientRects = () => [
    { left: 0, right: 500, top: 0, bottom: 300, width: 500, height: 300 },
  ];
  win.Range.prototype.getClientRects = () => [];
  win.Range.prototype.getBoundingClientRect = () => ({
    left: 0,
    right: 500,
    top: 0,
    bottom: 300,
    width: 500,
    height: 300,
  });
  win.scrollBy = () => {};
  Object.defineProperty(win.HTMLImageElement.prototype, "complete", {
    get: () => true,
  });
  Object.defineProperty(win.HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => 500,
  });
  Object.defineProperty(win.HTMLInputElement.prototype, "files", {
    configurable: true,
    get() {
      return this._files;
    },
    set(value) {
      this._files = value;
    },
  });
  win.DataTransfer = class {
    files: File[] = [];
    items = { add: (file: File) => this.files.push(file) };
  };
  const files: string[] = [];
  let tip: Editor | undefined;
  let handle: DraftHandle | undefined;
  const root = doc.querySelector<HTMLElement>(
    '[role="dialog"] [contenteditable]',
  );
  if (root) {
    handle = {
      props: {
        editorState: Draft.EditorState.createEmpty(),
        onChange: (state) => {
          handle!.props.editorState = state;
          root.textContent = state.getCurrentContent().getPlainText("\n");
        },
      },
    };
    (root as any).__reactFiber$test = { stateNode: handle };
    doc.querySelector("button")!.onclick = () => {
      throw new Error("MUST NOT PUBLISH");
    };
  }
  function setupXhs() {
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
        value: win[name],
      });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: win.navigator,
    });
    doc.body.innerHTML =
      '<div class="img-list"><input type="file" multiple accept="image/png"><div class="img-upload-area"><div class="img-preview-area"></div></div></div><div class="edit-container"><input placeholder="填写标题会有更多赞哦"><div class="tiptap-container"><div id="editor"></div></div></div><div id="creator-editor-topic-container"></div><button>发布</button>';
    doc.querySelector("button")!.onclick = () => {
      throw new Error("MUST NOT PUBLISH");
    };
    const Topic = TiptapNode.create({
      name: "topic",
      group: "inline",
      inline: true,
      atom: true,
      addAttributes: () => ({ data: { default: null } }),
      renderHTML: ({ node }) => [
        "a",
        {
          class: "tiptap-topic",
          "data-topic": JSON.stringify(node.attrs.data),
        },
        `#${node.attrs.data.name}`,
      ],
    });
    tip = new Editor({
      element: doc.querySelector("#editor") as HTMLElement,
      extensions: [StarterKit, Topic],
      onUpdate: ({ editor }) => {
        const text = editor.getText();
        const match = text.match(/#([\p{L}\p{N}_]+)$/u);
        const menu = doc.querySelector("#creator-editor-topic-container")!;
        menu.replaceChildren();
        if (!match || options.topicUnavailable) return;
        const el = doc.createElement("div");
        el.className = "item";
        const label = doc.createElement("span");
        label.className = "name";
        label.textContent = "#" + match[1];
        el.append(label);
        el.onclick = () => {
          const end = editor.state.selection.from;
          editor.commands.insertContentAt(
            { from: end - match[0].length, to: end },
            {
              type: "topic",
              attrs: { data: { id: "native-" + match[1], name: match[1] } },
            },
          );
        };
        menu.append(el);
      },
    });
  }
  const upload = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== "file") return;
    const file = input.files![0];
    files.push(file.name);
    if (platform === "x") {
      let gallery = doc.querySelector('[data-testid="attachments"]');
      if (!gallery) {
        gallery = doc.createElement("div");
        gallery.setAttribute("data-testid", "attachments");
        doc.querySelector('[role="dialog"]')!.append(gallery);
      }
      if (options.failure) return;
      const item = doc.createElement("div");
      item.setAttribute("data-testid", "tweetPhoto");
      const img = doc.createElement("img");
      img.src = `blob:https://x.com/${file.name}`;
      item.append(img);
      gallery.append(item);
      if (options.duplicate) gallery.append(item.cloneNode(true));
      if (options.pending) {
        const progress = doc.createElement("div");
        progress.setAttribute("role", "progressbar");
        gallery.append(progress);
      }
    } else {
      if (!tip) setupXhs();
      const item = doc.createElement("div");
      item.className = "img-container";
      // Production DOM has no Vue devtools properties. Native state is reflected
      // by failed/uploading masks and by Edit appearing after upload completes.
      item.innerHTML = `<img src="blob:https://creator.xiaohongshu.com/${files.length}">${options.failure ? '<div class="mask failed"></div>' : options.pending ? '<div class="mask uploading"></div>' : '<div class="mask hover-mask"><button class="edit-btn">编辑</button></div>'}`;
      doc.querySelector(".img-preview-area")!.append(item);
      if (options.duplicate)
        doc.querySelector(".img-preview-area")!.append(item.cloneNode(true));
    }
  };
  doc.addEventListener("change", upload);
  const plan = prepareArticle(
    {
      format: "mogao-article",
      version: 1,
      mode: "post",
      platform,
      title: "测试标题",
      html: `<p>第一段</p><img alt="不要复制文件名" src="${png}"><p>第二段</p><img src="${png}"><p>#生活 #记录</p>`,
    },
    win,
  );
  const session = new PostSession(
    doc,
    platform,
    options.failure ||
      options.pending ||
      options.duplicate ||
      options.topicUnavailable
      ? 1100
      : 4000,
  );
  return {
    win,
    doc,
    plan,
    session,
    files,
    handle,
    close() {
      tip?.destroy();
      dom.window.close();
    },
  };
}
async function begin(f: ReturnType<typeof fixture>) {
  const { images, ...body } = f.plan;
  await f.session.begin(
    body,
    images.map((i) => i.marker),
  );
}

test("post package preserves paragraphs, image occurrence order and native-topic inputs", () => {
  const f = fixture("xiaohongshu");
  try {
    assert.equal(f.plan.caption, "第一段\n\n第二段");
    assert.deepEqual(f.plan.topics, ["生活", "记录"]);
    assert.deepEqual(
      f.plan.images.map((i) => i.name),
      ["mogao-001.png", "mogao-002.png"],
    );
    assert.notEqual(f.plan.images[0].marker, f.plan.images[1].marker);
    assert.doesNotMatch(f.plan.caption!, /不要复制|MOGAOIMAGE/);
  } finally {
    f.close();
  }
});
test("X native composer receives all four photos in order and leaves background and Publish alone", async () => {
  const f = fixture("x");
  try {
    f.plan = prepareArticle(
      {
        format: "mogao-article",
        version: 1,
        mode: "post",
        platform: "x",
        title: "标题",
        html: `<p>正文</p>${Array(4).fill(`<img src="${png}">`).join("")}<p>#话题</p>`,
      },
      f.win,
    );
    await begin(f);
    for (const image of f.plan.images) await f.session.image(image);
    assert.match(await f.session.finish(), /4 张图片/);
    assert.equal(
      f.handle!.props.editorState.getCurrentContent().getPlainText("\n"),
      "标题\n\n正文\n\n#话题",
    );
    assert.deepEqual(f.files, [
      "mogao-001.png",
      "mogao-002.png",
      "mogao-003.png",
      "mogao-004.png",
    ]);
    assert.equal(
      f.doc.querySelector("[contenteditable]")!.textContent,
      "保留后台草稿",
    );
  } finally {
    f.close();
  }
});
test("production XHS DOM fills title/body after first photo without Vue devtools and adds native topics", async () => {
  const f = fixture("xiaohongshu");
  try {
    assert.equal(postProbe(f.doc, "xiaohongshu")?.empty, true);
    await begin(f);
    await f.session.image(f.plan.images[0]);
    assert.equal(f.files.length, 1);
    assert.equal(
      f.doc.querySelector<HTMLInputElement>("input[placeholder]")!.value,
      "测试标题",
    );
    assert.equal(f.doc.querySelector(".tiptap")!.textContent, "第一段第二段");
    await f.session.image(f.plan.images[1]);
    assert.match(await f.session.finish(), /2 个话题及 2 张图片/);
    assert.equal(
      f.doc.querySelector<HTMLInputElement>("input[placeholder]")!.value,
      "测试标题",
    );
    assert.equal(f.doc.querySelectorAll("a.tiptap-topic").length, 2);
    assert.equal(f.files.length, 2);
  } finally {
    f.close();
  }
});
test("existing X caption or attachments never get overwritten", async () => {
  const f = fixture("x");
  try {
    f.doc.querySelector('[role="dialog"] [contenteditable]')!.textContent =
      "已有稿件";
    await assert.rejects(begin(f), /已有内容/);
    assert.equal(f.files.length, 0);
  } finally {
    f.close();
  }
});
for (const platform of ["x", "xiaohongshu"] as const)
  test(`${platform} stops on incomplete uploads without sending the next photo`, async () => {
    const f = fixture(platform, { pending: true });
    try {
      await begin(f);
      await assert.rejects(f.session.image(f.plan.images[0]), /未确认上传/);
      assert.equal(f.files.length, 1);
      if (platform === "xiaohongshu") {
        assert.equal(
          f.doc.querySelector<HTMLInputElement>("input[placeholder]")!.value,
          "测试标题",
        );
        assert.equal(
          f.doc.querySelector(".tiptap")!.textContent,
          "第一段第二段",
        );
      }
    } finally {
      f.close();
    }
  });
test("X stops on duplicate attachments and on changed order", async () => {
  const f = fixture("x", { duplicate: true });
  try {
    await begin(f);
    await assert.rejects(f.session.image(f.plan.images[0]), /额外图片/);
  } finally {
    f.close();
  }
  const g = fixture("x");
  try {
    await begin(g);
    await g.session.image(g.plan.images[0]);
    g.doc.querySelector<HTMLImageElement>(
      '[data-testid="attachments"] img',
    )!.src = "blob:https://x.com/replaced";
    await assert.rejects(g.session.image(g.plan.images[1]), /顺序发生变化/);
    assert.equal(g.files.length, 1);
  } finally {
    g.close();
  }
});
test("cancel and user edits prevent additional uploads", async () => {
  const f = fixture("x");
  try {
    await begin(f);
    f.session.cancel();
    await assert.rejects(f.session.image(f.plan.images[0]), /停止/);
    assert.equal(f.files.length, 0);
  } finally {
    f.close();
  }
  const g = fixture("x");
  try {
    await begin(g);
    g.handle!.props.onChange(
      Draft.EditorState.createWithContent(
        Draft.ContentState.createFromText("用户改动"),
      ),
    );
    await assert.rejects(g.session.image(g.plan.images[0]), /已被编辑/);
    assert.equal(g.files.length, 0);
  } finally {
    g.close();
  }
});
test("XHS reports native upload and topic failures rather than claiming success", async () => {
  const f = fixture("xiaohongshu", { failure: true });
  try {
    await begin(f);
    await assert.rejects(f.session.image(f.plan.images[0]), /上传失败/);
  } finally {
    f.close();
  }
  const g = fixture("xiaohongshu", { topicUnavailable: true });
  try {
    await begin(g);
    for (const image of g.plan.images) await g.session.image(image);
    await assert.rejects(g.session.finish(), /未找到话题/);
    assert.equal(g.files.length, 2);
    assert.equal(g.doc.querySelectorAll("a.tiptap-topic").length, 0);
  } finally {
    g.close();
  }
});
test("post limits reject entire delivery without dropping images, text or title", () => {
  const f = fixture("x");
  const source = {
    format: "mogao-article" as const,
    version: 1 as const,
    mode: "post" as const,
    title: "标题",
    platform: "x" as const,
    html: "",
  };
  try {
    assert.throws(
      () =>
        prepareArticle(
          { ...source, html: Array(5).fill(`<img src="${png}">`).join("") },
          f.win,
        ),
      /最多 4/,
    );
    assert.equal(
      prepareArticle({ ...source, html: `<p>${"中".repeat(150)}</p>` }, f.win)
        .caption,
      "标题\n\n" + "中".repeat(150),
    );
    assert.throws(
      () =>
        prepareArticle(
          { ...source, platform: "xiaohongshu", html: "<p>没有图片</p>" },
          f.win,
        ),
      /至少需要/,
    );
    assert.throws(
      () =>
        prepareArticle(
          {
            ...source,
            platform: "xiaohongshu",
            title: "长".repeat(21),
            html: `<img src="${png}">`,
          },
          f.win,
        ),
      /20 字/,
    );
    assert.throws(
      () =>
        prepareArticle(
          {
            ...source,
            platform: "xiaohongshu",
            html: Array(19).fill(`<img src="${png}">`).join(""),
          },
          f.win,
        ),
      /最多 18/,
    );
    assert.throws(
      () =>
        prepareArticle(
          { ...source, html: '<img src="data:image/gif;base64,R0lGODlh">' },
          f.win,
        ),
      /格式不支持/,
    );
    assert.throws(
      () =>
        readArticle(
          JSON.stringify({ ...source, platform: "wechat" }),
          "json",
          undefined,
          f.win,
        ),
      /模式/,
    );
  } finally {
    f.close();
  }
});
test("normal navigation excludes invisible/offscreen XHS trap tabs and keeps article URLs", () => {
  const dom = new JSDOM(
    '<div class="creator-tab" aria-hidden="true">上传图文</div><div class="creator-tab" style="opacity:.00001">上传图文</div><div class="creator-tab">上传图文</div>',
    { url: destinationUrl("xiaohongshu", "post"), pretendToBeVisual: true },
  );
  const win = dom.window as any;
  win.HTMLElement.prototype.getClientRects = () => [
    { left: 0, right: 500, top: 0, bottom: 300, width: 500, height: 300 },
  ];
  let clicks = 0;
  [...win.document.querySelectorAll(".creator-tab")].forEach(
    (el: any, index) =>
      (el.onclick = () => {
        assert.equal(index, 2);
        clicks++;
      }),
  );
  prepareDestination(win.document, "xiaohongshu", "post");
  prepareDestination(win.document, "xiaohongshu", "post");
  assert.equal(clicks, 1);
  assert.equal(destinationUrl("x"), "https://x.com/compose/articles");
  dom.window.close();
});

test("XHS requires decoded images and preserves title/body typed while uploading", async () => {
  const f = fixture("xiaohongshu");
  try {
    await begin(f);
    Object.defineProperty(f.win.HTMLImageElement.prototype, "naturalWidth", {
      get: () => 0,
      configurable: true,
    });
    await assert.rejects(f.session.image(f.plan.images[0]), /未确认上传/);
  } finally {
    f.close();
  }
  const g = fixture("xiaohongshu");
  try {
    await begin(g);
    for (const image of g.plan.images) await g.session.image(image);
    g.doc.querySelector<HTMLInputElement>("input[placeholder]")!.value =
      "用户的新标题";
    await assert.rejects(g.session.finish(), /已被编辑/);
    assert.equal(
      g.doc.querySelector<HTMLInputElement>("input[placeholder]")!.value,
      "用户的新标题",
    );
  } finally {
    g.close();
  }
});

test("X receives long text even when its own Post button is disabled", async () => {
  const f = fixture("x");
  try {
    f.plan.caption = "完整长文".repeat(200);
    f.doc.querySelector<HTMLButtonElement>(
      '[data-testid="tweetButton"]',
    )!.disabled = true;
    await begin(f);
    for (const image of f.plan.images) await f.session.image(image);
    assert.match(await f.session.finish(), /2 张图片/);
    assert.equal(
      f.handle!.props.editorState.getCurrentContent().getPlainText("\n"),
      f.plan.caption,
    );
  } finally {
    f.close();
  }
});

test("XHS preserves user edits during the remaining image uploads", async () => {
  const f = fixture("xiaohongshu");
  try {
    await begin(f);
    await f.session.image(f.plan.images[0]);
    f.doc.querySelector<HTMLInputElement>("input[placeholder]")!.value =
      "用户改动";
    await assert.rejects(f.session.image(f.plan.images[1]), /已被编辑/);
    assert.equal(f.files.length, 1);
    assert.equal(
      f.doc.querySelector<HTMLInputElement>("input[placeholder]")!.value,
      "用户改动",
    );
  } finally {
    f.close();
  }
});
