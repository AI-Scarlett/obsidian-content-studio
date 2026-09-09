import { Parser } from "htmlparser2";

export const STYLE_SOURCE_LIMIT = 20 * 1024 * 1024;
const CONTENT_LIMIT = 3 * 1024 * 1024;
const SHEET_LIMIT = 300_000;
const dropped = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "noscript",
  "svg",
  "form",
  "nav",
  "footer",
  "video",
  "audio",
  "template",
]);
const kept = new Set([
  "html",
  "head",
  "body",
  "title",
  "link",
  "article",
  "main",
  "section",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "a",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "hr",
  "br",
  "img",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "sup",
  "sub",
  "small",
  "font",
]);
const voidTags = new Set(["link", "hr", "br", "img"]);
const escape = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );

/** Streaming reduction for style learning only; its output is never inserted into live UI. */
export class StyleSource {
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private readonly output: string[] = [];
  private readonly frames: { name: string; skip: boolean; emit: boolean }[] =
    [];
  private inputBytes = 0;
  private outputBytes = 0;
  private elements = 0;
  private sheet: string[] = [];
  private sheetBytes = 0;
  private totalSheetBytes = 0;
  private readonly parser = new Parser({
    onopentag: (name, attrs) => {
      if (++this.elements > 30_000 || this.frames.length >= 128)
        throw new Error("页面结构过于复杂，请粘贴正文区域 HTML 学习样式。");
      const skip = (this.frames.at(-1)?.skip ?? false) || dropped.has(name);
      const emit = !skip && kept.has(name);
      this.frames.push({ name, skip, emit });
      if (skip) return;
      if (name === "style") {
        this.sheet = [];
        this.sheetBytes = 0;
      }
      if (!emit) return;
      const attributes = Object.entries(attrs).filter(
        ([key, value]) =>
          value.length <= 16_000 &&
          (["id", "class", "style", "role"].includes(key) ||
            (name === "link" &&
              ["href", "rel"].includes(key) &&
              !/^\s*(?:data|javascript):/i.test(value))),
      );
      // No src/srcset/data-src, inline image bytes, event handlers or page metadata.
      this.append(
        `<${name}${attributes.map(([key, value]) => ` ${key}="${escape(value)}"`).join("")}>`,
      );
    },
    ontext: (text) => {
      const frame = this.frames.at(-1);
      if (frame?.skip) return;
      if (frame?.name === "style") {
        this.sheetBytes += this.encoder.encode(text).length;
        if (this.sheetBytes <= SHEET_LIMIT) this.sheet.push(text);
        else this.sheet = [];
      } else this.append(escape(text));
    },
    onclosetag: () => {
      const frame = this.frames.pop();
      if (!frame || frame.skip) return;
      if (
        frame.name === "style" &&
        this.sheetBytes <= SHEET_LIMIT &&
        this.totalSheetBytes + this.sheetBytes <= 500_000
      ) {
        this.append(`<style>${this.sheet.join("")}</style>`);
        this.totalSheetBytes += this.sheetBytes;
        this.sheet = [];
      }
      if (frame.emit && !voidTags.has(frame.name))
        this.append(`</${frame.name}>`);
    },
  });

  private append(text: string) {
    this.outputBytes += this.encoder.encode(text).length;
    if (this.outputBytes > CONTENT_LIMIT)
      throw new Error(
        "已跳过脚本和图片，正文与样式仍超过 3 MB。请粘贴正文区域 HTML。",
      );
    this.output.push(text);
  }

  write(bytes: Uint8Array) {
    this.inputBytes += bytes.byteLength;
    if (this.inputBytes > STYLE_SOURCE_LIMIT)
      throw new Error(
        "页面数据超过 20 MB，已停止读取。请粘贴正文区域 HTML；图片无需复制。",
      );
    this.parser.write(this.decoder.decode(bytes, { stream: true }));
  }

  finish(): string {
    this.parser.end(this.decoder.decode());
    return this.output.join("");
  }
}

export function compactStyleHtml(html: string): string {
  const source = new StyleSource();
  const encoder = new TextEncoder();
  // Keep pasted HTML on the same bounded path, without a second full-size byte buffer.
  for (let offset = 0; offset < html.length;) {
    let end = Math.min(offset + 16_384, html.length);
    const code = html.charCodeAt(end - 1);
    if (end < html.length && code >= 0xd800 && code <= 0xdbff) end--;
    source.write(encoder.encode(html.slice(offset, end)));
    offset = end;
  }
  return source.finish();
}
