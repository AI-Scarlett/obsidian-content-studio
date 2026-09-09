export type PublishMode = "article" | "post";
export type PostPlatform = "xiaohongshu" | "x";
export function parseTopics(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,，#]+/u)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
/** Read text in document order, retaining paragraph boundaries but never image paths/alt text. */
export function postContent(root: Node): { body: string; topics: string[] } {
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || "";
    const tag = node.nodeName.toLowerCase();
    if (["img", "figcaption", "script", "style"].includes(tag)) return "";
    if (tag === "br") return "\n";
    const text = [...node.childNodes].map(walk).join("");
    if (tag === "a" && node.nodeType === 1) {
      const href = (node as Element).getAttribute("href") || "";
      if (/^https?:\/\//i.test(href) && text.trim() !== href)
        return `${text} (${href})`;
    }
    return /^(p|div|section|article|blockquote|h[1-6]|li|pre|tr)$/.test(tag)
      ? `${text}\n\n`
      : text;
  };
  let body = walk(root)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const suffix = body.match(/(?:^|\n)\s*((?:#[\p{L}\p{N}_]+#?[\s,，]*)+)$/u);
  const topics = suffix ? parseTopics(suffix[1]) : [];
  if (suffix) body = body.slice(0, suffix.index).trim();
  return { body, topics };
}
export function postCaption(
  platform: PostPlatform,
  title: string,
  body: string,
  topics: string[],
): string {
  return [
    platform === "x" ? title.trim() : "",
    body.trim(),
    topics.map((tag) => `#${tag}`).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
}
/** Media constraints and Xiaohongshu limits; X owns its account-specific text limits. */
export function validatePost(
  platform: PostPlatform,
  title: string,
  body: string,
  topics: string[],
  images: number,
): void {
  const max = platform === "x" ? 4 : 18;
  if (images > max)
    throw new Error(
      `${platform === "x" ? "X 普通图文帖" : "小红书图文笔记"}最多 ${max} 张图片，当前 ${images} 张。请删减图片或切换长文；不会自动丢图。`,
    );
  if (platform === "xiaohongshu" && !images)
    throw new Error("小红书图文笔记至少需要 1 张图片。请在正文中插入图片。");
  if (topics.some((tag) => !/^[\p{L}\p{N}_]+$/u.test(tag)))
    throw new Error("话题只支持文字、数字和下划线，请用空格分隔话题。");
  if (platform === "xiaohongshu") {
    if (topics.length > 10)
      throw new Error("小红书最多填写 10 个话题；部分账号可能有更低限制。");
    if (
      topics.some(
        (tag) =>
          [...tag].reduce(
            (sum, ch) => sum + (ch.charCodeAt(0) > 127 ? 2 : 1),
            0,
          ) > 30,
      )
    )
      throw new Error("小红书单个话题最多 30 字节（约 15 个汉字）。");
    if ([...title].length > 20)
      throw new Error("小红书图文标题超过 20 字，请修改后再同步。");
    if ([...postCaption(platform, title, body, topics)].length > 1000)
      throw new Error("小红书图文正文和话题超过 1,000 字，请缩短或切换长文。");
  }
  if (!postCaption(platform, title, body, topics) && !images)
    throw new Error("帖子内容为空。");
}
