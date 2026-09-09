import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import Draft from "draft-js";
import type { EditorState } from "draft-js";
const { EditorState, AtomicBlockUtils, convertToRaw, convertFromRaw } = Draft;
import {
  DraftDriver,
  hasMediaId,
  type DraftHandle,
} from "../src/platforms/draftjs";
import { EditorSession } from "../src/editor";
import { prepareArticle } from "../src/package";
import { articleBlocks } from "../src/platforms/blocks";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
function fixture(
  platform: "zhihu" | "x",
  fail = false,
  pendingMedia = false,
  html?: string,
  options: {
    blob?: boolean;
    remount?: boolean;
    zhihuInput?: boolean;
    zhihuModal?: boolean;
    delayedId?: boolean;
    atMarker?: boolean;
    sameImageUrl?: boolean;
  } = {},
) {
  const dom = new JSDOM(
    '<textarea placeholder="标题 Title"></textarea><button aria-label="图片">图片</button><div class="public-DraftEditor-content" contenteditable="true"></div>',
    {
      url:
        platform === "x"
          ? "https://x.com/compose/articles/edit/123"
          : "https://zhuanlan.zhihu.com/p/123/edit",
      pretendToBeVisual: true,
    },
  );
  const win = dom.window as any;
  win.HTMLElement.prototype.getClientRects = () => [
    { width: 700, height: 300 },
  ];
  Object.defineProperty(win.HTMLImageElement.prototype, "complete", {
    get() {
      return /^(https:|blob:)/.test(this.src);
    },
  });
  Object.defineProperty(win.HTMLImageElement.prototype, "naturalWidth", {
    get() {
      return /^(https:|blob:)/.test(this.src) ? 750 : 0;
    },
  });
  Object.defineProperty(win.HTMLInputElement.prototype, "files", {
    configurable: true,
    get() {
      return (this as any)._files;
    },
    set(files) {
      (this as any)._files = files;
    },
  });
  win.DataTransfer = class {
    files: File[] = [];
    items = { add: (f: File) => this.files.push(f) };
  };
  const root = win.document.querySelector("[contenteditable]");
  let uploads = 0;
  const render = (state: EditorState) => {
    root.replaceChildren();
    state
      .getCurrentContent()
      .getBlocksAsArray()
      .forEach((block) => {
        const el = win.document.createElement("div");
        el.setAttribute("data-block", "true");
        el.setAttribute("data-offset-key", `${block.getKey()}-0-0`);
        if (block.getType() === "atomic") {
          const entity = block.getEntityAt(0);
          const src = state.getCurrentContent().getEntity(entity).getData().src;
          const img = win.document.createElement("img");
          img.src = src;
          el.append(img);
        } else el.textContent = block.getText();
        root.append(el);
      });
  };
  const handle: DraftHandle = {
    props: {
      editorState: EditorState.createEmpty(),
      onChange: (state) => {
        // Both platforms serialize on change to save the article. A rendered
        // string alone misses invalid character entity references.
        convertToRaw(state.getCurrentContent());
        handle.props.editorState = state;
        render(state);
      },
    },
  };
  // Preserve existing image DOM identities across ordinary state transactions, as React does.
  const setState = handle.props.onChange;
  handle.props.onChange = (state) => {
    const old = [...root.querySelectorAll("img")] as HTMLImageElement[];
    setState(state);
    if (options.remount) return;
    const consumed = new Set<HTMLImageElement>();
    for (const img of [...root.querySelectorAll("img")] as HTMLImageElement[]) {
      const match = old.find((i) => i.src === img.src && !consumed.has(i));
      if (match) {
        consumed.add(match);
        img.replaceWith(match);
      }
    }
  };
  win.document.execCommand = () => {
    throw new Error("Do not seed a React-managed editor using execCommand");
  };
  const upload = (files: File[]) => {
    assert.equal(files.length, 1);
    assert.ok(files[0].size > 50);
    uploads++;
    if (fail) return;
    const src =
      platform === "zhihu"
        ? `https://pic-private.zhihu.com/test-${options.sameImageUrl ? 1 : uploads}.png`
        : options.blob
          ? `blob:https://x.com/test-${uploads}`
          : `https://pbs.twimg.com/media/test-${uploads}.png`;
    // The native uploader deliberately adds the atomic node at the end of the document.
    const state = options.atMarker
      ? handle.props.editorState
      : EditorState.moveSelectionToEnd(handle.props.editorState);
    const content = state
      .getCurrentContent()
      .createEntity(platform === "x" ? "MEDIA" : "IMAGE", "IMMUTABLE", {
        src,
        platformUploadId: `asset-${uploads}`,
        ...(pendingMedia || options.delayedId
          ? {}
          : { mediaItems: [String(1234567890000 + uploads)] }),
      });
    handle.props.onChange(
      AtomicBlockUtils.insertAtomicBlock(
        EditorState.set(state, { currentContent: content }),
        content.getLastCreatedEntityKey(),
        " ",
      ),
    );
    if (options.delayedId) {
      const key = content.getLastCreatedEntityKey();
      const id = String(1234567890000 + uploads);
      win.setTimeout(() => {
        const state = handle.props.editorState;
        const updated = state
          .getCurrentContent()
          .mergeEntityData(key, { mediaItems: [id] });
        handle.props.onChange(
          EditorState.set(state, { currentContent: updated }),
        );
      }, 200);
    }
  };
  root.__reactFiber$mogao = {
    stateNode: handle,
    return: { memoizedProps: { onFilesAdded: upload } },
  };
  win.document.querySelector("button").onclick = () => {
    if (options.zhihuInput)
      throw new Error(
        "Do not open the material dialog when the native body input exists",
      );
    const input = win.document.createElement("input");
    input.type = "file";
    if (options.zhihuModal) {
      const dialog = win.document.createElement("div");
      dialog.className = "Modal";
      dialog.textContent = "上传图片 本地图片上传 手机扫码上传";
      input.accept = "image/*";
      input.multiple = true;
      dialog.append(input);
      input.onchange = () => {
        upload(input.files);
        dialog.remove();
      };
      win.setTimeout(() => win.document.body.append(dialog), 30);
      return;
    }
    input.click();
    input.onchange = () => upload(input.files);
  };
  if (options.zhihuInput) {
    const wrapper = win.document.createElement("div");
    wrapper.className = "PostEditor";
    root.replaceWith(wrapper);
    wrapper.append(root);
    for (const accept of [
      ".pdf,.png,.docx",
      "image/webp,image/jpeg,image/png,.heic",
    ]) {
      const input = win.document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = accept;
      input.onchange = () => {
        assert.ok(accept.startsWith("image/"));
        upload(input.files);
      };
      wrapper.append(input);
    }
    const cover = win.document.createElement("input");
    cover.type = "file";
    cover.accept = ".jpeg,.jpg,.png";
    cover.onchange = () => {
      throw new Error("Cover input must remain untouched");
    };
    win.document.body.append(cover);
  }
  const plan = prepareArticle(
    {
      format: "mogao-article",
      version: 1,
      platform,
      title: "三图顺序测试",
      html:
        html ??
        `<p><strong>开头</strong></p><img src="${png}"><p>中间一</p><img src="${png}"><p>中间二</p><img src="${png}"><p>结尾</p>`,
    },
    win,
  );
  const session = new EditorSession(
    root,
    platform,
    fail || pendingMedia ? 300 : 4000,
    new DraftDriver(root, platform),
  );
  return { dom, win, root, handle, plan, session, uploads: () => uploads };
}
for (const options of [
  { blob: true, remount: true, delayedId: true },
  { blob: true, remount: true, atMarker: true },
  { zhihuInput: true },
  { zhihuInput: true, remount: true },
  { zhihuInput: true, remount: true, sameImageUrl: true, atMarker: true },
  { zhihuModal: true },
]) {
  const platform = "blob" in options ? "x" : "zhihu";
  test(`${platform}: current native DOM route keeps three images in place ${JSON.stringify(options)}`, async () => {
    const f = fixture(platform, false, false, undefined, options);
    try {
      const { images, ...body } = f.plan;
      await f.session.begin(
        body,
        images.map((i) => i.marker),
      );
      for (const image of images) await f.session.image(image);
      assert.match(await f.session.finish(), /3 张平台图片/);
      assert.equal(f.uploads(), 3);
      const content = f.handle.props.editorState.getCurrentContent();
      const sequence = content
        .getBlocksAsArray()
        .filter((b) => b.getType() === "atomic" || b.getText().trim())
        .map((b) => (b.getType() === "atomic" ? "[image]" : b.getText()));
      assert.deepEqual(sequence, [
        "开头",
        "[image]",
        "中间一",
        "[image]",
        "中间二",
        "[image]",
        "结尾",
      ]);
      assert.deepEqual(
        convertToRaw(convertFromRaw(convertToRaw(content))),
        convertToRaw(content),
      );
      if (options.blob)
        assert.ok(
          [...f.root.querySelectorAll("img")].every((i: any) =>
            i.src.startsWith("blob:https://x.com/"),
          ),
        );
    } finally {
      f.session.cancel();
      f.dom.window.close();
    }
  });
}
test("X blob previews still require a platform media ID and an exact native block binding", async () => {
  const f = fixture("x", false, true, undefined, { blob: true });
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((i) => i.marker),
    );
    await assert.rejects(f.session.image(images[0]), /未在/);
    assert.equal(f.uploads(), 1);
    assert.ok(f.root.textContent.includes(images[0].marker));
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
  assert.equal(hasMediaId({ mediaItems: ["1234567890123456789"] }), true);
  assert.equal(hasMediaId({ width: 123456789, height: 987654321 }), false);
  assert.equal(hasMediaId({ mediaItems: ["local-preview"] }), false);
});

