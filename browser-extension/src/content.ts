import { prepareDestination } from "./navigation";
import { EditorSession, findEditor } from "./editor";
import type { Command, Reply } from "./types";

// ActiveTab injection may happen repeatedly; install one listener in this isolated world.
const scope = globalThis as typeof globalThis & {
  mogaoImporterInstalled?: boolean;
};
if (!scope.mogaoImporterInstalled) {
  scope.mogaoImporterInstalled = true;
  let session: EditorSession | undefined;
  let busy = false;
  let timer: number | undefined;
  const cleanup = () => {
    session?.cancel();
    session = undefined;
    window.clearTimeout(timer);
  };
  chrome.runtime.onMessage.addListener(
    (message: Command, sender, respond: (reply: Reply) => void) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message.op === "cancel") {
        cleanup();
        respond({ ok: true });
        return;
      }
      if (message.op === "prepare") {
        respond({
          ok: true,
          preparation: prepareDestination(document, message.platform),
        });
        return;
      }
      if (message.op === "probe") {
        respond({ ok: true, probe: findEditor(document)?.probe });
        return;
      }
      if (busy) {
        respond({ ok: false, error: "导入正在进行，请勿重复操作。" });
        return;
      }
      busy = true;
      window.clearTimeout(timer);
      void (async () => {
        if (message.op === "begin") {
          if (session) throw new Error("当前页面已有导入任务，请先停止。");
          const target = findEditor(document);
          if (!target) throw new Error("未识别到兼容的长文编辑器。");
          session = new EditorSession(target.root, target.platform);
          return session.begin(message.plan, message.markers);
        }
        if (!session) throw new Error("导入会话不存在，请重新检查编辑器。");
        if (message.op === "image") return session.image(message.image);
        if (message.op === "finish") {
          const text = await session.finish();
          cleanup();
          return text;
        }
        throw new Error("未知导入指令。");
      })()
        .then((text) =>
          respond({
            ok: true,
            progress: { text, done: message.op === "finish" },
          }),
        )
        .catch((error: unknown) => {
          cleanup();
          respond({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          busy = false;
          if (session) timer = window.setTimeout(cleanup, 120000);
        });
      return true;
    },
  );
}
