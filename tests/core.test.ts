import { installDomGlobals } from "./dom";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  draftFromNote,
  renderDraft,
  splitThread,
  weightedLength,
  imageSources,
  htmlDocument,
} from "../src/core/render";
import { learnTemplate, stylesheetLinks } from "../src/core/learn";
import {
  BUILTIN_TEMPLATES,
  safeStyle,
  validateTemplate,
  userTemplate,
  tuneTemplate,
} from "../src/core/templates";
import {
  isPublicAddress,
  validatePublicUrl,
  downloadPublic,
  resolvePublicAddresses,
  parseDnsAnswers,
} from "../src/core/network";
import type { Platform } from "../src/core/types";
import { portableMarkdown } from "../src/core/export";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.com/",
});
installDomGlobals(dom);
const draft = {
  title: "标题 <不可执行>",
  markdown:
    "## 观点\n\n这是一段**重要内容**。\n\n[参考](https://example.com/path)\n\n> 引用文字\n\n- 第一项\n- 第二项",
  sourcePath: "Notes/Test.md",
};
const options = (platform: Platform = "wechat") => ({
  platform,
  template: BUILTIN_TEMPLATES[0],
  fontSize: 16,
  accent: "#3d6254",
  footnotes: true,
});
test("frontmatter and matching first title are removed without changing the input", () => {
  const raw = '---\ntitle: "自定义标题"\n---\n\n# 自定义标题\n\n正文';
  const actual = draftFromNote(raw, "测试.md");
  assert.equal(actual.title, "自定义标题");
  assert.equal(actual.markdown, "正文");
  assert.ok(raw.includes("title:"));
});
test("a different body heading is preserved", () =>
  assert.ok(
    draftFromNote(
      "---\ntitle: 总标题\n---\n# 第一节\n\n正文",
      "a.md",
    ).markdown.startsWith("# 第一节"),
  ));
test("missing frontmatter closing delimiter is not silently discarded", () =>
  assert.match(
    draftFromNote("---\ntitle: unfinished\n正文", "a.md").markdown,
    /unfinished/,
  ));
for (const platform of ["wechat", "zhihu", "xiaohongshu", "x"] as Platform[])
  test(`${platform}: render contains all body content and clean inline HTML`, () => {
    const r = renderDraft(draft, options(platform));
    for (const text of [
      "重要内容",
      "引用文字",
      "第一项",
      "第二项",
      "https://example.com/path",
    ])
      assert.ok(r.plainText.includes(text));
    assert.ok(r.html.includes("style="));
    assert.ok(r.html.includes("&lt;不可执行&gt;"));
    assert.ok(!r.html.includes("<不可执行>"));
    assert.equal(draft.markdown.includes("**"), true);
  });