test("Zhihu image records survive CDN URL changes while refusing non-platform previews", async () => {
  const f = fixture("zhihu", false, false, undefined, {
    zhihuInput: true,
    remount: true,
  });
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((image) => image.marker),
    );
    await f.session.image(images[0]);
    const state = f.handle.props.editorState;
    const content = state.getCurrentContent();
    const block = content
      .getBlocksAsArray()
      .find((b) => b.getType() === "atomic")!;
    const updateUrl = (src: string) => {
      const current = f.handle.props.editorState;
      f.handle.props.onChange(
        EditorState.set(current, {
          currentContent: current
            .getCurrentContent()
            .mergeEntityData(block.getEntityAt(0), { src }),
        }),
      );
    };
    updateUrl("https://picx.zhimg.com/converted-first-image.webp");
    for (const image of images.slice(1)) await f.session.image(image);
    assert.equal(f.uploads(), 3);
    updateUrl("https://untrusted.example/image.png");
    await assert.rejects(f.session.finish(), /最终图片数量、顺序或显示状态/);
    updateUrl("https://picx.zhimg.com/converted-first-image.webp");
    assert.match(await f.session.finish(), /3 张平台图片/);
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});

test("Zhihu rejects a previous image as the new upload without moving or removing draft blocks", async () => {
  const f = fixture("zhihu", false, false, undefined, {
    zhihuInput: true,
    remount: true,
  });
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((image) => image.marker),
    );
    await f.session.image(images[0]);
    const driver = new DraftDriver(f.root, "zhihu");
    await driver.upload(images[1]);
    const before = convertToRaw(f.handle.props.editorState.getCurrentContent());
    await assert.rejects(
      driver.settle(images[1], f.root.querySelector("img")),
      /本次上传的文档记录不一致/,
    );
    assert.deepEqual(
      convertToRaw(f.handle.props.editorState.getCurrentContent()),
      before,
    );
    assert.ok(f.root.textContent.includes(images[1].marker));
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});

