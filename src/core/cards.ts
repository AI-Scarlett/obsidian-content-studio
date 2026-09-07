import { setSafeHtml } from "./dom";
import { toBlob } from "html-to-image";
import type { Template } from "./types";

export interface CardDeck {
  stage: HTMLElement;
  cards: HTMLElement[];
  dispose(): void;
}
function textSlice(
  element: HTMLElement,
  from: number,
  to: number,
): HTMLElement {
  const copy = element.cloneNode(false) as HTMLElement;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (cursor + length > from && cursor < to) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, from - cursor));
      range.setEnd(node, Math.min(length, to - cursor));
      const text = range.toString();
      let frag: Node = document.createTextNode(text);
      let parent = node.parentElement;
      while (parent && parent !== element) {
        const wrap = parent.cloneNode(false);
        wrap.appendChild(frag);
        frag = wrap;
        parent = parent.parentElement;
      }
      copy.appendChild(frag);
    }
    cursor += length;
  }
  return copy;
}
function units(article: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const [index, element] of (
    Array.from(article.children) as HTMLElement[]
  ).entries()) {
    if (index === 0 && element.tagName === "H1") continue;
    if (element.matches("ul,ol")) {
      const start = Number(element.getAttribute("start") || 1);
      Array.from(element.children).forEach((child, i) => {
        const list = element.cloneNode(false) as HTMLElement;
        if (element.tagName === "OL")
          list.setAttribute("start", String(start + i));
        list.setCssStyles({ margin: "0" });
        list.append(child.cloneNode(true));
        result.push(list);
      });
    } else if (element.tagName === "TABLE") {
      const head = element.querySelector("thead");
      const rows = Array.from(element.querySelectorAll("tbody tr"));
      if (!rows.length) {
        result.push(element.cloneNode(true) as HTMLElement);
        continue;
      }
      for (const row of rows) {
        const table = element.cloneNode(false) as HTMLElement;
        table.setCssStyles({ margin: "0 0 8px" });
        if (head) table.append(head.cloneNode(true));
        const body = createEl("tbody");
        body.append(row.cloneNode(true));
        table.append(body);
        result.push(table);
      }
    } else if (element.tagName === "P" && element.querySelector("img")) {
      let p = element.cloneNode(false) as HTMLElement;
      for (const child of Array.from(element.childNodes)) {
        if (
          child.nodeType === Node.ELEMENT_NODE &&
          (child as Element).tagName === "IMG"
        ) {
          if (p.childNodes.length) result.push(p);
          const image = child.cloneNode(true) as HTMLElement;
          result.push(image);
          p = element.cloneNode(false) as HTMLElement;
        } else p.append(child.cloneNode(true));
      }
      if (p.childNodes.length) result.push(p);
    } else result.push(element.cloneNode(true) as HTMLElement);
  }
  return result;
}
export async function createCards(
  html: string,
  title: string,
  template: Template,
): Promise<CardDeck> {
  await document.fonts.ready;
  const stage = createDiv();
  stage.className = "mg-export-stage";
  document.body.append(stage);
  const cards: HTMLElement[] = [];
  try {
    const parsed = createDiv();
    setSafeHtml(parsed, html);
    const article = parsed.firstElementChild as HTMLElement;
    if (!article) throw new Error("没有可导出的正文。");
    async function settle(el: HTMLElement) {
      await Promise.all(
        Array.from(el.querySelectorAll("img")).map((img) =>
          img.decode().catch(() => {
            throw new Error("有图片无法解码，请重新读取笔记或移除该图片。");
          }),
        ),
      );
    }
    function shell(cover = false): { card: HTMLElement; body: HTMLElement } {
      const card = createEl("section");
      card.className = "mg-card";
      card.setCssProps({
        "--mg-card-paper": template.palette.paper,
        "--mg-card-ink": template.palette.ink,
        "--mg-card-font": article.style.fontFamily,
        "--mg-card-muted": template.palette.muted,
        "--mg-card-accent": template.palette.accent,
      });
      const header = createEl("header");
      header.addClass("mg-card-header");
      header.textContent = cover
        ? ""
        : title.length > 52
          ? title.slice(0, 52) + "…"
          : title;
      const body = createDiv();
      body.addClass("mg-card-body");
      body.setCssStyles({
        fontSize: article.style.fontSize,
        fontFamily: article.style.fontFamily,
        lineHeight: article.style.lineHeight,
        letterSpacing: article.style.letterSpacing,
        overflowWrap: article.style.overflowWrap,
        wordBreak: article.style.wordBreak,
      });
      const footer = createEl("footer");
      footer.className = "mg-card-page";
      card.append(header, body, footer);
      stage.append(card);
      cards.push(card);
      return { card, body };
    }
    const cover = shell(true);
    cover.body.addClass("mg-card-cover");
    const coverTitle = createEl("h1");
    coverTitle.textContent = title;
    coverTitle.addClass("mg-card-title");
    cover.body.append(coverTitle);
    const ornament = createDiv();
    ornament.addClass("mg-card-ornament");
    cover.body.append(ornament);
    for (
      let size = 64;
      cover.body.scrollHeight > cover.body.clientHeight + 1 && size >= 30;
      size -= 2
    )
      coverTitle.setCssProps({ "--mg-card-title-size": `${size - 2}px` });
    if (cover.body.scrollHeight > cover.body.clientHeight + 1)
      throw new Error("标题太长，封面放不下；请在排版稿中缩短标题。");
    let current = shell();
    const fits = () =>
      current.body.scrollHeight <= current.body.clientHeight + 1;
    for (let unit of units(article)) {
      for (const img of [
        unit,
        ...Array.from(unit.querySelectorAll("img")),
      ].filter((el) => el.tagName === "IMG")) {
        img.addClass("mg-card-image");
      }
      current.body.append(unit);
      await settle(unit);
      if (fits()) continue;
      unit.remove();
      const tail = current.body.lastElementChild;
      const carry = tail && /^H[1-6]$/.test(tail.tagName) ? tail : null;
      carry?.remove();
      if (current.body.childNodes.length) current = shell();
      if (carry) current.body.append(carry);
      current.body.append(unit);
      if (fits()) continue;
      unit.remove();
      const text = unit.textContent || "";
      if (!text || unit.querySelector("img") || unit.tagName === "TABLE")
        throw new Error(
          "有表格或图片块超过一页，请缩小图片或将表格拆成较短段落后导出。",
        );
      const boundaries = [
        0,
        ...Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            text,
          ),
          (s) => s.index + s.segment.length,
        ),
      ];
      let start = 0;
      while (start < boundaries.length - 1) {
        let lo = start + 1,
          hi = boundaries.length - 1,
          best = start;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const part = textSlice(unit, boundaries[start], boundaries[mid]);
          current.body.append(part);
          const ok = fits();
          part.remove();
          if (ok) {
            best = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        if (best === start) throw new Error("有内容无法放入卡片，请调小字号。");
        current.body.append(
          textSlice(unit, boundaries[start], boundaries[best]),
        );
        start = best;
        if (start < boundaries.length - 1) current = shell();
      }
    }
    if (!current.body.childNodes.length) {
      current.card.remove();
      cards.pop();
    }
    for (const [i, card] of cards.entries())
      card.querySelector(".mg-card-page")!.textContent =
        `${String(i + 1).padStart(2, "0")} / ${String(cards.length).padStart(2, "0")}`;
    return { stage, cards, dispose: () => stage.remove() };
  } catch (error) {
    stage.remove();
    throw error;
  }
}
export async function cardPng(card: HTMLElement): Promise<ArrayBuffer> {
  const blob = await toBlob(card, {
    pixelRatio: 1.5,
    width: 720,
    height: 960,
    skipFonts: true,
    cacheBust: false,
  });
  if (!blob) throw new Error("图文卡片生成失败。");
  return blob.arrayBuffer();
}
