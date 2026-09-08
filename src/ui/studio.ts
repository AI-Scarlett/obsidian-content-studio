import { setSafeHtml, errorMessage } from "../core/dom";
import {
  BUILTIN_TEMPLATES,
  userTemplate,
  validateTemplate,
  tuneTemplate,
} from "../core/templates";
import { createCards, cardPng, type CardDeck } from "../core/cards";
import { learnTemplate } from "../core/learn";
import { portableMarkdown } from "../core/export";
import { wordDocument } from "../core/word";
import {
  isEmbeddedImage,
  type ImageOptions,
  type ImageResult,
} from "../core/images";
import {
  escapeHtml,
  htmlDocument,
  imageSources,
  renderDraft,
  splitThread,
  weightedLength,
} from "../core/render";
import {
  DEFAULT_SETTINGS,
  PLATFORMS,
  type Draft,
  type Platform,
  type Rendered,
  type Settings,
  type Template,
} from "../core/types";

export interface OutputFile {
  name: string;
  content: string | ArrayBuffer;
}
export interface Host {
  settings: Settings;
  saveSettings(settings: Settings): Promise<void>;
  chooseNote(): Promise<Draft | null>;
  currentNote(): Promise<Draft | null>;
  resolveImages(
    draft: Draft,
    remote: boolean,
    options?: ImageOptions,
  ): Promise<ImageResult>;
  learnUrl(url: string): Promise<Template>;
  copy(text: string, html?: string): Promise<void>;
  saveFiles(files: OutputFile[], title: string): Promise<string>;
  revealPath?(path: string): Promise<void>;
}

