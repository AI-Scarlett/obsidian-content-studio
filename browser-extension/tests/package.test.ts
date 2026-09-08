import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { prepareArticle, readArticle } from "../src/package";
import { platformFor, platformImage } from "../src/editor";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const dom = new JSDOM("", { url: "https://example.com" });
const win = dom.window as unknown as Window & typeof globalThis;
const source = (html: string) => ({
  format: "mogao-article" as const,
  version: 1 as const,
  title: "整篇测试",
  platform: "xiaohongshu" as const,
  html,
});
test("whole article preserves repeated image positions, captions and nested formatting", () => {
  const plan = prepareArticle(
    source(
      `<section><h2>第一章</h2><p><strong>开头</strong></p><figure><img src="${png}"><figcaption>图注一</figcaption></figure><p>中间</p><img src="${png}"><p>结尾</p></section>`,
    ),
    win,
  );
  assert.equal(plan.images.length, 2);
  assert.notEqual(plan.images[0].marker, plan.images[1].marker);
  assert.equal(plan.images[0].base64, plan.images[1].base64);
  assert.deepEqual(plan.textParts, ["第一章开头", "图注一中间", "结尾"]);
  assert.ok(plan.html.includes("<strong>开头</strong>"));
  assert.ok(!plan.html.includes("base64"));
});
test("old exported HTML is accepted with title separate from body", () => {
  const article = readArticle(
    `<!doctype html><title>标题</title><body><section><h1>标题</h1><p>正文</p><img src="${png}"></section></body>`,
    "html",
    "wechat",
    win,
  );
  assert.equal(article.title, "标题");
  assert.ok(!article.html.includes("<h1>"));
  assert.equal(prepareArticle(article, win).images.length, 1);
});
test("unsafe markup and CSS requests do not reach destination", () => {
  const plan = prepareArticle(
    source(
      `<p onclick="steal()" style="background-image:url(https://evil.example/a);color:red">正文</p><script>bad()</script><iframe src="https://evil.example"></iframe><a href="file:///Users/private">链接</a>`,
    ),
    win,
  );
  assert.ok(!/evil|onclick|script|iframe|file:/i.test(plan.html));
  assert.ok(plan.html.includes("color: red"));
});
test("local/remote paths, malformed packages and image limits fail before import", () => {
  for (const src of [
    "file:///tmp/a.png",
    "app://vault/a.png",
    "https://example.com/a.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
  ])
    assert.throws(
      () => prepareArticle(source(`<img src="${src}">`), win),
      /没有内嵌/,
    );
  assert.throws(
    () => readArticle('{"template":1}', "json", "wechat", win),
    /不是墨稿/,
  );
  assert.throws(
    () =>
      prepareArticle(
        source(Array.from({ length: 41 }, () => `<img src="${png}">`).join("")),
        win,
      ),
    /40/,
  );
});
test("editor hosts and uploaded image CDNs are matched on boundaries", () => {
  assert.equal(platformFor("creator.xiaohongshu.com"), "xiaohongshu");
  assert.equal(platformFor("creator.xiaohongshu.com.evil.example"), undefined);
  assert.equal(
    platformImage("https://sns-img.xhscdn.com/image", "xiaohongshu"),
    true,
  );
  for (const url of [
    "data:image/png;base64,AA==",
    "blob:https://creator.xiaohongshu.com/id",
    "https://xhscdn.com.evil.example/image",
    "https://user:password@sns-img.xhscdn.com/image",
  ])
    assert.equal(platformImage(url, "xiaohongshu"), false);
});
