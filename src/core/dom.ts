import createDOMPurify from "dompurify";

/** All HTML mounted in the workbench is converted to a sanitized DOM fragment. */
export function setSafeHtml(target: HTMLElement, html: string): void {
  const purifier = createDOMPurify(target.win as typeof window);
  target.replaceChildren(
    purifier.sanitize(html, { RETURN_DOM_FRAGMENT: true }),
  );
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
