import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { installDomGlobals } from "./dom";
import { learnTemplate } from "../src/core/learn";
import { renderDraft } from "../src/core/render";
import {
  BUILTIN_TEMPLATES,
  tuneTemplate,
  validateTemplate,
} from "../src/core/templates";
import { setSafeHtml } from "../src/core/dom";
import { Studio, type Host } from "../src/ui/studio";
import { DEFAULT_SETTINGS, type Template } from "../src/core/types";

const dom = new JSDOM("<!doctype html><body></body>");
installDomGlobals(dom);
const fixture = readFileSync(
  new URL("./fixtures/wechat-component-style.html", import.meta.url),
  "utf8",
);
const draft = {
  title: "我的新稿件",
  sourcePath: "稿件.md",
  markdown:
    "## 新的第一节\n\n这是我的正文。**正文重点**。\n\n## 新的第二节\n\n第二段正文。",
};
const render = (template: Template) =>
  renderDraft(draft, {
    template,
    platform: "wechat",
    fontSize: template.fontSize,
    accent: template.palette.accent,
    footnotes: false,
    includeTitle: false,
  });

test("repeated small centered captions do not displace the actual section heading", () => {
  const prose =
    "主要正文保持十七像素字号和稳定的行距，需要足够长来代表文章中主要的阅读内容。".repeat(
      3,
    );
  const source = `<article><p style="font-size:17px;line-height:1.8">${prose}</p><p style="font-size:20px;font-weight:bold;text-align:center;color:#123456">章节标题</p>${'<p style="font-size:14px;font-weight:bold;text-align:center;color:#888888">图片说明</p>'.repeat(12)}</article>`;
  const t = learnTemplate(source);
  assert.equal(t.roles!.h2!["font-size"], "20px");
  assert.equal(t.roles!.h2!.color, "#123456");
});

test("font shorthand and split border properties are sampled after CSS cascade", () => {
  const source = `<style>article p{font:18px/1.8 Georgia,serif;} article h2{border-left-width:3px;border-left-style:solid;border-left-color:#123456}</style><article><h2>章节标题</h2><p>${"正文应该使用参考文章字体而不是回退到默认字体。".repeat(5)}</p></article>`;
  const t = learnTemplate(source);
  assert.equal(t.fontSize, 18);
  assert.equal(t.lineHeight, 1.8);
  assert.match(t.roles!.p!["font-family"], /Georgia/);
  assert.match(t.roles!.h2!["border-left"], /^3px solid/);
});

