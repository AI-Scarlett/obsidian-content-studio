import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { installDomGlobals } from "./dom";
import { setSafeHtml } from "../src/core/dom";
import { createCards } from "../src/core/cards";
import { BUILTIN_TEMPLATES } from "../src/core/templates";
import { resolvePublicAddresses } from "../src/core/network";
import { setRequestHandler } from "./obsidian-api.mjs";
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
installDomGlobals(dom);

test("DOM fragment insertion rejects active content while preserving rich text and controls", () => {
  const root = document.createElement("div");
  setSafeHtml(
    root,
    '<section data-mg-article style="color:#123456"><p>正文<strong>重点</strong></p><script>alert(1)</script><img src="data:image/png;base64,AQID" onerror="alert(1)"><a href="javascript:alert(1)">链接</a><iframe src="https://example.com"></iframe><button data-action="copy">复制正文</button><input type="file" hidden></section>',
  );
  assert.equal(
    root.querySelectorAll('script,iframe,[onerror],a[href^="javascript:"]')
      .length,
    0,
  );
  assert.equal(root.querySelector("section")!.style.color, "rgb(18, 52, 86)");
  assert.equal(
    root.querySelector('[data-action="copy"]')!.textContent,
    "复制正文",
  );
  assert.equal(root.querySelector("img")!.src, "data:image/png;base64,AQID");
  assert.equal(root.querySelector("input")!.hidden, true);
});
test("card layout retains fixed export geometry and sanitizes its HTML input", async () => {
  const styles = document.createElement("style");
  styles.textContent = readFileSync("styles.css", "utf8");
  document.head.append(styles);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const deck = await createCards(
    '<section style="font-size:28px;line-height:1.85;font-family:serif"><h1>完整标题</h1><p onclick="alert(1)">正文<script>alert(1)</script></p></section>',
    "完整标题",
    BUILTIN_TEMPLATES[0],
  );
  try {
    assert.equal(deck.cards.length, 2);
    for (const card of deck.cards) {
      const computed = dom.window.getComputedStyle(card);
      assert.equal(computed.width, "720px");
      assert.equal(computed.height, "960px");
      assert.equal(computed.display, "flex");
      assert.equal(card.querySelectorAll("script,[onclick]").length, 0);
    }
    const stage = dom.window.getComputedStyle(deck.stage);
    assert.equal(stage.position, "fixed");
    assert.equal(stage.left, "-10000px");
    assert.equal(
      deck.cards[0].querySelector(".mg-card-title")!.textContent,
      "完整标题",
    );
    assert.equal(
      deck.cards[1].querySelector(".mg-card-body")!.textContent,
      "正文",
    );
  } finally {
    deck.dispose();
    styles.remove();
  }
  assert.equal(document.querySelector(".mg-export-stage"), null);
});
test("fake-IP DNS fallback uses the Obsidian requestUrl boundary without note content", async () => {
  let called = 0;
  setRequestHandler(
    async (options: {
      url: string;
      headers: Record<string, string>;
      throw: boolean;
    }) => {
      called++;
      const url = new URL(options.url);
      assert.equal(url.origin, "https://cloudflare-dns.com");
      assert.equal(url.searchParams.get("name"), "images.example.com");
      assert.deepEqual([...url.searchParams.keys()], ["name", "type"]);
      return {
        status: 200,
        text: JSON.stringify({ Answer: [{ type: 1, data: "93.184.216.34" }] }),
      };
    },
  );
  try {
    const result = await resolvePublicAddresses(
      "images.example.com",
      async () => [{ address: "198.18.0.1", family: 4 }],
    );
    assert.equal(called, 1);
    assert.deepEqual(result, [{ address: "93.184.216.34", family: 4 }]);
  } finally {
    setRequestHandler(undefined);
  }
});