for (const restoreMarkers of [false, true])
  test(`X final reconciliation restores two images moved to the end by delayed native updates (markers=${restoreMarkers})`, async () => {
    const f = fixture(
      "x",
      false,
      false,
      `<img src="${png}"><p>首段</p><img src="${png}"><p>第二段</p><p>结尾</p>`,
      { blob: true, remount: true },
    );
    try {
      const { images, ...body } = f.plan;
      await f.session.begin(
        body,
        images.map((i) => i.marker),
      );
      const seeded = f.handle.props.editorState
        .getCurrentContent()
        .getBlockMap();
      for (const image of images) await f.session.image(image);
      const original = convertToRaw(
        f.handle.props.editorState.getCurrentContent(),
      );
      let moved = 0;
      const lateUpdate = () => {
        const state = f.handle.props.editorState;
        const content = state.getCurrentContent();
        const map = content.getBlockMap();
        let next = restoreMarkers
          ? seeded
          : map.filter((b) => b?.getType() !== "atomic").toOrderedMap();
        if (restoreMarkers)
          map.forEach((b, key) => {
            if (b?.getType() === "unstyled" && !b.getLength() && key)
              next = next.set(key, b);
          });
        map.forEach((b, key) => {
          if (b?.getType() === "atomic" && key) next = next.set(key, b);
        });
        f.handle.props.onChange(
          EditorState.push(
            state,
            content.set("blockMap", next) as typeof content,
            "insert-fragment",
          ),
        );
        moved++;
      };
      f.win.setTimeout(lateUpdate, 350);
      f.win.setTimeout(lateUpdate, 950);
      await f.session.finish();
      assert.equal(
        moved,
        2,
        "completion must wait through delayed platform updates",
      );
      const saved = convertToRaw(
        f.handle.props.editorState.getCurrentContent(),
      );
      assert.deepEqual(
        saved,
        original,
        "restore complete saved document order and media metadata",
      );
      assert.deepEqual(convertToRaw(convertFromRaw(saved)), saved);
      assert.equal(
        f.uploads(),
        2,
        "moving uploaded images must not upload duplicates",
      );
    } finally {
      f.session.cancel();
      f.dom.window.close();
    }
  });

