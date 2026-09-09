import type { Role, Styles, Template } from "./types";

const make = (
  id: string,
  name: string,
  description: string,
  accent: string,
  paper: string,
  soft: string,
  heading: Template["heading"],
  fontFamily: Template["fontFamily"] = "sans",
  ink = "#272724",
): Template => ({
  version: 1,
  id,
  name,
  description,
  palette: { accent, ink, muted: "#797971", paper, soft },
  fontSize: 16,
  lineHeight: 1.85,
  fontFamily,
  heading,
  radius: heading === "block" ? 8 : 0,
});
export const BUILTIN_TEMPLATES: Template[] = [
  make(
    "ink",
    "墨白",
    "清晰有序，适合知识分享",
    "#3d6254",
    "#ffffff",
    "#f1f5f2",
    "line",
  ),
  make(
    "cinnabar",
    "朱砂",
    "醒目标题，适合观点与评论",
    "#ad3e36",
    "#fffdf9",
    "#f9eeea",
    "block",
  ),
  make(
    "bamboo",
    "青竹",
    "留白舒展，适合生活与随笔",
    "#547449",
    "#fcfdf8",
    "#edf3e7",
    "underline",
    "serif",
  ),
  make(
    "blueprint",
    "蓝图",
    "理性明快，适合技术与教程",
    "#2f5eaa",
    "#ffffff",
    "#edf3fc",
    "block",
  ),
  make(
    "cream",
    "奶油手记",
    "温暖纸感，适合读书与记录",
    "#96734a",
    "#fff9ed",
    "#f3ead7",
    "plain",
    "serif",
    "#493f33",
  ),
  make(
    "editorial",
    "黑金刊物",
    "简洁有力，适合专栏与长文",
    "#9b7e40",
    "#fffefa",
    "#f3f0e8",
    "underline",
    "serif",
    "#242421",
  ),
];

const colorNames =
  /^(transparent|black|white|red|green|blue|gray|grey|navy|teal|orange|purple|maroon|olive|silver|currentcolor)$/i;
