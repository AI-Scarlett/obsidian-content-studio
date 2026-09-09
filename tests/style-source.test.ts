import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installDomGlobals } from "./dom";
import {
  StyleSource,
  compactStyleHtml,
  STYLE_SOURCE_LIMIT,
} from "../src/core/style-source";
import { learnTemplate, stylesheetLinks } from "../src/core/learn";
import { renderDraft } from "../src/core/render";

installDomGlobals(new JSDOM(""));
const article = `<article id="js_content"><h2 style="font-size:22px;color:#123456;font-weight:700">示例标题</h2><p style="font-size:17px;color:#334455;line-height:1.8">${"正文中保留原来的段落和强调。".repeat(10)}</p><img src="https://example.com/large.png"><p>图片之后的内容依然需要保留。</p></article>`;

test("large scripts and image payloads do not consume the style-content budget", () => {
  const raw = `<head><title>参考 &amp; 样式</title><script>${"a".repeat(3_300_000)}</script><link rel="stylesheet" href="../theme.css"></head>${article.replace("https://example.com/large.png", `data:image/png;base64,${"A".repeat(4_000_000)}`)}`;
  const compact = compactStyleHtml(raw);
  assert.ok(Buffer.byteLength(compact) < 4000);
  assert.doesNotMatch(compact, /<script|data:image|src=|large\.png/);
  assert.match(compact, /图片之后的内容/);
  assert.deepEqual(stylesheetLinks(compact, "https://example.com/a/b"), [
    "https://example.com/theme.css",
  ]);
  const template = learnTemplate(raw);
  assert.equal(template.fontSize, 17);
  assert.equal(template.palette.accent, "#123456");
  assert.equal(template.name, "参考 · 参考 & 样式");
  assert.doesNotMatch(
    JSON.stringify(template),
    /data:image|正文中保留|large\.png/,
  );
});

test("streaming across every tag, UTF-8 and entity boundary keeps the same style evidence", () => {
  const raw = `<script>let x="<img src='trap'>";</script><!-- fake <article> -->${article}<p>中文 &amp; 😀</p>`;
  const bytes = new TextEncoder().encode(raw);
  const stream = new StyleSource();
  for (const byte of bytes) stream.write(Uint8Array.of(byte));
  const result = stream.finish();
  assert.equal(result, compactStyleHtml(raw));
  assert.match(result, /中文 &amp; 😀/);
  assert.doesNotMatch(result, /trap|fake/);
});

test("image, SVG, iframe, metadata and lazy-load payloads are omitted without fetching them", () => {
  const compact = compactStyleHtml(
    `${article}<img srcset="https://example.com/1 2x" data-src="https://example.com/2" onerror="run()"><svg><image href="data:image/png;base64,AAA" /></svg><iframe src="https://example.com/embed">unwanted</iframe><meta content="large-metadata">`,
  );
  assert.doesNotMatch(
    compact,
    /https:|data:image|onerror|svg|iframe|unwanted|large-metadata/,
  );
  assert.equal(
    new DOMParser().parseFromString(compact, "text/html").images.length,
    2,
  );
});

test("an oversized unused stylesheet does not prevent later article inline styles", () => {
  const compact = compactStyleHtml(
    `<style>.image{background:url(data:image/png;base64,${"A".repeat(700_000)})}</style>${article}`,
  );
  assert.doesNotMatch(compact, /data:image/);
  assert.equal(learnTemplate(compact).fontSize, 17);
});

test("meaningful text, raw input and excessive nesting remain bounded after reduction", () => {
  assert.throws(
    () => compactStyleHtml(`<article>${"文".repeat(1_100_000)}</article>`),
    /正文与样式仍超过 3 MB/,
  );
  const stream = new StyleSource();
  stream.write(new TextEncoder().encode("<script>"));
  const chunk = new Uint8Array(1024 * 1024).fill(65);
  assert.throws(() => {
    for (let i = 0; i < STYLE_SOURCE_LIMIT / chunk.length; i++)
      stream.write(chunk);
  }, /20 MB/);
  assert.throws(() => compactStyleHtml("<div>".repeat(150)), /结构过于复杂/);
});

test("placeholder preview retains image positions without embedding even cached images", () => {
  const template = learnTemplate(article);
  const draft = {
    title: "预览",
    sourcePath: "note.md",
    markdown: "开头\n\n![第一张](one.png)\n\n中间\n\n![[two.png]]\n\n结尾",
  };
  const rendered = renderDraft(
    draft,
    {
      platform: "wechat",
      template,
      fontSize: 17,
      accent: "#123456",
      footnotes: false,
      imagePlaceholders: true,
    },
    { "one.png": "data:image/png;base64,iVBORw0KGgo=" },
  );
  assert.doesNotMatch(rendered.html, /<img|data:image/);
  assert.match(
    rendered.html,
    /开头[\s\S]*图片占位：第一张[\s\S]*中间[\s\S]*图片占位：two.png[\s\S]*结尾/,
  );
  assert.deepEqual(rendered.warnings, []);
  assert.match(draft.markdown, /!\[第一张\]\(one.png\)/);
});
