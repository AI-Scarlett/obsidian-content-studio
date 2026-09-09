import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { installDomGlobals } from "./dom";
import { learnTemplate } from "../src/core/learn";
import { renderDraft } from "../src/core/render";
import { validateTemplate, BUILTIN_TEMPLATES } from "../src/core/templates";

installDomGlobals(new JSDOM(""));
const fixture = readFileSync(
  new URL("./fixtures/wechat-nested-style.html", import.meta.url),
  "utf8",
);
const prose =
  "这里是测试文章的正文，用足够长度代表主要段落，以检查不同位置的实际文字样式。".repeat(
    3,
  );

test("nested WeChat text and wrappers retain typography, heading contrast, indentation and blank-line spacing", () => {
  const t = learnTemplate(fixture);
  assert.equal(t.fontSize, 17);
  assert.equal(t.lineHeight, 1.75);
  assert.equal(t.palette.ink, "#181818");
  assert.equal(t.palette.paper, "#fff9ed");
  assert.equal(t.roles?.p?.["letter-spacing"], "1px");
  assert.equal(t.roles?.p?.["text-indent"], "32px");
  assert.equal(t.roles?.p?.["margin-bottom"], "28px");
  assert.equal(t.roles?.p?.["margin-left"], "0");
  assert.equal(t.roles?.h2?.color, "#ffffff");
  assert.equal(t.roles?.h2?.["background-color"], "#125ba3");
  assert.equal(t.roles?.h2?.["padding-left"], "14px");
  assert.equal(t.roles?.article?.["padding-left"], "12px");
  assert.equal(t.roles?.blockquote?.["border-left"], "3px solid #125ba3");
  assert.equal(t.roles?.strong?.["font-size"], "17px");
  assert.equal(t.styleMode, "reference");
  assert.deepEqual(validateTemplate(JSON.parse(JSON.stringify(t))), t);
});

test("reference render uses the learned shell and colors with no built-in green decorations", () => {
  const t = learnTemplate(fixture);
  const rendered = renderDraft(
    {
      title: "稿件",
      markdown: `## 标题\n\n${prose}\n\n> 引用\n\n**强调**`,
      sourcePath: "",
    },
    {
      platform: "wechat",
      template: t,
      fontSize: 19,
      accent: t.palette.accent,
      footnotes: false,
    },
  );
  const doc = new DOMParser().parseFromString(rendered.html, "text/html");
  const heading = doc.querySelector("h2")!;
  const article = doc.querySelector("section")!;
  assert.equal(article.style.fontSize, "19px");
  assert.equal(article.style.paddingLeft, "12px");
  assert.match(article.style.fontFamily, /PingFang SC/);
  assert.equal(
    heading.querySelector<HTMLElement>("[data-mg-heading-text]")!.style.color,
    "rgb(255, 255, 255)",
  );
  assert.equal(heading.style.backgroundColor, "rgb(18, 91, 163)");
  assert.equal(doc.querySelector("blockquote")!.style.borderLeftWidth, "3px");
  assert.equal(Number.parseFloat(heading.style.borderLeftWidth), 0);
  assert.doesNotMatch(rendered.html, /#3d6254|#f1f5f2/);
  const normal = BUILTIN_TEMPLATES[0];
  assert.equal(normal.heading, "line");
});

test("inline heading highlights keep foreground and background paired instead of mixing different styles", () => {
  const t = learnTemplate(
    `<article><p style="font-size:17px;color:#333;line-height:1.8">${prose}</p><p><strong><span style="font-size:22px;color:#fff;background:#125ba3"><span>第一节标题</span></span></strong></p><p><strong><span style="font-size:22px;color:#fff;background:#125ba3"><span>第二节标题</span></span></strong></p><p style="font-size:20px;color:#444;font-weight:bold">另一种标题</p></article>`,
  );
  assert.equal(t.roles?.h2?.color, "#fff");
  assert.equal(t.roles?.h2?.["background-color"], "#125ba3");
  assert.equal(t.palette.accent, "#125ba3");
});

test("relative nested sizes and inherited absolute line height resolve without repeated multiplication", () => {
  const t = learnTemplate(
    `<article style="font-size:16px;line-height:2em"><p><span style="font-size:1.2em;color:#333"><span>${prose}</span></span></p></article>`,
  );
  assert.equal(t.fontSize, 19.2);
  assert.equal(t.roles?.p?.["line-height"], "32px");
  assert.equal(t.lineHeight, 32 / 19.2);
});

test("plain learned paragraphs do not gain unseen heading bars or quote backgrounds", () => {
  const t = learnTemplate(
    `<article><p style="font-size:17px;color:#333;line-height:1.8">${prose}</p></article>`,
  );
  const r = renderDraft(
    {
      title: "稿件",
      markdown: `## 标题\n\n${prose}\n\n> 引用`,
      sourcePath: "",
    },
    {
      platform: "wechat",
      template: t,
      fontSize: t.fontSize,
      accent: t.palette.accent,
      footnotes: false,
    },
  );
  const doc = new DOMParser().parseFromString(r.html, "text/html");
  assert.equal(
    doc.querySelector("blockquote")!.style.backgroundColor,
    "transparent",
  );
  assert.equal(
    Number.parseFloat(doc.querySelector("h2")!.style.borderLeftWidth),
    0,
  );
  assert.equal(t.source?.confidence, "partial");
  assert.equal(t.heading, "plain");
});

test("reference template validation still strips executable and network styles", () => {
  const t = learnTemplate(fixture);
  t.roles!.article = {
    position: "fixed",
    "background-color": "url(https://example.com/image)",
    "text-indent": "2em",
  };
  assert.deepEqual(validateTemplate(t).roles?.article, {
    "text-indent": "2em",
  });
});

test("inactive media styles do not contaminate article colors and important declarations keep cascade priority", () => {
  const t = learnTemplate(
    `<style>article p{font-size:17px;color:#123456!important;line-height:1.8} @media print{article p{font-size:12px;color:#ffffff!important}} @media(prefers-color-scheme:dark){article p{background:#000}}</style><article><p style="color:#999">${prose}</p></article>`,
  );
  assert.equal(t.palette.ink, "#123456");
  assert.equal(t.fontSize, 17);
  assert.equal(t.roles?.p?.["background-color"], undefined);
});
