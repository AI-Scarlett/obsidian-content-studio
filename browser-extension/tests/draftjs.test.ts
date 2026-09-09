import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import Draft from "draft-js";
import type { EditorState } from "draft-js";
const { EditorState, AtomicBlockUtils, convertToRaw, convertFromRaw } = Draft;
import { DraftDriver, type DraftHandle } from "../src/platforms/draftjs";
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
      return this.src.startsWith("https:");
    },
  });
  Object.defineProperty(win.HTMLImageElement.prototype, "naturalWidth", {
    get() {
      return this.src.startsWith("https:") ? 750 : 0;
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
        ? `https://pic-private.zhihu.com/test-${uploads}.png`
        : `https://pbs.twimg.com/media/test-${uploads}.png`;
    // The native uploader deliberately adds the atomic node at the end of the document.
    const state = EditorState.moveSelectionToEnd(handle.props.editorState);
    const content = state
      .getCurrentContent()
      .createEntity(platform === "x" ? "MEDIA" : "IMAGE", "IMMUTABLE", {
        src,
        platformUploadId: `asset-${uploads}`,
        ...(pendingMedia ? {} : { mediaId: String(1234567890000 + uploads) }),
      });
    handle.props.onChange(
      AtomicBlockUtils.insertAtomicBlock(
        EditorState.set(state, { currentContent: content }),
        content.getLastCreatedEntityKey(),
        " ",
      ),
    );
  };
  root.__reactFiber$mogao = {
    stateNode: handle,
    return: { memoizedProps: { onFilesAdded: upload } },
  };
  win.document.querySelector("button").onclick = () => {
    const input = win.document.createElement("input");
    input.type = "file";
    input.click();
    input.onchange = () => upload(input.files);
  };
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
