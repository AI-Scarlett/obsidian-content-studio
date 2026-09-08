import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  handoffUrl,
  handoffPageUrl,
  publishUrl,
  destinations,
} from "../src/handoff";
import { prepareDestination } from "../src/navigation";
const id = "a".repeat(64);
test("handoff accepts only an exact loopback article capability, including different vault ports", () => {
  for (const port of [39276, 52341])
    assert.ok(handoffUrl(`http://127.0.0.1:${port}/publish/${id}`));
  for (const raw of [
    `https://127.0.0.1:39276/publish/${id}`,
    `http://evil.example:39276/publish/${id}`,
    `http://127.0.0.1:39276/publish/${id}?url=evil`,
    `http://127.0.0.1:39276/publish/${id}#evil`,
    `http://u@127.0.0.1:39276/publish/${id}`,
    `http://127.0.0.1:39276/v1/jobs/${id}`,
  ])
    assert.equal(handoffUrl(raw), undefined);
});
test("recovery URLs resume exactly the same capability while rejecting other localhost paths", () => {
  const raw = `http://127.0.0.1:52341/install/publish/${id}`;
  assert.equal(handoffUrl(raw), undefined);
  assert.equal(
    publishUrl(handoffPageUrl(raw)!).href,
    raw.replace("/install", ""),
  );
  for (const value of [
    raw + "?next=evil",
    raw + "#evil",
    raw.replace("127.0.0.1", "evil.example"),
    raw.replace("/install/publish/", "/install/"),
    raw.replace("/install/publish/", "/v1/jobs/"),
  ])
    assert.equal(handoffPageUrl(value), undefined);
});
function page(body: string, url: string) {
  const dom = new JSDOM(body, { url });
  dom.window.HTMLElement.prototype.getClientRects = () =>
    [{ width: 100 }] as any;
  return dom;
}
test("Xiaohongshu creates a new long-form draft once, never clicks publish or login", () => {
  const dom = page(
    "<button><span>新的创作</span></button><button>发布</button><button>登录</button>",
    destinations.xiaohongshu,
  );
  const clicks: string[] = [];
  dom.window.document.addEventListener("click", (event) =>
    clicks.push((event.target as HTMLElement).textContent!),
  );
  prepareDestination(dom.window.document, "xiaohongshu");
  prepareDestination(dom.window.document, "xiaohongshu");
  assert.deepEqual(clicks, ["新的创作"]);
  dom.window.close();
});
test("WeChat uses only the visible new-article link, excluding draft IDs and publish links", () => {
  const dom = page(
    '<a href="/cgi-bin/appmsg?action=edit&appmsgid=old">图文消息</a><a href="/cgi-bin/appmsg?action=publish">发布</a><a href="/cgi-bin/appmsg?action=edit">图文消息</a>',
    destinations.wechat,
  );
  assert.equal(
    prepareDestination(dom.window.document, "wechat").navigate,
    "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit",
  );
  dom.window.document.querySelectorAll("a")[2].remove();
  assert.equal(
    prepareDestination(dom.window.document, "wechat").navigate,
    undefined,
  );
  dom.window.close();
});
test("existing editor content is reported and never changed by preparation", () => {
  const dom = page(
    '<textarea placeholder="输入标题">已有文章</textarea><div class="tiptap ProseMirror" contenteditable="true"><p>正文</p></div>',
    destinations.xiaohongshu,
  );
  const before = dom.window.document.body.innerHTML;
  const prep = prepareDestination(dom.window.document, "xiaohongshu");
  assert.equal(prep.probe?.empty, false);
  assert.equal(prep.probe?.titleEmpty, false);
  assert.equal(dom.window.document.body.innerHTML, before);
  dom.window.close();
});