test("X final reconciliation keeps a later text edit instead of restoring a stale article", async () => {
  const f = fixture(
    "x",
    false,
    false,
    `<p>开头</p><img src="${png}"><p>结尾</p>`,
    { blob: true },
  );
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((i) => i.marker),
    );
    await f.session.image(images[0]);
    f.win.setTimeout(() => {
      const state = f.handle.props.editorState;
      const content = state.getCurrentContent();
      const block = content
        .getBlocksAsArray()
        .find((b) => b.getText() === "结尾")!;
      const map = content
        .getBlockMap()
        .set(block.getKey(), block.set("text", "保留") as typeof block);
      f.handle.props.onChange(
        EditorState.push(
          state,
          content.set("blockMap", map) as typeof content,
          "insert-characters",
        ),
      );
    }, 350);
    await assert.rejects(f.session.finish(), /正文已变化/);
    assert.ok(f.root.textContent.includes("保留"));
    assert.equal(f.uploads(), 1);
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});

test("X cancellation during final position checks stops without further writes", async () => {
  const f = fixture(
    "x",
    false,
    false,
    `<p>开头</p><img src="${png}"><p>结尾</p>`,
  );
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((i) => i.marker),
    );
    await f.session.image(images[0]);
    const saved = convertToRaw(f.handle.props.editorState.getCurrentContent());
    f.win.setTimeout(() => f.session.cancel(), 350);
    await assert.rejects(f.session.finish(), /同步已停止/);
    assert.deepEqual(
      convertToRaw(f.handle.props.editorState.getCurrentContent()),
      saved,
    );
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});
for (const platform of ["zhihu", "x"] as const) {
  test(`${platform}: native upload preserves three positions, platform metadata and separate title`, async () => {
    const f = fixture(platform);
    try {
      const { images, ...body } = f.plan;
      await f.session.begin(
        body,
        images.map((i) => i.marker),
      );
      for (const image of images) await f.session.image(image);
      assert.match(await f.session.finish(), /3 张平台图片/);
      const content = f.handle.props.editorState.getCurrentContent();
      const blocks = content
        .getBlocksAsArray()
        .filter((b) => b.getType() === "atomic" || b.getText().trim());
      assert.deepEqual(
        blocks.map((b) => (b.getType() === "atomic" ? "[image]" : b.getText())),
        ["开头", "[image]", "中间一", "[image]", "中间二", "[image]", "结尾"],
      );
      assert.equal(blocks[0].getInlineStyleAt(0).has("BOLD"), true);
      assert.deepEqual(
        blocks
          .filter((b) => b.getType() === "atomic")
          .map(
            (b) =>
              content.getEntity(b.getEntityAt(0)).getData().platformUploadId,
          ),
        ["asset-1", "asset-2", "asset-3"],
      );
      assert.equal(
        f.win.document.querySelector("textarea").value,
        "三图顺序测试",
      );
      assert.equal(f.uploads(), 3);
      const saved = convertToRaw(content);
      assert.deepEqual(convertToRaw(convertFromRaw(saved)), saved);
    } finally {
      f.session.cancel();
      f.dom.window.close();
    }
  });
}
for (const platform of ["zhihu", "x"] as const) {
  test(`${platform}: empty editor initializes without DOM seeding and saves plain text, links and emoji`, async () => {
    const f = fixture(
      platform,
      false,
      false,
      '<h2>正文标题</h2><p>中文 🐈 <strong>重点</strong> <a href="https://example.com/article">来源</a>结尾。</p>',
    );
    try {
      const { images, ...body } = f.plan;
      assert.equal(images.length, 0);
      await f.session.begin(body, []);
      const content = f.handle.props.editorState.getCurrentContent();
      const saved = convertToRaw(content);
      assert.deepEqual(convertToRaw(convertFromRaw(saved)), saved);
      assert.equal(saved.blocks[1].text, "中文 🐈 重点 来源结尾。");
      assert.equal(saved.blocks[1].entityRanges.length, 1);
      const range = saved.blocks[1].entityRanges[0];
      assert.equal(
        Array.from(saved.blocks[1].text)
          .slice(range.offset, range.offset + range.length)
          .join(""),
        "来源",
      );
      assert.equal(
        saved.entityMap[range.key].data.url,
        "https://example.com/article",
      );
      assert.equal(content.getFirstBlock().getEntityAt(0), null);
      assert.equal(f.uploads(), 0);
      await f.session.finish();
    } finally {
      f.session.cancel();
      f.dom.window.close();
    }
  });
}
test("Zhihu failed native upload preserves title and stops before subsequent images", async () => {
  const f = fixture("zhihu", true);
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((i) => i.marker),
    );
    await assert.rejects(f.session.image(images[0]), /未在/);
    assert.equal(f.uploads(), 1);
    assert.equal(
      f.win.document.querySelector("textarea").value,
      "三图顺序测试",
    );
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});
test("X decoded image without a completed media ID is not accepted or moved", async () => {
  const f = fixture("x", false, true);
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((i) => i.marker),
    );
    await assert.rejects(f.session.image(images[0]), /未在/);
    assert.equal(f.uploads(), 1);
    assert.equal(f.root.querySelector("img").naturalWidth, 750);
    assert.ok(f.root.textContent.includes(images[0].marker));
    await assert.rejects(f.session.finish(), /还没有全部上传/);
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});
test("structured blocks split inline images into exact blocks without losing surrounding text", () => {
  const d = new JSDOM("");
  try {
    const blocks = articleBlocks(
      d.window.document,
      "<h2>标题</h2><p><b>图前TOKEN图后</b>结尾</p><ol><li>项目一</li><li>项目二</li></ol>",
      ["TOKEN"],
    );
    assert.deepEqual(
      blocks.map((b) => b.text),
      ["标题", "图前", "TOKEN", "图后结尾", "项目一", "项目二"],
    );
    assert.equal(blocks[0].type, "header-two");
    assert.equal(blocks[3].inlineStyleRanges[0].style, "BOLD");
    assert.equal(blocks[4].type, "ordered-list-item");
  } finally {
    d.window.close();
  }
});
