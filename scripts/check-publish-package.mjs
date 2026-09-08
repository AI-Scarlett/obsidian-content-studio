// Verify the exact built plugin serves its matching extension; no UI/browser automation.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
const require = createRequire(import.meta.url);
let opened;
const app = { workspace: { getActiveFile: () => null, on: () => ({}), getLeavesOfType: () => [] } };
class Plugin {
  app = app;
  loadData() { return Promise.resolve(null); }
  registerEvent() {} registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {}
}
const obsidian = { Plugin, ItemView: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {}, Notice: class {}, TFile: class {}, MarkdownView: class {} };
const module = { exports: {} };
vm.runInNewContext(await readFile("main.js", "utf8"), {
  module, exports: module.exports,
  require: name => name === "obsidian" ? obsidian : name === "electron" ? { shell: { openExternal: async url => { opened = url; } } } : require(name),
  window: { setTimeout, clearTimeout }, console, URL, Buffer, TextEncoder, TextDecoder, AbortSignal, fetch, crypto, structuredClone, atob, btoa,
});
const plugin = new module.exports.default();
try {
  await plugin.onload();
  await plugin.host().publishArticle({ format: "mogao-article", version: 1, title: "Package verification", platform: "wechat", source: "studio", html: "<p>Verification fixture only.</p>" }, () => {});
  const response = await fetch(new URL("/extension.zip", opened));
  assert.equal(response.status, 200);
  const actual = Buffer.from(await response.arrayBuffer());
  const expected = await readFile("dist/mogao-browser-extension-0.2.0-preview.zip");
  assert.deepEqual(actual, expected);
  const archive = unzipSync(actual);
  const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
  assert.equal(manifest.version, "0.2.0");
  assert.ok(archive["launcher.js"]);
  assert.ok(!strFromU8(archive["importer.html"]).includes('type="file"'));
  for (const name of ["manifest.json", "background.js", "launcher.js", "content.js", "importer.js", "importer.html", "README.md"])
    assert.deepEqual(Buffer.from(archive[name]), await readFile(`dist/mogao-browser-extension/${name}`));
  console.log(JSON.stringify({ builtPlugin: "0.1.5", extension: manifest.version, extensionSha256: createHash("sha256").update(actual).digest("hex"), extensionDownloadMatchesBuild: true, manualFilePicker: false, platformAcceptance: "not verified" }, null, 2));
} finally { plugin.onunload(); }
