import createDOMPurify from "dompurify";
import type {
  ArticleFile,
  Destination,
  ImportPlan,
  InlineImage,
} from "./types";

export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const normalizeText = (text: string) =>
  text.replace(/[\s\u200b\ufeff]/g, "");
const destinations = new Set(["wechat", "xiaohongshu", "zhihu"]);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function readArticle(
  text: string,
  kind: "json" | "html",
  platform: Destination,
  win: Window & typeof globalThis,
): ArticleFile {
  if (new TextEncoder().encode(text).byteLength > MAX_PACKAGE_BYTES)
    throw new Error("内容包超过 64 MB，请拆分文章。");
  if (kind === "html") {
    // Compatibility with 0.1.4 article.html. Parse inertly; never mount the document.
    const document = new win.DOMParser().parseFromString(text, "text/html");
    const article =
      document.querySelector("section[data-mogao], article, section") ||
      document.body;
    const heading = article.querySelector("h1");
    const title = document.title || heading?.textContent || "未命名文章";
    if (
      heading &&
      normalizeText(heading.textContent || "") === normalizeText(title)
    )
      heading.remove();
    return {
      format: "mogao-article",
      version: 1,
      title,
      platform,
      html: article === document.body ? article.innerHTML : article.outerHTML,
    };
  }
  const value: unknown = JSON.parse(text);
  if (
    !record(value) ||
    value.format !== "mogao-article" ||
    value.version !== 1 ||
    typeof value.title !== "string" ||
    typeof value.html !== "string" ||
    typeof value.platform !== "string" ||
    !destinations.has(value.platform)
  )
    throw new Error(
      "这不是墨稿整篇图文包，请选择 article-mogao.json 或旧版 article.html。",
    );
  return value as unknown as ArticleFile;
}

export function prepareArticle(
  article: ArticleFile,
  win: Window & typeof globalThis,
): ImportPlan {
  if (!article.title.trim() || article.title.length > 300)
    throw new Error("标题不能为空，且不能超过 300 字。");
  // The explicit allowlist keeps article markup, not scripts, forms or remote resources.
  const purifier = createDOMPurify(win);
  const fragment = purifier.sanitize(article.html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      "section",
      "article",
      "div",
      "p",
      "span",
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
      "a",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "hr",
      "br",
      "figure",
      "figcaption",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "sub",
      "sup",
    ],
    ALLOWED_ATTR: [
      "style",
      "href",
      "src",
      "alt",
      "title",
      "colspan",
      "rowspan",
      "start",
    ],
    ALLOW_DATA_ATTR: false,
  });
  const root = win.document.createElement("div");
  root.append(fragment);
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    // CSS network functions are not content and must never fetch remote resources.
    for (const name of Array.from(el.style)) {
      const value = el.style.getPropertyValue(name);
      if (
        /url\s*\(|image-set|expression|var\s*\(|\\|@/i.test(value) ||
        /^(?:position|z-index|behavior|content|display|visibility|opacity)$/.test(
          name,
        )
      )
        el.style.removeProperty(name);
    }
    if (
      el.tagName === "A" &&
      !/^https?:\/\//i.test(el.getAttribute("href") || "")
    )
      el.removeAttribute("href");
  }
  const sources = [...root.querySelectorAll("img")];
  if (sources.length > 40)
    throw new Error("预览版每篇最多导入 40 个图片位置，请拆分文章。");
  const images: InlineImage[] = [];
  const nonce = win.crypto.randomUUID().replaceAll("-", "");
  for (const [index, img] of sources.entries()) {
    const source = img.getAttribute("src") || "";
    const match = source.match(
      /^data:(image\/(png|jpeg|webp|gif|avif));base64,([A-Za-z\d+/]+={0,2})$/,
    );
    if (!match)
      throw new Error(
        `第 ${index + 1} 张图没有内嵌图片文件。请在墨稿里载入全部图片后重新导出。`,
      );
    let bytes: string;
    try {
      bytes = win.atob(match[3]);
    } catch {
      throw new Error(`第 ${index + 1} 张图的文件数据损坏。`);
    }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
      throw new Error(`第 ${index + 1} 张图为空或超过 8 MB。`);
    const marker = `MOGAOIMAGE${nonce}N${index}END`;
    const placeholder = win.document.createElement("span");
    placeholder.textContent = marker;
    img.replaceWith(placeholder);
    images.push({
      marker,
      name: `mogao-${String(index + 1).padStart(3, "0")}.${match[2] === "jpeg" ? "jpg" : match[2]}`,
      mime: match[1],
      base64: match[3],
    });
  }
  const text = root.textContent || "";
  let rest = text;
  const textParts: string[] = [];
  for (const image of images) {
    const index = rest.indexOf(image.marker);
    if (index < 0) throw new Error("图片位置标记生成失败。");
    textParts.push(normalizeText(rest.slice(0, index)));
    rest = rest.slice(index + image.marker.length);
  }
  textParts.push(normalizeText(rest));
  if (!normalizeText(text)) throw new Error("正文为空。");
  return {
    title: article.title,
    platform: article.platform,
    html: root.innerHTML,
    images,
    textParts,
  };
}
