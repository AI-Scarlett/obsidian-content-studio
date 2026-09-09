import { prepareArticle, readArticle } from "./package";
import { destinations, handoffUrl, jobEndpoint } from "./handoff";
import type { Command, ImportPlan, Probe, Reply } from "./types";

const q = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const source = handoffUrl(new URL(location.href).searchParams.get("job"));
const runId = crypto.randomUUID();
const headers = {
  "X-Mogao-Extension": chrome.runtime.id,
  "X-Mogao-Run": runId,
  "X-Mogao-Protocol": "5",
  "Content-Type": "application/json",
};
const names = {
  wechat: "微信公众号",
  xiaohongshu: "小红书长文",
  zhihu: "知乎专栏",
  x: "X 长文",
};
let tabId: number | undefined;
let target: { frameId: number; probe: Probe } | undefined;
let cancelled = false;
let importing = false;
let completed = false;
let claimed = false;
let lastStatus = "";
let reporting = Promise.resolve();
const pause = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));
function check() {
  if (cancelled) throw new Error("已停止同步，已同步内容保留在平台草稿中。");
}
async function report(text: string, done = false) {
  q("status").textContent = text;
  if (text === lastStatus && !done) return;
  lastStatus = text;
  if (!source || !claimed) return;
  // Serialize progress so a slow old request cannot overwrite newer status.
  reporting = reporting.then(async () => {
    await fetch(jobEndpoint(source), {
      method: "POST",
      headers,
      body: JSON.stringify({ status: text, done }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  });
  await reporting;
}
async function pageCommand(frameId: number, message: Command): Promise<Reply> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId!, frameIds: [frameId] },
    world: "MAIN",
    func: async (owner: string, command: Command): Promise<Reply> => {
      const runtime = (
        globalThis as typeof globalThis & {
          __mogaoArticleV5?: import("./content").MainRuntime;
        }
      ).__mogaoArticleV5;
      if (runtime?.version !== 5)
        return { ok: false, error: "平台适配器未加载，请更新墨稿扩展。" };
      return runtime.dispatch(owner, command);
    },
    args: [runId, message],
  });
  return results[0]?.result || { ok: false, error: "平台没有响应。" };
}
async function command(message: Command): Promise<Reply> {
  if (tabId === undefined || !target) throw new Error("平台编辑器尚未就绪。");
  const reply = await pageCommand(target.frameId, message);
  if (!reply?.ok)
    throw new Error(reply?.error || "平台编辑器已关闭或没有响应。");
  return reply;
}
async function waitForEditor(plan: ImportPlan) {
  const deadline = Date.now() + 20 * 60 * 1000;
  let lastNavigation = "";
  let lastNavigationTime = 0;
  while (Date.now() < deadline) {
    check();
    const tab = await chrome.tabs.get(tabId!);
    if (
      tab.status === "complete" &&
      tab.url?.startsWith(new URL(destinations[plan.platform]).origin + "/")
    ) {
      let frames: chrome.scripting.InjectionResult[] = [];
      try {
        frames = await chrome.scripting.executeScript({
          target: { tabId: tabId!, allFrames: true },
          files: ["content.js"],
          world: "MAIN",
        });
      } catch {
        await report(
          "正在等待平台页面授权或加载完成。若持续停留，请在扩展的网站访问权限中允许此平台，然后重新加载扩展。",
        );
        await pause(1000);
        continue;
      }
      check();
      const probes = await Promise.all(
        frames.map(async (frame) => {
          try {
            const reply = await pageCommand(frame.frameId, { op: "probe" });
            return reply.probe
              ? { frameId: frame.frameId, probe: reply.probe }
              : undefined;
          } catch {
            return undefined;
          }
        }),
      );
      check();
      const found = probes.filter(
        (value): value is NonNullable<typeof value> => !!value,
      );
      if (found.length > 1)
        throw new Error(
          "平台同时显示多个编辑器，已停止同步，请在墨稿重新发布。",
        );
      if (found.length === 1) {
        if (found[0].probe.platform !== plan.platform)
          throw new Error("平台与稿件不一致。");
        if (!found[0].probe.empty || !found[0].probe.titleEmpty)
          throw new Error(
            "平台恢复了一篇已有内容的草稿，已停止，原稿没有被覆盖。请关闭该草稿后在墨稿重新发布。",
          );
        target = found[0];
        return;
      }
      let reply: Reply | undefined;
      try {
        reply = await pageCommand(0, {
          op: "prepare",
          platform: plan.platform,
        });
      } catch {
        /* document may still be changing */
      }
      const next = reply?.preparation?.navigate;
      if (
        next &&
        new URL(next).origin === new URL(destinations[plan.platform]).origin &&
        (next !== lastNavigation || Date.now() - lastNavigationTime > 15000)
      ) {
        check();
        lastNavigation = next;
        lastNavigationTime = Date.now();
        await chrome.tabs.update(tabId!, { url: next });
      }
      await report(reply?.preparation?.status || "正在等待平台的新稿编辑器…");
    } else await report("请在平台页面完成登录，登录后会自动继续同步。");
    await pause(1000);
  }
  throw new Error("等待平台登录或编辑器超时。请回到墨稿再次点击发布。");
}
async function run() {
  q("version").textContent = chrome.runtime.getManifest().version;
  if (!source) {
    q("intro").textContent =
      "扩展已安装。回到 Obsidian 墨稿，选择平台并点击“发布到平台”即可。";
    q("article").textContent = "从墨稿开始发布";
    q("guide").textContent = "稿件会自动送到这里，无需在浏览器选择或读取文件。";
    q("status").textContent = "等待墨稿发起发布。";
    return;
  }
  q<HTMLButtonElement>("cancel").disabled = false;
  try {
    const response = await fetch(jobEndpoint(source), {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(
        failure.error ||
          "发布任务已过期或已由另一个窗口接收，请在墨稿重新发布。",
      );
    }
    claimed = true;
    const payload = await response.json();
    check();
    const plan = prepareArticle(
      readArticle(JSON.stringify(payload.article), "json", undefined, window),
      window,
    );
    q("intro").textContent = "稿件已从墨稿送达，正在自动同步到平台。";
    q("article").textContent = plan.title;
    q("target").textContent =
      `${names[plan.platform]} · ${plan.images.length} 张图片`;
    await report(`正在打开${names[plan.platform]}…`);
    check();
    const tab = await chrome.tabs.create({
      url: destinations[plan.platform],
      active: true,
    });
    if (tab.id === undefined) throw new Error("无法打开平台标签页。");
    tabId = tab.id;
    q<HTMLButtonElement>("show").disabled = false;
    await waitForEditor(plan);
    check();
    // Recheck immediately before changing the editor; never reuse an existing draft.
    const probe = (await command({ op: "probe" })).probe;
    if (!probe?.empty || !probe.titleEmpty || probe.platform !== plan.platform)
      throw new Error("平台草稿已变化，已停止同步。");
    const { images, ...body } = plan;
    importing = true;
    await report("正在同步正文…");
    check();
    await command({
      op: "begin",
      plan: body,
      markers: images.map((image) => image.marker),
    });
    for (const [index, image] of images.entries()) {
      check();
      await report(`正在上传图片 ${index + 1} / ${images.length}…`);
      check();
      await command({ op: "image", image });
    }
    check();
    const result = await command({ op: "finish" });
    if (result.progress?.navigate) {
      const next = new URL(result.progress.navigate);
      const allowed =
        plan.platform === "wechat" &&
        next.origin === "https://mp.weixin.qq.com" &&
        next.pathname === "/cgi-bin/appmsg" &&
        next.searchParams.get("action") === "edit" &&
        /^\d+$/.test(next.searchParams.get("appmsgid") || "");
      if (!allowed)
        throw new Error("平台返回了无法识别的草稿地址，已停止跳转。");
      // The draft already exists: navigation failure must not cause another create request.
      try {
        await chrome.tabs.update(tabId!, { url: next.href, active: true });
      } catch {
        throw new Error(
          "公众号草稿已创建，但编辑页未能打开。请到公众号草稿箱查看，不要重复发送。",
        );
      }
    }
    completed = true;
    await report(
      result.progress?.text || "图文同步完成，请在平台检查后自行发表。",
      true,
    );
    q("guide").textContent =
      "标题、正文和图片已经填写。请在平台预览并确认草稿保存完成，最后由你点击发表。";
  } catch (error) {
    if (importing) await command({ op: "cancel" }).catch(() => {});
    q("status").classList.add("error");
    await report(error instanceof Error ? error.message : String(error), true);
    completed = true;
  } finally {
    importing = false;
    q<HTMLButtonElement>("cancel").disabled = true;
  }
}
q("show").addEventListener("click", () => {
  if (tabId !== undefined) void chrome.tabs.update(tabId, { active: true });
});
q("cancel").addEventListener("click", () => {
  cancelled = true;
  q<HTMLButtonElement>("cancel").disabled = true;
  if (importing) void command({ op: "cancel" }).catch(() => {});
  void report("已停止同步，已同步内容保留在平台草稿中。", true);
});
window.addEventListener("pagehide", () => {
  cancelled = true;
  if (importing) void command({ op: "cancel" }).catch(() => {});
  if (source && claimed && !completed)
    void fetch(jobEndpoint(source), {
      method: "POST",
      headers,
      keepalive: true,
      body: JSON.stringify({
        status: "发布窗口已关闭，同步停止。",
        done: true,
      }),
    }).catch(() => {});
});
void run();
