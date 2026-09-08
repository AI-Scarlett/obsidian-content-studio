import { setSafeHtml } from "./dom";
import { isEmbeddedImage } from "./images";

/** Compatibility fallback used by Shanhai's current six-theme preview. */
function nativeCopy(stage: HTMLElement): boolean {
  const doc = stage.doc;
  stage.contentEditable = "true";
  const selection = doc.getSelection();
  if (!selection) return false;
  const ranges = Array.from({ length: selection.rangeCount }, (_, i) =>
    selection.getRangeAt(i).cloneRange(),
  );
  const focused = doc.activeElement;
  const input =
    focused?.instanceOf(HTMLInputElement) ||
    focused?.instanceOf(HTMLTextAreaElement)
      ? focused
      : null;
  const cursor = input
    ? ([
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
      ] as const)
    : null;
  let copied = false;
  try {
    stage.focus({ preventScroll: true });
    const range = doc.createRange();
    range.selectNodeContents(stage);
    selection.removeAllRanges();
    selection.addRange(range);
    // Chromium still exposes selection copying only through this legacy API.
    // Keep the compatibility surface limited to the copy command.
    const commands: { execCommand(command: "copy"): boolean } = doc;
    copied = commands.execCommand("copy");
  } catch {
    // The caller reports failure if neither copy mechanism is available.
  } finally {
    selection.removeAllRanges();
    if (focused?.isConnected && focused.instanceOf(HTMLElement))
      focused.focus({ preventScroll: true });
    for (const range of ranges) {
      if (range.commonAncestorContainer.isConnected) selection.addRange(range);
    }
    if (
      input?.isConnected &&
      cursor &&
      cursor[0] !== null &&
      cursor[1] !== null
    )
      input.setSelectionRange(cursor[0], cursor[1], cursor[2] || undefined);
  }
  return copied;
}

export async function copyContent(
  text: string,
  html?: string,
  context?: HTMLElement,
): Promise<void> {
  const win = (context?.win || window) as typeof window;
  if (!html) {
    if (!win.navigator.clipboard)
      throw new Error("当前窗口不能访问剪贴板，请重新打开工作台后重试。");
    await win.navigator.clipboard.writeText(text);
    return;
  }
  const stage = context?.doc.body.createDiv({ cls: "mg-copy-stage" });
  try {
    if (stage) {
      stage.setAttribute("aria-label", "正在复制正文");
      setSafeHtml(stage, html);
      stage
        .querySelectorAll("button,script,style")
        .forEach((el) => el.remove());
      await Promise.all(
        Array.from(stage.querySelectorAll("img"), async (img) => {
          if (!isEmbeddedImage(img.getAttribute("src") || ""))
            throw new Error("图片尚未嵌入，请重新载入图片后复制。");
          await img.decode().catch(() => {
            throw new Error("有图片无法解码，已暂停复制。请重新载入图片。");
          });
        }),
      );
      html = stage.innerHTML.trim();
    }
    try {
      await win.navigator.clipboard.write([
        new win.ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text.trim()], { type: "text/plain" }),
        }),
      ]);
    } catch {
      if (!stage || !nativeCopy(stage))
        throw new Error("图文复制失败，请重新打开工作台后重试。");
    }
  } finally {
    stage?.remove();
  }
}

/** Raster bytes, not an HTML img tag. Invoke write before asynchronous encoding. */
export async function copyPng(
  encode: () => Promise<Blob>,
  context: HTMLElement,
): Promise<void> {
  const win = context.win as typeof window;
  if (!win.navigator.clipboard?.write || !win.ClipboardItem)
    throw new Error("当前窗口不支持复制图片，请使用导出图片。");
  const png = encode();
  // ClipboardItem can throw synchronously; still observe an encoding rejection.
  void png.catch(() => {});
  await Promise.all([
    png,
    win.navigator.clipboard.write([
      new win.ClipboardItem({ "image/png": png }),
    ]),
  ]);
}

export async function imagePng(
  source: string,
  context: HTMLElement,
): Promise<Blob> {
  if (!isEmbeddedImage(source)) throw new Error("请先载入这张图片。");
  const img = context.doc.adoptNode(createEl("img"));
  img.src = source;
  await img.decode().catch(() => {
    throw new Error("图片无法解码，请重新载入。");
  });
  if (
    !img.naturalWidth ||
    !img.naturalHeight ||
    img.naturalWidth * img.naturalHeight > 40_000_000
  )
    throw new Error("图片尺寸过大，请缩小后复制。");
  const canvas = context.doc.adoptNode(createEl("canvas"));
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("无法创建图片，请重试。");
  drawing.drawImage(img, 0, 0);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("图片转换失败。"))),
        "image/png",
      );
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    img.removeAttribute("src");
  }
}
