import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorDriver, InlineImage } from "../types";
import { articleBlocks, blocksHtml } from "./blocks";
import { delay, imageFile, pictureButton, uploadThroughPicker } from "./upload";

export class TiptapDriver implements EditorDriver {
  private editor: Editor;
  private win: Window & typeof globalThis;
  private button?: HTMLElement;
  private stopped = false;
  cancel() {
    this.stopped = true;
  }
  private check() {
    if (this.stopped || this.editor.isDestroyed || !this.root.isConnected)
      throw new Error("同步已停止，当前草稿保留。");
  }
  constructor(private root: HTMLElement) {
    // Tiptap itself attaches this property in Editor.createView; it is only visible in MAIN.
    const editor = (root as HTMLElement & { editor?: Editor }).editor;
    if (!editor?.view?.state || !editor.commands?.setContent)
      throw new Error(
        "小红书长文编辑器版本不兼容：无法连接文档模型，原稿未修改。",
      );
    this.editor = editor;
    this.win = root.ownerDocument.defaultView as Window & typeof globalThis;
  }
  async write(html: string, markers: string[]) {
    if (markers.length)
      this.button = await pictureButton(this.root.ownerDocument, "xiaohongshu");
    this.check();
    this.editor.commands.setContent(
      blocksHtml(
        this.root.ownerDocument,
        articleBlocks(this.root.ownerDocument, html, markers),
      ),
      { emitUpdate: true },
    );
    await delay(this.win, 100);
  }
  private marker(marker: string) {
    const matches: { pos: number; node: PMNode }[] = [];
    this.editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === marker)
        matches.push({ node, pos });
    });
    if (matches.length !== 1)
      throw new Error("小红书图片位置在文档中不唯一，已停止。");
    return matches[0];
  }
  async upload(image: InlineImage) {
    this.check();
    const marker = this.marker(image.marker);
    // A collapsed model selection leaves the marker untouched until the upload completes.
    this.editor.commands.setTextSelection(marker.pos + 1);
    this.editor.view.focus();
    await delay(this.win, 80);
    this.check();
    const button = this.button;
    if (!button?.isConnected) throw new Error("小红书图片工具栏已关闭。");
    await uploadThroughPicker(
      this.win,
      imageFile(this.win, image),
      () => button.click(),
      4000,
      () => !this.stopped,
    );
  }
  async settle(image: InlineImage, candidate: HTMLImageElement) {
    this.check();
    const marker = this.marker(image.marker);
    const src = candidate.getAttribute("src");
    const nodes: { node: PMNode; pos: number }[] = [];
    this.editor.state.doc.descendants((node, pos) => {
      if (node.attrs.src === src) nodes.push({ node, pos });
    });
    const uploaded = nodes.find((n) => {
      const dom = this.editor.view.nodeDOM(n.pos);
      return dom === candidate || dom?.contains(candidate);
    });
    if (!uploaded || !uploaded.node.isBlock)
      throw new Error("小红书上传结果无法唯一对应到正文图片，已停止。");
    // Move the uploaded document node, with all its platform metadata, to the marker block.
    const tr = this.editor.state.tr.delete(
      uploaded.pos,
      uploaded.pos + uploaded.node.nodeSize,
    );
    const at = tr.mapping.map(marker.pos);
    tr.replaceWith(at, at + marker.node.nodeSize, uploaded.node);
    this.editor.view.dispatch(tr);
    await delay(this.win, 100);
  }
}
