export type LaunchError = "worker-unavailable" | "tab-changed" | "open-failed";
export type LaunchReply =
  { ok: true; version: string } | { ok: false; error: LaunchError };
export const launchErrors: Record<LaunchError, string> = {
  "worker-unavailable":
    "扩展已检测到，但后台没有响应。请在扩展管理页重新加载墨稿，再刷新此页。",
  "tab-changed": "发布页面已经变化，已停止打开。请回到墨稿重新点击发布。",
  "open-failed":
    "扩展已连接，但未能打开发送窗口。请点击“重新连接”；仍失败时重新加载扩展。",
};
