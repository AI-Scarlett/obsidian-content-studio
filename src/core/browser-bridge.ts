import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import {
  setTimeout as scheduleExpiry,
  clearTimeout as cancelExpiry,
} from "node:timers";
// Ephemeral ports allow multiple vaults to publish without colliding.
export const BRIDGE_PORT = 0;
declare const MOGAO_EXTENSION_ZIP: string;
const extensionArchive =
  typeof MOGAO_EXTENSION_ZIP === "string" ? MOGAO_EXTENSION_ZIP : "";
export type BridgePlatform = "wechat" | "xiaohongshu" | "zhihu";
export interface BrowserArticle {
  format: "mogao-article";
  version: 1;
  title: string;
  platform: BridgePlatform;
  html: string;
  source: "studio" | "note";
}
interface Delivery {
  article: BrowserArticle;
  expires: number;
  status: string;
  claimedBy?: string;
  runId?: string;
  timer: ReturnType<typeof scheduleExpiry>;
  notify: (message: string) => void;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const names = {
  wechat: "微信公众号",
  xiaohongshu: "小红书长文",
  zhihu: "知乎专栏",
};
/** Each click shares one frozen article through an expiring capability URL on loopback. */
export class BrowserBridge {
  private server?: Server;
  private deliveries = new Map<string, Delivery>();
  private port: number;
  constructor(port = BRIDGE_PORT) {
    this.port = port;
  }
  async start(): Promise<number> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() =>
        this.json(res, 500, { error: "发布连接出错，请在墨稿重试。" }),
      );
    });
    this.server.requestTimeout = 5000;
    this.server.headersTimeout = 5000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "127.0.0.1", () => {
        this.server!.removeListener("error", reject);
        const addr = this.server!.address();
        if (addr && typeof addr !== "string") this.port = addr.port;
        resolve();
      });
    });
    return this.port;
  }
  stop() {
    for (const id of this.deliveries.keys()) this.remove(id);
    this.server?.close();
    this.server?.closeAllConnections();
  }
  publish(
    article: BrowserArticle,
    notify: (message: string) => void = () => {},
  ): string {
    if (!this.server?.listening)
      throw new Error("浏览器发布连接未启动，请重载墨稿插件后重试。");
    this.prune();
    if (this.deliveries.size >= 4)
      throw new Error("已有发布任务正在进行，请先完成或等待旧任务过期。");
    if (Buffer.byteLength(JSON.stringify(article)) > 64 * 1024 * 1024)
      throw new Error("稿件超过 64 MB，请拆分后发布。");
    const id = randomBytes(32).toString("hex");
    const timer = scheduleExpiry(() => this.remove(id), 30 * 60 * 1000);
    timer.unref();
    this.deliveries.set(id, {
      timer,
      article: structuredClone(article),
      expires: Date.now() + 30 * 60 * 1000,
      status: "等待浏览器扩展",
      notify,
    });
    return `http://127.0.0.1:${this.port}/publish/${id}`;
  }
  private remove(id: string) {
    const job = this.deliveries.get(id);
    if (job) cancelExpiry(job.timer);
    this.deliveries.delete(id);
  }
  private prune() {
    for (const [id, job] of this.deliveries)
      if (job.expires < Date.now()) this.remove(id);
  }
  private json(res: ServerResponse, status: number, data: unknown) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  }
  private page(
    res: ServerResponse,
    title: string,
    body: string,
    script = false,
  ) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'",
    });
    res.end(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#243b33;background:#f4f5f0;margin:0}main{max-width:660px;margin:12vh auto;padding:36px;background:white;border-radius:18px}h1{font-size:26px}a,button{color:#2d5747}small{color:#728177}button{font:inherit;padding:10px 18px;cursor:pointer}</style><main>${body}</main>${script ? '<script src="/launch.js"></script>' : ""}</html>`,
    );
  }
  private async body(req: IncomingMessage) {
    if (req.headers["content-type"] !== "application/json")
      throw Error("Invalid JSON");
    let text = "";
    for await (const data of req as AsyncIterable<unknown>) {
      if (!Buffer.isBuffer(data)) throw Error("Invalid body");
      text += data.toString("utf8");
      if (text.length > 2048) throw Error("Too large");
    }
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid body");
    return value as Record<string, unknown>;
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.host !== `127.0.0.1:${this.port}`) {
      this.json(res, 403, { error: "不允许的连接地址。" });
      return;
    }
    const origin = req.headers.origin;
    if (
      origin &&
      !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
      origin !== `http://127.0.0.1:${this.port}`
    ) {
      this.json(res, 403, { error: "不允许的网页来源。" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Mogao-Extension, X-Mogao-Run",
      );
      this.json(res, 200, {});
      return;
    }
    this.prune();
    const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);
    if (req.method === "GET" && url.pathname === "/extension.zip") {
      if (!extensionArchive) {
        this.json(res, 404, { error: "当前构建未附带扩展，请使用完整构建。" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="mogao-browser-extension-0.2.0-preview.zip"',
        "Cache-Control": "no-store",
      });
      res.end(Buffer.from(extensionArchive, "base64"));
      return;
    }
    if (req.method === "GET" && url.pathname === "/launch.js") {
      res.writeHead(200, {
        "Content-Type": "text/javascript",
        "Cache-Control": "no-store",
      });
      res.end(
        `let connected=false;window.addEventListener('message',e=>{if(e.source===window&&e.data?.type==='mogao-extension-ready'){connected=true;document.getElementById('state').textContent='扩展已连接，正在打开发布平台…';}});window.setTimeout(()=>{if(!connected)location.replace('/install'+location.pathname);},2500);`,
      );
      return;
    }
    const match = url.pathname.match(
      /^\/(publish|install\/publish|v1\/jobs)\/([a-f\d]{64})$/,
    );
    const id = match?.[2] || "";
    const job = this.deliveries.get(id);
    if (!match || !job) {
      this.json(res, 404, {
        error: "发布任务不存在或已过期，请回到墨稿重新点击发布。",
      });
      return;
    }
    if (req.method === "GET" && match[1] === "publish") {
      this.page(
        res,
        "墨稿正在发布",
        `<h1>正在打开${names[job.article.platform]}</h1><p>《${escape(job.article.title)}》</p><p id="state">正在调用墨稿浏览器扩展…</p><small>未登录时，请在平台页面完成登录；登录后会自动继续同步。最后的发表由你确认。</small>`,
        true,
      );
      return;
    }
    if (req.method === "GET" && match[1] === "install/publish") {
      this.page(
        res,
        "安装墨稿浏览器扩展",
        `<h1>先安装墨稿浏览器扩展</h1><p>安装一次，之后在 Obsidian 点“发布”即可自动打开平台并同步整篇图文。</p><p>当前为开发预览版，尚未上架 Chrome 扩展商店。</p><p>已安装过：在 Chrome 扩展管理页重新加载墨稿扩展，使新版本生效。</p><p><a href="/extension.zip" download>下载墨稿浏览器扩展</a>，解压后在 Chrome / Edge 扩展管理页开启开发者模式，选择“加载已解压的扩展程序”。</p><p>详细步骤：<a href="https://github.com/AI-Scarlett/obsidian-content-studio/tree/feat/browser-article-import-preview/browser-extension" target="_blank" rel="noreferrer">打开安装说明</a></p><p><a href="/publish/${id}">安装完成，继续发布</a></p>`,
      );
      return;
    }
    if (match[1] !== "v1/jobs") {
      this.json(res, 405, {});
      return;
    }
    const extensionId = req.headers["x-mogao-extension"];
    if (
      typeof extensionId !== "string" ||
      !/^[a-p]{32}$/.test(extensionId) ||
      (origin && origin !== `chrome-extension://${extensionId}`) ||
      (job.claimedBy && job.claimedBy !== extensionId)
    ) {
      this.json(res, 403, { error: "发布任务只能由墨稿浏览器扩展接收。" });
      return;
    }
    const runId = req.headers["x-mogao-run"];
    if (typeof runId !== "string" || !/^[a-f\d-]{36}$/.test(runId)) {
      this.json(res, 403, { error: "缺少本次发布窗口标识。" });
      return;
    }
    if (job.runId && job.runId !== runId) {
      this.json(res, 409, {
        error: "这篇稿件已由另一个发布窗口接收，请查看已经打开的平台页面。",
      });
      return;
    }
    if (req.method === "GET") {
      job.claimedBy = extensionId;
      job.runId = runId;
      this.json(res, 200, { article: job.article, status: job.status });
      return;
    }
    if (req.method === "POST") {
      if (!job.runId) {
        this.json(res, 409, { error: "发布任务尚未接收。" });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await this.body(req);
      } catch {
        this.json(res, 400, {});
        return;
      }
      if (typeof body.status !== "string" || body.status.length > 300) {
        this.json(res, 400, {});
        return;
      }
      job.status = body.status;
      job.notify(body.status);
      this.json(res, 200, { ok: true });
      if (body.done === true) this.remove(id);
      return;
    }
    this.json(res, 405, {});
  }
}