export function safeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const v = value.trim();
  if (/^#[a-f\d]{3,8}$/i.test(v) && [4, 5, 7, 9].includes(v.length)) return v;
  if (
    colorNames.test(v) ||
    /^(rgb|rgba|hsl|hsla)\([\d\s.,%/+\-deg]+\)$/i.test(v)
  )
    return v;
}
export const STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-indent",
  "border-right",
  "border-left",
  "border-bottom",
  "border-top",
  "border",
  "border-radius",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
]);
export function safeStyle(property: string, value: string): string | undefined {
  const p = property.toLowerCase(),
    v = value.replace(/\s*!important\s*$/i, "").trim();
  if (
    !STYLE_PROPERTIES.has(p) ||
    !v ||
    v.length > 160 ||
    /[;{}<>\\]|url\s*\(|expression|var\s*\(|@|!|\/\*/i.test(v)
  )
    return;
  if (p === "color" || p === "background-color") return safeColor(v);
  if (p === "font-family")
    return /^[\p{L}\p{N} ,'"_-]+$/u.test(v) ? v : undefined;
  if (p === "font-weight")
    return /^(normal|bold|[1-9]00)$/.test(v) ? v : undefined;
  if (p === "font-style") return /^(normal|italic)$/.test(v) ? v : undefined;
  if (p === "text-align")
    return /^(left|right|center|justify|start)$/.test(v) ? v : undefined;
  if (p === "text-decoration")
    return /^(none|underline|line-through)$/.test(v) ? v : undefined;
  if (p === "line-height")
    return /^(normal|[12](?:\.\d{1,2})?(?:em)?|[2-4]\d(?:\.\d+)?px|[12]\d\d%)$/.test(
      v,
    )
      ? v
      : undefined;
  if (p.startsWith("border") && p !== "border-radius") {
    if (v === "none" || v === "0") return v;
    const match = v.match(
      /^(\d(?:\.\d+)?px) (solid|dashed|dotted|double) (.+)$/,
    );
    return match && Number.parseFloat(match[1]) <= 8 && safeColor(match[3])
      ? v
      : undefined;
  }
  if (p === "font-size")
    return /^(?:[1-4]\d(?:\.\d+)?px|[12](?:\.\d+)?(?:em|rem)|1\d\d%)$/.test(v)
      ? v
      : undefined;
  if (p === "letter-spacing")
    return /^(0|normal|[0-3](?:\.\d+)?px|0(?:\.\d+)?em)$/.test(v)
      ? v
      : undefined;
  return v.split(/\s+/).length <= 4 &&
    v
      .split(/\s+/)
      .every(
        (s) =>
          s === "0" || /^(?:[0-5]?\d(?:\.\d+)?px|[0-3](?:\.\d+)?em)$/.test(s),
      )
    ? v
    : undefined;
}
export function sanitizeStyles(input: unknown): Styles {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Styles = {};
  for (const [p, v] of Object.entries(input))
    if (typeof v === "string") {
      const safe = safeStyle(p, v);
      if (safe) result[p] = safe;
    }
  return result;
}
export function validateTemplate(input: unknown): Template {
  if (!input || typeof input !== "object")
    throw new Error("模板文件格式不正确。");
  const t = input as Template;
  if (
    t.version !== 1 ||
    typeof t.name !== "string" ||
    !t.name.trim() ||
    t.name.length > 60 ||
    typeof t.id !== "string" ||
    !/^user-[a-z\d-]{1,70}$/.test(t.id)
  )
    throw new Error("模板名称或版本不正确，请使用墨稿导出的模板 JSON。");
  if (
    !t.palette ||
    !Object.values(t.palette).every(safeColor) ||
    !["accent", "ink", "muted", "paper", "soft"].every((k) =>
      safeColor(t.palette[k as keyof Template["palette"]]),
    )
  )
    throw new Error("模板配色不正确。");
  if (
    !Number.isFinite(t.fontSize) ||
    t.fontSize < 12 ||
    t.fontSize > 24 ||
    !Number.isFinite(t.lineHeight) ||
    t.lineHeight < 1.2 ||
    t.lineHeight > 2.5
  )
    throw new Error("模板字号或行距超出范围。");
  const roles: Template["roles"] = {};
  for (const key of [
    "article",
    "h1",
    "h2",
    "h3",
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
  ] as Role[])
    if (t.roles?.[key]) roles[key] = sanitizeStyles(t.roles[key]);
  let source: Template["source"];
  if (t.source && typeof t.source.url === "string") {
    const url =
      t.source.url === "pasted-html"
        ? "pasted-html"
        : new URL(t.source.url).href;
    if (url !== "pasted-html" && !/^https?:\/\//i.test(url))
      throw new Error("来源链接仅支持 HTTP/HTTPS。");
    source = {
      url,
      importedAt:
        typeof t.source.importedAt === "string"
          ? t.source.importedAt.slice(0, 40)
          : "",
      evidence: Math.max(0, Math.min(10000, Number(t.source.evidence) || 0)),
      confidence: t.source.confidence === "strong" ? "strong" : "partial",
      notes: Array.isArray(t.source.notes)
        ? t.source.notes
            .filter((n) => typeof n === "string")
            .slice(0, 8)
            .map((n) => n.slice(0, 200))
        : [],
    };
  }
  return {
    version: 1,
    id: t.id,
    name: t.name.trim(),
    description: String(t.description || "自定义模板").slice(0, 120),
    palette: {
      accent: t.palette.accent,
      ink: t.palette.ink,
      muted: t.palette.muted,
      paper: t.palette.paper,
      soft: t.palette.soft,
    },
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    fontFamily: t.fontFamily === "serif" ? "serif" : "sans",
    heading: ["line", "block", "underline", "plain"].includes(t.heading)
      ? t.heading
      : "line",
    radius: Math.max(0, Math.min(20, Number(t.radius) || 0)),
    ...(t.styleMode === "reference" ? { styleMode: "reference" as const } : {}),
    roles,
    source,
  };
}
export function userTemplate(base: Template, name: string): Template {
  return validateTemplate({
    ...structuredClone(base),
    id: `user-${crypto.randomUUID()}`,
    name,
  });
}
export function tuneTemplate(
  base: Template,
  accent: string,
  fontSize: number,
): Template {
  const color = safeColor(accent) || base.palette.accent;
  const result = structuredClone(base);
  result.palette.accent = color;
  result.fontSize = fontSize;
  for (const styles of Object.values(result.roles || {}))
    for (const key of Object.keys(styles || {}))
      styles[key] = styles[key].split(base.palette.accent).join(color);
  return result;
}
