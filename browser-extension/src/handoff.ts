import type { Destination } from "./types";
export const destinations: Record<Destination, string> = {
  wechat: "https://mp.weixin.qq.com/",
  xiaohongshu:
    "https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=article",
  zhihu: "https://zhuanlan.zhihu.com/write",
};
export function handoffUrl(raw: unknown): URL | undefined {
  if (typeof raw !== "string") return;
  try {
    const url = new URL(raw);
    if (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/publish\/[a-f\d]{64}$/.test(url.pathname)
    )
      return url;
  } catch {
    /* not a handoff URL */
  }
}
export function jobEndpoint(url: URL) {
  return `${url.origin}/v1/jobs/${url.pathname.split("/").pop()}`;
}
