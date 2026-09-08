import type { Destination, ImportPlan, InlineImage, Probe } from "./types";
import { normalizeText } from "./package";

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
    cdns: ["zhimg.com"],
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
function titleField(
  doc: Document,
  platform: Destination,
): HTMLInputElement | HTMLTextAreaElement | undefined {
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
  if (!platform) return;
  const roots = [
    ...new Set(
      config[platform].editors.flatMap((selector) => [
        ...doc.querySelectorAll<HTMLElement>(selector),
      ]),
    ),
  ].filter(visible);
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
      titleEmpty: !!title && !title.value.trim(),
    },
  };
}

/** Uses the editor's paste handling. Never assigns its HTML or reads app/cookie state. */
export class EditorSession {
  private markers: string[] = [];
  private urls: string[] = [];
  private plan?: Omit<ImportPlan, "images">;
  private stopped = false;
  private win: Window & typeof globalThis;
  private intercept = (event: Event) => {
    if (event.isTrusted) {
      this.stopped = true;
      this.dispose();
    }
  };
  constructor(
    private root: HTMLElement,
    private platform: Destination,
    private timeout = 45000,
  ) {
    this.win = root.ownerDocument.defaultView as Window & typeof globalThis;
  }
  cancel() {
    this.stopped = true;
    this.dispose();
  }
  dispose() {
    this.root.ownerDocument.removeEventListener(
      "pointerdown",
      this.intercept,
      true,
    );
    this.root.ownerDocument.removeEventListener(
      "keydown",
      this.intercept,
      true,
    );
  }
  private check() {
    if (this.stopped || !this.root.isConnected)
      throw new Error(
        "同步已停止或编辑器已关闭；请保留当前草稿并检查已同步部分。",
      );
  }
  private focusRange(range: Range) {
    this.check();
    this.root.focus();
    const selection = this.win.getSelection();
    if (!selection) throw new Error("编辑器不支持设置插入位置。");
    selection.removeAllRanges();
    selection.addRange(range);
    this.root.ownerDocument.dispatchEvent(
      new this.win.Event("selectionchange"),
    );
  }
  private paste(data: DataTransfer) {
    this.root.dispatchEvent(
      new this.win.ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }
  private markerRange(marker: string): Range {
    const walker = this.root.ownerDocument.createTreeWalker(
      this.root,
      this.win.NodeFilter.SHOW_TEXT,
    );
    const nodes: Text[] = [];
    let text = "",
      node: Node | null;
    while ((node = walker.nextNode())) {
      nodes.push(node as Text);
      text += node.textContent || "";
    }
    const start = text.indexOf(marker);
    if (start < 0 || text.indexOf(marker, start + 1) !== -1)
      throw new Error("编辑器改变了图片位置标记，已停止同步。");
    let offset = 0;
    const range = this.root.ownerDocument.createRange();
    let began = false;
    for (const node of nodes) {
      const end = offset + node.length;
      if (!began && start < end) {
        range.setStart(node, start - offset);
        began = true;
      }
      if (began && start + marker.length <= end) {
        range.setEnd(node, start + marker.length - offset);
        return range;
      }
      offset = end;
    }
    throw new Error("无法定位图片插入位置。");
  }
  async begin(plan: Omit<ImportPlan, "images">, markers: string[]) {
    if (this.plan || this.stopped)
      throw new Error("本次同步已经开始，请勿重复同步。");
    const title = titleField(this.root.ownerDocument, this.platform);
    if (!empty(this.root) || !title || title.value.trim())
      throw new Error(
        "请在标题和正文都为空的新长文草稿中同步，避免覆盖已有内容。",
      );
    if (plan.platform !== this.platform)
      throw new Error("稿件平台与当前编辑器不同，请在墨稿重新选择发布平台。");
    if (title.maxLength > 0 && plan.title.length > title.maxLength)
      throw new Error(
        `标题超过平台 ${title.maxLength} 字上限，请先在墨稿修改。`,
      );
    this.plan = plan;
    this.markers = markers;
    this.root.ownerDocument.addEventListener(
      "pointerdown",
      this.intercept,
      true,
    );
    this.root.ownerDocument.addEventListener("keydown", this.intercept, true);
    const range = this.root.ownerDocument.createRange();
    range.selectNodeContents(this.root);
    range.collapse(false);
    this.focusRange(range);
    const data = new this.win.DataTransfer();
    data.setData("text/html", plan.html);
    const parsed = new this.win.DOMParser().parseFromString(
      plan.html,
      "text/html",
    );
    data.setData("text/plain", parsed.body.textContent || "");
    this.paste(data);
    await pause(this.win, 350);
    this.check();
    // An ignored synthetic paste never falls back to untracked DOM replacement.
    const actual = normalizeText(this.root.textContent || "");
    if (
      empty(this.root) ||
      markers.some((marker) => !actual.includes(marker)) ||
      plan.textParts.some((part) => part && !actual.includes(part))
    )
      throw new Error(
        "编辑器未完整接收正文粘贴，已停止；此版本暂不兼容该编辑器。",
      );
    return "正文已进入编辑器，开始按原位置上传图片。";
  }
  async image(image: InlineImage) {
    this.check();
    if (!this.plan || this.markers[this.urls.length] !== image.marker)
      throw new Error("图片顺序不一致，已停止。");
    const before = [...this.root.querySelectorAll("img")];
    this.focusRange(this.markerRange(image.marker));
    await pause(this.win, 80);
    this.check();
    const bytes = Uint8Array.from(this.win.atob(image.base64), (char) =>
      char.charCodeAt(0),
    );
    const data = new this.win.DataTransfer();
    data.items.add(
      new this.win.File([bytes], image.name, { type: image.mime }),
    );
    this.paste(data);
    const deadline = Date.now() + this.timeout;
    let candidateUrl = "",
      stableSince = 0;
    while (Date.now() < deadline) {
      await pause(this.win, 150);
      this.check();
      const imgs = [...this.root.querySelectorAll("img")];
      const candidate = imgs[this.urls.length];
      const src = candidate?.getAttribute("src") || "";
      const priorIntact = this.urls.every(
        (url, i) => imgs[i]?.getAttribute("src") === url,
      );
      const isNew = !!candidate && !before.includes(candidate);
      if (
        imgs.length === before.length + 1 &&
        priorIntact &&
        isNew &&
        platformImage(src, this.platform) &&
        candidate.complete &&
        candidate.naturalWidth > 0
      ) {
        if (candidateUrl !== src) {
          candidateUrl = src;
          stableSince = Date.now();
        }
        if (Date.now() - stableSince < 600) continue;
        // Some upload handlers insert beside rather than replace the selected marker.
        if ((this.root.textContent || "").includes(image.marker)) {
          this.focusRange(this.markerRange(image.marker));
          await pause(this.win, 80);
          this.check();
          if (!this.root.ownerDocument.execCommand("delete"))
            throw new Error(
              "图片已上传，但编辑器不能清除位置标记，请检查当前草稿。",
            );
          await pause(this.win, 200);
        }
        if ((this.root.textContent || "").includes(image.marker))
          throw new Error("图片已上传，但位置标记仍在正文，请检查当前草稿。");
        this.urls.push(src);
        return `图片 ${this.urls.length} / ${this.markers.length} 已上传。`;
      }
      // If the destination ignored the File paste, report failure, never insert data URLs.
    }
    throw new Error(
      `第 ${this.urls.length + 1} 张图片未在 45 秒内变成可显示的平台图片。同步已停止，请检查平台上传提示；已同步内容保留。`,
    );
  }
  async finish() {
    this.check();
    if (!this.plan || this.urls.length !== this.markers.length)
      throw new Error("图片还没有全部上传。");
    const imgs = [...this.root.querySelectorAll("img")];
    if (
      imgs.length !== this.urls.length ||
      imgs.some(
        (img, index) =>
          img.getAttribute("src") !== this.urls[index] ||
          !img.complete ||
          img.naturalWidth === 0,
      )
    )
      throw new Error("最终图片数量或顺序不一致，请检查草稿。");
    if (
      this.markers.some((marker) =>
        (this.root.textContent || "").includes(marker),
      )
    )
      throw new Error("正文仍有未替换的图片位置标记。");
    // Check text on both sides of every image, not just total text/image counts.
    const parts = [""];
    let index = 0;
    const walk = (node: Node) => {
      if (node.nodeType === this.win.Node.TEXT_NODE)
        parts[index] += node.textContent || "";
      else if (node instanceof this.win.HTMLImageElement) {
        index++;
        parts[index] = "";
      } else for (const child of node.childNodes) walk(child);
    };
    walk(this.root);
    if (
      this.plan.textParts.some(
        (part, i) => part && !normalizeText(parts[i] || "").includes(part),
      )
    )
      throw new Error("图片与正文位置核对未通过，请检查草稿，不要直接发表。");
    const title = titleField(this.root.ownerDocument, this.platform);
    if (!title || title.value.trim())
      throw new Error("标题栏已变化，请手动确认标题。正文和图片保留。");
    const titleWin = title.ownerDocument.defaultView as Window &
      typeof globalThis;
    const proto =
      title.tagName === "TEXTAREA"
        ? titleWin.HTMLTextAreaElement.prototype
        : titleWin.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(
      title,
      this.plan.title,
    );
    title.dispatchEvent(new this.win.Event("input", { bubbles: true }));
    title.dispatchEvent(new this.win.Event("change", { bubbles: true }));
    await pause(this.win, 500);
    this.check();
    if (title.value !== this.plan.title)
      throw new Error("平台没有接收完整标题，请手动填写。正文和图片已保留。");
    this.stopped = true;
    this.dispose();
    return `已填入标题、正文和 ${imgs.length} 张平台图片，并核对图文顺序。请确认平台自动保存完成，再预览草稿。`;
  }
}
