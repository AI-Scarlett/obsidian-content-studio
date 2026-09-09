export type Platform = "wechat" | "zhihu" | "xiaohongshu" | "x";
export type Role =
  | "article"
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "blockquote"
  | "strong"
  | "em"
  | "a"
  | "code"
  | "pre"
  | "li"
  | "hr"
  | "figcaption";
export type Styles = Record<string, string>;
/** A bounded, text-free heading skeleton. It never stores source HTML. */
export interface HeadingComponent {
  styles: Styles;
  slot?: "content" | "number";
  numberWidth?: number;
  children?: HeadingComponent[];
}
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
  styleMode?: "reference";
  roles?: Partial<Record<Role, Styles>>;
  components?: Partial<Record<"h2" | "h3", HeadingComponent>>;
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
  imagePlaceholders?: boolean;
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
  publishModes?: Partial<Record<"xiaohongshu" | "x", "article" | "post">>;
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
    hint: "点“发布到公众号”，自动打开平台并同步标题、正文和图片。",
  },
  zhihu: {
    name: "知乎",
    label: "ZHIHU",
    hint: "点“发布到知乎”，自动打开专栏并同步整篇图文。",
  },
  xiaohongshu: {
    name: "小红书",
    label: "REDNOTE",
    hint: "点“发布到小红书”，自动打开长文编辑器并同步整篇图文。",
  },
  x: {
    name: "X",
    label: "X / TWITTER",
    hint: "复制长文，或逐条复制按 280 加权字符分段的串文。",
  },
};
