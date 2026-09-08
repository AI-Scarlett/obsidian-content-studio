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
    hint: "有图片请导出 Word 图文，在公众号编辑器导入文档；标题单独复制。",
  },
  zhihu: {
    name: "知乎",
    label: "ZHIHU",
    hint: "标题与富文本正文分别复制，也可保存 Markdown。",
  },
  xiaohongshu: {
    name: "小红书",
    label: "REDNOTE",
    hint: "图片通过“导出发布图片”批量上传；复制正文只复制文案。",
  },
  x: {
    name: "X",
    label: "X / TWITTER",
    hint: "复制长文，或逐条复制按 280 加权字符分段的串文。",
  },
};
