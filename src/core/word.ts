import { strToU8, zipSync } from "fflate";
import { setSafeHtml } from "./dom";
import { isEmbeddedImage } from "./images";

export interface WordImage {
  bytes: Uint8Array;
  type: "png" | "jpeg";
  width: number;
  height: number;
}
export type WordImageReader = (src: string) => Promise<WordImage>;

// Word import requires real embedded media, not HTML data URLs or altChunk HTML.
export async function readWordImage(src: string): Promise<WordImage> {
  if (!isEmbeddedImage(src)) throw new Error("Word 导出需要先载入全部图片。");
  const img = createEl("img");
  img.src = src;
  await img.decode();
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error("图片尺寸无效。");
  // Bound document size; rasterize unsupported Word formats and freeze GIFs.
  const scale = Math.min(
    1,
    2000 / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  let data = src;
  if (scale < 1 || !/^data:image\/(png|jpeg);/i.test(src)) {
    const canvas = createEl("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法转换文档图片。");
    context.drawImage(img, 0, 0, width, height);
    data = canvas.toDataURL("image/png");
  }
  return {
    bytes: Uint8Array.from(atob(data.split(",")[1]), (char) =>
      char.charCodeAt(0),
    ),
    type: data.startsWith("data:image/jpeg;") ? "jpeg" : "png",
    width,
    height,
  };
}
function xml(value: string): string {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0)!;
    return code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
      ? char
      : "";
  })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function color(raw: string): string | undefined {
  const rgb = raw.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
  const hex = /^#[0-9a-f]{6}$/i.test(raw)
    ? raw.slice(1)
    : rgb
      ? rgb
          .slice(1)
          .map((c) => Number(c).toString(16).padStart(2, "0"))
          .join("")
      : undefined;
  if (!hex) return undefined;
  // Word imports use a white page. Keep light-on-dark templates readable there.
  const channels = [0, 2, 4].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  return channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114 > 190
    ? "292D29"
    : hex;
}
function pixelSize(raw: string, inherited: number): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return inherited;
  if (raw.endsWith("rem")) return value * 16;
  if (raw.endsWith("em")) return value * inherited;
  if (raw.endsWith("%")) return (value * inherited) / 100;
  return value;
}
const relBase =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

