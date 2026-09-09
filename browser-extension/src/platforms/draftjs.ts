/**
 * Draft.js state discovery and structured writes adapted from xPoster (MIT):
 * nevertoday/xposter@ac93d21dfe8482496441034e3e35d46aceefcbba, src/main-world.js.
 * Copyright (c) 2026 xPoster contributors. See licenses/xposter-MIT.txt.
 * Modified for scoped roots, typed state, native Zhihu uploads, strict single-upload
 * verification and preservation of the uploaded block's complete platform metadata.
 */
import type {
  CharacterMetadata,
  ContentBlock,
  ContentState,
  EditorState,
  SelectionState,
} from "draft-js";
import type { EditorDriver, InlineImage } from "../types";
import { articleBlocks } from "./blocks";
import { delay, imageFile, pictureButton, uploadThroughPicker } from "./upload";

export interface DraftHandle {
  props: { editorState: EditorState; onChange: (state: EditorState) => void };
}
interface Fiber {
  return?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
  stateNode?: Partial<DraftHandle>;
  memoizedProps?: { onFilesAdded?: (files: File[]) => void };
}
function fiberOf(root: HTMLElement): Fiber | undefined {
  const key = Object.keys(root).find((key) =>
    /^__react(Fiber|InternalInstance)\$/.test(key),
  );
  return key ? (root as unknown as Record<string, Fiber>)[key] : undefined;
}
export function draftHandle(root: HTMLElement): DraftHandle | undefined {
  for (
    let fiber = fiberOf(root), depth = 0;
    fiber && depth < 100;
    fiber = fiber.return, depth++
  ) {
    const node = fiber.stateNode;
    if (
      node?.props?.editorState?.getCurrentContent &&
      typeof node.props.onChange === "function"
    )
      return node as DraftHandle;
  }
}
function uploadHandler(
  root: HTMLElement,
): ((files: File[]) => void) | undefined {
  const seen = new Set<Fiber>();
  function children(
    fiber: Fiber | undefined,
    depth: number,
  ): ((files: File[]) => void) | undefined {
    if (!fiber || seen.has(fiber) || depth > 8 || seen.size > 600) return;
    seen.add(fiber);
    if (typeof fiber.memoizedProps?.onFilesAdded === "function")
      return fiber.memoizedProps.onFilesAdded;
    return (
      children(fiber.child, depth + 1) || children(fiber.sibling, depth + 1)
    );
  }
  for (
    let fiber = fiberOf(root), depth = 0;
    fiber && depth < 160;
    fiber = fiber.return, depth++
  ) {
    const found = children(fiber, 0);
    if (found) return found;
  }
}
export function markerBlock(content: ContentState, marker: string) {
  const matches: ContentBlock[] = [];
  content.getBlockMap().forEach((block) => {
    if (block && block.getType() !== "atomic" && block.getText() === marker)
      matches.push(block);
  });
  if (matches.length !== 1)
    throw new Error("文章图片位置在文档中不唯一，已停止同步。");
  return matches[0];
}

// xPoster identifies completed uploads through the MEDIA entity's assigned media ID.
// Only inspect known media containers/keys; dimensions or unrelated numeric fields are not IDs.
export function hasMediaId(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 5) return false;
  if (Array.isArray(value))
    return value.some((item) => hasMediaId(item, depth + 1));
  const data = value as Record<string, unknown>;
  for (const key of [
    "mediaId",
    "mediaID",
    "media_id",
    "media_id_string",
    "mediaIdString",
    "mediaKey",
    "media_key",
    "id_str",
    "id",
    "rest_id",
  ])
    if (/^(?:\d+_)?\d{8,}$/.test(String(data[key] || ""))) return true;
  return [
    "mediaItems",
    "media_items",
    "mediaItem",
    "media_item",
    "media",
    "upload",
    "uploadResult",
    "result",
  ].some((key) => hasMediaId(data[key], depth + 1));
}
function push(handle: DraftHandle, content: ContentState) {
  const state = handle.props.editorState;
  const E = state.constructor as typeof EditorState;
  const S = state.getSelection().constructor as typeof SelectionState;
  const last = content.getLastBlock();
  const selection = S.createEmpty(last.getKey());
  const next = content.merge({
    selectionBefore: selection,
    selectionAfter: selection,
  }) as ContentState;
  handle.props.onChange(
    E.moveSelectionToEnd(E.push(state, next, "insert-fragment")),
  );
}

