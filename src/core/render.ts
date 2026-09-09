import { setSafeHtml } from "./dom";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import twitter from "twitter-text";
import type { Draft, RenderOptions, Rendered, Styles } from "./types";
import { safeColor } from "./templates";
import { isEmbeddedImage } from "./images";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });
export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const styleText = (s: Styles): string =>
  Object.entries(s)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
export function draftFromNote(raw: string, path: string): Draft {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  let body = match ? normalized.slice(match[0].length) : normalized;
  const frontTitle = match?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const h1 = body.match(/^\s*# (.+)\n?/);
  const title =
    frontTitle ||
    h1?.[1] ||
    path.split("/").pop()?.replace(/\.md$/i, "") ||
    "未命名笔记";
  if (h1 && (!frontTitle || h1[1] === frontTitle))
    body = body.slice(h1[0].length);
  return { title, markdown: body.trim(), sourcePath: path };
}
export function normalizeWikiLinks(text: string): string {
  return text
    .replace(/!\[\[([^\]]+)\]\]/g, (_all, ref: string) => {
      const [path, alias] = ref.split("|");
      return `![${(alias && !/^\d+(x\d+)?$/.test(alias) ? alias : path.split("/").pop() || "图片").replace(/[[\]]/g, "")}](<${path.replace(/[<>\n]/g, "")}>)`;
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_all, ref: string) => {
      const [path, alias] = ref.split("|");
      return (alias || path.split("/").pop() || path).replace(/[<>]/g, "");
    });
}
export function imageSources(draft: Draft): string[] {
  const sources = new Set<string>();
  for (const token of markdown.parse(normalizeWikiLinks(draft.markdown), {}))
    for (const child of token.children || [])
      if (child.type === "image")
        sources.add(String(child.attrGet("src") || ""));
  return [...sources].filter(Boolean);
}
export function renderDraft(
  draft: Draft,
  options: RenderOptions,
  assets: Record<string, string> = {},
): Rendered {
  const t = options.template,
    accent = safeColor(options.accent) || t.palette.accent;
  const size = options.forCards ? options.fontSize * 1.75 : options.fontSize;
  const ink = t.palette.ink,
    muted = t.palette.muted;
  const font =
    t.fontFamily === "serif"
      ? "'Noto Serif SC','Songti SC',STSong,Georgia,serif"
      : "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif";
  const shared: Styles = {
    color: ink,
    "font-family": font,
    "font-size": `${size}px`,
    "line-height": String(t.lineHeight),
    "letter-spacing": "0.02em",
    "overflow-wrap": "anywhere",
    "word-break": "normal",
  };
  const heading: Styles = {
    "font-size": `${size * 1.25}px`,
    "font-weight": "700",
    "line-height": "1.5",
    margin: "28px 0 14px",
    color: accent,
  };
  if (t.heading === "line")
    Object.assign(heading, {
      "border-left": `3px solid ${accent}`,
      "padding-left": "12px",
    });
  if (t.heading === "block")
    Object.assign(heading, {
      "background-color": t.palette.soft,
      padding: "10px 14px",
      "border-radius": `${t.radius}px`,
    });
  if (t.heading === "underline")
    Object.assign(heading, {
      "border-bottom": `1px solid ${accent}`,
      "padding-bottom": "10px",
    });
  const roles: Record<string, Styles> = {
    h1: {
      "font-size": `${size * 1.8}px`,
      "line-height": "1.35",
      "font-weight": "750",
      margin: "0 0 28px",
      "letter-spacing": "-0.03em",
      color: ink,
    },
    h2: heading,
    h3: {
      "font-size": `${size * 1.08}px`,
      "font-weight": "700",
      "line-height": "1.5",
      margin: "22px 0 12px",
      color: accent,
    },
    h4: {
      "font-size": `${size}px`,
      "font-weight": "700",
      margin: "18px 0 10px",
    },
    p: { margin: "0 0 18px", "line-height": String(t.lineHeight) },
    blockquote: {
      margin: "20px 0",
      padding: "14px 18px",
      color: muted,
      "background-color": t.palette.soft,
      "border-left": `3px solid ${accent}`,
      "border-radius": `${t.radius}px`,
    },
    strong: { "font-weight": "700", color: accent },
    a: {
      color: accent,
      "text-decoration": "underline",
      "word-break": "break-all",
    },
    code: {
      "font-family": "ui-monospace,SFMono-Regular,Menlo,monospace",
      "font-size": "0.88em",
      "background-color": t.palette.soft,
      padding: "2px 5px",
      "border-radius": "3px",
    },
    pre: {
      padding: "16px",
      "background-color": t.palette.soft,
      "border-radius": "6px",
      "white-space": "pre-wrap",
      "overflow-wrap": "anywhere",
      margin: "20px 0",
    },
    li: { margin: "7px 0", "line-height": String(t.lineHeight) },
    ul: { "padding-left": "1.5em", margin: "16px 0" },
    ol: { "padding-left": "1.5em", margin: "16px 0" },
    hr: { border: "0", "border-top": `1px solid ${accent}`, margin: "28px 0" },
    img: {
      display: "block",
      "max-width": "100%",
      height: "auto",
      margin: "18px auto",
      "border-radius": `${t.radius}px`,
    },
    table: {
      "border-collapse": "collapse",
      width: "100%",
      margin: "20px 0",
      "font-size": "0.9em",
      "table-layout": "fixed",
    },
    th: {
      "background-color": t.palette.soft,
      padding: "10px",
      border: `1px solid ${muted}`,
      "text-align": "left",
    },
    td: {
      padding: "10px",
      border: `1px solid ${muted}`,
      "overflow-wrap": "anywhere",
    },
    figcaption: {
      "font-size": "0.8em",
      color: muted,
      "text-align": "center",
      margin: "8px 0 20px",
    },
  };
  if (t.styleMode === "reference") {
    // Reference templates start from plain semantic defaults. Merging sampled
    // styles onto a built-in theme used to invent green bars and tinted boxes.
    Object.assign(shared, {
      "font-family": t.roles?.p?.["font-family"] || font,
      "letter-spacing": t.roles?.p?.["letter-spacing"] || "normal",
      "text-align": t.roles?.p?.["text-align"] || "left",
    });
    for (const role of [
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "blockquote",
      "strong",
      "em",
      "a",
      "code",
      "pre",
      "li",
      "hr",
      "figcaption",
    ]) {
      const previous = Object.fromEntries(
        Object.entries(roles[role] || {}).filter(
          ([key]) => !/^(border|padding|background)/.test(key),
        ),
      );
      roles[role] = {
        border: "0",
        "border-radius": "0",
        "background-color": "transparent",
        padding: "0",
        ...previous,
        color: ink,
      };
      if (/^h[1-4]$/.test(role) || role === "blockquote") {
        roles[role]["line-height"] = "normal";
        roles[role]["letter-spacing"] = "normal";
      }
    }
    roles.strong["font-weight"] = "700";
    roles.em["font-style"] = "italic";
    roles.p = { margin: `0 0 ${size}px`, "line-height": String(t.lineHeight) };
    roles.a["text-decoration"] = "underline";
    roles.blockquote.margin = "1em 40px";
  }
  for (const [role, styles] of Object.entries(t.roles || {})) {
    const adjusted = { ...styles };
    // The user's typography controls take precedence over sampled paragraph sizes.
    if (role === "p" || role === "li") {
      delete adjusted["font-size"];
      delete adjusted["font-family"];
    }
    for (const key of Object.keys(adjusted))
      adjusted[key] = adjusted[key].split(t.palette.accent).join(accent);
    if (
      (t.styleMode === "reference"
        ? options.forCards
        : options.platform === "xiaohongshu") &&
      adjusted["font-size"]?.endsWith("px")
    )
      adjusted["font-size"] =
        `${Number.parseFloat(adjusted["font-size"]) * 1.75}px`;
    roles[role] = { ...roles[role], ...adjusted };
  }
  const purifier = createDOMPurify(window);
  const raw = markdown.render(normalizeWikiLinks(draft.markdown));
  const clean = purifier.sanitize(raw, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "strong",
      "em",
      "s",
      "del",
      "blockquote",
      "ul",
      "ol",
      "li",
      "pre",
      "code",
      "a",
      "img",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "sup",
      "sub",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "start"],
    ALLOW_DATA_ATTR: false,
  });
  const article = createEl("section");
  Object.assign(shared, {
    "background-color": t.palette.paper,
    padding: "28px 30px",
    "max-width": "720px",
    "box-sizing": "border-box",
    margin: "0 auto",
  });
  if (t.styleMode === "reference") {
    Object.assign(shared, { padding: "0" }, t.roles?.article);
    // Font controls still resize the user's draft; the reference supplies its
    // family, spacing and decoration rather than a fixed body font size.
    shared["font-size"] = `${size}px`;
  }
  article.setCssProps(shared);
  article.setAttribute("data-mg-article", "true");
  setSafeHtml(
    article,
    `${options.includeTitle === false ? "" : `<h1>${escapeHtml(draft.title)}</h1>`}${clean}`,
  );
  const warnings: string[] = [];
  for (const el of article.querySelectorAll<HTMLElement>("*")) {
    const role = el.tagName.toLowerCase();
    if (roles[role]) el.setCssProps(roles[role]);
  }
  if (t.styleMode === "reference") {
    article.querySelectorAll<HTMLElement>("blockquote p").forEach((el) =>
        el.setCssStyles({
          color: "inherit",
          fontSize: "inherit",
          fontFamily: "inherit",
          lineHeight: "inherit",
          textAlign: "inherit",
          textIndent: "0",
        margin: "0",
      }),
    );
    article
      .querySelectorAll<HTMLElement>("h1 strong,h2 strong,h3 strong,h4 strong")
      .forEach((el) =>
        el.setCssStyles({
          color: "inherit",
          fontSize: "inherit",
          fontFamily: "inherit",
          lineHeight: "inherit",
          backgroundColor: "transparent",
        }),
      );
  }
  article.querySelectorAll<HTMLElement>("pre code").forEach((el) => {
    el.setCssStyles({
      fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
      fontSize: "0.88em",
      whiteSpace: "pre-wrap",
      background: "transparent",
      padding: "0",
    });
  });
  for (const img of article.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (!options.imagePlaceholders && isEmbeddedImage(assets[src]))
      img.src = assets[src];
    else {
      const p = createEl("p");
      p.textContent = options.imagePlaceholders
        ? `〔图片占位：${img.alt || "图片"}〕`
        : `〔图片：${img.alt || src}〕`;
      p.setAttribute(
        "style",
        `padding:16px;border:1px dashed ${muted};color:${muted};font-size:0.85em`,
      );
      img.replaceWith(p);
      if (!options.imagePlaceholders)
        warnings.push(`图片未嵌入：${img.alt || src}`);
    }
  }
  const references = new Map<string, number>();
  for (const link of article.querySelectorAll("a")) {
    const href = link.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
      link.replaceWith(document.createTextNode(link.textContent || href));
      continue;
    }
    if (options.footnotes && options.platform === "wechat") {
      if (!references.has(href)) references.set(href, references.size + 1);
      const sup = createEl("sup");
      sup.textContent = `[${references.get(href)}]`;
      sup.setAttribute("style", `font-size:0.7em;color:${accent}`);
      link.after(sup);
    }
  }
  if (references.size) {
    const h = createEl("h3");
    h.textContent = "参考链接";
    h.setAttribute("style", styleText(roles.h3));
    article.append(h);
    for (const [href, n] of references) {
      const p = createEl("p");
      p.textContent = `[${n}] ${href}`;
      p.setAttribute(
        "style",
        `font-size:0.8em;color:${muted};word-break:break-all;margin:8px 0`,
      );
      article.append(p);
    }
  }
  // Text exporters preserve all paragraphs, links, images' captions, and code.
  const plain = article.cloneNode(true) as HTMLElement;
  plain.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && !a.textContent?.includes(href)) a.append(` (${href})`);
  });
  plain
    .querySelectorAll("img")
    .forEach((img) =>
      img.replaceWith(document.createTextNode(`〔图片：${img.alt}〕`)),
    );
  plain
    .querySelectorAll("br")
    .forEach((br) => br.replaceWith(document.createTextNode("\n")));
  plain
    .querySelectorAll("p,h1,h2,h3,h4,blockquote,pre,ul,ol,table")
    .forEach((el) => el.append(document.createTextNode("\n\n")));
  plain.querySelectorAll("li").forEach((el) => {
    el.prepend(document.createTextNode("• "));
    el.append(document.createTextNode("\n"));
  });
  plain
    .querySelectorAll("tr")
    .forEach((el) => el.append(document.createTextNode("\n")));
  plain
    .querySelectorAll("td,th")
    .forEach((el) => el.append(document.createTextNode(" | ")));
  const plainText = (plain.textContent || "")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    html: article.outerHTML,
    plainText,
    markdown: `${options.includeTitle === false ? "" : `# ${draft.title}\n\n`}${normalizeWikiLinks(draft.markdown)}`,
    warnings: [...new Set(warnings)],
  };
}
export const weightedLength = (text: string): number =>
  twitter.parseTweet(text).weightedLength;
