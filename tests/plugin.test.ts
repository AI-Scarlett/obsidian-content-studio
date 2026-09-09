import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire, builtinModules } from "node:module";
import { BUILTIN_TEMPLATES, userTemplate } from "../src/core/templates";

const compiled = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  write: false,
  external: [
    "obsidian",
    "electron",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
});
const livePlugins: { onunload(): void }[] = [];
afterEach(() => {
  for (const plugin of livePlugins.splice(0)) plugin.onunload();
});
function harness(saved: any = null) {
  class TFile {
    constructor(
      public path: string,
      public extension = "md",
      public stat = { size: 10 },
      public name = path.split("/").pop() || path,
    ) {}
  }
  class MarkdownView {}
  const note = new TFile("Notes/原笔记.md");
  const picture = new TFile("Attachments/test.png", "png");
  const original = "# 原笔记\n\n正文不会被导出覆盖。";
  const files = new Map<string, unknown>([
    [note.path, original],
    [picture.path, new Uint8Array([1, 2, 3]).buffer],
  ]);
  const folders = new Set<string>();
  const notices: string[] = [];
  const browserUrls: string[] = [];
  let data = saved;
  let clip: any;
  let enumerations = 0;
  let clipboardReads = 0;
  const leaves: any[] = [],
    revealed: any[] = [],
    layoutCallbacks: (() => void)[] = [];
  let reads = 0;
  const app = {
    workspace: {
      getActiveFile: () => note,
      getActiveViewOfType: () => null,
      on: () => ({}),
      getLeavesOfType: () => leaves,
      onLayoutReady: (callback: () => void) => {
        layoutCallbacks.push(callback);
      },
      getLeaf: () => ({
        view: {
          studio: {
            draft: undefined,
            openDraft(draft: any) {
              this.draft = draft;
            },
            destroy() {},
          },
        },
        async setViewState() {
          leaves.push(this);
        },
      }),
      revealLeaf: async (leaf: any) => {
        revealed.push(leaf);
      },
    },
    vault: {
      getMarkdownFiles: () => {
        enumerations++;
        return [note];
      },
      cachedRead: async (file: TFile) => {
        reads++;
        return files.get(file.path);
      },
      readBinary: async (file: TFile) => files.get(file.path),
      getAbstractFileByPath: (path: string) =>
        files.has(path) ? new TFile(path) : folders.has(path) ? {} : null,
      createFolder: async (path: string) => {
        if (folders.has(path)) throw new Error("exists");
        folders.add(path);
      },
      create: async (path: string, content: string) => {
        if (files.has(path)) throw new Error("overwrite");
        files.set(path, content);
      },
      createBinary: async (path: string, content: ArrayBuffer) => {
        if (files.has(path)) throw new Error("overwrite");
        files.set(path, content);
      },
    },
    metadataCache: { getFirstLinkpathDest: () => picture },
  };
  class Plugin {
    app = app;
    commands: any[] = [];
    ribbons: any[] = [];
    views: any[] = [];
    settingTabs: any[] = [];
    protocols = new Map<string, (params: any) => void>();
    registerObsidianProtocolHandler(
      action: string,
      handler: (params: any) => void,
    ) {
      this.protocols.set(action, handler);
    }
    async loadData() {
      return data;
    }
    async saveData(value: any) {
      data = structuredClone(value);
    }
    registerEvent() {}
    registerView(...args: any[]) {
      this.views.push(args);
    }
    addRibbonIcon(...args: any[]) {
      this.ribbons.push(args);
    }
    addCommand(command: any) {
      this.commands.push(command);
    }
    addSettingTab(tab: any) {
      this.settingTabs.push(tab);
    }
  }
  const obsidian = {
    Plugin,
    ItemView: class {},
    MarkdownView,
    TFile,
    FuzzySuggestModal: class {
      constructor(public app: any) {}
      setPlaceholder() {}
      open() {
        (this as any).getItems();
        (this as any).onClose();
      }
    },
    PluginSettingTab: class {},
    Setting: class {},
    Notice: class {
      constructor(message: string) {
        notices.push(message);
      }
    },
    normalizePath: (p: string) => p.replace(/\\/g, "/"),
  };
  class ClipboardItem {
    constructor(public data: Record<string, Blob>) {}
    async getType(type: string) {
      return this.data[type];
    }
  }
  const navigator = {
    clipboard: {
      write: async (items: ClipboardItem[]) => {
        clip = {
          text: await items[0].data["text/plain"].text(),
          html: await items[0].data["text/html"].text(),
        };
      },
      writeText: async (text: string) => {
        clip = { text };
      },
      read: () => {
        clipboardReads++;
        throw Error("Clipboard reading is forbidden");
      },
      readText: () => {
        clipboardReads++;
        throw Error("Clipboard reading is forbidden");
      },
    },
  };
  const require = createRequire(import.meta.url);
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    require: (name: string) =>
      name === "obsidian"
        ? obsidian
        : name === "electron"
          ? {
              shell: {
                openExternal: async (url: string) => {
                  browserUrls.push(url);
                },
              },
              clipboard: {
                write: (value: any) => {
                  clip = value;
                },
                writeText: (text: string) => {
                  clip = { text };
                },
              },
            }
          : name === "node:http"
            ? {
                ...require(name),
                createServer: (...args: any[]) => {
                  const server = require(name).createServer(...args);
                  const listen = server.listen.bind(server);
                  server.listen = (
                    _port: number,
                    host: string,
                    callback: () => void,
                  ) => listen(0, host, callback);
                  return server;
                },
              }
            : require(name),
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    window: { setTimeout, clearTimeout, navigator, ClipboardItem },
    navigator,
    ClipboardItem,
    Blob,
    URL,
    Buffer,
    TextDecoder,
    TextEncoder,
    AbortSignal,
    fetch,
    crypto,
    structuredClone,
    atob,
    btoa,
  });
  const plugin = new module.exports.default();
  livePlugins.push(plugin);
  return {
    plugin,
    safeFolder: module.exports.safeFolder,
    app,
    files,
    folders,
    note,
    original,
    browserUrls,
    getData: () => data,
    getClip: () => clip,
    getEnumerations: () => enumerations,
    getClipboardReads: () => clipboardReads,
    leaves,
    revealed,
    getReads: () => reads,
    layoutReady: () => {
      for (const callback of layoutCallbacks.splice(0)) callback();
    },
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
test("Obsidian URI waits for workspace restore and preserves an existing unsaved draft", async () => {
  const h = harness();
  await h.plugin.onload();
  const uri = h.plugin.protocols.get("content-studio");
  assert.ok(uri);
  uri({
    action: "content-studio",
    file: "other.md",
    text: "overwrite",
    publish: "true",
  });
  assert.equal(h.leaves.length, 0);
  assert.equal(h.revealed.length, 0);
  const draft = { title: "未保存标题", markdown: "未保存正文 ![[test.png]]" };
  const leaf = h.app.workspace.getLeaf();
  await leaf.setViewState();
  leaf.view.studio.openDraft(draft);
  h.layoutReady();
  await settle();
  assert.equal(h.revealed[0], leaf);
  assert.equal(leaf.view.studio.draft, draft);
  assert.equal(h.getReads(), 0);
  assert.equal(h.browserUrls.length, 0);
  assert.equal(h.files.get(h.note.path), h.original);
});
test("repeated URI requests create only one workbench with the active note", async () => {
  const h = harness();
  await h.plugin.onload();
  const uri = h.plugin.protocols.get("content-studio");
  uri({});
  uri({});
  uri({});
  h.layoutReady();
  await settle();
  assert.equal(h.leaves.length, 1);
  assert.equal(h.getReads(), 1);
  assert.equal(h.leaves[0].view.studio.draft.title, "原笔记");
  assert.equal(h.getEnumerations(), 0);
  uri({});
  h.layoutReady();
  await settle();
  assert.equal(h.leaves.length, 1);
  assert.equal(h.getReads(), 1);
});
test("URI opens an empty workbench without an active note and ignores callbacks after unload", async () => {
  const h = harness();
  h.app.workspace.getActiveFile = () => null as any;
  await h.plugin.onload();
  h.plugin.protocols.get("content-studio")({});
  h.layoutReady();
  await settle();
  assert.equal(h.leaves.length, 1);
  assert.equal(h.leaves[0].view.studio.draft, undefined);
  assert.equal(h.getReads(), 0);
  h.plugin.protocols.get("content-studio")({});
  h.plugin.onunload();
  h.layoutReady();
  await settle();
  assert.equal(h.revealed.length, 1);
});
test("built plugin loads and registers an Obsidian view, commands and ribbon", async () => {
  const h = harness();
  await h.plugin.onload();
  assert.equal(h.plugin.commands.length, 2);
  assert.equal(h.plugin.views[0][0], "content-studio-view");
  assert.equal(h.plugin.ribbons[0][0], "newspaper");
});
test("host reads notes and writes unique content packages without changing the source", async () => {
  const h = harness();
  await h.plugin.onload();
  const host = h.plugin.host();
  const draft = await host.currentNote();
  assert.equal(draft.title, "原笔记");
  const first = await host.saveFiles(
    [{ name: "article.md", content: "# 导出" }],
    "同一标题",
  );
  const second = await host.saveFiles(
    [{ name: "article.md", content: "# 第二版" }],
    "同一标题",
  );
  assert.notEqual(first, second);
  assert.equal(h.files.get(h.note.path), h.original);
  assert.equal(h.files.get(`${first}/article.md`), "# 导出");
  assert.equal(h.files.get(`${second}/article.md`), "# 第二版");
});
test("host embeds Vault attachments and writes rich clipboard formats", async () => {
  const h = harness();
  await h.plugin.onload();
  const host = h.plugin.host();
  const r = await host.resolveImages(
    { title: "附件", markdown: "![[test.png]]", sourcePath: h.note.path },
    false,
  );
  assert.equal(Object.values(r.assets)[0], "data:image/png;base64,AQID");
  await host.copy("正文", "<p>正文</p>");
  assert.equal(h.getClip().html, "<p>正文</p>");
});
test("custom templates persist and reload through plugin data", async () => {
  const h = harness();
  await h.plugin.onload();
  const host = h.plugin.host();
  const t = userTemplate(BUILTIN_TEMPLATES[1], "测试模板");
  await host.saveSettings({
    ...host.settings,
    customTemplates: [t],
    templateId: t.id,
  });
  const next = harness(h.getData());
  await next.plugin.onload();
  assert.equal(next.plugin.settings.customTemplates[0].name, "测试模板");
  assert.equal(next.plugin.settings.templateId, t.id);
});
test("export folder validation rejects traversal and configuration directories", () => {
  const h = harness();
  for (const path of [
    "/tmp",
    "../note",
    ".obsidian/plugins",
    "safe/../../target",
    "safe//target",
  ])
    assert.throws(() => h.safeFolder(path));
  assert.equal(h.safeFolder("墨稿导出/草稿"), "墨稿导出/草稿");
});

test("startup and formatting do not enumerate the vault or read the clipboard", async () => {
  const h = harness();
  await h.plugin.onload();
  await h.plugin.host().currentNote();
  await h.plugin.host().copy("标题");
  assert.equal(h.getEnumerations(), 0);
  assert.equal(h.getClipboardReads(), 0);
  assert.equal(h.getClip().text, "标题");
});
test("malformed saved settings are validated before becoming runtime settings", async () => {
  const h = harness({
    platform: { bad: true },
    exportFolder: { bad: true },
    customTemplates: [null, {}, "invalid"],
  });
  await h.plugin.onload();
  assert.equal(h.plugin.settings.platform, "wechat");
  assert.equal(h.plugin.settings.exportFolder, "墨稿导出");
  assert.equal(h.plugin.settings.customTemplates.length, 0);
});

test("vault paths are enumerated only when the user opens the note chooser", async () => {
  const h = harness();
  await h.plugin.onload();
  assert.equal(h.getEnumerations(), 0);
  assert.equal(await h.plugin.host().chooseNote(), null);
  assert.equal(h.getEnumerations(), 1);
});
test("searchable settings definitions preserve export folder validation", async () => {
  const h = harness();
  await h.plugin.onload();
  const tab = h.plugin.settingTabs[0];
  const definitions = tab.getSettingDefinitions();
  const control = definitions[0].control;
  assert.equal(control.key, "exportFolder");
  assert.equal(control.validate("导出/内容"), undefined);
  assert.ok(control.validate("../outside"));
  await tab.setControlValue("exportFolder", "导出/内容");
  assert.equal(tab.getControlValue("exportFolder"), "导出/内容");
  assert.equal(h.getData().exportFolder, "导出/内容");
});

test("compiled host opens one browser handoff with the selected draft and preserves plugin data", async () => {
  const h = harness({
    templateId: "ink",
    customTemplates: [],
    exportFolder: "导出",
  });
  await h.plugin.onload();
  const before = structuredClone(h.getData());
  await h.plugin.host().publishArticle(
    {
      format: "mogao-article",
      version: 1,
      title: "点击发布",
      platform: "wechat",
      source: "studio",
      html: "<p>正文</p>",
    },
    () => {},
  );
  assert.equal(h.browserUrls.length, 1);
  const url = h.browserUrls[0];
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/publish\/[a-f\d]{64}$/);
  const page = await (await fetch(url)).text();
  assert.match(page, /点击发布/);
  assert.deepEqual(h.getData(), before);
  assert.equal(h.files.get(h.note.path), h.original);
});