test("wechat references preserve full original links", () => {
  const r = renderDraft(draft, options());
  assert.match(r.html, /参考链接/);
  assert.match(r.html, /\[1\]/);
  assert.ok(!renderDraft(draft, options("zhihu")).html.includes("参考链接"));
});
test("script HTML and dangerous URLs are never rendered as executable content", () => {
  const r = renderDraft(
    {
      ...draft,
      markdown:
        "<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<img src=x onerror=alert(1)>",
    },
    options(),
  );
  const doc = new dom.window.DOMParser().parseFromString(r.html, "text/html");
  assert.equal(
    doc.querySelectorAll('script,[onerror],a[href^="javascript:"]').length,
    0,
  );
});
test("local attachments and wikilinks are recognized", () => {
  const d = {
    ...draft,
    markdown: "![[assets/一张图片.png|说明]]\n\n[[另一篇笔记|显示名称]]",
  };
  assert.equal(imageSources(d).length, 1);
  assert.ok(renderDraft(d, options()).plainText.includes("显示名称"));
});
test("unresolved external images produce a placeholder without network loading", () => {
  const r = renderDraft(
    { ...draft, markdown: "![外链](https://example.com/p.png)" },
    options(),
  );
  assert.equal(
    new dom.window.DOMParser().parseFromString(r.html, "text/html").images
      .length,
    0,
  );
  assert.ok(r.warnings[0].includes("外链"));
});
test("resolved raster attachments embed into rich text", () => {
  const r = renderDraft({ ...draft, markdown: "![本地图](a.png)" }, options(), {
    "a.png": "data:image/png;base64,iVBORw0KGgo=",
  });
  assert.ok(r.html.includes("data:image/png;base64,"));
  assert.equal(r.warnings.length, 0);
});
test("SVG and non-image data URLs cannot be injected through resolved assets", () => {
  const r = renderDraft({ ...draft, markdown: "![附件](a.svg)" }, options(), {
    "a.svg": "data:image/svg+xml;base64,PHN2Zz4=",
  });
  assert.ok(!r.html.includes("<img"));
});
test("each built-in template produces its own palette and heading treatment", () => {
  const html = BUILTIN_TEMPLATES.map(
    (t) =>
      renderDraft(draft, {
        ...options(),
        template: t,
        accent: t.palette.accent,
      }).html,
  );
  assert.equal(new Set(html).size, 6);
});
test("manual font and accent overrides affect output", () => {
  const r = renderDraft(draft, {
    ...options(),
    fontSize: 21,
    accent: "#123456",
  });
  assert.equal(
    new dom.window.DOMParser()
      .parseFromString(r.html, "text/html")
      .querySelector("section")!.style.fontSize,
    "21px",
  );
  assert.ok(r.html.includes("#123456"));
});
test("learning extracts article typography and records provenance without source prose", () => {
  const html = readFileSync(
    new URL("./fixtures/wechat-style.html", import.meta.url),
    "utf8",
  );
  const t = learnTemplate(html, "https://example.com/reference");
  assert.equal(t.palette.accent, "#ad3e36");
  assert.equal(t.fontSize, 16);
  assert.equal(t.roles?.h2?.["border-bottom"], "2px solid #ad3e36");
  assert.ok(t.source!.evidence >= 14);
  assert.ok(!JSON.stringify(t).includes("这是一段足够长"));
  assert.equal(t.source?.url, "https://example.com/reference");
});
test("link stylesheets resolve relative to the final URL", () =>
  assert.deepEqual(
    stylesheetLinks(
      '<link rel="stylesheet" href="../theme.css"><link rel="icon" href="x">',
      "https://example.com/a/b",
    ),
    ["https://example.com/theme.css"],
  ));
test("external CSS can supply missing page styles", () => {
  const html =
    "<article><h2>External CSS</h2><p>" +
    "足够长的正文".repeat(20) +
    "</p></article>";
  const t = learnTemplate(html, "https://example.com", [
    "article p{font-size:17px;color:#333333;line-height:1.9;}article h2{color:#123456;font-size:20px;font-weight:700;}",
  ]);
  assert.equal(t.palette.accent, "#123456");
  assert.equal(t.fontSize, 17);
});
test("captcha and empty pages return a real error instead of fabricated templates", () => {
  assert.throws(
    () =>
      learnTemplate(
        "<body>环境异常，请完成验证。" + "验证".repeat(40) + "</body>",
      ),
    /验证/,
  );
  assert.throws(() => learnTemplate("<p>too short</p>"), /正文/);
});
test("plain unstyled pages do not count as a learned template", () =>
  assert.throws(
    () =>
      learnTemplate(`<article><p>${"没有样式的正文".repeat(20)}</p></article>`),
    /足够的排版样式/,
  ));
test("style values reject network loads, scripts, positioning and oversized spacing", () => {
  for (const [p, v] of [
    ["color", "expression(alert(1))"],
    ["background-color", "url(https://bad.example)"],
    ["position", "fixed"],
    ["padding", "9999px"],
    ["font-family", "x;position:fixed"],
    ["border", "2px solid red;display:none"],
  ])
    assert.equal(safeStyle(p, v), undefined);
  assert.equal(safeStyle("color", "#123456"), "#123456");
});
test("template import validates identity and strips unsafe style fields", () => {
  const t = userTemplate(BUILTIN_TEMPLATES[0], "自定义");
  t.roles = {
    p: {
      color: "#333333",
      position: "fixed",
      "background-color": "url(https://bad.example)",
    },
  };
  const valid = validateTemplate(t);
  assert.deepEqual(valid.roles?.p, { color: "#333333" });
  assert.throws(() => validateTemplate({ ...t, id: "ink" }), /模板/);
  assert.throws(() => validateTemplate({ ...t, fontSize: 200 }), /字号/);
});
test("X thread splitting respects CJK, emoji, long URLs and every input character", () => {
  const text =
    "中文内容 🌿👨‍👩‍👧‍👦 A long line.\n".repeat(25) +
    " https://example.com/" +
    "long/".repeat(120) +
    "\n最后一段";
  const parts = splitThread(text);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every((p) => weightedLength(p) <= 280));
  assert.ok(parts.some((p) => p.includes("https://example.com/")));
  assert.ok(parts.filter((p) => p.includes("long/")).length === 1);
});
test("X does not split joined emoji sequences and keeps punctuation", () => {
  const text = "👨‍👩‍👧‍👦".repeat(180) + "。结尾！";
  const parts = splitThread(text);
  assert.equal(parts.join(""), text);
  assert.ok(
    parts.every((p) => !p.startsWith("\u200d") && !p.endsWith("\u200d")),
  );
});
test("empty X draft creates no posts", () =>
  assert.deepEqual(splitThread(""), []));
