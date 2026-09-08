import type { JSDOM } from "jsdom";
/** Minimal implementations of the documented Obsidian DOM extensions for host tests. */
export function installDomGlobals(dom: JSDOM) {
  const win = dom.window;
  function element(tag: string, options: any = {}, callback?: Function) {
    const el = win.document.createElement(tag);
    if (typeof options === "string") el.className = options;
    else {
      if (options.cls)
        el.className = Array.isArray(options.cls)
          ? options.cls.join(" ")
          : options.cls;
      if (options.text !== undefined) el.textContent = options.text;
      for (const [key, value] of Object.entries(options.attr || {}))
        el.setAttribute(key, String(value));
      options.parent?.appendChild(el);
    }
    callback?.(el);
    return el;
  }
  Object.defineProperties(win.Node.prototype, {
    win: {
      configurable: true,
      get() {
        return this.ownerDocument?.defaultView || win;
      },
    },
    doc: {
      configurable: true,
      get() {
        return this.ownerDocument || win.document;
      },
    },
  });
  Object.assign(win.Node.prototype, {
    createEl(this: Node, tag: string, options: any = {}, callback?: Function) {
      const el = element(tag, options, callback);
      this.appendChild(el);
      return el;
    },
    createDiv(this: Node, options: any = {}, callback?: Function) {
      return (this as any).createEl("div", options, callback);
    },
    empty(this: HTMLElement) {
      this.replaceChildren();
    },
    instanceOf(this: Node, type: any) {
      return this instanceof type;
    },
  });
  Object.assign(win.HTMLElement.prototype, {
    addClass(this: HTMLElement, ...names: string[]) {
      this.classList.add(...names);
    },
    setCssProps(this: HTMLElement, props: Record<string, string>) {
      for (const [key, value] of Object.entries(props))
        this.style.setProperty(key, value);
    },
    setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
      Object.assign(this.style, styles);
    },
  });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    DOMParser: win.DOMParser,
    Node: win.Node,
    NodeFilter: win.NodeFilter,
    HTMLElement: win.HTMLElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    createEl: element,
    createDiv: (options?: any) => element("div", options),
    createFragment: () => win.document.createDocumentFragment(),
  });
}
