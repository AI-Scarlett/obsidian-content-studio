import { MAX_PACKAGE_BYTES, prepareArticle, readArticle } from "./package";
import type { Command, ImportPlan, Probe, Reply } from "./types";

const q = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const tabId = Number(new URL(location.href).searchParams.get("tab"));
const checkButton = q<HTMLButtonElement>("check"),
  importButton = q<HTMLButtonElement>("import"),
  cancelButton = q<HTMLButtonElement>("cancel"),
  fileInput = q<HTMLInputElement>("file");
let target: { frameId: number; probe: Probe } | undefined;
let plan: ImportPlan | undefined;
let importing = false;
let cancelled = false;
const names = {
  wechat: "微信公众号",
  xiaohongshu: "小红书长文",
  zhihu: "知乎专栏",
};
function status(text: string, error = false) {
  q("status").textContent = text;
  q("status").classList.toggle("error", error);
}
function buttons() {
  checkButton.disabled = importing;
  fileInput.disabled = importing;
  importButton.disabled =
    importing ||
    !plan ||
    !target ||
    !target.probe.empty ||
    !target.probe.titleEmpty ||
    plan.platform !== target.probe.platform;
  cancelButton.disabled = !importing;
}
function fail(error: unknown) {
  status(error instanceof Error ? error.message : String(error), true);
}
async function command(message: Command): Promise<Reply> {
  if (!target) throw new Error("尚未识别编辑器。");
  const reply: Reply = await chrome.tabs.sendMessage(tabId, message, {
    frameId: target.frameId,
  });
  if (!reply?.ok)
    throw new Error(reply?.error || "编辑器没有响应，请重新检查。");
  return reply;
}
async function inspect() {
  target = undefined;
  buttons();
  try {
    if (!Number.isSafeInteger(tabId) || tabId <= 0)
      throw new Error("请在目标平台标签页点击扩展图标打开。");
    const tab = await chrome.tabs.get(tabId);
    const host = new URL(tab.url || "about:blank").hostname;
    if (
      ![
        "creator.xiaohongshu.com",
        "mp.weixin.qq.com",
        "zhuanlan.zhihu.com",
      ].includes(host)
    )
      throw new Error(
        "请先打开公众号、小红书长文或知乎专栏的编辑页，然后在该页面点击扩展图标。",
      );
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"],
    });
    const probes = await Promise.all(
      frames.map(async (frame) => {
        try {
          const reply: Reply = await chrome.tabs.sendMessage(
            tabId,
            { op: "probe" },
            { frameId: frame.frameId },
          );
          return reply.probe
            ? { frameId: frame.frameId, probe: reply.probe }
            : undefined;
        } catch {
          return undefined;
        }
      }),
    );
    const found = probes.filter((probe) => !!probe);
    if (found.length !== 1)
      throw new Error(
        "没有找到唯一可用的长文编辑器。请确认已进入正文编辑页；当前版本可能尚不兼容这个页面。",
      );
    target = found[0];
    q("target").textContent =
      `${names[target.probe.platform]} · ${target.probe.empty && target.probe.titleEmpty ? "空白草稿，可以导入" : "已有内容，请换用标题和正文都为空的新草稿"}`;
    if (fileInput.files?.[0]) await loadFile();
    buttons();
  } catch (error) {
    q("target").textContent = "尚不可导入";
    fail(error);
  }
}
async function loadFile() {
  plan = undefined;
  buttons();
  try {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!target) throw new Error("请先检查编辑器，再选择内容包。");
    if (file.size > MAX_PACKAGE_BYTES)
      throw new Error("内容包超过 64 MB，请拆分文章。");
    const article = readArticle(
      await file.text(),
      file.name.endsWith(".html") ? "html" : "json",
      target.probe.platform,
      window,
    );
    const prepared = prepareArticle(article, window);
    if (prepared.platform !== target.probe.platform)
      throw new Error(
        "内容包的平台与当前编辑器不同，请在墨稿选择当前平台后重新导出。",
      );
    plan = prepared;
    q("article").textContent =
      `《${plan.title}》\n${plan.images.length} 个图片位置 · ${names[plan.platform]}`;
    status(
      "准备完成。点击后将向当前平台上传这篇文章的图片；导入期间请保持目标页面打开，不要编辑正文。",
    );
    buttons();
  } catch (error) {
    q("article").textContent = "文件未准备好";
    fail(error);
  }
}
async function run() {
  if (!plan || !target || importing) return;
  importing = true;
  cancelled = false;
  buttons();
  try {
    // Probe again immediately before mutation: page may have changed while the file was selected.
    const probe = (await command({ op: "probe" })).probe;
    if (!probe?.empty || !probe.titleEmpty || probe.platform !== plan.platform)
      throw new Error("目标草稿已变化，请换用空白草稿并重新检查。");
    const { images, ...body } = plan;
    status("正在导入正文并设置图片位置…");
    await command({
      op: "begin",
      plan: body,
      markers: images.map((image) => image.marker),
    });
    for (const [index, image] of images.entries()) {
      if (cancelled) throw new Error("已停止导入，已导入部分保留在草稿中。");
      status(`正在由平台上传图片 ${index + 1} / ${images.length}…`);
      const reply = await command({ op: "image", image });
      status(reply.progress?.text || "正在核对图片…");
    }
    if (cancelled) throw new Error("已停止导入。");
    const result = await command({ op: "finish" });
    status(result.progress?.text || "导入流程完成，请检查草稿。");
  } catch (error) {
    await command({ op: "cancel" }).catch(() => {});
    fail(error);
  } finally {
    importing = false;
    // Reusing the same draft could duplicate the article. Require a fresh explicit probe.
    target = undefined;
    buttons();
    q("target").textContent =
      "本次导入已结束；再次导入前请打开空白草稿并重新检查。";
  }
}
checkButton.addEventListener("click", () => void inspect());
fileInput.addEventListener("change", () => void loadFile());
importButton.addEventListener("click", () => void run());
cancelButton.addEventListener("click", () => {
  cancelled = true;
  cancelButton.disabled = true;
  void command({ op: "cancel" }).catch(() => {});
  status("正在停止，已导入部分将保留在草稿中。");
});
window.addEventListener("pagehide", () => {
  if (importing) void command({ op: "cancel" }).catch(() => {});
});
void inspect();
