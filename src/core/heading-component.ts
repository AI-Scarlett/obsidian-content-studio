import type { HeadingComponent, Styles } from "./types";
import { sanitizeStyles } from "./templates";

/** Transfer a heading's boxes and text runs without retaining its original words. */
export function sampleHeadingComponent(
  element: Element,
  article: Element,
  styleOf: (element: Element) => Styles,
): HeadingComponent | undefined {
  const text = (el: Element) => (el.textContent || "").replace(/\s+/g, "");
  let root = element;
  for (let i = 0; i < 5 && root.parentElement !== article; i++) {
    const parent = root.parentElement;
    if (!parent || !article.contains(parent)) break;
    const extra = text(parent).replace(text(element), "");
    if (extra && !/^\d{1,2}[.、]?$/.test(extra)) break;
    if (parent.querySelector("img,table,blockquote")) break;
    root = parent;
  }
  // Plain headings need no structure; their semantic role is sufficient.
  if (root === element && !element.children.length) return;
  const leaves = [...root.querySelectorAll("*")].filter(
    (el) => text(el) && ![...el.children].some((child) => text(child)),
  );
  const contentLeaf =
    leaves
      .filter((el) => !/^\d{1,2}[.、]?$/.test(text(el)))
      .sort((a, b) => text(b).length - text(a).length)[0] || element;
  // Split titles with several independent text runs cannot be safely generalized.
  if (
    leaves.some((el) => el !== contentLeaf && !/^\d{1,2}[.、]?$/.test(text(el)))
  )
    return;
  let count = 0;
  function capture(el: Element, depth: number): HeadingComponent | undefined {
    if (depth > 8 || ++count > 24) return;
    const styles = { ...styleOf(el) };
    styles.display ||= el.matches("span,strong,b,em,i,a") ? "inline" : "block";
    // Browser heading defaults must not leak into a sampled paragraph shell.
    const node: HeadingComponent = { styles };
    if (el === contentLeaf) node.slot = "content";
    else if (/^\d{1,2}[.、]?$/.test(text(el)) && !el.children.length) {
      node.slot = "number";
      node.numberWidth = text(el).match(/^\d+/)![0].length;
    } else {
      const children: HeadingComponent[] = [];
      for (const child of el.children) {
        const next = capture(child, depth + 1);
        if (!next) return;
        children.push(next);
      }
      if (text(el) && !children.length) return;
      node.children = children;
    }
    return node;
  }
  return validateHeadingComponent(capture(root, 0));
}

/** Reject malformed/imported trees, extra text slots and executable styles. */
export function validateHeadingComponent(
  input: unknown,
): HeadingComponent | undefined {
  let count = 0,
    slots = 0;
  function visit(value: unknown, depth: number): HeadingComponent | undefined {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      depth > 8 ||
      ++count > 24
    )
      return;
    const data = value as Record<string, unknown>;
    const node: HeadingComponent = { styles: sanitizeStyles(data.styles) };
    if (data.slot === "content" || data.slot === "number") {
      node.slot = data.slot;
      if (data.slot === "content") slots++;
      else node.numberWidth = data.numberWidth === 2 ? 2 : 1;
    } else if (Array.isArray(data.children) && data.children.length <= 12) {
      node.children = [];
      for (const child of data.children) {
        const next = visit(child, depth + 1);
        if (!next) return;
        node.children.push(next);
      }
    }
    return node;
  }
  const result = visit(input, 0);
  return result && slots === 1 ? result : undefined;
}

export function applyHeadingComponent(
  heading: HTMLElement,
  component: HeadingComponent,
  index: number,
  tune: (styles: Styles) => Styles,
) {
  const content = [...heading.childNodes];
  function mount(target: HTMLElement, node: HeadingComponent) {
    const styles = {
      margin: "0",
      padding: "0",
      border: "0",
      "border-radius": "0",
      "background-color": "transparent",
      "font-size": "inherit",
      "font-family": "inherit",
      "font-weight": "inherit",
      color: "inherit",
      "line-height": "inherit",
      "letter-spacing": "inherit",
      "text-align": "inherit",
      "text-indent": "0",
      "box-sizing": "border-box",
      "max-width": "100%",
      ...tune(node.styles),
    };
    target.setCssProps(styles);
    if (node.slot === "content") {
      target.setAttribute("data-mg-heading-text", "true");
      target.append(...content);
    } else if (node.slot === "number")
      target.textContent = String(index).padStart(node.numberWidth || 1, "0");
    else
      for (const child of node.children || [])
        mount(target.createSpan(), child);
  }
  heading.replaceChildren();
  heading.removeAttribute("style");
  mount(heading, component);
}
