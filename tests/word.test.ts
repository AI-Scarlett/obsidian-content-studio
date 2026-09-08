import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { unzipSync, strFromU8 } from "fflate";
import { installDomGlobals } from "./dom";
import { wordDocument } from "../src/core/word";
const dom = new JSDOM("<!doctype html><body></body>");
installDomGlobals(dom);
const png = "data:image/png;base64,AQID";
const read = async () => ({
  bytes: new Uint8Array([1, 2, 3]),
  type: "png" as const,
  width: 4000,
  height: 2000,
});
const ns = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
};
function open(data: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(data));
  const xml = (path: string) =>
    new dom.window.DOMParser().parseFromString(
      strFromU8(files[path]),
      "application/xml",
    );
  for (const name of Object.keys(files).filter((n) => /\.(xml|rels)$/.test(n)))
    assert.equal(xml(name).querySelector("parsererror"), null, name);
  return { files, xml, doc: xml("word/document.xml") };
}
test("Word embeds actual image parts in order, preserves repeated occurrences, styles, tables and links", async () => {
  let reads = 0;
  const data = await wordDocument(
    `<section data-mg-article style="font-size:16px;color:rgb(41,45,41)"><p>开头<strong>重点 &amp; 细节</strong></p><p><img src="${png}" alt="图一"/></p><h2>中间</h2><p><a href="https://example.com/?a=1&amp;b=2">链接</a><img src="${png}" alt="图二"/></p><ol start="4"><li>第四项<ul><li>子项目</li></ul></li><li>第五项</li></ol><table><tr><th>项目</th><th>数量</th></tr><tr><td>图片</td><td>2</td></tr></table><p>结尾</p></section>`,
    async () => {
      reads++;
      return read();
    },
  );
  const { files, doc, xml } = open(data);
  assert.equal(reads, 1);
  assert.deepEqual(files["word/media/image1.png"], new Uint8Array([1, 2, 3]));
  assert.equal(
    Object.keys(files).filter((n) => n.includes("/media/")).length,
    1,
  );
  assert.equal(doc.getElementsByTagNameNS(ns.w, "drawing").length, 2);
  assert.equal(doc.getElementsByTagNameNS(ns.w, "tbl").length, 1);
  assert.ok(doc.getElementsByTagNameNS(ns.w, "b").length > 0);
  const text = doc.documentElement.textContent!;
  assert.match(
    text,
    /开头重点 & 细节中间链接4\. 第四项• 子项目5\. 第五项项目数量图片2结尾/,
  );
  const children = [...doc.getElementsByTagNameNS(ns.w, "body")[0].children];
  assert.equal(children[0].textContent, "开头重点 & 细节");
  assert.equal(children[1].getElementsByTagNameNS(ns.w, "drawing").length, 1);
  assert.equal(children[2].textContent, "中间");
  const rels = xml("word/_rels/document.xml.rels");
  const image = [...rels.documentElement.children].find(
    (el) => el.getAttribute("Id") === "image1",
  )!;
  assert.equal(image.getAttribute("TargetMode"), null);
  assert.equal(image.getAttribute("Target"), "media/image1.png");
  assert.ok(!Object.keys(files).some((n) => n.includes("altChunk")));
  const ext = doc.getElementsByTagNameNS(ns.a, "ext")[0];
  assert.equal(Number(ext.getAttribute("cx")), 600 * 9525);
  assert.equal(Number(ext.getAttribute("cy")), 300 * 9525);
});
test("Word blocks unembedded images and preserves literal text without active XML", async () => {
  await assert.rejects(
    wordDocument(
      '<section><img src="https://example.com/a.png"></section>',
      read,
    ),
    /未载入/,
  );
  const { doc } = open(
    await wordDocument(
      '<section><p>&lt;tag&gt; 中文 😃</p><script>alert(1)</script><a href="javascript:alert(1)">文字</a></section>',
      read,
    ),
  );
  assert.match(doc.documentElement.textContent!, /<tag> 中文 😃文字/);
  assert.equal(doc.getElementsByTagNameNS(ns.w, "hyperlink").length, 0);
});

test("relative font sizes remain readable and dark templates use visible ink on Word white pages", async () => {
  const { doc, xml } = open(
    await wordDocument(
      '<section data-mg-article style="font-size:16px;color:#ffffff"><p style="font-size:0.88em;color:rgb(255,255,255)">参考链接 https://example.com/</p></section>',
      read,
    ),
  );
  assert.equal(
    doc.getElementsByTagNameNS(ns.w, "sz")[0].getAttribute("w:val"),
    "21",
  );
  assert.equal(
    doc.getElementsByTagNameNS(ns.w, "color")[0].getAttribute("w:val"),
    "292D29",
  );
  assert.equal(
    xml("word/styles.xml")
      .getElementsByTagNameNS(ns.w, "color")[0]
      .getAttribute("w:val"),
    "292D29",
  );
});