const graphemes = (text: string): string[] =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );
export function splitThread(text: string, limit = 280): string[] {
  if (limit < 30) throw new Error("串文上限至少为 30。");
  if (!text.trim()) return [];
  const parts: string[] = [];
  const urls = twitter.extractUrlsWithIndices(text);
  const tokens: string[] = [];
  let cursor = 0;
  for (const u of urls) {
    tokens.push(...graphemes(text.slice(cursor, u.indices[0])), u.url);
    cursor = u.indices[1];
  }
  tokens.push(...graphemes(text.slice(cursor)));
  let current = "";
  for (const token of tokens) {
    if (weightedLength(current + token) > limit) {
      if (!current) throw new Error("某个不可拆分字符或链接超过串文上限。");
      let boundary = 0;
      const protectedUrls = twitter.extractUrlsWithIndices(current);
      for (const match of current.matchAll(/[。！？!?；;\n]|\s+/g)) {
        const end = match.index + match[0].length;
        if (protectedUrls.some((u) => end > u.indices[0] && end < u.indices[1]))
          continue;
        if (weightedLength(current.slice(0, end)) >= limit * 0.6)
          boundary = end;
      }
      if (!boundary) boundary = current.length;
      parts.push(current.slice(0, boundary));
      current = current.slice(boundary) + token;
    } else current += token;
  }
  if (current) parts.push(current);
  // No numbering is inserted into the payload, so joining reproduces the input exactly.
  return parts;
}
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f5f4f0">${body}</body></html>`;
}
