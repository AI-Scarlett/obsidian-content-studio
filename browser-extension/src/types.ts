export type Destination = "wechat" | "xiaohongshu" | "zhihu" | "x";
export interface ArticleFile {
  format: "mogao-article";
  version: 1;
  title: string;
  platform: Destination;
  html: string;
}
export interface InlineImage {
  marker: string;
  name: string;
  mime: string;
  base64: string;
  alt?: string;
  style?: string;
}
export interface ImportPlan {
  title: string;
  platform: Destination;
  html: string;
  images: InlineImage[];
  textParts: string[];
}
export interface Probe {
  platform: Destination;
  editor: string;
  empty: boolean;
  titleEmpty: boolean;
}
export interface Progress {
  text: string;
  done: boolean;
  error?: string;
  navigate?: string;
}
export type Command =
  | { op: "probe" }
  | { op: "prepare"; platform: Destination }
  | { op: "begin"; plan: Omit<ImportPlan, "images">; markers: string[] }
  | { op: "image"; image: InlineImage }
  | { op: "finish" }
  | { op: "cancel" };
export interface Reply {
  ok: boolean;
  error?: string;
  probe?: Probe;
  progress?: Progress;
  preparation?: { probe?: Probe; navigate?: string; status?: string };
}

export interface EditorDriver {
  cancel?(): void;
  ready?(): boolean;
  imageIdentity?(candidate: HTMLImageElement): string | undefined;
  write(html: string, markers: string[]): Promise<void>;
  upload(image: InlineImage): Promise<void>;
  settle(image: InlineImage, candidate: HTMLImageElement): Promise<void>;
}
