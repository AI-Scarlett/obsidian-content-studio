import type { Destination, PublishMode } from "./types";
export const destinations: Record<Destination, string> = {
  wechat: "https://mp.weixin.qq.com/",
  xiaohongshu:
    "https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=article",
  zhihu: "https://zhuanlan.zhihu.com/write",
  x: "https://x.com/compose/articles",
};
export function destinationUrl(
  platform: Destination,
  mode?: PublishMode,
): string {
  if (mode === "post" && platform === "x") return "https://x.com/compose/post";
  if (mode === "post" && platform === "xiaohongshu")
    return "https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=image";
  return destinations[platform];
}
function localJobUrl(raw: unknown, recovery: boolean): URL | undefined {
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
      (recovery
        ? /^\/(?:install\/)?publish\/[a-f\d]{64}$/
        : /^\/publish\/[a-f\d]{64}$/
      ).test(url.pathname)
    )
      return url;
  } catch {
    /* not a handoff URL */
  }
}
export function handoffUrl(raw: unknown): URL | undefined {
  return localJobUrl(raw, false);
}
/** The recovery page belongs to the same capability, without accepting arbitrary localhost pages. */
export function handoffPageUrl(raw: unknown): URL | undefined {
  return localJobUrl(raw, true);
}
export function publishUrl(page: URL): URL {
  return new URL(page.href.replace("/install/publish/", "/publish/"));
}
export function jobEndpoint(url: URL) {
  return `${url.origin}/v1/jobs/${url.pathname.split("/").pop()}`;
}
