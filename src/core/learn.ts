import parse from "css-tree/parser";
import generate from "css-tree/generator";
import walk from "css-tree/walker";
import juice from "juice/client";
import { sampleHeadingComponent } from "./heading-component";
import {
  BUILTIN_TEMPLATES,
  safeColor,
  safeStyle,
  validateTemplate,
} from "./templates";
import type { Role, Styles, Template } from "./types";
import { compactStyleHtml } from "./style-source";
const css = { parse, generate, walk };

function declarations(text: string): Styles {
  const result: Styles = {};
  try {
    const ast = css.parse(text, { context: "declarationList" });
    css.walk(ast, (node) => {
      if (node.type === "Declaration") {
        const property =
          node.property === "background" ? "background-color" : node.property;
        const v = safeStyle(property, css.generate(node.value));
        if (v) {
          result[property] = v;
          // Canonical sides prevent an uncommon shorthand from overriding the
          // sampled longhands when the template is rendered later.
          if (property === "margin" || property === "padding") {
            const [top, right = top, bottom = top, left = right] =
              v.split(/\s+/);
            for (const [side, value] of Object.entries({
              top,
              right,
              bottom,
              left,
            }))
              result[`${property}-${side}`] = value;
            delete result[property];
          }
        }
      }
    });
  } catch {
    /* malformed declarations do not become styles */
  }
  // Expand CSS font and split-border declarations with the host's CSS parser.
  // This element stays detached; only allowlisted values enter the template.
  if (/(?:^|;)\s*(?:font\s*:|border-[\w-]+\s*:)/i.test(text)) {
    const parsed = createDiv();
    parsed.setAttribute("style", text);
    const keys = /(?:^|;)\s*font\s*:/i.test(text)
      ? ["font-size", "font-family", "font-weight", "font-style", "line-height"]
      : [];
    for (const side of ["left", "right", "top", "bottom"]) {
      if (
        new RegExp(`border-${side}-(?:width|style|color)\\s*:`, "i").test(text)
      )
        keys.push(`border-${side}`);
    }
    for (const key of keys) {
      const value = safeStyle(key, parsed.style.getPropertyValue(key));
      if (value) result[key] = value;
    }
  }
  return result;
}
export function stylesheetLinks(html: string, base: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))
    .slice(0, 3)
    .map((el) => {
      try {
        return new URL(el.getAttribute("href")!, base).href;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}
export function learnTemplate(
  html: string,
  url = "pasted-html",
  externalCss: string[] = [],
): Template {
  // The same CSS inliner used by doocs/md and obsidian-wechat-converter.
  // The client entry point never fetches images, fonts or linked resources.
  const compact = compactStyleHtml(html);
  const prepared = new DOMParser().parseFromString(compact, "text/html");
  const sheets = [...prepared.querySelectorAll("style")].map(
    (el) => el.textContent || "",
  );
  prepared.querySelectorAll("style").forEach((el) => el.remove());
  let budget = 0;
  const cssText = [...sheets, ...externalCss]
    .filter((sheet) => (budget += sheet.length) <= 500_000)
    .join("\n");
  const inlined = juice.inlineContent(
    prepared.documentElement.outerHTML,
    cssText,
    {
      inlinePseudoElements: true,
      preserveMediaQueries: false,
      preserveFontFaces: false,
      preserveKeyFrames: false,
      preservePseudos: false,
      removeStyleTags: true,
      resolveCSSVariables: true,
    },
  );
  const doc = new DOMParser().parseFromString(inlined, "text/html");
  doc
    .querySelectorAll("script,iframe,object,embed,noscript,svg,form,nav,footer")
    .forEach((el) => el.remove());
  const root =
    doc.querySelector(
      '#js_content, article, [role="main"], main, .rich_media_content',
    ) || doc.body;
  const text = root.textContent?.trim() || "";
  if (
    text.length < 50 ||
    (!doc.querySelector("#js_content, article") &&
      /环境异常|访问过于频繁|请完成验证|验证码|access denied|verify you are human/i.test(
        text.slice(0, 1200),
      ))
  )
    throw new Error(
      "页面没有可学习的正文，可能需要登录或验证。请在浏览器打开后复制正文 HTML，使用“粘贴 HTML”。",
    );
  const cache = new Map<Element, Styles>();
  const inherited = new Set([
    "color",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-indent",
  ]);
  function styleOf(el: Element): Styles {
    if (cache.has(el)) return cache.get(el)!;
    const result: Styles = {};
    if (el.parentElement)
      for (const [key, val] of Object.entries(styleOf(el.parentElement)))
        if (inherited.has(key)) result[key] = val;
    const parentSize = Number.parseFloat(result["font-size"]) || 16;
    if (el.matches("strong,b")) result["font-weight"] = "700";
    if (el.matches("em,i")) result["font-style"] = "italic";
    const own = declarations(el.getAttribute("style") || "");
    const fontSize = own["font-size"];
    if (fontSize && /(?:em|rem|%)$/.test(fontSize)) {
      const scale = fontSize.endsWith("rem") ? 16 : parentSize;
      own["font-size"] =
        `${Math.round(((Number.parseFloat(fontSize) * scale) / (fontSize.endsWith("%") ? 100 : 1)) * 100) / 100}px`;
    }
    Object.assign(result, own);
    if (own["text-indent"]?.endsWith("em"))
      result["text-indent"] =
        `${Math.round(Number.parseFloat(own["text-indent"]) * (Number.parseFloat(result["font-size"]) || 16) * 100) / 100}px`;
    if (own["line-height"]?.endsWith("em"))
      result["line-height"] =
        `${Math.round(Number.parseFloat(own["line-height"]) * (Number.parseFloat(result["font-size"]) || 16) * 100) / 100}px`;
    else if (own["line-height"]?.endsWith("%"))
      result["line-height"] =
        `${Math.round(Number.parseFloat(own["line-height"]) * (Number.parseFloat(result["font-size"]) || 16)) / 100}px`;
    cache.set(el, result);
    return result;
  }
  const textLength = (el: Element) =>
    el.textContent?.replace(/\s+/g, "").length || 0;
  const contentNodes = Array.from(
    root.querySelectorAll("p,section,div"),
  ).filter((el) => textLength(el) > 0 && !el.querySelector("p,section,div"));
  const textStyleCache = new Map<Element, Styles>();
  function textStyle(el: Element, ignoreEmphasis = false): Styles {
    if (!ignoreEmphasis && textStyleCache.has(el))
      return textStyleCache.get(el)!;
    const counts = new Map<string, Map<string, number>>();
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let count = 0;
    for (
      let node = walker.nextNode();
      node && count++ < 5000;
      node = walker.nextNode()
    ) {
      const weight = node.textContent?.replace(/\s+/g, "").length || 0;
      const parent = node.parentElement;
      if (
        !weight ||
        !parent ||
        (ignoreEmphasis && parent.closest("strong,b,em,i,a"))
      )
        continue;
      const styles = { ...styleOf(parent) };
      for (
        let wrapper: Element | null = parent;
        wrapper && el.contains(wrapper);
        wrapper = wrapper.parentElement
      ) {
        for (const key of ["background-color", "text-decoration"])
          if (!styles[key] && styleOf(wrapper)[key])
            styles[key] = styleOf(wrapper)[key];
        if (wrapper === el) break;
      }
      for (const key of [...inherited, "background-color", "text-decoration"]) {
        // Missing declarations participate too: a small colored footer must
        // not color all the unstyled body text.
        const value = styles[key] || "";
        if (!counts.has(key)) counts.set(key, new Map());
        const values = counts.get(key)!;
        values.set(value, (values.get(value) || 0) + weight);
      }
    }
    const result: Styles = {};
    for (const [key, values] of counts) {
      const value = [...values].sort((a, b) => b[1] - a[1])[0][0];
      if (value) result[key] = value;
    }
    if (!ignoreEmphasis) textStyleCache.set(el, result);
    return result;
  }
  function boxStyle(el: Element): Styles {
    const chain = [el];
    for (
      let parent = el.parentElement;
      parent && parent !== root && chain.length < 6;
      parent = parent.parentElement
    ) {
      const extra = (parent.textContent || "")
        .replace(el.textContent || "", "")
        .trim();
      if (textLength(parent) !== textLength(el) && !/^\d{1,2}$/.test(extra))
        break;
      chain.unshift(parent);
    }
    const result: Styles = {};
    for (const node of chain)
      for (const [key, value] of Object.entries(styleOf(node)))
        if (!inherited.has(key)) result[key] = value;
    return result;
  }
  function representative(elements: Element[], body = false): Styles {
    let samples = elements
      .filter((el) => textLength(el) > 0 || el.matches("hr"))
      .slice(0, 250)
      .map((el) => {
        const text = textStyle(el, body);
        const styles = { ...styleOf(el), ...boxStyle(el), ...text };
        if (body) {
          // Text indentation/alignment belongs to the paragraph, not a short
          // span nested inside it. Emphasis remains a separate semantic role.
          for (const key of [
            "font-weight",
            "font-style",
            "background-color",
            "text-decoration",
          ])
            if (!(key in boxStyle(el))) delete styles[key];
          for (const key of ["text-align", "text-indent"])
            if (styleOf(el)[key]) styles[key] = styleOf(el)[key];
          const next = el.nextElementSibling;
          if (
            next?.matches("p,section") &&
            !textLength(next) &&
            next.querySelector("br") &&
            !next.querySelector("img")
          ) {
            const spacer = styleOf(next);
            const size = Number.parseFloat(spacer["font-size"]) || 16;
            const line = spacer["line-height"] || "1.75";
            const gap =
              Number.parseFloat(line) * (line.endsWith("px") ? 1 : size);
            styles["margin-bottom"] = `${Math.min(59, Math.round(gap))}px`;
          }
        }
        return { styles, weight: Math.max(1, Math.min(400, textLength(el))) };
      });
    if (!body && samples.length > 1) {
      const groups = new Map<string, typeof samples>();
      for (const sample of samples) {
        const signature = [
          "font-size",
          "color",
          "background-color",
          "text-align",
          "font-weight",
        ]
          .map((key) => sample.styles[key] || "")
          .join("|");
        const group = groups.get(signature) || [];
        group.push(sample);
        groups.set(signature, group);
      }
      // Keep foreground/background and typography from the same observed style
      // family. Independent votes could create white headings on white paper.
      samples = [...groups.values()].sort(
        (a, b) =>
          b.length - a.length ||
          b.reduce((sum, s) => sum + s.weight, 0) -
            a.reduce((sum, s) => sum + s.weight, 0),
      )[0];
    }
    const tallies = new Map<string, Map<string, number>>();
    const keys = new Set(samples.flatMap(({ styles }) => Object.keys(styles)));
    for (const { styles, weight } of samples) {
      for (const key of keys) {
        const val = styles[key] || "";
        if (!tallies.has(key)) tallies.set(key, new Map());
        const counts = tallies.get(key)!;
        counts.set(val, (counts.get(val) || 0) + weight);
      }
    }
    const result: Styles = {};
    for (const [key, counts] of tallies) {
      const value = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      if (value) result[key] = value;
    }
    return result;
  }
  const roles: Template["roles"] = {};
  const components: Template["components"] = {};
  const headingNodes: Partial<Record<"h2" | "h3", Element[]>> = {};
  const bodyNodes = contentNodes.filter(
    (el) => textLength(el) >= 40 && !el.closest("blockquote,li,figcaption"),
  );
  roles.p = representative(bodyNodes.length ? bodyNodes : contentNodes, true);
  for (const role of [
    "h1",
    "h2",
    "h3",
    "blockquote",
    "strong",
    "em",
    "a",
    "code",
    "pre",
    "li",
    "hr",
    "figcaption",
  ] as Role[]) {
    let nodes = Array.from(
      root.querySelectorAll(
        role === "strong" ? "strong,b" : role === "em" ? "em,i" : role,
      ),
    );
    if (["strong", "em", "a"].includes(role)) {
      const mainText = nodes.filter((el) =>
        bodyNodes.includes(el.closest("p,section,div")!),
      );
      if (mainText.length) nodes = mainText;
    }
    if (nodes.length) roles[role] = representative(nodes);
    if (role === "h2" || role === "h3") headingNodes[role] = nodes;
  }
  if (!root.querySelector("h2")) {
    const headings = contentNodes.slice(0, 1000).filter((el) => {
      const len = el.textContent?.trim().length || 0;
      const s = textStyle(el);
      const box = boxStyle(el);
      const bodySize = Number.parseFloat(roles.p?.["font-size"] || "") || 16;
      const candidateSize = Number.parseFloat(s["font-size"]) || bodySize;
      // Repeated centered image captions / calls to action are often smaller
      // than the article body. They must not become the main heading style.
      if (candidateSize < bodySize || el.closest("figure,figcaption"))
        return false;
      const distinct =
        Number.parseFloat(s["font-size"]) >=
          Math.max(
            18,
            (Number.parseFloat(roles.p?.["font-size"] || "") || 16) + 1,
          ) ||
        s["text-align"] === "center" ||
        !!(
          s["background-color"] ||
          box["background-color"] ||
          box["border-bottom"] ||
          box["border-left"]
        );
      return (
        len > 1 &&
        len < 60 &&
        distinct &&
        (s["font-weight"] === "bold" || Number(s["font-weight"]) >= 600)
      );
    });
    if (headings.length) {
      const bodySize = Number.parseFloat(roles.p?.["font-size"] || "") || 16;
      const larger = headings.filter(
        (el) => Number.parseFloat(textStyle(el)["font-size"]) >= bodySize + 1,
      );
      const primary = larger.length ? larger : headings;
      roles.h2 = representative(primary);
      headingNodes.h2 = primary;
    }
  }
  for (const role of ["h2", "h3"] as const) {
    const nodes = headingNodes[role] || [];
    // Choose an actual component matching the representative typography, not
    // an arbitrary first heading or a combination of incompatible fragments.
    const ranked = [...nodes].sort((a, b) => {
      const score = (el: Element) => {
        const styles = { ...styleOf(el), ...boxStyle(el), ...textStyle(el) };
        return Object.entries(roles[role] || {}).filter(
          ([key, value]) => styles[key] === value,
        ).length;
      };
      return score(b) - score(a);
    });
    for (const node of ranked) {
      const component = sampleHeadingComponent(node, root, styleOf);
      if (component) {
        components[role] = component;
        break;
      }
    }
  }
  const articleTitle = doc.querySelector("#activity-name");
  if (!roles.h1 && articleTitle) roles.h1 = representative([articleTitle]);
  // Keep the main article shell, not page chrome or a boxed subsection.
  const articleStyle = { ...styleOf(root) };
  for (const el of Array.from(root.querySelectorAll("section,div")).slice(
    0,
    1000,
  )) {
    if (
      textLength(el) >= textLength(root) * 0.8 &&
      el.querySelectorAll("p").length >= 3
    )
      Object.assign(articleStyle, styleOf(el));
  }
  for (const key of inherited) delete articleStyle[key];
  roles.article = articleStyle;
  const evidence = Object.values(roles).reduce(
    (n, s) => n + Object.keys(s || {}).length,
    0,
  );
  if (evidence < 3)
    throw new Error(
      "正文可读取，但没有足够的排版样式。该页面可能依赖脚本或外部样式；请改用含行内样式的正文 HTML。",
    );
  const base = structuredClone(BUILTIN_TEMPLATES[0]),
    body = { ...styleOf(root), ...roles.p },
    heading = roles.h2 || roles.h1 || {};
  const accent =
    safeColor(heading["background-color"]) ||
    safeColor(heading.color) ||
    safeColor(roles.strong?.color) ||
    safeColor(body.color) ||
    "#333333";
  const name = (
    doc.querySelector("#activity-name")?.textContent ||
    doc.title ||
    "链接排版"
  )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);
  const notes = [
    "提取配色、字体、间距及标题/引用样式；不保存原文章正文。",
    "已跳过参考文章图片和脚本；预览图片用占位符表示，不下载或保存原图。",
    "已解析 CSS 层叠，并保留可识别的标题色块、嵌套文字与编号结构；未出现的元素使用简洁样式。",
    "图片内文字、动画、整篇多栏布局和无法识别的装饰未复刻；请用样式示例对照后保存。",
  ];
  if (doc.querySelector('link[rel~="stylesheet"]') && externalCss.length === 0)
    notes.push("外部样式未读取，当前结果基于页面内样式。");
  return validateTemplate({
    ...base,
    styleMode: "reference",
    id: `user-${crypto.randomUUID()}`,
    name: `参考 · ${name}`,
    description: "从文章版式提取，可继续调整",
    palette: {
      ...base.palette,
      accent,
      ink: safeColor(body.color) || "#333333",
      muted: safeColor(roles.figcaption?.color) || "#777777",
      paper: safeColor(articleStyle["background-color"]) || "#ffffff",
      soft: safeColor(roles.blockquote?.["background-color"]) || "#ffffff",
    },
    fontSize: Math.max(
      12,
      Math.min(24, Number.parseFloat(body["font-size"]) || 16),
    ),
    lineHeight: Math.max(
      1.2,
      Math.min(
        2.5,
        (Number.parseFloat(body["line-height"]) || 1.75) /
          (body["line-height"]?.endsWith("px")
            ? Number.parseFloat(body["font-size"]) || 16
            : 1),
      ),
    ),
    fontFamily:
      /serif|宋|明体/i.test(body["font-family"] || "") &&
      !/sans-serif/i.test(body["font-family"] || "")
        ? "serif"
        : "sans",
    heading: heading["background-color"]
      ? "block"
      : heading["border-bottom"]
        ? "underline"
        : "plain",
    roles,
    ...(Object.keys(components).length ? { components } : {}),
    source: {
      url,
      importedAt: new Date().toISOString(),
      evidence,
      confidence:
        Object.keys(roles.p || {}).length >= 3 && !!roles.h2
          ? "strong"
          : "partial",
      notes,
    },
  });
}
