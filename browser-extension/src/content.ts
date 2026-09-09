import { prepareDestination } from "./navigation";
import { EditorSession, findEditor } from "./editor";
import { WechatSession, wechatProbe } from "./platforms/wechat";
import type { Command, Reply } from "./types";

export interface MainRuntime {
  version: 6;
  dispatch(owner: string, message: Command): Promise<Reply>;
}
const scope = globalThis as typeof globalThis & {
  __mogaoArticleV6?: MainRuntime;
};
// Injected explicitly into MAIN only after a user sends a draft from Obsidian.
// No page message listener, remote code, cookie export or publication endpoint.
if (!scope.__mogaoArticleV6) {
  let session: EditorSession | WechatSession | undefined;
  let owner: string | undefined;
  let busy = false;
  let timer: number | undefined;
  const cleanup = () => {
    session?.cancel();
    session = undefined;
    window.clearTimeout(timer);
  };
  scope.__mogaoArticleV6 = {
    version: 6,
    async dispatch(requestOwner, message) {
      if (!/^[a-f\d-]{36}$/.test(requestOwner))
        return { ok: false, error: "发布任务标识不正确。" };
      if (message.op === "probe")
        return {
          ok: true,
          probe: wechatProbe(document) || findEditor(document)?.probe,
        };
      if (message.op === "prepare")
        return {
          ok: true,
          preparation: prepareDestination(document, message.platform),
        };
      if (owner && owner !== requestOwner)
        return {
          ok: false,
          error: "此页已由另一篇墨稿任务使用，当前草稿保留。",
        };
      if (message.op === "cancel") {
        cleanup();
        return { ok: true };
      }
      if (busy) return { ok: false, error: "同步正在进行，请勿重复操作。" };
      try {
        busy = true;
        window.clearTimeout(timer);
        if (message.op === "begin") {
          if (owner)
            throw new Error("本页的同步任务已开始或结束，请勿重复写入。");
          owner = requestOwner;
          const probe = wechatProbe(document);
          if (message.plan.platform === "wechat" && probe)
            session = new WechatSession(document);
          else {
            const target = findEditor(document);
            if (!target) throw new Error("未识别到兼容的长文编辑器。");
            session = new EditorSession(target.root, target.platform);
          }
          return {
            ok: true,
            progress: {
              text: await session.begin(message.plan, message.markers),
              done: false,
            },
          };
        }
        if (!session) throw new Error("同步会话已停止，请检查平台草稿。");
        if (message.op === "image")
          return {
            ok: true,
            progress: { text: await session.image(message.image), done: false },
          };
        if (message.op === "finish") {
          const result = await session.finish();
          cleanup();
          return {
            ok: true,
            progress:
              typeof result === "string"
                ? { text: result, done: true }
                : { ...result, done: true },
          };
        }
        throw new Error("未知同步指令。");
      } catch (error) {
        cleanup();
        return {
          ok: false,
          error: error instanceof Error ? error.message : "平台同步失败。",
        };
      } finally {
        busy = false;
        if (session) timer = window.setTimeout(cleanup, 180000);
      }
    },
  };
}
