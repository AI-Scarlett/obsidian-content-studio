import {
  FileSystemAdapter,
  Plugin,
  ItemView,
  MarkdownView,
  TFile,
  FuzzySuggestModal,
  PluginSettingTab,
  Setting,
  Notice,
  normalizePath,
  type WorkspaceLeaf,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import { shell } from "electron";
import { Studio, type Host, type OutputFile } from "./ui/studio";
import {
  DEFAULT_SETTINGS,
  PLATFORMS,
  type Draft,
  type Settings,
  type Template,
} from "./core/types";
import { draftFromNote, imageSources } from "./core/render";
import { validateTemplate } from "./core/templates";
import { learnTemplate, stylesheetLinks } from "./core/learn";
import { downloadPublic } from "./core/network";
import { resolveImageAssets } from "./core/images";
import { errorMessage, isRecord } from "./core/dom";
import { BrowserBridge } from "./core/browser-bridge";
import { copyContent } from "./core/clipboard";

const VIEW = "content-studio-view";
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32);
}
function isPlatform(value: unknown): value is Settings["platform"] {
  return typeof value === "string" && Object.hasOwn(PLATFORMS, value);
}
export function safeFolder(raw: string): string {
  const value = raw.trim().replace(/\\/g, "/");
  if (
    !value ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          p.startsWith(".") ||
          /[<>:"|?*]/.test(p) ||
          hasControlCharacters(p),
      )
  )
    throw new Error("导出目录请使用 Vault 内的普通相对路径，例如“墨稿导出”。");
  return normalizePath(value);
}
class ChooseNote extends FuzzySuggestModal<TFile> {
  private settled = false;
  constructor(
    app: App,
    private done: (file: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder("搜索要排版的笔记…");
  }
  getItems() {
    return this.app.vault.getMarkdownFiles();
  }
  getItemText(file: TFile) {
    return file.path;
  }
  onChooseItem(file: TFile) {
    this.settled = true;
    this.done(file);
  }
  onClose() {
    window.setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        this.done(null);
      }
    }, 0);
  }
}
class StudioView extends ItemView {
  studio?: Studio;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: ContentStudioPlugin,
  ) {
    super(leaf);
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "墨稿";
  }
  getIcon() {
    return "newspaper";
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("mg-view");
    const root = this.contentEl.createDiv();
    this.studio = new Studio(root, this.plugin.host());
  }
  async onClose() {
    this.studio?.destroy();
  }
}
export default class ContentStudioPlugin extends Plugin {
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private lastNote: TFile | null = null;
  private bridge?: BrowserBridge;
  async onload() {
    const saved: unknown = await this.loadData();
    if (isRecord(saved)) {
      const templates: Template[] = [];
      const customTemplates: unknown[] = Array.isArray(saved.customTemplates)
        ? saved.customTemplates
        : [];
      for (const item of customTemplates) {
        try {
          templates.push(validateTemplate(item));
        } catch {
          new Notice("墨稿：一个无效模板未载入，可从模板 JSON 重新导入。");
        }
      }
      let exportFolder = DEFAULT_SETTINGS.exportFolder;
      try {
        exportFolder = safeFolder(
          typeof saved.exportFolder === "string"
            ? saved.exportFolder
            : exportFolder,
        );
      } catch {
        /* use safe default */
      }
      this.settings = {
        templateId:
          typeof saved.templateId === "string"
            ? saved.templateId
            : DEFAULT_SETTINGS.templateId,
        platform: isPlatform(saved.platform) ? saved.platform : "wechat",
        customTemplates: templates,
        exportFolder,
        footnotes: saved.footnotes !== false,
      };
    }
    this.lastNote = this.app.workspace.getActiveFile();
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file?.extension === "md") this.lastNote = file;
      }),
    );
    this.registerView(VIEW, (leaf) => new StudioView(leaf, this));
    this.addRibbonIcon(
      "newspaper",
      "墨稿：将笔记排成多平台内容",
      () => void this.open(),
    );
    this.addCommand({
      id: "open-studio",
      name: "打开多平台排版工作台",
      callback: () => void this.open(),
    });
    this.addCommand({
      id: "format-current-note",
      name: "排版当前笔记",
      editorCallback: (editor, view) =>
        void this.open(
          draftFromNote(editor.getValue(), view.file?.path || "未命名笔记.md"),
        ),
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md")
          menu.addItem((item) =>
            item
              .setTitle("用墨稿排版")
              .setIcon("newspaper")
              .onClick(
                () =>
                  void this.readNote(file).then((draft) => this.open(draft)),
              ),
          );
      }),
    );
    this.addSettingTab(new StudioSettings(this.app, this));
    this.bridge = new BrowserBridge();
    try {
      await this.bridge.start();
    } catch {
      new Notice("墨稿：浏览器发布连接未启动，请重新打开墨稿后重试。");
    }
  }
  onunload() {
    this.bridge?.stop();
    this.app.workspace
      .getLeavesOfType(VIEW)
      .forEach((leaf) => (leaf.view as StudioView).studio?.destroy());
  }
  async readNote(file: TFile): Promise<Draft> {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const raw =
      active?.file?.path === file.path
        ? active.editor.getValue()
        : await this.app.vault.cachedRead(file);
    if (raw.length > 500_000)
      throw new Error("笔记超过 50 万字符，请分篇排版。");
    return draftFromNote(raw, file.path);
  }
  private async activeDraft() {
    const file = this.app.workspace.getActiveFile() || this.lastNote;
    return file?.extension === "md" ? this.readNote(file) : null;
  }
  async open(draft?: Draft) {
    try {
      const current = draft || (await this.activeDraft());
      let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
      if (!leaf) {
        leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: VIEW, active: true });
      }
      await this.app.workspace.revealLeaf(leaf);
      if (current) await (leaf.view as StudioView).studio?.openDraft(current);
    } catch (error) {
      new Notice(`墨稿：${errorMessage(error)}`);
    }
  }
  host(): Host {
    return {
      settings: structuredClone(this.settings),
      saveSettings: async (settings) => {
        this.settings = {
          ...settings,
          exportFolder: this.settings.exportFolder,
        };
        await this.saveData(this.settings);
      },
      publishArticle: async (article, notify) => {
        if (!this.bridge) throw new Error("浏览器发布连接尚未启动。");
        const url = this.bridge.publish(article, notify);
        await shell.openExternal(url);
      },
      currentNote: () => this.activeDraft(),
      chooseNote: async () => {
        const file = await new Promise<TFile | null>((resolve) =>
          new ChooseNote(this.app, resolve).open(),
        );
        return file ? this.readNote(file) : null;
      },
      resolveImages: (draft, remote, options) =>
        resolveImageAssets(
          imageSources(draft),
          async (src) => {
            if (/^https?:\/\//i.test(src)) {
              if (!remote) throw new Error("外链图片尚未载入。");
              const downloaded = await downloadPublic(src, "image");
              return `data:${downloaded.contentType};base64,${Buffer.from(downloaded.data).toString("base64")}`;
            }
            const path = decodeURIComponent(src.split("#")[0]);
            const file = this.app.metadataCache.getFirstLinkpathDest(
              path,
              draft.sourcePath,
            );
            if (!file) throw new Error(`找不到图片 ${path}`);
            const mime: Record<string, string> = {
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              gif: "image/gif",
              webp: "image/webp",
              avif: "image/avif",
            };
            if (!mime[file.extension.toLowerCase()])
              throw new Error(
                `暂不支持嵌入 ${file.name}，请转换成 PNG 或 JPEG。`,
              );
            if (file.stat.size > 8 * 1024 * 1024)
              throw new Error(`图片 ${file.name} 超过 8 MB。`);
            const bytes = await this.app.vault.readBinary(file);
            return `data:${mime[file.extension.toLowerCase()]};base64,${Buffer.from(bytes).toString("base64")}`;
          },
          options,
        ),
      learnUrl: async (url) => {
        const page = await downloadPublic(url);
        const html = new TextDecoder().decode(page.data);
        const links = stylesheetLinks(html, page.finalUrl);
        const results = await Promise.allSettled(
          links.map((link) => downloadPublic(link, "css")),
        );
        const sheets = results.flatMap((r) =>
          r.status === "fulfilled"
            ? [new TextDecoder().decode(r.value.data)]
            : [],
        );
        const template = learnTemplate(html, page.finalUrl, sheets);
        if (results.some((r) => r.status === "rejected"))
          template.source!.notes.push(
            "部分外部样式未能读取，已保留可提取的样式。",
          );
        return template;
      },
      copy: copyContent,
      saveFiles: (files, title) => this.writePackage(files, title),
      revealPath: async (path) => {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter))
          throw new Error("请在 Vault 的导出目录查看文件。");
        shell.showItemInFolder(adapter.getFullPath(safeFolder(path)));
      },
    };
  }
  private async mkdir(path: string) {
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile)
        throw new Error(`导出路径被文件占用：${current}`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }
  async writePackage(files: OutputFile[], title: string): Promise<string> {
    const root = safeFolder(this.settings.exportFolder);
    const safeTitle =
      Array.from(title, (c) => (hasControlCharacters(c) ? "-" : c))
        .join("")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/^\.+/, "")
        .trim()
        .slice(0, 60) || "草稿";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = normalizePath(
      `${root}/${safeTitle}-${stamp}-${crypto.randomUUID().slice(0, 6)}`,
    );
    await this.mkdir(directory);
    for (const file of files) {
      if (
        !/^[a-z\d-]+\.(html|md|txt|png|jpg|gif|webp|avif|json|docx)$/.test(
          file.name,
        )
      )
        throw new Error("导出文件名不合法。");
      const path = `${directory}/${file.name}`;
      if (typeof file.content === "string")
        await this.app.vault.create(path, file.content);
      else await this.app.vault.createBinary(path, file.content);
    }
    new Notice(`墨稿：内容包已保存到 ${directory}`);
    return directory;
  }
}
class StudioSettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: ContentStudioPlugin,
  ) {
    super(app, plugin);
  }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "内容包保存目录",
        desc: "相对于当前笔记库；每次导出都会新建目录，保留之前的稿件。",
        aliases: ["导出", "图片", "保存路径"],
        control: {
          type: "text",
          key: "exportFolder",
          defaultValue: DEFAULT_SETTINGS.exportFolder,
          validate: (value) => {
            try {
              safeFolder(value);
            } catch (error) {
              return errorMessage(error);
            }
          },
        },
      },
      {
        name: "平台适配",
        desc: "桌面 Obsidian：公众号/知乎复制富文本，小红书导出图片与文案，X 导出长文与串文。",
      },
    ];
  }
  getControlValue(key: string): unknown {
    return key === "exportFolder"
      ? this.plugin.settings.exportFolder
      : undefined;
  }
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "exportFolder" && typeof value === "string") {
      this.plugin.settings.exportFolder = safeFolder(value);
      await this.plugin.saveData(this.plugin.settings);
    }
  }
  // Legacy Obsidian versions use display(); 1.13+ uses the searchable definitions above.
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("p", {
      text: "笔记在本地排版，点击保存后生成独立内容包。通过侧边栏的报纸图标或命令面板打开。",
    });
    new Setting(this.containerEl)
      .setName("内容包保存目录")
      .setDesc("相对于当前笔记库；每次导出都会新建目录，保留之前的稿件。")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.exportFolder)
          .onChange(async (value) => {
            try {
              this.plugin.settings.exportFolder = safeFolder(value);
              await this.plugin.saveData(this.plugin.settings);
            } catch {
              /* incomplete input is not persisted */
            }
          }),
      );
    new Setting(this.containerEl)
      .setName("平台适配")
      .setDesc(
        "首版支持桌面 Obsidian。公众号/知乎复制富文本，小红书导出图片与文案，X 导出长文与串文。",
      );
  }
}
