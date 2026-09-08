import type { InlineImage } from "../types";

export const delay = (win: Window, ms: number) =>
  new Promise<void>((resolve) => win.setTimeout(resolve, ms));

export function imageFile(win: Window & typeof globalThis, image: InlineImage) {
  const bytes = Uint8Array.from(win.atob(image.base64), (c) => c.charCodeAt(0));
  return new win.File([bytes], image.name, { type: image.mime });
}

/** Supply this operation's bytes to the platform-created picker, without opening an OS dialog.
 * Runs in the page's MAIN world so detached inputs created by the toolbar are intercepted too.
 * The prototype changes exist only while invoking the one verified picture control.
 */
export async function uploadThroughPicker(
  win: Window & typeof globalThis,
  file: File,
  activate: () => void,
  timeout = 4000,
  isActive: () => boolean = () => true,
) {
  const proto = win.HTMLInputElement.prototype;
  const originalClick = proto.click;
  const originalPicker = proto.showPicker;
  const clickDescriptor = Object.getOwnPropertyDescriptor(proto, "click");
  const pickerDescriptor = Object.getOwnPropertyDescriptor(proto, "showPicker");
  let input: HTMLInputElement | undefined;
  let completed = false;
  const fill = (target: HTMLInputElement) => {
    if (!isActive()) return false;
    if (target.type !== "file") return false;
    if (input) return true; // A toolbar may call both click and showPicker.
    input = target;
    const data = new win.DataTransfer();
    data.items.add(file);
    target.value = "";
    target.files = data.files;
    // Defer until the native toolbar has installed its change handler.
    win.queueMicrotask(() => {
      if (!isActive()) return;
      target.dispatchEvent(new win.Event("input", { bubbles: true }));
      if (!isActive()) return;
      target.dispatchEvent(new win.Event("change", { bubbles: true }));
      completed = true;
    });
    return true;
  };
  function click(this: HTMLInputElement) {
    if (!fill(this)) originalClick.call(this);
  }
  function picker(this: HTMLInputElement) {
    if (!fill(this)) originalPicker?.call(this);
  }
  proto.click = click;
  proto.showPicker = picker;
  try {
    activate();
    const until = Date.now() + timeout;
    while (!completed && Date.now() < until && isActive()) await delay(win, 30);
    if (!isActive()) throw new Error("同步已停止，当前草稿保留。");
    if (!completed)
      throw new Error("平台图片按钮未启动上传；已停止同步，当前草稿保留。");
  } finally {
    if (proto.click === click) {
      if (clickDescriptor)
        Object.defineProperty(proto, "click", clickDescriptor);
      else delete (proto as Partial<HTMLInputElement>).click;
    }
    if (proto.showPicker === picker) {
      if (pickerDescriptor)
        Object.defineProperty(proto, "showPicker", pickerDescriptor);
      else delete (proto as Partial<HTMLInputElement>).showPicker;
    }
  }
}

export function visible(element: Element): element is HTMLElement {
  return (
    element instanceof element.ownerDocument.defaultView!.HTMLElement &&
    element.getClientRects().length > 0
  );
}

export async function pictureButton(
  doc: Document,
  platform: "xiaohongshu" | "zhihu",
) {
  const win = doc.defaultView as Window & typeof globalThis;
  const labelled = [
    ...doc.querySelectorAll<HTMLElement>("button,[role=button]"),
  ]
    .filter(visible)
    .find((el) =>
      /^(图片|插入图片|上传图片|Image|Insert image)$/i.test(
        (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.textContent ||
          ""
        ).trim(),
      ),
    );
  if (labelled) return labelled;
  if (platform === "xiaohongshu") {
    // Verified long-form toolbar route from rednote-skills; do not use a numeric button index.
    for (const el of doc.querySelectorAll<HTMLElement>("button.menu-item")) {
      if (!visible(el)) continue;
      el.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
      el.dispatchEvent(new win.MouseEvent("mouseenter"));
      await delay(win, 180);
      const match = [
        ...doc.querySelectorAll(".menu-tooltip,[role=tooltip]"),
      ].some((tip) => visible(tip) && tip.textContent?.trim() === "图片");
      el.dispatchEvent(new win.MouseEvent("mouseleave"));
      el.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }));
      if (match) return el;
    }
  }
  throw new Error("未识别到长文编辑器的图片上传按钮，已停止同步。");
}
