import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { WechatSession, wechatProbe } from "../src/platforms/wechat";
import { prepareArticle } from "../src/package";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
function fixture(
  options: {
    uncertain?: boolean;
    uploadFail?: boolean;
    noTicket?: boolean;
  } = {},
) {
  const dom = new JSDOM("", {
    url: "https://mp.weixin.qq.com/cgi-bin/home?token=123",
  });
  const win = dom.window as any;
  win.AbortSignal = AbortSignal;
  const descriptor = Object.getOwnPropertyDescriptor(
    win.HTMLImageElement.prototype,
    "src",
  )!;
  Object.defineProperty(win.HTMLImageElement.prototype, "src", {
    get: descriptor.get,
    set(value) {
      descriptor.set!.call(this, value);
      win.queueMicrotask(() => this.onload?.(new win.Event("load")));
    },
  });
  Object.defineProperty(win.HTMLImageElement.prototype, "naturalWidth", {
    get: () => 750,
  });
  const requests: { url: URL; init: RequestInit }[] = [];
  let uploads = 0;
  win.fetch = async (raw: string, init: RequestInit) => {
    const url = new URL(raw);
    requests.push({ url, init });
    if (url.pathname === "/")
      return new Response(
        `window.wx.commonData = {t:'123',ticket:'${options.noTicket ? "" : "test-ticket"}',user_name:'test-user'};`,
      );
    if (url.pathname === "/cgi-bin/filetransfer") {
      uploads++;
      const form = init.body as FormData;
      assert.equal(url.searchParams.get("action"), "upload_material");
      assert.ok((form.get("file") as File).size > 50);
      return Response.json(
        options.uploadFail
          ? { base_resp: { err_msg: "denied" } }
          : {
              base_resp: { err_msg: "ok" },
              cdn_url: `https://mmbiz.qpic.cn/image-${uploads}`,
              content: String(uploads),
            },
      );
    }
    if (url.pathname === "/cgi-bin/operate_appmsg") {
      assert.equal(url.searchParams.get("sub"), "create");
      assert.equal(url.searchParams.get("type"), "77");
      if (options.uncertain)
        throw new Error("connection reset after server accepted");
      return Response.json({ appMsgId: "7654321" });
    }
    throw new Error("Unexpected endpoint");
  };
  const plan = prepareArticle(
    {
      format: "mogao-article",
      version: 1,
      platform: "wechat",
      title: "公众号测试标题",
      html: `<section style="color: red"><p>开头</p><img alt="图一" style="width: 100%" src="${png}"><p>中间</p><img src="${png}"><p>结尾</p></section>`,
    },
    win,
  );
  const session = new WechatSession(win.document);
  return { dom, win, requests, plan, session };
}
test("WeChat uploads actual files then creates one styled draft and returns the exact editor link", async () => {
  const f = fixture();
  try {
    const { images, ...body } = f.plan;
    assert.equal(
      wechatProbe(f.win.document)?.editor,
      "wechat-material-draft-api",
    );
    await f.session.begin(
      body,
      images.map((i) => i.marker),
    );
    for (const image of images) await f.session.image(image);
    const result = await f.session.finish();
    const link = new URL(result.navigate);
    assert.equal(link.pathname, "/cgi-bin/appmsg");
    assert.equal(link.searchParams.get("appmsgid"), "7654321");
    assert.equal(link.searchParams.get("action"), "edit");
    const create = f.requests.filter(
      (r) => r.url.pathname === "/cgi-bin/operate_appmsg",
    );
    assert.equal(create.length, 1);
    const form = create[0].init.body as FormData;
    assert.equal(form.get("title0"), "公众号测试标题");
    const html = String(form.get("content0"));
    assert.ok(!/data:image|MOGAOIMAGE/.test(html));
    const parsed = new f.win.DOMParser().parseFromString(html, "text/html");
    assert.deepEqual(
      [...parsed.images].map((img: any) => img.src),
      ["https://mmbiz.qpic.cn/image-1", "https://mmbiz.qpic.cn/image-2"],
    );
    assert.equal(parsed.body.textContent, "开头中间结尾");
    assert.equal(parsed.querySelector("section").style.color, "red");
    assert.equal(parsed.images[0].getAttribute("alt"), "图一");
    assert.equal(parsed.images[0].style.width, "100%");
    assert.ok(
      f.requests.every((r) => !/publish|masssend|sendall/.test(r.url.href)),
    );
    await assert.rejects(f.session.finish(), /避免重复/);
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});
test("uncertain WeChat draft creation is never retried automatically", async () => {
  const f = fixture({ uncertain: true });
  try {
    const { images, ...body } = f.plan;
    await f.session.begin(
      body,
      images.map((i) => i.marker),
    );
    for (const image of images) await f.session.image(image);
    await assert.rejects(f.session.finish(), /结果未能确认/);
    await assert.rejects(f.session.finish(), /避免重复/);
    assert.equal(
      f.requests.filter((r) => r.url.pathname === "/cgi-bin/operate_appmsg")
        .length,
      1,
    );
  } finally {
    f.session.cancel();
    f.dom.window.close();
  }
});
test("failed upload and missing login metadata never create a WeChat draft", async () => {
  for (const options of [{ uploadFail: true }, { noTicket: true }]) {
    const f = fixture(options);
    try {
      const { images, ...body } = f.plan;
      if (options.noTicket)
        await assert.rejects(
          f.session.begin(
            body,
            images.map((i) => i.marker),
          ),
          /会话/,
        );
      else {
        await f.session.begin(
          body,
          images.map((i) => i.marker),
        );
        await assert.rejects(f.session.image(images[0]), /上传失败/);
      }
      assert.ok(
        !f.requests.some((r) => r.url.pathname === "/cgi-bin/operate_appmsg"),
      );
    } finally {
      f.session.cancel();
      f.dom.window.close();
    }
  }
});