export class DraftDriver implements EditorDriver {
  private win: Window & typeof globalThis;
  private button?: HTMLElement;
  private beforeKeys = new Set<string>();
  private stopped = false;
  cancel() {
    this.stopped = true;
  }
  private check() {
    if (this.stopped || !this.root.isConnected)
      throw new Error("同步已停止，当前草稿保留。");
  }
  ready() {
    if (this.platform !== "x") return true;
    const content = this.handle().props.editorState.getCurrentContent();
    const uploaded = content
      .getBlocksAsArray()
      .filter(
        (b) => b.getType() === "atomic" && !this.beforeKeys.has(b.getKey()),
      );
    if (uploaded.length !== 1) return false;
    const entity = content.getEntity(uploaded[0].getEntityAt(0));
    return entity.getType() === "MEDIA" && hasMediaId(entity.getData());
  }
  constructor(
    private root: HTMLElement,
    private platform: "zhihu" | "x",
  ) {
    this.win = root.ownerDocument.defaultView as Window & typeof globalThis;
    this.handle();
  }
  private handle() {
    const handle = draftHandle(this.root);
    if (!handle)
      throw new Error(
        "无法连接平台的文章文档模型，请保留草稿；此编辑器版本暂不兼容。",
      );
    return handle;
  }
  async write(html: string, markers: string[]) {
    if (markers.length) {
      if (this.platform === "zhihu")
        this.button = await pictureButton(this.root.ownerDocument, "zhihu");
      else if (!uploadHandler(this.root))
        throw new Error(
          "X Articles 图片上传功能尚未就绪，请确认正在编辑长文。",
        );
    }
    this.check();
    const handle = this.handle();
    let content = handle.props.editorState.getCurrentContent();
    // Use the platform's own model constructors without inserting a seed into
    // React's managed DOM. Zhihu can crash while reconciling execCommand edits.
    const NativeContent = content.constructor as typeof ContentState;
    if (typeof NativeContent.createFromText !== "function")
      throw new Error("平台文档构造器不兼容，正文未修改。");
    const template = NativeContent.createFromText(" ").getFirstBlock();
    const character = template?.getCharacterList().first();
    if (!template || !character?.getStyle)
      throw new Error("平台未接收文档初始化，已停止同步。");
    let map = content.getBlockMap().clear();
    for (const block of articleBlocks(this.root.ownerDocument, html, markers)) {
      const key = this.win.crypto.randomUUID().replaceAll("-", "").slice(0, 12);
      let characters = template.getCharacterList().clear();
      const links: { start: number; end: number; entity: string }[] = [];
      for (const link of block.links) {
        content = content.createEntity("LINK", "MUTABLE", { url: link.url });
        links.push({
          start: link.offset,
          end: link.offset + link.length,
          entity: content.getLastCreatedEntityKey(),
        });
      }
      for (let i = 0; i < block.text.length; i++) {
        let styles = character.getStyle().clear();
        for (const range of block.inlineStyleRanges)
          if (i >= range.offset && i < range.offset + range.length)
            styles = styles.add(range.style);
        const entity = links.find(
          (link) => i >= link.start && i < link.end,
        )?.entity;
        const C = character.constructor as typeof CharacterMetadata;
        // Draft.js serializers distinguish null (no entity) from undefined,
        // which is treated as a missing entity key and breaks X autosave.
        characters = characters.push(
          C.create(
            entity === undefined
              ? { style: styles }
              : { style: styles, entity },
          ),
        );
      }
      map = map.set(
        key,
        template.merge({
          key,
          type: block.type,
          text: block.text,
          depth: block.depth,
          characterList: characters,
          data: template.getData().clear(),
        }) as ContentBlock,
      );
    }
    if (!map.size) throw new Error("文章正文为空。");
    push(handle, content.set("blockMap", map) as ContentState);
    await delay(this.win, 150);
  }
  async upload(image: InlineImage) {
    this.check();
    const handle = this.handle(),
      state = handle.props.editorState;
    const marker = markerBlock(state.getCurrentContent(), image.marker);
    this.beforeKeys = new Set(
      state.getCurrentContent().getBlockMap().keySeq().toArray(),
    );
    const E = state.constructor as typeof EditorState;
    const S = state.getSelection().constructor as typeof SelectionState;
    // Keep the complete marker intact, upload beside it, and move the resulting atomic block.
    handle.props.onChange(
      E.forceSelection(state, S.createEmpty(marker.getKey())),
    );
    this.root.focus();
    await delay(this.win, 100);
    this.check();
    const file = imageFile(this.win, image);
    if (this.platform === "x") {
      const handler = uploadHandler(this.root);
      if (!handler) throw new Error("X 图片上传处理器已关闭。");
      handler([file]);
    } else {
      if (!this.button?.isConnected) throw new Error("知乎图片工具栏已关闭。");
      await uploadThroughPicker(
        this.win,
        file,
        () => this.button!.click(),
        4000,
        () => !this.stopped,
      );
    }
  }
  async settle(image: InlineImage, _candidate: HTMLImageElement) {
    this.check();
    const handle = this.handle(),
      content = handle.props.editorState.getCurrentContent();
    const map = content.getBlockMap();
    const marker = markerBlock(content, image.marker);
    const uploaded = map
      .valueSeq()
      .toArray()
      .filter(
        (block) =>
          block.getType() === "atomic" && !this.beforeKeys.has(block.getKey()),
      );
    if (uploaded.length !== 1)
      throw new Error("图片上传产生了多个或未知文档块，已停止，避免图片错位。");
    const media = uploaded[0];
    let next = map.clear();
    map.forEach((block, key) => {
      if (!block || !key || key === media.getKey()) return;
      next =
        key === marker.getKey()
          ? next.set(media.getKey(), media)
          : next.set(key, block);
    });
    // Preserve the original media block and entity; only change its position.
    push(handle, content.set("blockMap", next) as ContentState);
    await delay(this.win, 150);
  }
}