/** Native OOXML keeps each picture at its original position between runs/paragraphs. */
export async function wordDocument(
  html: string,
  readImage: WordImageReader = readWordImage,
): Promise<ArrayBuffer> {
  const parsed = createDiv();
  setSafeHtml(parsed, html);
  const article =
    parsed.querySelector<HTMLElement>("[data-mg-article]") || parsed;
  const files: Record<string, Uint8Array> = {};
  const relations: string[] = [];
  const pictures = new Map<
    string,
    { id: string; width: number; height: number }
  >();
  for (const img of Array.from(article.querySelectorAll("img"))) {
    const src = img.getAttribute("src") || "";
    if (pictures.has(src)) continue;
    if (!isEmbeddedImage(src))
      throw new Error("仍有图片未载入，已暂停 Word 导出。");
    const image = await readImage(src);
    if (!image.bytes.length || image.width <= 0 || image.height <= 0)
      throw new Error("图片数据无效。");
    const id = `image${pictures.size + 1}`;
    const name = `${id}.${image.type === "jpeg" ? "jpg" : "png"}`;
    files[`word/media/${name}`] = image.bytes;
    relations.push(
      `<Relationship Id="${id}" Type="${relBase}image" Target="media/${name}"/>`,
    );
    pictures.set(src, { id, width: image.width, height: image.height });
  }
  const bodySize = pixelSize(article.style.fontSize, 16);
  let imageIndex = 0;
  function imageRun(el: HTMLElement): string {
    const image = pictures.get(el.getAttribute("src") || "");
    if (!image) throw new Error("文档图片未找到。");
    const ratio = Math.min(1, 600 / image.width, 850 / image.height);
    const cx = Math.round(image.width * ratio * 9525);
    const cy = Math.round(image.height * ratio * 9525);
    const id = ++imageIndex;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}" descr="${xml(el.getAttribute("alt") || "")}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  function runs(node: Node, inherited = "", inheritedSize = bodySize): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "")
        .split("\n")
        .map(
          (line, i) =>
            `${i ? "<w:r><w:br/></w:r>" : ""}<w:r><w:rPr>${inherited}</w:rPr><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`,
        )
        .join("");
    }
    if (!node.instanceOf(HTMLElement)) return "";
    if (node.tagName === "IMG") return imageRun(node);
    if (node.tagName === "BR") return "<w:r><w:br/></w:r>";
    let props = inherited;
    if (/^(STRONG|B|H[1-6])$/.test(node.tagName)) props += "<w:b/>";
    if (/^(EM|I)$/.test(node.tagName)) props += "<w:i/>";
    if (/^(S|DEL)$/.test(node.tagName)) props += "<w:strike/>";
    if (node.tagName === "CODE")
      props += '<w:rFonts w:ascii="Courier New" w:eastAsia="等线"/>';
    const ink = color(node.style.color);
    if (ink) props += `<w:color w:val="${ink}"/>`;
    const size = pixelSize(node.style.fontSize, inheritedSize);
    if (node.style.fontSize) {
      props = props.replace(/<w:sz(?:Cs)? w:val="[^"]*"\/>/g, "");
      const halfPoints = Math.max(12, Math.round(size * 1.5));
      props += `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
    }
    const content = Array.from(node.childNodes)
      .map((child) => runs(child, props, size))
      .join("");
    if (
      node.tagName === "A" &&
      /^https?:\/\//i.test(node.getAttribute("href") || "")
    ) {
      const id = `link${relations.length + 1}`;
      relations.push(
        `<Relationship Id="${id}" Type="${relBase}hyperlink" Target="${xml(node.getAttribute("href")!)}" TargetMode="External"/>`,
      );
      return `<w:hyperlink r:id="${id}">${content}</w:hyperlink>`;
    }
    return content;
  }
  function paragraph(el: HTMLElement, prefix = "", level = 0): string {
    const heading = /^H([1-6])$/.exec(el.tagName);
    const align = ["center", "right", "justify"].includes(el.style.textAlign)
      ? `<w:jc w:val="${el.style.textAlign === "justify" ? "both" : el.style.textAlign}"/>`
      : "";
    const props = `${heading ? `<w:pStyle w:val="Heading${heading[1]}"/><w:keepNext/>` : ""}${align}<w:spacing w:after="180" w:line="360" w:lineRule="auto"/>${prefix ? `<w:ind w:left="${360 * (level + 1)}" w:hanging="240"/>` : ""}`;
    return `<w:p><w:pPr>${props}</w:pPr>${prefix ? `<w:r><w:t xml:space="preserve">${xml(prefix)} </w:t></w:r>` : ""}${runs(el)}</w:p>`;
  }
  function blocks(parent: HTMLElement, level = 0): string {
    return Array.from(parent.childNodes)
      .map((node) => {
        if (!node.instanceOf(HTMLElement))
          return node.textContent?.trim() ? `<w:p>${runs(node)}</w:p>` : "";
        if (node.matches("ul,ol")) {
          let number = Number(node.getAttribute("start") || 1);
          return Array.from(node.children)
            .map((li) => {
              const text = li.cloneNode(true) as HTMLElement;
              text.querySelectorAll("ul,ol").forEach((list) => list.remove());
              const current = paragraph(
                text,
                node.tagName === "OL" ? `${number++}.` : "•",
                level,
              );
              const nested = createDiv();
              Array.from(li.children)
                .filter((child) => child.matches("ul,ol"))
                .forEach((child) => nested.append(child.cloneNode(true)));
              return current + blocks(nested, level + 1);
            })
            .join("");
        }
        if (node.tagName === "TABLE") {
          const rows = Array.from(node.querySelectorAll("tr"));
          const cols = Math.max(1, ...rows.map((row) => row.children.length));
          return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((edge) => `<w:${edge} w:val="single" w:sz="4" w:color="D9DEDA"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`).join("")}</w:tblGrid>${rows
            .map(
              (row) =>
                `<w:tr>${Array.from(row.children)
                  .map(
                    (cell) =>
                      `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / cols)}" w:type="dxa"/></w:tcPr>${paragraph(cell as HTMLElement)}</w:tc>`,
                  )
                  .join("")}</w:tr>`,
            )
            .join("")}</w:tbl>`;
        }
        if (node.matches("section,div,blockquote")) return blocks(node, level);
        if (node.tagName === "HR")
          return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D9DEDA"/></w:pBdr></w:pPr></w:p>';
        return paragraph(node);
      })
      .join("");
  }
  const content = blocks(article);
  const fontSize = Math.round(bodySize * 1.5);
  const font =
    article.style.fontFamily.includes("serif") &&
    !article.style.fontFamily.includes("sans-serif")
      ? "宋体"
      : "等线";
  const styles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="${font}"/><w:sz w:val="${fontSize}"/><w:color w:val="${color(article.style.color) || "292D29"}"/></w:rPr></w:rPrDefault></w:docDefaults>${[1, 2, 3, 4, 5, 6].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:pPr><w:outlineLvl w:val="${n - 1}"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="${48 - n * 4}"/></w:rPr></w:style>`).join("")}</w:styles>`;
  const documentXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${relBase.slice(0, -1)}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${content}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1200" w:bottom="1200" w:left="1200"/></w:sectPr></w:body></w:document>`;
  const addXml = (path: string, value: string) => {
    files[path] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`,
    );
  };
  addXml("word/document.xml", documentXml);
  addXml("word/styles.xml", styles);
  addXml(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join("")}<Relationship Id="styles" Type="${relBase}styles" Target="styles.xml"/></Relationships>`,
  );
  addXml(
    "_rels/.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${relBase}officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  addXml(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  const data = zipSync(files);
  return Uint8Array.from(data).buffer;
}
