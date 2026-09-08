import { requestUrl } from "obsidian";
import { setTimeout, clearTimeout } from "node:timers";
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import ipaddr from "ipaddr.js";

export function validatePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入完整的 http:// 或 https:// 文章链接。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("仅支持不带账号密码的 HTTP/HTTPS 链接。");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("文章链接仅支持 80/443 端口。");
  if (
    host === "localhost" ||
    (!host.includes(".") && !ipaddr.isValid(host)) ||
    /\.(localhost|local|internal|test|invalid)$/i.test(host)
  )
    throw new Error("不能从本地或内网地址学习模板。");
  if (ipaddr.isValid(host) && !isPublicAddress(host))
    throw new Error("不能读取内网或保留地址。");
  return url;
}
export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (
      parsed.kind() === "ipv6" &&
      (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    )
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export interface Download {
  data: Uint8Array;
  contentType: string;
  finalUrl: string;
}
type Address = { address: string; family: number };
async function publicDns(host: string): Promise<Address[]> {
  // TUN proxies may return 198.18/15 fake IPs. Resolve public names independently
  // instead of treating benchmark/private addresses as safe destinations.
  const response = await requestUrl({
    url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    headers: { Accept: "application/dns-json" },
    throw: false,
  });
  if (response.status !== 200)
    throw new Error("无法解析代理后的真实地址，请稍后重试。");
  return parseDnsAnswers(response.text);
}
export function parseDnsAnswers(text: string): Address[] {
  if (text.length > 32000) throw new Error("DNS 响应异常。");
  const data: unknown = JSON.parse(text);
  if (
    !data ||
    typeof data !== "object" ||
    !("Answer" in data) ||
    !Array.isArray(data.Answer)
  )
    return [];
  const answers: unknown[] = data.Answer;
  return answers.flatMap((answer) =>
    answer &&
    typeof answer === "object" &&
    "type" in answer &&
    answer.type === 1 &&
    "data" in answer &&
    typeof answer.data === "string"
      ? [{ address: answer.data, family: 4 }]
      : [],
  );
}
export async function resolvePublicAddresses(
  host: string,
  systemResolve: (host: string) => Promise<Address[]> = (name) =>
    lookup(name, { all: true, verbatim: true }),
  fallback: (host: string) => Promise<Address[]> = publicDns,
): Promise<Address[]> {
  let addresses = await systemResolve(host);
  const fake = (a: Address) => /^198\.(18|19)\./.test(a.address);
  if (addresses.length && addresses.every(fake) && !ipaddr.isValid(host))
    addresses = await fallback(host);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("链接解析到了内网或保留地址，已停止读取。");
  return addresses;
}
export async function downloadPublic(
  raw: string,
  kind: "html" | "css" | "image" = "html",
): Promise<Download> {
  const max =
    kind === "image"
      ? 8 * 1024 * 1024
      : kind === "css"
        ? 300_000
        : 3 * 1024 * 1024;
  const deadline = Date.now() + 20000;
  async function visit(rawUrl: string, hops: number): Promise<Download> {
    if (hops > 4) throw new Error("页面跳转过多，请使用最终文章链接。");
    const url = validatePublicUrl(rawUrl),
      host = url.hostname.replace(/^\[|\]$/g, "");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("读取超时，请稍后重试或粘贴 HTML。");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      resolvePublicAddresses(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("域名解析超时。")),
          Math.min(remaining, 10000),
        );
      }),
    ]).finally(() => clearTimeout(timer));
    const chosen = addresses[0];
    return new Promise<Download>((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      let complete = false;
      const fail = (error: Error) => {
        if (!complete) {
          complete = true;
          clearTimeout(timeout);
          reject(error);
        }
      };
      const req = transport.get(
        url,
        {
          agent: false,
          headers: {
            "User-Agent": "Mozilla/5.0 ContentStudio/0.1.4",
            Accept:
              kind === "html"
                ? "text/html,application/xhtml+xml"
                : kind === "css"
                  ? "text/css"
                  : "image/png,image/jpeg,image/webp,image/gif,image/avif",
            "Accept-Encoding": "gzip, deflate, br",
          },
          lookup: (_hostname, options, callback) => {
            if (typeof options === "object" && options.all)
              callback(null, [chosen]);
            else callback(null, chosen.address, chosen.family);
          },
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
            const next = res.headers.location;
            res.destroy();
            clearTimeout(timeout);
            if (!next) {
              fail(new Error("页面跳转缺少目标地址。"));
              return;
            }
            let target: string;
            try {
              target = new URL(next, url).href;
            } catch {
              fail(new Error("页面返回了无效的跳转链接。"));
              return;
            }
            complete = true;
            visit(target, hops + 1).then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            res.destroy();
            fail(
              new Error(
                `页面返回 ${res.statusCode}，可能需要登录或验证。可改用粘贴 HTML。`,
              ),
            );
            return;
          }
          const mime = (res.headers["content-type"] || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          const allowed =
            kind === "html"
              ? ["text/html", "application/xhtml+xml"]
              : kind === "css"
                ? ["text/css", "text/plain"]
                : [
                    "image/png",
                    "image/jpeg",
                    "image/gif",
                    "image/webp",
                    "image/avif",
                  ];
          if (!allowed.includes(mime)) {
            res.destroy();
            fail(new Error(`链接返回了不支持的内容类型：${mime || "未知"}。`));
            return;
          }
          const encoding = res.headers["content-encoding"];
          const decoder =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : undefined;
          if (encoding && !decoder && encoding !== "identity") {
            res.destroy();
            fail(new Error("不支持的响应压缩格式。"));
            return;
          }
          const stream = decoder ? res.pipe(decoder) : res;
          const buffers: Buffer[] = [];
          let size = 0;
          res.on("error", fail);
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > max) {
              stream.destroy();
              res.destroy();
              req.destroy();
              fail(new Error("内容过大，已停止下载。"));
            } else buffers.push(Buffer.from(chunk));
          });
          stream.on("end", () => {
            if (complete) return;
            complete = true;
            clearTimeout(timeout);
            resolve({
              data: new Uint8Array(Buffer.concat(buffers)),
              contentType: mime,
              finalUrl: url.href,
            });
          });
        },
      );
      const timeout = setTimeout(
        () => {
          req.destroy();
          fail(new Error("读取超时，请稍后重试或粘贴 HTML。"));
        },
        Math.max(1, deadline - Date.now()),
      );
      req.on("error", fail);
    });
  }
  return visit(raw, 0);
}
