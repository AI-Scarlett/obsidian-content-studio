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
    hint: "标题、图文正文分开复制；图片被过滤时可逐张复制，或导入 Word 图文。",
  },
  zhihu: {
    name: "知乎",
    label: "ZHIHU",
    hint: "标题与富文本正文分别复制，也可保存 Markdown。",
  },
  xiaohongshu: {
    name: "小红书",
    label: "REDNOTE",
    hint: "长文可复制图文正文；普通图文请在图片区粘贴原图，或复制排版卡片。",
  },
  x: {
    name: "X",
    label: "X / TWITTER",
    hint: "复制长文，或逐条复制按 280 加权字符分段的串文。",
  },
};
