export type Platform = "wechat" | "zhihu" | "xiaohongshu" | "x";
export type Role =
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "blockquote"
  | "strong"
  | "a"
  | "code"
  | "pre"
  | "li"
  | "hr"
  | "figcaption";
export type Styles = Record<string, string>;
export interface Template {
  version: 1;
  id: string;
  name: string;
  description: string;
  palette: {
    accent: string;
    ink: string;
    muted: string;
    paper: string;
    soft: string;
  };
  fontSize: number;
  lineHeight: number;
  fontFamily: "sans" | "serif";
  heading: "line" | "block" | "underline" | "plain";
  radius: number;
  roles?: Partial<Record<Role, Styles>>;
  source?: {
    url: string;
    importedAt: string;
    evidence: number;
    confidence: "partial" | "strong";
    notes: string[];
  };
}
export interface Draft {
  title: string;
  markdown: string;
  sourcePath: string;
}
export interface RenderOptions {
  platform: Platform;
  template: Template;
  fontSize: number;
  accent: string;
  footnotes: boolean;
  includeTitle?: boolean;
  forCards?: boolean;
}
export interface Rendered {
  html: string;
  plainText: string;
  markdown: string;
  warnings: string[];
}
export interface Settings {
  templateId: string;
  platform: Platform;
  customTemplates: Template[];
  exportFolder: string;
  footnotes: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  templateId: "ink",
  platform: "wechat",
  customTemplates: [],
  exportFolder: "墨稿导出",
  footnotes: true,
};
export const PLATFORMS: Record<
  Platform,
  { name: string; label: string; hint: string }
> = {
  wechat: {
    name: "公众号",
    label: "WECHAT",
    hint: "整篇带图导入可使用浏览器导入包与配套扩展预览版；标题仍可单独复制。",
  },
  zhihu: {
    name: "知乎",
    label: "ZHIHU",
    hint: "标题与正文分开；浏览器导入包面向知乎专栏长文编辑器。",
  },
  xiaohongshu: {
    name: "小红书",
    label: "REDNOTE",
    hint: "浏览器导入包面向小红书长文；普通图文仍可导出排版卡片。",
  },
  x: {
    name: "X",
    label: "X / TWITTER",
    hint: "复制长文，或逐条复制按 280 加权字符分段的串文。",
  },
};
