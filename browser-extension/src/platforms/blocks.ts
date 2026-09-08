/** Semantic blocks supported by Draft.js; image markers always occupy their own block. */
export interface DraftBlock {
  type: string;
  text: string;
  depth: number;
  inlineStyleRanges: { offset: number; length: number; style: string }[];
  links: { offset: number; length: number; url: string }[];
}

export function articleBlocks(
  doc: Document,
  html: string,
  markers: string[],
): DraftBlock[] {
  const parsed = new doc.defaultView!.DOMParser().parseFromString(
    html,
    "text/html",
  );
  const result: DraftBlock[] = [];
  let current: DraftBlock;
  const block = (type = "unstyled", depth = 0): DraftBlock => ({
    type,
    depth,
    text: "",
    inlineStyleRanges: [],
    links: [],
  });
  current = block();
  const flush = () => {
    if (current.text.trim()) result.push(current);
    current = block();
  };
  const append = (text: string, styles: string[], url?: string) => {
    const offset = current.text.length;
    current.text += text;
    if (!text) return;
    for (const style of styles)
      current.inlineStyleRanges.push({ offset, length: text.length, style });
    if (url) current.links.push({ offset, length: text.length, url });
  };
  const types: Record<string, string> = {
    H1: "header-one",
    H2: "header-two",
    H3: "header-three",
    H4: "header-three",
    H5: "header-three",
    H6: "header-three",
    BLOCKQUOTE: "blockquote",
    PRE: "code-block",
    P: "unstyled",
    FIGCAPTION: "unstyled",
  };
  const inline: Record<string, string> = {
    B: "BOLD",
    STRONG: "BOLD",
    I: "ITALIC",
    EM: "ITALIC",
    U: "UNDERLINE",
    S: "STRIKETHROUGH",
    CODE: "CODE",
  };
  const visit = (
    node: Node,
    styles: string[] = [],
    url?: string,
    depth = 0,
    context?: string,
  ) => {
    if (node.nodeType === 3) {
      let rest = node.textContent || "";
      while (rest) {
        const next = markers
          .map((marker) => ({ marker, at: rest.indexOf(marker) }))
          .filter((x) => x.at >= 0)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) {
          append(rest, styles, url);
          break;
        }
        append(rest.slice(0, next.at), styles, url);
        const previousType = current.type,
          previousDepth = current.depth;
        flush();
        result.push({ ...block(), text: next.marker });
        current = block(previousType, previousDepth);
        rest = rest.slice(next.at + next.marker.length);
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement,
      tag = el.tagName;
    if (tag === "BR") {
      append("\n", styles, url);
      return;
    }
    if (tag === "HR") {
      flush();
      return;
    }
    let type =
      tag === "LI"
        ? el.parentElement?.tagName === "OL"
          ? "ordered-list-item"
          : "unordered-list-item"
        : types[tag];
    if (context === "blockquote" && type === "unstyled") type = "blockquote";
    const boundary =
      !!type ||
      [
        "SECTION",
        "ARTICLE",
        "DIV",
        "FIGURE",
        "UL",
        "OL",
        "TABLE",
        "TR",
      ].includes(tag);
    if (boundary) {
      flush();
      current = block(type || "unstyled", Math.max(0, depth - 1));
    }
    const nextStyles = inline[tag]
      ? [...new Set([...styles, inline[tag]])]
      : styles;
    const href = tag === "A" ? el.getAttribute("href") || undefined : url;
    const nextUrl = href && /^https?:\/\//i.test(href) ? href : undefined;
    for (const child of el.childNodes)
      visit(
        child,
        nextStyles,
        nextUrl,
        depth + (["OL", "UL"].includes(tag) ? 1 : 0),
        tag === "BLOCKQUOTE" ? "blockquote" : context,
      );
    if (tag === "TH" || tag === "TD") append("\t", [], undefined);
    if (boundary) flush();
  };
  visit(parsed.body);
  flush();
  return result;
}

/** Serializes semantic blocks for the platform schema, retaining inline structure. */
export function blocksHtml(doc: Document, blocks: DraftBlock[]): string {
  const root = doc.createElement("div");
  const tags: Record<string, string> = {
    "header-one": "h1",
    "header-two": "h2",
    "header-three": "h3",
    blockquote: "blockquote",
    "code-block": "pre",
  };
  const styleTags: Record<string, string> = {
    BOLD: "strong",
    ITALIC: "em",
    UNDERLINE: "u",
    STRIKETHROUGH: "s",
    CODE: "code",
  };
  for (const block of blocks) {
    const list =
      block.type === "ordered-list-item"
        ? "ol"
        : block.type === "unordered-list-item"
          ? "ul"
          : undefined;
    const parent = list
      ? root.lastElementChild?.tagName.toLowerCase() === list
        ? root.lastElementChild
        : doc.createElement(list)
      : root;
    const el = doc.createElement(list ? "li" : tags[block.type] || "p");
    for (let offset = 0; offset < block.text.length;) {
      const styles = block.inlineStyleRanges.filter(
        (r) => offset >= r.offset && offset < r.offset + r.length,
      );
      const link = block.links.find(
        (r) => offset >= r.offset && offset < r.offset + r.length,
      );
      const boundaries = [...block.inlineStyleRanges, ...block.links].flatMap(
        (r) => [r.offset, r.offset + r.length],
      );
      const end = Math.min(
        block.text.length,
        ...boundaries.filter((x) => x > offset),
      );
      let child: Node = doc.createTextNode(block.text.slice(offset, end));
      for (const style of styles) {
        const tag = styleTags[style.style];
        if (tag) {
          const wrapper = doc.createElement(tag);
          wrapper.append(child);
          child = wrapper;
        }
      }
      if (link) {
        const a = doc.createElement("a");
        a.href = link.url;
        a.append(child);
        child = a;
      }
      el.append(child);
      offset = end;
    }
    parent.append(el);
    if (parent !== root) root.append(parent);
  }
  return root.innerHTML;
}
