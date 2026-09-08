/**
 * WeChat material/draft protocol adapted from MultiPost-Extension (Apache-2.0),
 * leaperone/MultiPost-Extension@fdbc6c3b2f3c03f57be8a59b46e33860689ba509,
 * src/sync/article/weixin.ts. See licenses/MultiPost-Apache-2.0.txt.
 * Modified: typed responses, local image bytes, draft-only operation, no account logs,
 * no fixed cover crops, bounded requests, no retry after an uncertain draft creation.
 */
import type { ImportPlan, InlineImage, Probe } from "../types";
import { imageFile } from "./upload";
import { normalizeText } from "../package";

interface SessionInfo {
  token: string;
  ticket: string;
  userName: string;
}
interface Material {
  image: InlineImage;
  url: string;
  fileId: string;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
export function wechatProbe(doc: Document): Probe | undefined {
  if (doc.location.hostname !== "mp.weixin.qq.com") return;
  const url = new URL(doc.location.href);
  if (
    !/^\d+$/.test(url.searchParams.get("token") || "") ||
    !url.pathname.startsWith("/cgi-bin/")
  )
    return;
  return {
    platform: "wechat",
    editor: "wechat-material-draft-api",
    empty: true,
    titleEmpty: true,
  };
}
function parseInfo(doc: Document, html: string): SessionInfo {
  const urlToken = new URL(doc.location.href).searchParams.get("token") || "";
  const common =
    html.match(/(?:window\.)?wx\.commonData\s*=\s*\{([\s\S]*?)\};/)?.[1] ||
    html;
  const token = /^\d+$/.test(urlToken)
    ? urlToken
    : common.match(/\bt:\s*["'](\d+)["']/)?.[1] || "";
  const field = (name: string) =>
    common.match(new RegExp(`\\b${name}\\s*:\\s*["']([^"']+)["']`))?.[1] || "";
  return { token, ticket: field("ticket"), userName: field("user_name") };
}
export function materializedHtml(
  doc: Document,
  html: string,
  materials: Material[],
): string {
  const parsed = new doc.defaultView!.DOMParser().parseFromString(
    html,
    "text/html",
  );
  for (const { image, url } of materials) {
    const walker = parsed.createTreeWalker(parsed.body, 4);
    const matches: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()))
      if (node.textContent?.includes(image.marker)) matches.push(node as Text);
    if (matches.length !== 1)
      throw new Error("公众号图片位置不唯一，未创建草稿。");
    const text = matches[0],
      at = text.data.indexOf(image.marker);
    if (text.data.indexOf(image.marker, at + image.marker.length) >= 0)
      throw new Error("公众号图片位置重复。");
    const img = parsed.createElement("img");
    img.setAttribute("src", url);
    img.setAttribute("data-src", url);
    if (image.alt) img.setAttribute("alt", image.alt);
    if (image.style) img.setAttribute("style", image.style);
    const after = text.splitText(at);
    after.splitText(image.marker.length);
    after.replaceWith(img);
  }
  if (/MOGAOIMAGE[a-f\d]{32}N\d+END/.test(parsed.body.textContent || ""))
    throw new Error("公众号图片尚未全部上传，未创建草稿。");
  return parsed.body.innerHTML;
}

export class WechatSession {
  private plan?: Omit<ImportPlan, "images">;
  private markers: string[] = [];
  private info?: SessionInfo;
  private materials: Material[] = [];
  private controller = new AbortController();
  private attempted = false;
  private win: Window & typeof globalThis;
  constructor(private doc: Document) {
    this.win = doc.defaultView as Window & typeof globalThis;
  }
  cancel() {
    this.controller.abort();
  }
  private check() {
    if (this.controller.signal.aborted)
      throw new Error("公众号同步已停止，已上传素材保留。");
  }
  private async request(url: string | URL, init: RequestInit = {}) {
    this.check();
    const target = new URL(url, this.doc.location.href);
    if (target.origin !== "https://mp.weixin.qq.com")
      throw new Error("公众号请求地址不正确。");
    const response = await this.win.fetch(target.href, {
      ...init,
      credentials: "same-origin",
      signal: this.win.AbortSignal.any([
        this.controller.signal,
        this.win.AbortSignal.timeout(45000),
      ]),
    });
    this.check();
    if (!response.ok)
      throw new Error(`公众号请求失败（${response.status}），请检查登录状态。`);
    return response;
  }
  private endpoint(path: string, params: Record<string, string> = {}) {
    if (!this.info) throw new Error("公众号登录信息不可用。");
    const url = new URL(path, "https://mp.weixin.qq.com");
    for (const [key, value] of Object.entries({
      ...params,
      token: this.info.token,
      lang: "zh_CN",
      f: "json",
    }))
      url.searchParams.set(key, value);
    return url;
  }
  async begin(plan: Omit<ImportPlan, "images">, markers: string[]) {
    if (this.plan) throw new Error("公众号同步任务已开始，请勿重复。");
    if (plan.platform !== "wechat" || !wechatProbe(this.doc))
      throw new Error("请先完成公众号登录。");
    if (Array.from(plan.title).length > 64)
      throw new Error("公众号标题超过 64 字，请先在墨稿修改。");
    const html = await (await this.request("/")).text();
    this.info = parseInfo(this.doc, html);
    if (
      !this.info.token ||
      (markers.length && (!this.info.ticket || !this.info.userName))
    )
      throw new Error(
        "未取得公众号素材上传会话，请刷新公众号首页并重新登录后再试。",
      );
    this.plan = plan;
    this.markers = markers;
    return "公众号已连接，正在上传正文图片素材。";
  }
  async image(image: InlineImage) {
    this.check();
    if (
      !this.plan ||
      !this.info ||
      this.markers[this.materials.length] !== image.marker
    )
      throw new Error("公众号图片顺序不一致。");
    const file = imageFile(this.win, image);
    const form = new this.win.FormData();
    for (const [key, value] of Object.entries({
      type: file.type,
      id: String(Date.now()),
      name: file.name,
      lastModifiedDate: new Date().toString(),
      size: String(file.size),
    }))
      form.append(key, value);
    form.append("file", file, file.name);
    const response = await this.request(
      this.endpoint("/cgi-bin/filetransfer", {
        action: "upload_material",
        scene: "8",
        writetype: "doublewrite",
        groupid: "1",
        ticket_id: this.info.userName,
        ticket: this.info.ticket,
        svr_time: String(Math.floor(Date.now() / 1000)),
        seq: String(Date.now()),
      }),
      { method: "POST", body: form },
    );
    const value = record(await response.json());
    const base = record(value.base_resp);
    if (base.err_msg !== "ok" || typeof value.cdn_url !== "string")
      throw new Error("公众号图片素材上传失败，请检查平台登录或上传限制。");
    const url = new URL(value.cdn_url);
    if (
      !/^https?:$/.test(url.protocol) ||
      !/(^|\.)qpic\.cn$/.test(url.hostname)
    )
      throw new Error("公众号返回了无法识别的图片地址。");
    // Verify that the uploaded image is actually decodable in this authenticated page.
    await new Promise<void>((resolve, reject) => {
      const img = new this.win.Image();
      const timer = this.win.setTimeout(() => {
        img.src = "";
        reject(new Error("公众号图片素材暂时无法显示，未创建草稿。"));
      }, 20000);
      img.onload = () => {
        this.win.clearTimeout(timer);
        img.naturalWidth
          ? resolve()
          : reject(new Error("公众号图片素材为空。"));
      };
      img.onerror = () => {
        this.win.clearTimeout(timer);
        reject(new Error("公众号图片素材未加载成功。"));
      };
      img.src = url.href;
    });
    this.check();
    this.materials.push({
      image,
      url: url.href,
      fileId: String(value.content || ""),
    });
    return `公众号图片 ${this.materials.length} / ${this.markers.length} 已上传。`;
  }
  async finish() {
    this.check();
    if (!this.plan || this.materials.length !== this.markers.length)
      throw new Error("公众号图片尚未全部上传。");
    if (this.attempted)
      throw new Error("已请求创建公众号草稿；请先检查草稿箱，避免重复创建。");
    const html = materializedHtml(this.doc, this.plan.html, this.materials);
    const parsed = new this.win.DOMParser().parseFromString(html, "text/html");
    if (
      parsed.images.length !== this.materials.length ||
      this.plan.textParts.some(
        (part) => !normalizeText(parsed.body.textContent || "").includes(part),
      )
    )
      throw new Error("公众号图文完整性核对失败，未创建草稿。");
    const form = new this.win.FormData();
    // Fields adapted from MultiPost's createArticle. Empty covers are valid for drafts;
    // do not invent a cover crop or change copyright/originality declarations.
    const fields: Record<string, string> = {
      token: this.info!.token,
      lang: "zh_CN",
      f: "json",
      ajax: "1",
      random: String(Math.random()),
      AppMsgId: "",
      count: "1",
      data_seq: "0",
      operate_from: "Chrome",
      isnew: "0",
      title0: this.plan.title,
      author0: "",
      writerid0: "0",
      fileid0: "",
      digest0: "",
      auto_gen_digest0: "1",
      content0: html,
      sourceurl0: "",
      need_open_comment0: "1",
      only_fans_can_comment0: "0",
      cdn_url0: "",
      cdn_235_1_url0: "",
      cdn_16_9_url0: "",
      cdn_3_4_url0: "",
      cdn_1_1_url0: "",
      cdn_url_back0: "",
      crop_list0: '{"crop_list":[],"crop_list_percent":[]}',
      music_id0: "",
      video_id0: "",
      voteid0: "",
      voteismlt0: "",
      supervoteid0: "",
      cardid0: "",
      cardquantity0: "",
      cardlimit0: "",
      vid_type0: "",
      show_cover_pic0: "0",
      shortvideofileid0: "",
      copyright_type0: "0",
      releasefirst0: "",
      platform0: "",
      reprint_permit_type0: "",
      allow_reprint0: "",
      allow_reprint_modify0: "",
      original_article_type0: "",
      ori_white_list0: "",
      free_content0: "",
      fee0: "0",
      ad_id0: "",
      guide_words0: "",
      is_share_copyright0: "0",
      share_copyright_url0: "",
      source_article_type0: "",
      reprint_recommend_title0: "",
      reprint_recommend_content0: "",
      share_page_type0: "0",
      share_imageinfo0: '{"list":[]}',
      share_video_id0: "",
      dot0: "{}",
      share_voice_id0: "",
      insert_ad_mode0: "",
      categories_list0: "[]",
      compose_info0: '{"list":""}',
      ad_video_transition0: "",
      can_reward0: "0",
      related_video0: "",
      is_video_recommend0: "-1",
    };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    this.attempted = true;
    let value: Record<string, unknown>;
    try {
      value = record(
        await (
          await this.request(
            this.endpoint("/cgi-bin/operate_appmsg", {
              t: "ajax-response",
              sub: "create",
              type: "77",
            }),
            { method: "POST", body: form },
          )
        ).json(),
      );
    } catch {
      throw new Error(
        "公众号创建草稿的结果未能确认，请先检查草稿箱；不要立即重复发送，以免产生重复稿件。",
      );
    }
    const id = String(value.appMsgId || "");
    if (!/^\d+$/.test(id))
      throw new Error(
        "公众号没有返回草稿编号，请检查登录状态和平台限制后重试。",
      );
    const edit = this.endpoint("/cgi-bin/appmsg", {
      t: "media/appmsg_edit",
      action: "edit",
      type: "77",
      appmsgid: id,
    });
    edit.searchParams.delete("f");
    return {
      text: `公众号草稿已创建，包含标题、正文和 ${this.materials.length} 张图片。正在打开编辑页，请预览并检查封面。`,
      navigate: edit.href,
    };
  }
}
