import parse from "css-tree/parser";
import generate from "css-tree/generator";
import walk from "css-tree/walker";
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
        const v = safeStyle(node.property, css.generate(node.value));
        if (v) result[node.property] = v;
      }
    });
  } catch {
    /* malformed declarations do not become styles */
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
  const doc = new DOMParser().parseFromString(
    compactStyleHtml(html),
    "text/html",
  );
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
  type Rule = {
    selector: string;
    styles: Styles;
    score: number;
    order: number;
  };
  const rules: Rule[] = [];
  const sheets = [
    ...Array.from(doc.querySelectorAll("style")).map(
      (el) => el.textContent || "",
    ),
    ...externalCss,
  ];
  let cssBytes = 0;
  for (const sheet of sheets) {
    cssBytes += sheet.length;
    if (cssBytes > 500_000) break;
    try {
      const ast = css.parse(sheet);
      css.walk(ast, (node) => {
        if (
          node.type !== "Rule" ||
          node.prelude.type !== "SelectorList" ||
          rules.length >= 600
        )
          return;
        const style = declarations(css.generate(node.block).slice(1, -1));
        if (!Object.keys(style).length) return;
        node.prelude.children.forEach((selector) => {
          const s = css.generate(selector);
          if (/:|\*/.test(s) || s.length > 200) return;
          const score =
            (s.match(/#/g) || []).length * 100 +
            (s.match(/[.[]/g) || []).length * 10 +
            (s.match(/(?:^|[ >+~])\w/g) || []).length;
          rules.push({
            selector: s,
            styles: style,
            score,
            order: rules.length,
          });
        });
      });
    } catch {
      /* invalid stylesheet ignored */
    }
  }
  rules.sort((a, b) => a.score - b.score || a.order - b.order);
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
  ]);
  function styleOf(el: Element): Styles {
    if (cache.has(el)) return cache.get(el)!;
    const result: Styles = {};
    if (el.parentElement)
      for (const [key, val] of Object.entries(styleOf(el.parentElement)))
        if (inherited.has(key)) result[key] = val;
    for (const rule of rules) {
      try {
        if (el.matches(rule.selector)) Object.assign(result, rule.styles);
      } catch {
        /* unknown selector */
      }
    }
    Object.assign(result, declarations(el.getAttribute("style") || ""));
    cache.set(el, result);
    return result;
  }
  function representative(elements: Element[]): Styles {
    const tallies = new Map<string, Map<string, number>>();
    for (const el of elements.slice(0, 150)) {
      const weight = Math.max(
        1,
        Math.min(400, el.textContent?.trim().length || 0),
      );
      for (const [key, val] of Object.entries(styleOf(el))) {
        if (!tallies.has(key)) tallies.set(key, new Map());
        const counts = tallies.get(key)!;
        counts.set(val, (counts.get(val) || 0) + weight);
      }
    }
    const result: Styles = {};
    for (const [key, counts] of tallies)
      result[key] = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    return result;
  }
  const roles: Template["roles"] = {};
  for (const role of [
    "h1",
    "h2",
    "h3",
    "p",
    "blockquote",
    "strong",
    "a",
    "code",
    "pre",
    "li",
    "hr",
    "figcaption",
  ] as Role[]) {
    const nodes = Array.from(root.querySelectorAll(role));
    if (nodes.length) roles[role] = representative(nodes);
  }
  if (!root.querySelector("h2")) {
    const headings = Array.from(root.querySelectorAll("section,p,span,strong"))
      .slice(0, 1000)
      .filter((el) => {
        const len = el.textContent?.trim().length || 0;
        const s = styleOf(el);
        return (
          len > 1 &&
          len < 60 &&
          Number.parseFloat(s["font-size"]) >= 18 &&
          (s["font-weight"] === "bold" || Number(s["font-weight"]) >= 600)
        );
      });
    if (headings.length) roles.h2 = representative(headings);
  }
  const evidence = Object.values(roles).reduce(
    (n, s) => n + Object.keys(s || {}).length,
    0,
  );
  if (evidence < 3)
    throw new Error(
      "正文可读取，但没有足够的排版样式。该页面可能依赖脚本或外部样式；请改用含行内样式的正文 HTML。",
    );
  const base = structuredClone(BUILTIN_TEMPLATES[0]),
    body = roles.p || styleOf(root),
    heading = roles.h2 || roles.h1 || {};
  const accent =
    safeColor(heading.color) ||
    safeColor(roles.strong?.color) ||
    base.palette.accent;
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
    "脚本生成效果、动画及复杂布局需要手动调整。",
  ];
  if (doc.querySelector('link[rel~="stylesheet"]') && externalCss.length === 0)
    notes.push("外部样式未读取，当前结果基于页面内样式。");
  return validateTemplate({
    ...base,
    id: `user-${crypto.randomUUID()}`,
    name: `参考 · ${name}`,
    description: "从文章版式提取，可继续调整",
    palette: {
      ...base.palette,
      accent,
      ink: safeColor(body.color) || base.palette.ink,
      paper: safeColor(styleOf(root)["background-color"]) || "#ffffff",
      soft:
        safeColor(roles.blockquote?.["background-color"]) || base.palette.soft,
    },
    fontSize: Math.max(
      12,
      Math.min(24, Number.parseFloat(body["font-size"]) || 16),
    ),
    lineHeight:
      body["line-height"] && !body["line-height"].includes("px")
        ? Math.max(
            1.2,
            Math.min(2.5, Number.parseFloat(body["line-height"]) || 1.85),
          )
        : 1.85,
    fontFamily:
      /serif|宋|明体/i.test(body["font-family"] || "") &&
      !/sans-serif/i.test(body["font-family"] || "")
        ? "serif"
        : "sans",
    heading: heading["background-color"]
      ? "block"
      : heading["border-bottom"]
        ? "underline"
        : "line",
    roles,
    source: {
      url,
      importedAt: new Date().toISOString(),
      evidence,
      confidence: evidence >= 14 ? "strong" : "partial",
      notes,
    },
  });
}