test("standalone HTML has no script permission and escapes titles", () => {
  const html = htmlDocument("</title><script>x</script>", "<p>正文</p>");
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!html.includes("<script>"));
});
for (const address of [
  "127.0.0.1",
  "10.0.0.2",
  "172.16.0.1",
  "192.168.1.2",
  "169.254.169.254",
  "0.0.0.0",
  "100.64.0.1",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
])
  test(`network rejects ${address}`, () =>
    assert.equal(isPublicAddress(address), false));
test("network permits public unicast IPs", () => {
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
test("URL normalization blocks numeric/private hosts and credential URLs", () => {
  for (const u of [
    "http://2130706433",
    "http://0x7f000001",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "http://localhost",
    "http://host.local",
    "https://example.com:8080",
  ])
    assert.throws(() => validatePublicUrl(u));
  assert.equal(
    validatePublicUrl("https://mp.weixin.qq.com/s/abc").hostname,
    "mp.weixin.qq.com",
  );
});
test("network rejects private URL before making a request", async () =>
  await assert.rejects(
    downloadPublic("http://127.0.0.1/private"),
    /内网|本地|保留/,
  ));
test("fake-IP proxy resolution uses validated public DNS results", async () => {
  const addresses = await resolvePublicAddresses(
    "example.com",
    async () => [{ address: "198.18.0.1", family: 4 }],
    async () => [{ address: "1.1.1.1", family: 4 }],
  );
  assert.equal(addresses[0].address, "1.1.1.1");
});
test("fake-IP fallback still rejects a private answer", async () =>
  await assert.rejects(
    resolvePublicAddresses(
      "example.com",
      async () => [{ address: "198.18.0.1", family: 4 }],
      async () => [{ address: "127.0.0.1", family: 4 }],
    ),
    /内网|保留/,
  ));
test("ordinary private answers are rejected without invoking DNS fallback", async () => {
  let called = false;
  await assert.rejects(
    resolvePublicAddresses(
      "example.com",
      async () => [{ address: "10.0.0.1", family: 4 }],
      async () => {
        called = true;
        return [{ address: "1.1.1.1", family: 4 }];
      },
    ),
    /内网|保留/,
  );
  assert.equal(called, false);
});
test("Markdown content packages include and relink resolved image bytes", () => {
  const data = "data:image/png;base64,aGVsbG8=";
  const r = portableMarkdown(
    "![说明](<图片 名称.png>)\n\n![引用][image]\n\n[image]: 图片%20名称.png",
    {
      "%E5%9B%BE%E7%89%87%20%E5%90%8D%E7%A7%B0.png": data,
      "图片%20名称.png": data,
    },
  );
  assert.ok(r.markdown.includes("![说明](<image-01.png>)"));
  assert.ok(r.markdown.includes("[image]: image-02.png"));
  assert.equal(new TextDecoder().decode(r.images[0].content), "hello");
});
test("saved learned-template color adjustments include border rules", () => {
  const t = learnTemplate(
    readFileSync(
      new URL("./fixtures/wechat-style.html", import.meta.url),
      "utf8",
    ),
  );
  const saved = userTemplate(tuneTemplate(t, "#123456", 19), "自定义配色");
  assert.equal(saved.roles?.h2?.color, "#123456");
  assert.equal(saved.roles?.h2?.["border-bottom"], "2px solid #123456");
  assert.equal(saved.fontSize, 19);
  assert.equal(t.palette.accent, "#ad3e36");
});

test("DNS response parsing narrows untrusted records and caps payload size", () => {
  assert.deepEqual(
    parseDnsAnswers(
      JSON.stringify({
        Answer: [
          null,
          {},
          "text",
          { type: 1, data: 123 },
          { type: 5, data: "alias" },
          { type: 1, data: "93.184.216.34" },
        ],
      }),
    ),
    [{ address: "93.184.216.34", family: 4 }],
  );
  assert.deepEqual(parseDnsAnswers("null"), []);
  assert.throws(() => parseDnsAnswers(" ".repeat(32001)), /DNS/);
});