export class Studio {
  private settings: Settings;
  private draft: Draft = { title: "", markdown: "", sourcePath: "" };
  private assets: Record<string, string> = {};
  private assetWarnings: string[] = [];
  private rendered?: Rendered;
  private imageJob?: { key: string; promise: Promise<void> };
  private imageGeneration = 0;
  private template!: Template;
  private fontSize = 16;
  private accent = "#3d6254";
  private busy = false;
  private destroyed = false;
  private renderTimer?: number;
  private resizeObserver?: ResizeObserver;
  private status!: HTMLElement;
  private preview!: HTMLElement;
  private cardDeck?: CardDeck;
  private cardGeneration = 0;
  private previewMode: "article" | "thread" | "cards" = "article";
  private saveQueue: Promise<void> = Promise.resolve();
  constructor(
    private root: HTMLElement,
    private host: Host,
  ) {
    this.settings = structuredClone(host.settings || DEFAULT_SETTINGS);
    this.template =
      this.templates().find((t) => t.id === this.settings.templateId) ||
      BUILTIN_TEMPLATES[0];
    this.fontSize = this.template.fontSize;
    this.accent = this.template.palette.accent;
    this.mount();
  }
  private templates() {
    return [...BUILTIN_TEMPLATES, ...this.settings.customTemplates];
  }
  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }
  private tell(message: string, error = false) {
    if (this.destroyed) return;
    this.status.textContent = message;
    this.status.classList.toggle("is-error", error);
  }
  private async run(message: string, fn: () => Promise<void>) {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    this.root.classList.add("is-busy");
    this.root.setAttribute("aria-busy", "true");
    this.tell(message);
    const controls = Array.from(
      this.root.querySelectorAll<
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      >("button,input,select,textarea"),
    );
    const disabled = controls.map((el) => el.disabled);
    controls.forEach((el) => (el.disabled = true));
    try {
      await fn();
    } catch (error) {
      this.tell(error instanceof Error ? error.message : String(error), true);
    } finally {
      controls.forEach((el, i) => (el.disabled = disabled[i]));
      this.busy = false;
      this.root.classList.remove("is-busy");
      this.root.removeAttribute("aria-busy");
    }
  }
  private persist() {
    const snapshot = structuredClone(this.settings);
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => this.host.saveSettings(snapshot));
    return this.saveQueue;
  }
  private commitPreferences() {
    void this.persist().catch((error: unknown) =>
      this.tell(`设置未保存：${errorMessage(error)}`, true),
    );
  }
  private mount() {
    this.root.classList.add("mg");
    setSafeHtml(
      this.root,
      `<header class="mg-top"><div class="mg-brand"><span class="mg-mark">墨</span><h1>墨稿 <span>Content Studio</span></h1></div><div class="mg-note-actions"><button data-action="current" class="mg-button">读取当前笔记</button><button data-action="choose" class="mg-button">选择笔记</button></div></header>
      <nav class="mg-platforms" aria-label="发布平台">${Object.entries(
        PLATFORMS,
      )
        .map(([key, p]) => `<button data-platform="${key}">${p.name}</button>`)
        .join(
          "",
        )}<button data-action="appearance" class="mg-appearance-button" aria-expanded="false">模板与样式</button></nav>
      <div class="mg-workbar"><div class="mg-view-modes" aria-label="工作区模式"><button data-view="edit">编辑</button><button data-view="preview">预览</button><button data-view="split">对照</button></div><span class="mg-source">选择一篇笔记开始</span><span class="mg-counts"></span></div>
      <main class="mg-workspace"><section class="mg-writing" aria-label="编辑排版稿"><label class="mg-title-field">标题<input class="mg-title-input" placeholder="文章标题" maxlength="300"></label><label class="mg-body-label" for="mg-body-${crypto.randomUUID()}">正文 <span>Markdown · 仅编辑排版稿，不改原笔记</span></label><textarea class="mg-markdown-input" aria-label="正文 Markdown" spellcheck="false" placeholder="读取笔记，或在这里粘贴 Markdown 开始写作…"></textarea></section>
      <section class="mg-canvas" aria-label="图文预览"><div class="mg-canvas-toolbar"><span>图文预览</span><div class="mg-preview-modes"><button data-mode="article">排版</button><button data-mode="thread">串文</button><button data-mode="cards">卡片</button></div></div><div class="mg-preview-scroll"><div class="mg-preview"></div></div></section></main>
      <section class="mg-output-area"><div class="mg-publish-actions"><button data-action="copy-title" class="mg-button">复制标题</button><button data-action="copy" class="mg-button">复制正文</button><button data-action="publish" class="mg-button mg-primary">导出 Word 图文</button><button data-action="export" class="mg-text-button">完整内容包</button></div><p class="mg-platform-hint"></p><details class="mg-output-details"><summary><span class="mg-image-status"></span></summary><div class="mg-warnings" aria-live="polite"></div><button data-action="images" class="mg-text-button">重新载入图片</button></details></section>
      <div class="mg-drawer-backdrop" hidden><aside class="mg-drawer" aria-label="模板与样式"><header><h2>模板与样式</h2><button data-action="close-appearance" class="mg-button">完成</button></header><section class="mg-settings"><div class="mg-section-title"><h2>微调样式</h2><button data-action="reset" class="mg-text-button">重置</button></div><label class="mg-field">正文字号 <span class="mg-font-value"></span><input class="mg-font-input" type="range" min="12" max="24" step="1" value="16"></label><label class="mg-color-field">主题颜色<input class="mg-color-input" type="color" value="#3d6254"></label><label class="mg-check"><input class="mg-footnotes" type="checkbox"> 公众号文末保留链接</label><div class="mg-template-controls"><button data-action="save-template" class="mg-text-button">存为新模板</button><button data-action="export-template" class="mg-text-button">导出模板</button><button data-action="delete-template" class="mg-text-button mg-danger">删除</button></div><div class="mg-template-source"></div></section><section class="mg-library"><div class="mg-section-title"><h2>模板库</h2><span class="mg-template-count"></span></div><div class="mg-template-list"></div><div class="mg-library-bottom"><button data-action="learn" class="mg-button mg-learn">＋ 链接学模板</button><button data-action="import" class="mg-text-button">导入模板 JSON</button><input type="file" class="mg-file-input" accept="application/json,.json" hidden></div></section></aside></div>
      <footer class="mg-status" role="status" aria-live="polite">编辑、预览随时切换；宽窗口可左右对照。</footer>`,
    );
    this.root.dataset.view = "edit";
    const bodyLabel = this.q<HTMLLabelElement>(".mg-body-label");
    this.q(".mg-markdown-input").id = bodyLabel.htmlFor;
    this.status = this.q(".mg-status");
    this.preview = this.q(".mg-preview");
    const bind = (action: string, fn: () => void) =>
      this.q(`[data-action="${action}"]`).addEventListener("click", () => {
        if (!this.busy) fn();
      });
    const appearance = (open: boolean) => {
      this.q(".mg-drawer-backdrop").hidden = !open;
      this.q('[data-action="appearance"]').setAttribute(
        "aria-expanded",
        String(open),
      );
      this.q(
        open
          ? '[data-action="close-appearance"]'
          : '[data-action="appearance"]',
      ).focus();
    };
    bind("appearance", () => appearance(true));
    bind("close-appearance", () => appearance(false));
    this.q(".mg-drawer-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) appearance(false);
    });
    this.q(".mg-drawer-backdrop").addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        appearance(false);
        e.stopPropagation();
      }
    });
    const setView = (mode: string) => {
      this.root.dataset.view = mode;
      this.root
        .querySelectorAll<HTMLElement>("[data-view]")
        .forEach((button) => {
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.view === mode),
          );
        });
    };
    this.root.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => {
      button.addEventListener("click", () =>
        setView(button.dataset.view || "edit"),
      );
    });
    setView("edit");
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        if (
          entries[0].contentRect.width < 900 &&
          this.root.dataset.view === "split"
        )
          setView("edit");
      });
      this.resizeObserver.observe(this.root);
    }
    bind(
      "publish",
      () => void this.run("正在生成图文文件…", () => this.publishFiles()),
    );
    bind(
      "current",
      () =>
        void this.run("正在读取笔记…", async () => {
          const draft = await this.host.currentNote();
          if (!draft) throw new Error("没有活动笔记。请点击“选择笔记”。");
          await this.load(draft);
        }),
    );
    bind(
      "choose",
      () =>
        void this.run("选择笔记…", async () => {
          const draft = await this.host.chooseNote();
          if (draft) await this.load(draft);
          else this.tell("已取消选择。");
        }),
    );
    bind("learn", () => this.learnDialog());
    bind("import", () => this.q<HTMLInputElement>(".mg-file-input").click());
    bind("reset", () => this.selectTemplate(this.template.id));
    bind(
      "images",
      () =>
        void this.run("正在载入图片…", async () => {
          if (!this.draft.markdown) throw new Error("请先读取笔记。");
          await this.refreshImages(true);
          this.tell(this.imageSummary(), this.missingImages().length > 0);
        }),
    );
    bind("save-template", () =>
      this.nameDialog(
        "存为新模板",
        `${this.template.name} · 自定义`,
        async (name) => {
          const next = userTemplate(
            tuneTemplate(this.template, this.accent, this.fontSize),
            name,
          );
          this.settings.customTemplates.push(next);
          await this.persist();
          this.selectTemplate(next.id);
          this.tell("新模板已保存，下次打开仍可使用。");
        },
      ),
    );
    bind(
      "export-template",
      () =>
        void this.run("保存模板…", async () => {
          const t = userTemplate(
            tuneTemplate(this.template, this.accent, this.fontSize),
            this.template.name,
          );
          const path = await this.host.saveFiles(
            [{ name: "template.json", content: JSON.stringify(t, null, 2) }],
            `${t.name}-模板`,
          );
          this.tell(`模板已保存：${path}`);
        }),
    );
    bind("delete-template", () => {
      if (!this.template.id.startsWith("user-")) return;
      const id = this.template.id;
      const modal = this.dialog(
        "删除自定义模板",
        `<p>删除“${escapeHtml(this.template.name)}”？已导出的内容不受影响。</p><button class="mg-button mg-primary" data-confirm>删除模板</button>`,
      );
      modal.querySelector("[data-confirm]")!.addEventListener(
        "click",
        () =>
          void this.run("删除模板…", async () => {
            this.settings.customTemplates =
              this.settings.customTemplates.filter((t) => t.id !== id);
            await this.persist();
            this.selectTemplate("ink");
            modal.remove();
            this.tell("模板已删除。");
          }),
      );
    });
    bind(
      "copy-title",
      () =>
        void this.run("复制标题…", async () => {
          const title = this.draft.title.trim();
          if (!title) throw new Error("请先输入标题或选择笔记。");
          await this.host.copy(title);
          this.tell("标题已复制，请粘贴到平台的标题栏。");
        }),
    );
    bind("copy", () => void this.run("准备复制…", () => this.copy()));
    bind("export", () => void this.run("正在生成内容包…", () => this.export()));
    this.root
      .querySelectorAll<HTMLElement>("[data-platform]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          if (this.busy) return;
          this.settings.platform = button.dataset.platform as Platform;
          this.previewMode = "article";
          this.commitPreferences();
          this.render();
        }),
      );
    this.root.querySelectorAll<HTMLElement>("[data-mode]").forEach((button) =>
      button.addEventListener("click", () => {
        if (this.busy) return;
        this.previewMode = button.dataset.mode as typeof this.previewMode;
        this.render();
      }),
    );
    this.q<HTMLInputElement>(".mg-title-input").addEventListener(
      "input",
      (e) => {
        this.draft.title = (e.target as HTMLInputElement).value;
        this.debounce();
      },
    );
    this.q<HTMLTextAreaElement>(".mg-markdown-input").addEventListener(
      "input",
      (e) => {
        this.draft.markdown = (e.target as HTMLTextAreaElement).value;
        this.debounce();
      },
    );
    this.q<HTMLInputElement>(".mg-font-input").addEventListener(
      "input",
      (e) => {
        this.fontSize = Number((e.target as HTMLInputElement).value);
        this.render();
      },
    );
    this.q<HTMLInputElement>(".mg-color-input").addEventListener(
      "input",
      (e) => {
        this.accent = (e.target as HTMLInputElement).value;
        this.render();
      },
    );
    this.q<HTMLInputElement>(".mg-footnotes").addEventListener(
      "change",
      (e) => {
        this.settings.footnotes = (e.target as HTMLInputElement).checked;
        this.commitPreferences();
        this.render();
      },
    );
    this.q<HTMLInputElement>(".mg-file-input").addEventListener(
      "change",
      (event) => {
        const input = event.target as HTMLInputElement,
          file = input.files?.[0];
        input.value = "";
        if (!file) return;
        void this.run("导入模板…", async () => {
          if (file.size > 500000) throw new Error("模板文件超过 500 KB。");
          const template = validateTemplate(JSON.parse(await file.text()));
          const imported = { ...template, id: `user-${crypto.randomUUID()}` };
          this.settings.customTemplates.push(imported);
          await this.persist();
          this.selectTemplate(imported.id);
          this.tell("模板已导入。");
        });
      },
    );
    this.paintTemplates();
    this.render();
  }
  async openDraft(draft: Draft) {
    await this.run("读取笔记…", () => this.load(draft));
  }
  private async load(draft: Draft) {
    this.root.win.clearTimeout(this.renderTimer);
    this.imageGeneration++;
    this.imageJob = undefined;
    this.draft = structuredClone(draft);
    this.assets = {};
    this.assetWarnings = [];
    this.q<HTMLInputElement>(".mg-title-input").value = draft.title;
    this.q<HTMLTextAreaElement>(".mg-markdown-input").value = draft.markdown;
    this.render();
    await this.refreshImages();
    if (this.destroyed) return;
    this.tell(
      `已读取 ${draft.sourcePath || "草稿"}。${this.imageSummary()}`,
      this.missingImages().length > 0,
    );
  }
  private imageKey() {
    return JSON.stringify([this.draft.sourcePath, imageSources(this.draft)]);
  }
  private missingImages() {
    return imageSources(this.draft).filter(
      (src) => !isEmbeddedImage(this.assets[src]),
    );
  }
  private imageSummary() {
    const total = imageSources(this.draft).length,
      missing = this.missingImages().length;
    return total
      ? `图片已载入 ${total - missing} / ${total}${missing ? "，请重试失败图片。" : "，保留在正文原位置。"}`
      : "正文没有图片。";
  }
  private async refreshImages(force = false) {
    const key = this.imageKey();
    if (this.imageJob?.key === key && !force) return this.imageJob.promise;
    const generation = ++this.imageGeneration,
      draft = structuredClone(this.draft);
    const current = () =>
      !this.destroyed &&
      generation === this.imageGeneration &&
      key === this.imageKey();
    const promise = (async () => {
      const result = await this.host.resolveImages(draft, true, {
        assets: force ? {} : this.assets,
        onProgress: (loaded, total, finished) => {
          if (current() && total)
            this.q(".mg-image-status").textContent =
              `正在载入图片：${finished} / ${total}，成功 ${loaded} 张…`;
        },
      });
      if (!current()) return;
      this.assets = result.assets;
      this.assetWarnings = result.warnings;
      this.render();
    })();
    this.imageJob = { key, promise };
    try {
      await promise;
    } finally {
      if (this.imageJob?.promise === promise) this.imageJob = undefined;
    }
  }
  private debounce() {
    this.root.win.clearTimeout(this.renderTimer);
    this.renderTimer = this.root.win.setTimeout(() => {
      if (this.destroyed) return;
      this.render();
      void this.refreshImages().catch((error: unknown) =>
        this.tell(`图片载入失败：${errorMessage(error)}`, true),
      );
    }, 350);
  }
  private paintTemplates() {
    this.q(".mg-template-count").textContent = String(
      this.templates().length,
    ).padStart(2, "0");
    const list = this.q(".mg-template-list");
    setSafeHtml(
      list,
      this.templates()
        .map(
          (t) =>
            `<button class="mg-template ${t.id === this.template.id ? "is-active" : ""}" data-template="${t.id}" aria-pressed="${t.id === this.template.id}"><div class="mg-template-thumb" style="background:${t.palette.paper};color:${t.palette.ink};--sample-accent:${t.palette.accent};--sample-soft:${t.palette.soft}"><span class="mg-sample-type ${t.heading}">好内容，值得被看见</span><i></i><i></i><i></i><em></em></div><div class="mg-template-label"><strong>${escapeHtml(t.name)}</strong><span>${t.source ? "学习" : "内置"}</span></div><p>${escapeHtml(t.description)}</p></button>`,
        )
        .join(""),
    );
    list.querySelectorAll<HTMLElement>("[data-template]").forEach((button) =>
      button.addEventListener("click", () => {
        if (!this.busy) this.selectTemplate(button.dataset.template!);
      }),
    );
  }
  private selectTemplate(id: string) {
    this.template =
      this.templates().find((t) => t.id === id) || BUILTIN_TEMPLATES[0];
    this.fontSize = this.template.fontSize;
    this.accent = this.template.palette.accent;
    this.settings.templateId = this.template.id;
    this.commitPreferences();
    this.paintTemplates();
    this.render();
  }
  private options() {
    return {
      platform: this.settings.platform,
      template: this.template,
      fontSize: this.fontSize,
      accent: this.accent,
      footnotes: this.settings.footnotes,
    };
  }
  private render() {
    if (this.destroyed) return;
    this.cardGeneration++;
    this.cardDeck?.dispose();
    this.cardDeck = undefined;
    const platform = this.settings.platform;
    this.root.querySelectorAll<HTMLElement>("[data-platform]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.platform === platform);
      el.setAttribute("aria-pressed", String(el.dataset.platform === platform));
    });
    this.q('[data-mode="thread"]').hidden = platform !== "x";
    this.q('[data-mode="cards"]').hidden = platform !== "xiaohongshu";
    this.root
      .querySelectorAll<HTMLElement>("[data-mode]")
      .forEach((el) =>
        el.classList.toggle(
          "is-selected",
          el.dataset.mode === this.previewMode,
        ),
      );
    this.q(".mg-source").textContent = this.draft.sourcePath || "临时排版稿";
    this.q(".mg-image-status").textContent = this.imageSummary();
    this.q<HTMLInputElement>(".mg-font-input").value = String(this.fontSize);
    this.q(".mg-font-value").textContent = `${this.fontSize} px`;
    if (/^#[\da-f]{6}$/i.test(this.accent))
      this.q<HTMLInputElement>(".mg-color-input").value = this.accent;
    this.q<HTMLInputElement>(".mg-footnotes").checked = this.settings.footnotes;
    this.q('[data-action="delete-template"]').hidden =
      !this.template.id.startsWith("user-");
    const source = this.q(".mg-template-source");
    source.textContent = this.template.source
      ? `来源：${this.template.source.url === "pasted-html" ? "粘贴的 HTML" : new URL(this.template.source.url).hostname} · ${this.template.source.evidence} 项样式特征`
      : "内置模板，可微调后另存。";
    this.q('[data-action="publish"]').textContent =
      platform === "wechat"
        ? "导出 Word 图文"
        : platform === "xiaohongshu"
          ? "导出发布图片"
          : "导出原图";
    this.q(".mg-platform-hint").textContent = PLATFORMS[platform].hint;
    this.q('[data-action="copy"]').textContent =
      platform === "x" && this.previewMode === "thread"
        ? "复制整组串文"
        : platform === "xiaohongshu"
          ? "复制正文文案"
          : "复制正文";
    if (!this.draft.title && !this.draft.markdown) {
      this.rendered = undefined;
      setSafeHtml(
        this.preview,
        '<div class="mg-empty"><span>一</span><h2>从一篇笔记开始</h2><p>选择 Obsidian 笔记，或粘贴 Markdown。<br>切换平台和模板，就能预览新的版式。</p></div>',
      );
      this.q(".mg-counts").textContent = "0 字";
      return;
    }
    this.rendered = renderDraft(
      { ...this.draft, title: this.draft.title || "未命名草稿" },
      this.options(),
      this.assets,
    );
    const count = Array.from(this.rendered.plainText).length;
    this.q(".mg-counts").textContent =
      `${count.toLocaleString()} 字符` +
      (platform === "x"
        ? ` · ${splitThread(this.bodyContent().plainText).length} 条串文`
        : "");
    const warnings = [
      ...new Set([...this.assetWarnings, ...this.rendered.warnings]),
    ];
    if (platform === "xiaohongshu" && count > 1000)
      warnings.push(
        "文案超过常见的 1,000 字限制。完整内容可导出为卡片；复制文案前请在草稿中精简。",
      );
    if (platform === "xiaohongshu" && Array.from(this.draft.title).length > 20)
      warnings.push("标题超过常见的 20 字限制，请在发布前精简。");
    setSafeHtml(
      this.q(".mg-warnings"),
      warnings.map((w) => `<p>${escapeHtml(w)}</p>`).join(""),
    );
    this.preview.classList.toggle(
      "mg-thread-preview",
      this.previewMode === "thread",
    );
    this.preview.classList.toggle(
      "mg-deck-preview",
      this.previewMode === "cards",
    );
    if (this.previewMode === "thread") {
      const threads = splitThread(this.bodyContent().plainText);
      setSafeHtml(
        this.preview,
        threads
          .map(
            (text, i) =>
              `<section class="mg-tweet"><div class="mg-tweet-meta"><span>${i + 1} / ${threads.length}</span><span>${weightedLength(text)} / 280</span></div><p>${escapeHtml(text)}</p><button class="mg-text-button" data-tweet="${i}">复制此条</button></section>`,
          )
          .join(""),
      );
      this.preview.querySelectorAll<HTMLElement>("[data-tweet]").forEach((el) =>
        el.addEventListener(
          "click",
          () =>
            void this.run("复制串文…", async () => {
              await this.host.copy(threads[Number(el.dataset.tweet)]);
              this.tell(`第 ${Number(el.dataset.tweet) + 1} 条已复制。`);
            }),
        ),
      );
    } else if (this.previewMode === "cards") {
      setSafeHtml(
        this.preview,
        '<div class="mg-empty"><p>正在按内容分页…</p></div>',
      );
      void this.paintCards(this.cardGeneration);
    } else setSafeHtml(this.preview, this.rendered.html);
  }
  private async paintCards(generation: number) {
    try {
      const deck = await createCards(this.rendered!.html, this.draft.title, {
        ...this.template,
        palette: { ...this.template.palette, accent: this.accent },
      });
      if (this.destroyed || generation !== this.cardGeneration) {
        deck.dispose();
        return;
      }
      this.cardDeck = deck;
      this.preview.replaceChildren();
      for (const card of deck.cards) {
        const frame = createDiv();
        frame.className = "mg-card-frame";
        frame.append(card.cloneNode(true));
        this.preview.append(frame);
      }
      this.tell(
        `已分页为 ${deck.cards.length} 张卡片，导出尺寸为 1080 × 1440。`,
      );
    } catch (error) {
      if (generation === this.cardGeneration) {
        this.preview.textContent =
          error instanceof Error ? error.message : String(error);
        this.tell(this.preview.textContent, true);
      }
    }
  }
  private fresh() {
    this.root.win.clearTimeout(this.renderTimer);
    this.render();
    if (!this.rendered) throw new Error("请先选择笔记或输入正文。");
    return this.rendered;
  }
  private async completeContent() {
    this.root.win.clearTimeout(this.renderTimer);
    await this.refreshImages();
    if (this.destroyed) throw new Error("工作台已关闭。");
    const content = this.fresh(),
      missing = this.missingImages();
    if (
      missing.length ||
      content.warnings.some((w) => w.startsWith("图片未嵌入"))
    )
      throw new Error(
        `仍有 ${missing.length || 1} 张图片未载入，已暂停复制或导出。请查看失败原因并点击“重新载入图片”。`,
      );
    return content;
  }
  private bodyContent() {
    return renderDraft(
      this.draft,
      { ...this.options(), includeTitle: false },
      this.assets,
    );
  }
  private async copy() {
    const textOnly =
      this.settings.platform === "xiaohongshu" ||
      (this.settings.platform === "x" && this.previewMode === "thread");
    if (textOnly) this.fresh();
    else await this.completeContent();
    const content = this.bodyContent();
    if (!this.draft.markdown.trim())
      throw new Error("正文为空，请先输入正文。");
    if (this.settings.platform === "xiaohongshu")
      await this.host.copy(content.plainText);
    else if (textOnly)
      await this.host.copy(
        splitThread(content.plainText).join("\n\n—— 下一条 ——\n\n"),
      );
    else await this.host.copy(content.plainText, content.html);
    const count = imageSources(this.draft).length;
    this.tell(
      textOnly
        ? "正文已复制（不含标题）；图片请通过内容包上传。"
        : count
          ? "正文已复制（不含标题）。剪贴板中的图片可能被平台过滤；公众号请使用“导出 Word 图文”。"
          : "正文已复制（不含标题），请粘贴到平台正文编辑器。",
    );
  }
  private async publishFiles(kind?: "word" | "cards" | "images") {
    const platform = this.settings.platform;
    if (platform === "xiaohongshu" && !kind) {
      const modal = this.dialog(
        "小红书发布图片",
        `<div class="mg-delivery-options"><div><button class="mg-button mg-primary" data-delivery="cards">导出排版卡片</button><p>文字与图片一起排进 3:4 图片，按顺序批量上传，排版随图片保留。卡片中的文字不能在平台单独编辑。</p></div><div><button class="mg-button" data-delivery="images">导出笔记原图</button><p>只导出笔记里的图片，按出现顺序编号；正文文案单独复制。适合普通图文笔记。</p></div></div>`,
      );
      modal.querySelectorAll<HTMLElement>("[data-delivery]").forEach((button) =>
        button.addEventListener("click", () => {
          modal.remove();
          void this.run("正在生成发布图片…", () =>
            this.publishFiles(
              button.dataset.delivery === "cards" ? "cards" : "images",
            ),
          );
        }),
      );
      return;
    }
    kind ??= platform === "wechat" ? "word" : "images";
    const content = await this.completeContent();
    const files: OutputFile[] = [
      { name: "title.txt", content: this.draft.title },
      { name: "body.txt", content: this.bodyContent().plainText },
    ];
    let instructions: string;
    if (kind === "word") {
      files.unshift({
        name: "article.docx",
        content: await wordDocument(this.bodyContent().html),
      });
      instructions =
        "在公众号图文编辑器中选择“导入”或“导入文档”，选取 article.docx。图片已嵌入文档并保留在正文原位置，无需逐张插入。标题从 title.txt 或“复制标题”单独填写。公众号可能调整字体、间距等样式，导入后请预览。GIF 在 Word 中转为静态图片。";
    } else if (kind === "cards") {
      const template = tuneTemplate(this.template, this.accent, this.fontSize);
      const deck = await createCards(
        content.html,
        this.draft.title || "未命名草稿",
        template,
      );
      try {
        for (const [i, card] of deck.cards.entries()) {
          this.tell(`正在生成卡片 ${i + 1} / ${deck.cards.length}…`);
          files.unshift({
            name: `card-${String(i + 1).padStart(3, "0")}.png`,
            content: await cardPng(card),
          });
        }
      } finally {
        deck.dispose();
      }
      // Names sort in publication order even for decks with 100+ pages.
      files.sort((a, b) => a.name.localeCompare(b.name));
      instructions = `已生成 ${deck.cards.length} 张卡片（1080 × 1440）。在小红书选择“上传图文”，批量选取 card- 开头的 PNG，按文件名顺序排列；文字和插图已排在卡片上。标题单独复制，正文文案可使用 body.txt 并按需精简。若数量超过发布页上限，请拆成多篇发布；本次没有截断卡片。`;
    } else {
      const images = portableMarkdown(content.markdown, this.assets).images;
      if (!images.length) throw new Error("正文没有可导出的图片。");
      files.unshift(...images);
      instructions = `已导出 ${images.length} 张原图，按笔记中首次出现的顺序编号（重复引用只存一份）。在平台批量选取 image- 开头的文件并确认顺序；标题、正文文案分别复制。普通小红书图文的照片与正文分开展示，如需保留文中排版，请导出排版卡片。`;
    }
    files.push({ name: "readme.txt", content: instructions });
    const path = await this.host.saveFiles(
      files,
      this.draft.title || "未命名草稿",
    );
    this.tell(`图文文件已保存：${path}`);
    this.deliveryDialog(path, instructions);
  }
  private deliveryDialog(path: string, instructions: string) {
    const modal = this.dialog(
      "图文文件已准备好",
      `<p>${escapeHtml(instructions)}</p><p class="mg-delivery-path">${escapeHtml(path)}</p><button class="mg-button mg-primary" data-reveal>打开文件夹</button>`,
    );
    const button = modal.querySelector<HTMLButtonElement>("[data-reveal]")!;
    button.textContent = this.host.revealPath ? "打开文件夹" : "复制保存路径";
    button.addEventListener(
      "click",
      () =>
        void this.run("打开导出位置…", async () => {
          if (this.host.revealPath) await this.host.revealPath(path);
          else await this.host.copy(path);
          this.tell(
            this.host.revealPath
              ? "已打开导出位置，可批量选择图片或 Word 文件。"
              : "保存路径已复制。",
          );
        }),
    );
  }
  private async export() {
    await this.completeContent();
    const content = this.fresh(),
      draft = structuredClone(this.draft),
      platform = this.settings.platform,
      template = structuredClone({
        ...this.template,
        palette: { ...this.template.palette, accent: this.accent },
      }),
      options = this.options();
    const portable = portableMarkdown(content.markdown, this.assets);
    const files: OutputFile[] = [
      {
        name: "article.html",
        content: htmlDocument(draft.title, content.html),
      },
      { name: "article.md", content: portable.markdown },
      { name: "title.txt", content: draft.title },
      { name: "caption.txt", content: this.bodyContent().plainText },
      {
        name: "template.json",
        content: JSON.stringify(
          userTemplate(
            tuneTemplate(this.template, this.accent, this.fontSize),
            template.name,
          ),
          null,
          2,
        ),
      },
      ...portable.images,
    ];
    let cardCount = 0;
    if (platform === "x")
      splitThread(this.bodyContent().plainText).forEach((text, i) =>
        files.push({
          name: `thread-${String(i + 1).padStart(2, "0")}.txt`,
          content: text,
        }),
      );
    if (platform === "xiaohongshu") {
      const deck = await createCards(content.html, draft.title, template);
      try {
        cardCount = deck.cards.length;
        for (const [i, card] of deck.cards.entries()) {
          this.tell(`正在生成卡片 ${i + 1} / ${deck.cards.length}…`);
          files.push({
            name: `card-${String(i + 1).padStart(2, "0")}.png`,
            content: await cardPng(card),
          });
        }
      } finally {
        deck.dispose();
      }
    }
    files.push({
      name: "manifest.json",
      content: JSON.stringify(
        {
          version: 1,
          pluginVersion: "0.1.3",
          title: draft.title,
          sourceNote: draft.sourcePath,
          platform,
          template: template.name,
          sourceTemplate: template.source || null,
          fontSize: options.fontSize,
          accent: options.accent,
          generatedAt: new Date().toISOString(),
          manualPublishOnly: true,
          warnings: [...this.assetWarnings, ...content.warnings],
          cards: cardCount,
          files: files.map((f) => f.name),
        },
        null,
        2,
      ),
    });
    const path = await this.host.saveFiles(files, draft.title || "未命名草稿");
    this.tell(`已保存 ${files.length} 个文件：${path}`);
    this.deliveryDialog(
      path,
      "完整内容包已保存。HTML 用于本地预览，不能保证复制其中的内嵌图片后被平台接受。公众号请使用“导出 Word 图文”，小红书请使用“导出发布图片”。",
    );
  }
  private dialog(title: string, html: string): HTMLElement {
    this.root.querySelector(".mg-modal-overlay")?.remove();
    const overlay = createDiv();
    overlay.className = "mg-modal-overlay";
    setSafeHtml(
      overlay,
      `<section class="mg-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><h2>${escapeHtml(title)}</h2><button class="mg-text-button" aria-label="关闭">✕</button></header><div class="mg-modal-content">${html}</div></section>`,
    );
    this.root.append(overlay);
    const close = () => {
      if (!this.busy) overlay.remove();
    };
    overlay.querySelector("header button")!.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        close();
        e.stopPropagation();
      }
    });
    this.root.win.setTimeout(
      () => overlay.querySelector<HTMLInputElement>("input,textarea")?.focus(),
      0,
    );
    return overlay;
  }
  private nameDialog(
    title: string,
    initial: string,
    save: (name: string) => Promise<void>,
  ) {
    const modal = this.dialog(
      title,
      `<label class="mg-field">模板名称<input data-name maxlength="60" value="${escapeHtml(initial)}"></label><button class="mg-button mg-primary" data-save>保存模板</button>`,
    );
    modal.querySelector("[data-save]")!.addEventListener(
      "click",
      () =>
        void this.run("保存模板…", async () => {
          const name = modal
            .querySelector<HTMLInputElement>("[data-name]")!
            .value.trim();
          if (!name) throw new Error("请填写模板名称。");
          await save(name);
          modal.remove();
        }),
    );
  }
  private learnDialog() {
    const modal = this.dialog(
      "把喜欢的版式，存成自己的模板",
      `<p class="mg-modal-intro">粘贴公众号或网页文章链接，提取配色、字体、标题和引用样式。无需配置模型。</p><div class="mg-learn-tabs"><button class="mg-button is-active" data-learn-mode="url">文章链接</button><button class="mg-button" data-learn-mode="html">粘贴 HTML</button></div><label class="mg-field mg-url-field">文章链接<input data-url type="url" placeholder="https://mp.weixin.qq.com/s/…"></label><label class="mg-field mg-html-field" hidden>正文 HTML<textarea data-html placeholder="粘贴含样式的文章 HTML，适用于无法直接读取的页面。"></textarea></label><button class="mg-button mg-primary" data-learn>提取样式并预览</button><div class="mg-learn-result" aria-live="polite"></div>`,
    );
    let mode = "url";
    let learned: Template | undefined;
    modal.querySelectorAll<HTMLElement>("[data-learn-mode]").forEach((el) =>
      el.addEventListener("click", () => {
        if (this.busy) return;
        mode = el.dataset.learnMode!;
        modal.querySelector<HTMLElement>(".mg-url-field")!.hidden =
          mode !== "url";
        modal.querySelector<HTMLElement>(".mg-html-field")!.hidden =
          mode !== "html";
        modal
          .querySelectorAll("[data-learn-mode]")
          .forEach((b) => b.classList.toggle("is-active", b === el));
      }),
    );
    modal.querySelector("[data-learn]")!.addEventListener(
      "click",
      () =>
        void this.run("正在提取排版样式…", async () => {
          const result = modal.querySelector<HTMLElement>(".mg-learn-result")!;
          try {
            learned =
              mode === "url"
                ? await this.host.learnUrl(
                    modal
                      .querySelector<HTMLInputElement>("[data-url]")!
                      .value.trim(),
                  )
                : learnTemplate(
                    modal.querySelector<HTMLTextAreaElement>("[data-html]")!
                      .value,
                  );
            setSafeHtml(
              result,
              `<div class="mg-learn-success">已提取 ${learned.source!.evidence} 项样式特征 · ${learned.source!.confidence === "strong" ? "样式信息较完整" : "部分样式可复用"}</div><label class="mg-field">模板名称<input data-template-name maxlength="60" value="${escapeHtml(learned.name)}"></label><div class="mg-learn-swatches">${Object.values(
                learned.palette,
              )
                .map((c) => `<i style="background:${c}"></i>`)
                .join(
                  "",
                )}</div><div class="mg-learn-sample"></div><p class="mg-learn-notes">${learned.source!.notes.map(escapeHtml).join("<br>")}</p><button class="mg-button mg-primary" data-store>保存到模板库</button>`,
            );
            const sample = this.draft.markdown
              ? this.draft
              : {
                  title: "好内容，值得被看见",
                  markdown:
                    "## 从一篇笔记开始\n\n把熟悉的内容换一种表达，让想法被更多人看见。**重点依然清晰。**\n\n> 用恰当的留白，让阅读更轻松。",
                  sourcePath: "",
                };
            setSafeHtml(
              result.querySelector(".mg-learn-sample")!,
              renderDraft(
                sample,
                {
                  platform: "wechat",
                  template: learned,
                  fontSize: learned.fontSize,
                  accent: learned.palette.accent,
                  footnotes: false,
                },
                this.assets,
              ).html,
            );
            result.querySelector("[data-store]")!.addEventListener(
              "click",
              () =>
                void this.run("保存学习模板…", async () => {
                  if (!learned) return;
                  const name = result
                    .querySelector<HTMLInputElement>("[data-template-name]")!
                    .value.trim();
                  const t = validateTemplate({ ...learned, name });
                  this.settings.customTemplates.push(t);
                  await this.persist();
                  this.selectTemplate(t.id);
                  modal.remove();
                  this.tell("模板已保存并套用到当前草稿。");
                }),
            );
            this.tell("样式提取完成，可在弹窗中预览并保存。");
          } catch (error) {
            result.textContent =
              error instanceof Error ? error.message : String(error);
            result.classList.add("is-error");
            throw error;
          }
        }),
    );
  }
  destroy() {
    this.resizeObserver?.disconnect();
    this.destroyed = true;
    this.imageGeneration++;
    this.root.win.clearTimeout(this.renderTimer);
    this.cardGeneration++;
    this.cardDeck?.dispose();
    this.root.replaceChildren();
  }
}
