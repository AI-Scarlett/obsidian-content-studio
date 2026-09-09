import { postProbe, postVisible } from "./platforms/posts";
import { findEditor, platformFor } from "./editor";
import { destinations, destinationUrl } from "./handoff";
import type { Destination, Probe, PublishMode } from "./types";
export interface Preparation {
  probe?: Probe;
  navigate?: string;
  status?: string;
}
const created = new WeakSet<Document>();
/** Only operate within a new tab created for this delivery. Never click a publish control. */
export function prepareDestination(
  doc: Document,
  expected: Destination,
  mode?: PublishMode,
): Preparation {
  if (platformFor(doc.location.hostname) !== expected)
    return { status: "请在平台页面完成登录，登录后自动继续。" };
  if (
    /(?:^|\/)(?:signin|login|signup)(?:\/|$)|^\/account\/access/.test(
      doc.location.pathname,
    )
  )
    return { status: "请在平台页面完成登录，登录后自动继续。" };
  if (mode === "post") {
    const probe = postProbe(doc, expected);
    if (probe) return { probe };
    const url = destinationUrl(expected, mode);
    if (expected === "x" && doc.location.pathname !== "/compose/post")
      return { navigate: url };
    if (expected === "xiaohongshu") {
      if (
        doc.location.pathname !== "/publish/publish" ||
        new URL(doc.location.href).searchParams.get("target") !== "image"
      )
        return { navigate: url };
      const tab = [...doc.querySelectorAll<HTMLElement>(".creator-tab")].find(
        (el) => postVisible(el) && el.textContent?.trim() === "上传图文",
      );
      if (tab && !created.has(doc)) {
        created.add(doc);
        tab.click();
      }
    }
    return { status: "正在等待图文上传页；请完成登录后自动继续。" };
  }
  const target = findEditor(doc);
  if (target) return { probe: target.probe };
  const visible = (el: HTMLElement) => el.getClientRects().length > 0;
  if (expected === "x") {
    if (!doc.location.pathname.startsWith("/compose/articles"))
      return { navigate: destinations.x };
    const actions = [
      ...doc.querySelectorAll<HTMLElement>('button,[role="button"],a[href]'),
    ].filter(
      (el) =>
        visible(el) &&
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-disabled") !== "true" &&
        (!el.hasAttribute("href") ||
          (() => {
            try {
              return (
                new URL(el.getAttribute("href")!, doc.location.href).href ===
                destinations.x
              );
            } catch {
              return false;
            }
          })()),
    );
    const labels = (el: HTMLElement) =>
      [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.textContent,
      ].map((value) => value?.trim() || "");
    // Prefer the visible Write action. Translated text and icon labels are
    // independent: whitespace/text inside an icon must not hide its aria-label.
    const create =
      actions.find((el) =>
        labels(el).some((label) =>
          /^(Write|Write an article|写文章|撰写文章)$/i.test(label),
        ),
      ) ||
      actions.find((el) =>
        labels(el).some((label) =>
          /^(Create|Create article|创建文章|新建文章|创建|创造)$/i.test(label),
        ),
      );
    if (create && !created.has(doc)) {
      created.add(doc);
      create.click();
      return { status: "正在创建 X Articles 长文草稿…" };
    }
    return {
      status:
        "正在等待 X 长文编辑器。请完成登录；若平台提示订阅或没有 Articles 权限，需先在 X 开通相应功能。",
    };
  }
  if (expected === "xiaohongshu") {
    // Long-form landing page uses this exact visible action, verified in Chrome.
    const create = [
      ...doc.querySelectorAll<HTMLElement>(
        "button, [role=button], .new-creation-btn",
      ),
    ].find((el) => visible(el) && el.textContent?.trim() === "新的创作");
    if (create && !created.has(doc)) {
      created.add(doc);
      create.click();
      return { status: "正在创建小红书长文草稿…" };
    }
    // Some platform versions render the action as a plain div.
    const leaf = [...doc.querySelectorAll<HTMLElement>("div,span")].find(
      (el) =>
        !el.children.length &&
        visible(el) &&
        el.textContent?.trim() === "新的创作",
    );
    if (leaf && !created.has(doc)) {
      created.add(doc);
      leaf.click();
      return { status: "正在创建小红书长文草稿…" };
    }
    if (doc.location.pathname === "/home")
      return { navigate: destinations.xiaohongshu };
  }
  if (
    expected === "zhihu" &&
    doc.location.pathname !== "/write" &&
    !doc.location.pathname.startsWith("/p/")
  )
    return { navigate: destinations.zhihu };
  if (expected === "wechat") {
    // Use only a visible new-article link furnished by the logged-in UI.
    // Existing draft edit links and all publish/save buttons are excluded.
    const link = [...doc.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
      (el) => {
        if (
          !visible(el) ||
          !["图文", "图文消息", "写文章", "新建图文"].includes(
            el.textContent?.trim() || "",
          )
        )
          return false;
        try {
          const url = new URL(el.href, doc.location.href);
          return (
            url.origin === "https://mp.weixin.qq.com" &&
            ["/cgi-bin/appmsg", "/cgi-bin/appmsg_edit"].includes(
              url.pathname,
            ) &&
            ["edit", ""].includes(url.searchParams.get("action") || "") &&
            !["appmsgid", "appmsg_id", "draft_id"].some((key) =>
              url.searchParams.has(key),
            )
          );
        } catch {
          return false;
        }
      },
    );
    if (link) return { navigate: link.href };
  }
  return {
    status:
      "正在等待平台登录或新稿编辑器。登录后会自动继续；也可以在平台页面打开新文章。",
  };
}