test("CSS variables, structural selectors and nested heading boxes survive source sampling", () => {
  const template = learnTemplate(fixture);
  assert.equal(template.fontSize, 17);
  assert.equal(template.roles!.p!["margin-bottom"], "26px");
  assert.ok(template.components?.h2);
  const result = render(template);
  const doc = new DOMParser().parseFromString(result.html, "text/html");
  const headings = [...doc.querySelectorAll("h2")];
  assert.deepEqual(
    headings.map((h) => h.textContent),
    ["01新的第一节", "02新的第二节"],
  );
  const heading = headings[0];
  assert.equal(heading.style.border, "1px solid rgb(18, 91, 163)");
  const text = heading.querySelector<HTMLElement>("[data-mg-heading-text]")!;
  assert.equal(text.style.color, "rgb(255, 255, 255)");
  assert.equal(text.style.fontSize, "22px");
  const blue = [...heading.querySelectorAll<HTMLElement>("span")].find(
    (el) => el.style.backgroundColor === "rgb(18, 91, 163)",
  )!;
  assert.ok(blue.contains(text));
  assert.equal(blue.style.display, "inline-block");
  assert.equal(blue.style.padding, "8px 14px");
  assert.doesNotMatch(
    JSON.stringify(template),
    /原文第|参考正文|large-source-image|<section|<script|var\(/,
  );
  assert.deepEqual(
    validateTemplate(JSON.parse(JSON.stringify(template))),
    template,
  );
});

test("template typography survives mounting under hostile host p and span defaults and stripping the article shell", () => {
  const template = learnTemplate(fixture);
  const host = document.createElement("div");
  const css = document.createElement("style");
  css.textContent =
    ".foreign p,.foreign span{font-size:12px;line-height:1;font-family:monospace;color:purple;letter-spacing:0;text-align:left;}";
  document.head.append(css);
  document.body.append(host);
  host.className = "foreign";
  setSafeHtml(host, render(template).html);
  const section = host.firstElementChild!;
  section.replaceWith(...section.childNodes);
  const body = host.querySelector<HTMLElement>(":scope > p")!;
  const computed = dom.window.getComputedStyle(body);
  assert.equal(computed.fontSize, "17px");
  assert.equal(computed.lineHeight, "1.8");
  assert.equal(computed.letterSpacing, "1px");
  assert.equal(computed.textAlign, "justify");
  assert.equal(computed.marginBottom, "26px");
  assert.match(computed.fontFamily, /PingFang/);
  const title = host.querySelector<HTMLElement>("[data-mg-heading-text]")!;
  assert.equal(dom.window.getComputedStyle(title).color, "rgb(255, 255, 255)");
  host.remove();
  css.remove();
});

test("all six builtins change paragraph typography, not just paper or accent", () => {
  const signatures = BUILTIN_TEMPLATES.map((t) => {
    const doc = new DOMParser().parseFromString(render(t).html, "text/html");
    const p = doc.querySelector("p")!;
    return [
      p.style.fontSize,
      p.style.fontFamily,
      p.style.lineHeight,
      p.style.marginBottom,
      p.style.textIndent,
      p.style.letterSpacing,
    ].join("|");
  });
  assert.equal(new Set(signatures).size, 6);
});

test("saving adjusted reference templates recolors every nested box without changing source text", () => {
  const t = learnTemplate(fixture);
  const tuned = tuneTemplate(t, "#a12233", 19);
  const doc = new DOMParser().parseFromString(render(tuned).html, "text/html");
  assert.equal(doc.querySelector("p")!.style.fontSize, "19px");
  assert.equal(doc.querySelector("h2")!.style.borderColor, "rgb(161, 34, 51)");
  assert.equal(
    doc.querySelector<HTMLElement>("[data-mg-heading-text]")!.style.color,
    "rgb(255, 255, 255)",
  );
});

test("untrusted heading component imports cannot introduce text, resources, scripts or duplicate content", () => {
  const t = learnTemplate(fixture);
  const imported = validateTemplate({
    ...t,
    components: {
      h2: {
        styles: {
          position: "fixed",
          color: "red",
          width: "99999px",
          "background-color": "url(https://example.com)",
        },
        html: "<script>bad()</script>",
        slot: "content",
      },
    },
  });
  assert.deepEqual(imported.components!.h2!.styles, { color: "red" });
  assert.doesNotMatch(
    JSON.stringify(imported.components),
    /script|position|url\(|99999/,
  );
  const duplicate = validateTemplate({
    ...t,
    components: {
      h2: { children: [{ slot: "content" }, { slot: "content" }] },
    },
  });
  assert.equal(duplicate.components, undefined);
});

test("Studio template selection reaches preview and copy using the same paragraph and component styles", async () => {
  const learned = learnTemplate(fixture);
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    customTemplates: [learned],
  };
  let copied = "";
  const host: Host = {
    settings,
    currentNote: async () => draft,
    chooseNote: async () => draft,
    saveSettings: async () => {},
    learnUrl: async () => learned,
    copy: async (_text, html) => {
      copied = html || "";
    },
    saveFiles: async () => "test-output",
    resolveImages: async () => ({ assets: {}, warnings: [], details: [] }),
  };
  const root = document.createElement("div");
  document.body.append(root);
  const studio = new Studio(root, host);
  await studio.openDraft(draft);
  for (const t of [BUILTIN_TEMPLATES[2], learned]) {
    root.querySelector<HTMLButtonElement>(`[data-template="${t.id}"]`)!.click();
    const preview = root.querySelector<HTMLElement>(".mg-preview")!;
    const before = preview.querySelector("p")!.getAttribute("style");
    root.querySelector<HTMLButtonElement>('[data-action="copy"]')!.click();
    const deadline = Date.now() + 1500;
    while (root.getAttribute("aria-busy") === "true" && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 5));
    const doc = new DOMParser().parseFromString(copied, "text/html");
    assert.equal(doc.querySelector("p")!.getAttribute("style"), before);
    assert.equal(doc.querySelector("h1"), null);
    assert.equal(
      doc.querySelector("h2")!.outerHTML,
      preview.querySelector("h2")!.outerHTML,
    );
  }
  studio.destroy();
  root.remove();
});
