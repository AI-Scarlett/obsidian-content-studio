import type {
  Destination,
  EditorDriver,
  ImportPlan,
  InlineImage,
  Probe,
} from "./types";
import { normalizeText } from "./package";
import { TiptapDriver } from "./platforms/tiptap";
import { DraftDriver } from "./platforms/draftjs";

const config: Record<
  Destination,
  { host: string; editors: string[]; titles: string[]; cdns: string[] }
> = {
  xiaohongshu: {
    host: "creator.xiaohongshu.com",
    editors: [".tiptap.ProseMirror[contenteditable=true]"],
    titles: ['textarea[placeholder="输入标题"]'],
    cdns: ["xhscdn.com", "xiaohongshu.com"],
  },
  zhihu: {
    host: "zhuanlan.zhihu.com",
    editors: [
      ".public-DraftEditor-content[contenteditable=true]",
      ".ProseMirror[contenteditable=true]",
      ".RichText-editable[contenteditable=true]",
    ],
    titles: ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
    cdns: ["zhimg.com", "pic-private.zhihu.com"],
  },
  x: {
    host: "x.com",
    editors: [".public-DraftEditor-content[contenteditable=true]"],
    titles: [
      'textarea[placeholder*="Title" i]',
      'input[placeholder*="Title" i]',
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]',
      '[contenteditable=true][data-placeholder*="Title" i]',
      '[contenteditable=true][aria-label*="Title" i]',
      '[contenteditable=true][data-placeholder*="标题"]',
    ],
    cdns: ["twimg.com"],
  },
  wechat: {
    host: "mp.weixin.qq.com",
    editors: [
      ".ProseMirror[contenteditable=true]",
      "#ueditor_0[contenteditable=true]",
      "body.view[contenteditable=true]",
      ".edui-body-container[contenteditable=true]",
    ],
    titles: [
      "#title",
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
    ],
    cdns: ["qpic.cn", "qlogo.cn"],
  },
};
export function platformFor(host: string): Destination | undefined {
  return (Object.keys(config) as Destination[]).find(
    (key) => config[key].host === host,
  );
}
export function platformImage(url: string, platform: Destination): boolean {
  try {
    const parsed = new URL(url);
    return (
      ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      config[platform].cdns.some(
        (host) =>
          parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
const pause = (win: Window, ms: number) =>
  new Promise<void>((resolve) => win.setTimeout(resolve, ms));
function visible(el: HTMLElement) {
  return el.getClientRects().length > 0;
}
export function titleField(
  doc: Document,
  platform: Destination,
): HTMLInputElement | HTMLTextAreaElement | HTMLElement | undefined {
  const documents = [doc];
  try {
    if (
      doc.defaultView?.parent.document &&
      doc.defaultView.parent.document !== doc
    )
      documents.push(doc.defaultView.parent.document);
  } catch {
    /* cross-origin frames cannot supply title fields */
  }
  return documents
    .flatMap((d) =>
      config[platform].titles.flatMap((selector) => [
        ...d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector),
      ]),
    )
    .find((el) => visible(el) && !el.disabled && !el.readOnly);
}
function empty(root: HTMLElement) {
  return (
    !normalizeText(root.textContent || "") &&
    !root.querySelector("img,video,iframe,table")
  );
}
export function findEditor(
  doc: Document,
): { root: HTMLElement; platform: Destination; probe: Probe } | undefined {
  const platform = platformFor(doc.location.hostname);
  if (
    !platform ||
    (platform === "x" && !doc.location.pathname.startsWith("/compose/articles"))
  )
    return;
  const roots = [
    ...new Set(
      config[platform].editors.flatMap((selector) => [
        ...doc.querySelectorAll<HTMLElement>(selector),
      ]),
    ),
  ].filter((el) => visible(el) && el !== titleField(doc, platform));
  if (roots.length !== 1) return;
  const root = roots[0],
    title = titleField(doc, platform);
  return {
    root,
    platform,
    probe: {
      platform,
      editor: root.className || root.tagName,
      empty: empty(root),
      titleEmpty: !!title && !titleText(title).trim(),
    },
  };
}

export function titleText(el: HTMLElement) {
  return "value" in el ? String(el.value) : el.textContent || "";
}
async function writeTitle(el: HTMLElement, text: string) {
  const win = el.ownerDocument.defaultView as Window & typeof globalThis;
  if (
    el instanceof win.HTMLInputElement ||
    el instanceof win.HTMLTextAreaElement
  ) {
    const proto =
      el.tagName === "TEXTAREA"
        ? win.HTMLTextAreaElement.prototype
        : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
  } else {
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    win.getSelection()?.removeAllRanges();
    win.getSelection()?.addRange(range);
    el.ownerDocument.execCommand("insertText", false, text);
  }
  await pause(win, 150);
  if (titleText(el) !== text)
    throw new Error("平台没有接收完整标题，已停止同步。");
}

/** Shared auditing only. Platform drivers own document state, media upload and placement. */
export class EditorSession {
  private plan?: Omit<ImportPlan, "images">;
  private markers: string[] = [];
  private urls: string[] = [];
  private stopped = false;
  private win: Window & typeof globalThis;
  private driver?: EditorDriver;
  private intercept = (event: Event) => {
    if (event.isTrusted) this.cancel();
  };
  constructor(
    private root: HTMLElement,
    private platform: Destination,
    private timeout = 90000,
    driver?: EditorDriver,
  ) {
    this.win = root.ownerDocument.defaultView as Window & typeof globalThis;
    this.driver = driver;
  }
  cancel() {
    this.stopped = true;
    this.driver?.cancel?.();
    this.dispose();
  }
  dispose() {
    for (const event of ["pointerdown", "keydown"])
      this.root.ownerDocument.removeEventListener(event, this.intercept, true);
  }
  private check() {
    if (this.stopped || !this.root.isConnected)
      throw new Error(
        "同步已停止或编辑器已关闭；当前草稿保留，请检查已同步部分。",
      );
  }
  private imageIdentity(image: HTMLImageElement): string | undefined {
    const src = image.getAttribute("src") || "";
    if (!image.complete || !image.naturalWidth) return;
    if (this.platform === "x") {
      if (!platformImage(src, "x") && !src.startsWith("blob:https://x.com/"))
        return;
      return this.driver?.imageIdentity?.(image);
    }
    return platformImage(src, this.platform) ? src : undefined;
  }
  async begin(plan: Omit<ImportPlan, "images">, markers: string[]) {
    if (this.plan || this.stopped)
      throw new Error("本次同步已经开始，请勿重复同步。");
    const title = titleField(this.root.ownerDocument, this.platform);
    if (!empty(this.root) || !title || titleText(title).trim())
      throw new Error(
        "请在标题和正文都为空的新长文草稿中同步，避免覆盖已有内容。",
      );
    if (plan.platform !== this.platform)
      throw new Error("稿件平台与当前编辑器不同。");
    const max =
      title instanceof this.win.HTMLTextAreaElement ||
      title instanceof this.win.HTMLInputElement
        ? title.maxLength
        : -1;
    if (max > 0 && plan.title.length > max)
      throw new Error(`标题超过平台 ${max} 字上限，请先在墨稿修改。`);
    this.driver ||=
      this.platform === "xiaohongshu"
        ? new TiptapDriver(this.root)
        : this.platform === "zhihu" || this.platform === "x"
          ? new DraftDriver(this.root, this.platform)
          : undefined;
    if (!this.driver) throw new Error("公众号须使用素材和草稿适配器。");
    this.plan = plan;
    this.markers = markers;
    for (const event of ["pointerdown", "keydown"])
      this.root.ownerDocument.addEventListener(event, this.intercept, true);
    await writeTitle(title, plan.title);
    this.check();
    await this.driver.write(plan.html, markers);
    this.check();
    const actual = normalizeText(this.root.textContent || "");
    if (
      empty(this.root) ||
      markers.some((marker) => !actual.includes(marker)) ||
      plan.textParts.some((part) => part && !actual.includes(part))
    )
      throw new Error("平台文档未完整接收正文，已停止同步，请检查草稿。");
    return "标题和正文已写入，开始按原位置上传图片。";
  }
  async image(image: InlineImage) {
    this.check();
    if (
      !this.plan ||
      !this.driver ||
      this.markers[this.urls.length] !== image.marker
    )
      throw new Error("图片顺序不一致，已停止。");
    const before = [...this.root.querySelectorAll("img")];
    const beforeIdentities = new Set(
      before.map((img) => this.imageIdentity(img)),
    );
    await this.driver.upload(image);
    const until = Date.now() + this.timeout;
    let stableUrl = "",
      since = 0;
    while (Date.now() < until) {
      await pause(this.win, 150);
      this.check();
      const all = [...this.root.querySelectorAll("img")];
      if (all.length > before.length + 1)
        throw new Error(
          "平台插入了多余图片，已停止；请检查当前草稿，避免重复上传。",
        );
      const added = all.filter((img) =>
        this.platform === "x"
          ? !!this.imageIdentity(img) &&
            !beforeIdentities.has(this.imageIdentity(img))
          : !before.includes(img),
      );
      const candidate = added.length === 1 ? added[0] : undefined;
      const src = candidate ? this.imageIdentity(candidate) : undefined;
      if (
        !candidate ||
        all.length !== before.length + 1 ||
        !src ||
        (this.driver.ready && !this.driver.ready())
      ) {
        stableUrl = "";
        since = 0;
        continue;
      }
      if (stableUrl !== src) {
        stableUrl = src;
        since = Date.now();
      }
      if (Date.now() - since < 600) continue;
      await this.driver.settle(image, candidate);
      this.check();
      const imgs = [...this.root.querySelectorAll("img")];
      const expected = [...this.urls, src];
      if (
        imgs.length !== expected.length ||
        expected.some((url, i) => this.imageIdentity(imgs[i]) !== url)
      )
        throw new Error("图片在平台文档中的顺序不一致，已停止同步。");
      if ((this.root.textContent || "").includes(image.marker))
        throw new Error("图片已上传，但位置标记仍在正文，已停止同步。");
      this.urls.push(src);
      return `图片 ${this.urls.length} / ${this.markers.length} 已上传并放回原位置。`;
    }
    throw new Error(
      `第 ${this.urls.length + 1} 张图片未在 ${Math.ceil(this.timeout / 1000)} 秒内完成平台上传。当前草稿保留，请检查平台提示。`,
    );
  }
  async finish() {
    this.check();
    if (!this.plan || this.urls.length !== this.markers.length)
      throw new Error("图片还没有全部上传。");
    await this.driver?.finish?.();
    this.check();
    const imgs = [...this.root.querySelectorAll("img")];
    if (
      imgs.length !== this.urls.length ||
      imgs.some((img, i) => this.imageIdentity(img) !== this.urls[i])
    )
      throw new Error("最终图片数量、顺序或显示状态不一致。");
    if (
      this.markers.some((marker) =>
        (this.root.textContent || "").includes(marker),
      )
    )
      throw new Error("正文仍有未替换的图片位置标记。");
    const parts = [""];
    const walk = (node: Node) => {
      if (node.nodeType === 3)
        parts[parts.length - 1] += node.textContent || "";
      else if (node instanceof this.win.HTMLImageElement) parts.push("");
      else for (const child of node.childNodes) walk(child);
    };
    walk(this.root);
    if (
      this.plan.textParts.some(
        (part, i) => part && !normalizeText(parts[i] || "").includes(part),
      )
    )
      throw new Error("图片与相邻正文核对未通过，请检查草稿。");
    const title = titleField(this.root.ownerDocument, this.platform);
    if (!title || titleText(title) !== this.plan.title)
      throw new Error("标题栏已变化，请检查草稿。");
    this.cancel();
    return `标题、正文和 ${imgs.length} 张平台图片已填入，图文顺序已核对。请确认平台自动保存完成，再预览草稿。`;
  }
}
