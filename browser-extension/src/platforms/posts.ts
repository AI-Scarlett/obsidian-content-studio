import type { Editor } from "@tiptap/core";
import type { ContentState, EditorState } from "draft-js";
import type { Destination, ImportPlan, InlineImage, Probe } from "../types";
import { draftHandle } from "./draftjs";
import { delay, imageFile, uploadToInput } from "./upload";

/** Exclude offscreen/transparent duplicate controls as well as hidden ancestors. */
export function postVisible(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView!;
  const rects = [...el.getClientRects()];
  if (
    !rects.some(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.right > 0 &&
        r.bottom > 0 &&
        r.left < win.innerWidth,
    )
  )
    return false;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const css = win.getComputedStyle(node);
    if (
      node.hidden ||
      node.getAttribute("aria-hidden") === "true" ||
      css.display === "none" ||
      css.visibility === "hidden" ||
      (css.opacity !== "" && Number(css.opacity) < 0.05)
    )
      return false;
  }
  return true;
}
function xRoot(doc: Document): HTMLElement | undefined {
  const roots = [
    ...doc.querySelectorAll<HTMLElement>(
      '[role="dialog"] [data-testid="tweetTextarea_0"][contenteditable="true"]',
    ),
  ].filter(postVisible);
  return roots.length === 1 ? roots[0] : undefined;
}
function xScope(doc: Document): HTMLElement | undefined {
  return xRoot(doc)?.closest<HTMLElement>('[role="dialog"]') || undefined;
}
function xhsGallery(doc: Document): HTMLElement | undefined {
  const roots = [...doc.querySelectorAll<HTMLElement>(".img-list")].filter(
    (el) =>
      !el.closest('.creator-modal-style, #img-note-modal, [role="dialog"]') &&
      postVisible(el) &&
      el.querySelector(".img-upload-area"),
  );
  return roots.length === 1 ? roots[0] : undefined;
}
function xhsRoot(doc: Document): HTMLElement | undefined {
  const roots = [
    ...doc.querySelectorAll<HTMLElement>(
      '.tiptap-container .tiptap.ProseMirror[contenteditable="true"]',
    ),
  ].filter(postVisible);
  return roots.length === 1 ? roots[0] : undefined;
}
function xhsTitle(doc: Document): HTMLInputElement | undefined {
  const fields = [
    ...doc.querySelectorAll<HTMLInputElement>(
      'input[placeholder="填写标题会有更多赞哦"]',
    ),
  ].filter(postVisible);
  return fields.length === 1 ? fields[0] : undefined;
}
export function postImageInput(
  doc: Document,
  platform: Destination,
): HTMLInputElement | undefined {
  let candidates: HTMLInputElement[];
  if (platform === "x")
    candidates = [
      ...(xScope(doc)?.querySelectorAll<HTMLInputElement>(
        'input[type="file"][data-testid="fileInput"][multiple]',
      ) || []),
    ];
  else {
    const gallery = xhsGallery(doc);
    candidates = gallery
      ? [
          ...gallery.querySelectorAll<HTMLInputElement>(
            'input[type="file"][multiple]',
          ),
        ]
      : [
          ...doc.querySelectorAll<HTMLInputElement>(
            'input.upload-input[type="file"][multiple]',
          ),
        ].filter(
          (input) => input.parentElement && postVisible(input.parentElement),
        );
  }
  candidates = candidates.filter(
    (el) => !el.disabled && /image|\.png|\.jpg/i.test(el.accept),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}
function xImages(doc: Document): HTMLImageElement[] {
  return [
    ...(xScope(doc)?.querySelectorAll<HTMLImageElement>(
      '[data-testid="attachments"] [data-testid="tweetPhoto"] img',
    ) || []),
  ];
}
function xhsItems(doc: Document): HTMLElement[] {
  return [
    ...(xhsGallery(doc)?.querySelectorAll<HTMLElement>(
      ".img-preview-area .img-container",
    ) || []),
  ];
}
export function postProbe(
  doc: Document,
  platform?: Destination,
): Probe | undefined {
  const path = doc.location.pathname;
  if (
    doc.location.hostname === "x.com" &&
    platform !== "xiaohongshu" &&
    path === "/compose/post"
  ) {
    const root = xRoot(doc);
    if (root && postImageInput(doc, "x"))
      return {
        platform: "x",
        mode: "post",
        editor: "x-post",
        empty:
          !root.textContent?.trim() &&
          !xImages(doc).length &&
          !xScope(doc)?.querySelector('[data-testid="attachments"]'),
        titleEmpty: true,
      };
  }
  if (
    doc.location.hostname === "creator.xiaohongshu.com" &&
    platform !== "x" &&
    path === "/publish/publish" &&
    new URL(doc.location.href).searchParams.get("target") === "image"
  ) {
    if (postImageInput(doc, "xiaohongshu"))
      return {
        platform: "xiaohongshu",
        mode: "post",
        editor: "xhs-image-post",
        empty: !xhsItems(doc).length && !xhsRoot(doc)?.textContent?.trim(),
        titleEmpty: !xhsTitle(doc)?.value.trim(),
      };
  }
}
// Source-backed Vue SingleImg props; the CDN preview may legitimately stay a blob.
function xhsIdentity(item: HTMLElement): string | undefined {
  const component = (
    item as HTMLElement & {
      __vueParentComponent?: {
        props?: { img?: { fileId?: unknown; status?: unknown } };
      };
    }
  ).__vueParentComponent;
  const id = component?.props?.img?.fileId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
function tiptap(root: HTMLElement): Editor {
  const editor = (root as HTMLElement & { editor?: Editor }).editor;
  if (!editor?.commands?.setContent || !editor.view?.state)
    throw new Error("小红书图文编辑器版本不兼容，未修改正文。");
  return editor;
}
export class PostSession {
  private win: Window & typeof globalThis;
  private stopped = false;
  private plan?: Omit<ImportPlan, "images">;
  private markers: string[] = [];
  private uploaded: string[] = [];
  private root?: HTMLElement;
  private textWritten = false;
  private topicCount = 0;
  constructor(
    private doc: Document,
    private platform: "x" | "xiaohongshu",
    private timeout = 60000,
  ) {
    this.win = doc.defaultView as Window & typeof globalThis;
  }
  cancel() {
    this.stopped = true;
  }
  private check() {
    if (this.stopped || (this.root && !this.root.isConnected))
      throw new Error("同步已停止或编辑器已关闭，当前草稿保留。");
  }
  private async until<T>(
    read: () => T | undefined | false,
    message: string,
  ): Promise<T> {
    const end = Date.now() + this.timeout;
    while (Date.now() < end) {
      this.check();
      const result = read();
      if (result) return result;
      await delay(this.win, 100);
    }
    throw new Error(message);
  }
  async begin(plan: Omit<ImportPlan, "images">, markers: string[]) {
    const probe = postProbe(this.doc, this.platform);
    if (
      plan.mode !== "post" ||
      plan.platform !== this.platform ||
      !probe?.empty ||
      !probe.titleEmpty
    )
      throw new Error("图文页已有内容或模式不符，原稿未被覆盖。");
    if (typeof plan.caption !== "string" || !Array.isArray(plan.topics))
      throw new Error("图文正文或话题缺失，请更新墨稿后重试。");
    this.plan = plan;
    this.markers = [...markers];
    if (this.platform === "x") {
      this.root = xRoot(this.doc)!;
      const handle = draftHandle(this.root);
      if (!handle) throw new Error("X 普通帖编辑器版本不兼容，原稿未修改。");
      const state = handle.props.editorState;
      const C = state.getCurrentContent().constructor as typeof ContentState;
      const E = state.constructor as typeof EditorState;
      handle.props.onChange(
        E.moveFocusToEnd(
          E.push(state, C.createFromText(plan.caption), "insert-fragment"),
        ),
      );
      this.textWritten = true;
      await this.until(
        () => this.captionMatches(),
        "X 未接收完整正文，已停止。",
      );
    }
    return "图文编辑器已就绪，正在按笔记顺序上传图片。";
  }
  private captionMatches(): boolean {
    if (!this.root || !this.plan) return false;
    const clean = (s: string) =>
      s
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .trim();
    if (this.platform === "x")
      return (
        clean(
          draftHandle(this.root)
            ?.props.editorState.getCurrentContent()
            .getPlainText("\n") || "",
        ) === clean(this.plan.caption!)
      );
    const editor = tiptap(this.root);
    const lines: string[] = [];
    editor.state.doc.forEach((block) => {
      let line = "";
      block.descendants((node) => {
        if (node.type.name === "topic") return false;
        if (node.isText) line += node.text || "";
        else if (node.type.name === "hardBreak") line += "\n";
      });
      lines.push(line);
    });
    const text = lines.join("\n");
    // Topic nodes are atomic and omitted by the native getText serializer.
    return clean(text) === clean(this.plan.caption!);
  }
  private identities(): string[] | undefined {
    if (this.platform === "x") {
      const imgs = xImages(this.doc);
      if (imgs.some((img) => !img.complete || !img.naturalWidth)) return;
      if (
        xScope(this.doc)?.querySelector(
          '[data-testid="attachments"] [role="progressbar"], [data-testid="mediaUploadProgress"]',
        )
      )
        return;
      return imgs.map((img) => img.currentSrc || img.src);
    }
    const items = xhsItems(this.doc);
    if (items.some((item) => item.querySelector(".mask.failed")))
      throw new Error("小红书图片上传失败，已停止；已上传内容保留。");
    if (
      items.some((item) =>
        item.querySelector(
          ".mask.uploading, .prerender, .processing-container",
        ),
      )
    )
      return;
    if (
      items.some((item) => {
        const image = item.querySelector("img");
        return !image?.complete || !image.naturalWidth;
      })
    )
      return;
    const ids = items.map(xhsIdentity);
    if (ids.some((id) => !id)) return;
    return ids as string[];
  }
  private verifyPrior(ids: string[]) {
    if (this.uploaded.some((id, i) => ids[i] !== id))
      throw new Error("图片被删除或顺序发生变化，已停止，请检查平台草稿。");
  }
  async image(image: InlineImage) {
    this.check();
    if (!this.plan || image.marker !== this.markers[this.uploaded.length])
      throw new Error("图片顺序不一致，已停止。");
    if (this.textWritten && !this.captionMatches())
      throw new Error("正文已被编辑，已停止同步，保留你的修改。");
    const before = this.identities();
    if (!before || before.length !== this.uploaded.length)
      throw new Error("平台图片发生变化，已停止同步。");
    this.verifyPrior(before);
    const input = postImageInput(this.doc, this.platform);
    if (!input) throw new Error("没有找到图文图片上传入口，请更新扩展后重试。");
    await uploadToInput(
      this.win,
      input,
      imageFile(this.win, image),
      () => !this.stopped,
    );
    const expected = this.uploaded.length + 1;
    let stable = "",
      since = 0;
    const ids = await this.until(() => {
      const result = this.identities();
      if (!result) {
        since = 0;
        return;
      }
      if (result.length > expected)
        throw new Error("平台插入了额外图片，已停止同步，避免重复上传。");
      if (result.length !== expected) {
        since = 0;
        return;
      }
      this.verifyPrior(result);
      const key = JSON.stringify(result);
      if (key !== stable || !since) {
        stable = key;
        since = Date.now();
        return;
      }
      return Date.now() - since >= 700 ? result : undefined;
    }, `第 ${expected} 张图片未确认上传完成，请检查平台页面，不要重复发送。`);
    this.uploaded = ids;
    return `已接收图片 ${expected} / ${this.markers.length}`;
  }
  private async writeXhs() {
    this.root = await this.until(
      () => xhsRoot(this.doc),
      "图片已上传，但小红书正文编辑器未出现。请检查当前草稿。",
    );
    const title = xhsTitle(this.doc);
    if (!title || title.value.trim() || this.root.textContent?.trim())
      throw new Error("小红书恢复了已有标题或正文，已保留原稿并停止。");
    const editor = tiptap(this.root);
    const setter = Object.getOwnPropertyDescriptor(
      this.win.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(title, this.plan!.title);
    title.dispatchEvent(new this.win.Event("input", { bubbles: true }));
    title.dispatchEvent(new this.win.Event("change", { bubbles: true }));
    editor.commands.setContent(
      {
        type: "doc",
        content: this.plan!.caption!.split("\n").map((text) => ({
          type: "paragraph",
          content: text ? [{ type: "text", text }] : [],
        })),
      },
      { emitUpdate: true },
    );
    this.textWritten = true;
    await this.until(
      () => this.captionMatches() && title.value === this.plan!.title,
      "小红书未接收完整标题或正文。",
    );
    for (const topic of this.plan!.topics!) {
      this.check();
      if (!this.captionMatches())
        throw new Error("正文已被编辑，停止添加话题，保留你的修改。");
      editor.commands.focus("end");
      editor.commands.insertContent(` #${topic}`);
      const expectedDocument = JSON.stringify(editor.getJSON());
      const option = await this.until(
        () =>
          [
            ...this.doc.querySelectorAll<HTMLElement>(
              "#creator-editor-topic-container .item",
            ),
          ].find(
            (el) =>
              postVisible(el) &&
              el.querySelector(".name")?.textContent?.trim() === `#${topic}`,
          ),
        `未找到话题 #${topic}，正文和图片已保留，请在平台确认话题。`,
      );
      this.check();
      if (
        JSON.stringify(editor.getJSON()) !== expectedDocument ||
        title.value !== this.plan!.title
      )
        throw new Error(
          "等待话题时正文或标题已被编辑，停止同步并保留你的修改。",
        );
      option.click();
      await this.until(
        () =>
          this.topicNames().length === this.topicCount + 1 &&
          this.topicNames()[this.topicCount] === topic,
        `话题 #${topic} 未被平台接收，可能达到当前账号话题限制，请在平台确认。`,
      );
      this.topicCount++;
    }
  }
  private topicNames(): string[] {
    if (!this.root) return [];
    return [
      ...this.root.querySelectorAll<HTMLElement>("a.tiptap-topic[data-topic]"),
    ].map((node) => {
      try {
        const data = JSON.parse(node.dataset.topic || "{}") as {
          id?: unknown;
          name?: unknown;
        };
        return typeof data.id === "string" &&
          !!data.id &&
          data.id !== "newTopic_Id" &&
          typeof data.name === "string"
          ? data.name
          : "";
      } catch {
        return "";
      }
    });
  }
  async finish() {
    this.check();
    if (!this.plan || this.uploaded.length !== this.markers.length)
      throw new Error("图片尚未全部上传，不能完成同步。");
    if (this.platform === "xiaohongshu") await this.writeXhs();
    await this.until(() => {
      if (!this.captionMatches())
        throw new Error("平台正文与墨稿不一致，请检查草稿。");
      const ids = this.identities();
      if (!ids) return;
      this.verifyPrior(ids);
      if (ids.length !== this.markers.length)
        throw new Error("平台图片数量与稿件不一致。");
      if (this.platform === "xiaohongshu") {
        if (
          xhsTitle(this.doc)?.value !== this.plan!.title ||
          JSON.stringify(this.topicNames()) !==
            JSON.stringify(this.plan!.topics)
        )
          throw new Error("标题或话题核对失败，请检查当前草稿。");
      } else {
        const button = xScope(this.doc)?.querySelector<HTMLElement>(
          '[data-testid="tweetButton"]',
        );
        if (
          !button ||
          button.hasAttribute("disabled") ||
          button.getAttribute("aria-disabled") === "true"
        )
          return;
      }
      return true;
    }, "图片或文案仍未通过平台检查，请检查平台提示。已同步内容保留。");
    return `已填入${this.platform === "x" ? "X 普通帖正文" : "小红书标题、正文和 " + this.topicCount + " 个话题"}及 ${this.uploaded.length} 张图片，请在平台检查后自行发布。`;
  }
}
