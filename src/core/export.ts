export function portableMarkdown(
  markdown: string,
  assets: Record<string, string>,
): { markdown: string; images: { name: string; content: ArrayBuffer }[] } {
  const images: { name: string; content: ArrayBuffer }[] = [];
  let output = markdown;
  for (const [source, data] of Object.entries(assets)) {
    const match = data.match(
      /^data:image\/(png|jpeg|gif|webp|avif);base64,([A-Za-z\d+/=]+)$/,
    );
    if (!match) continue;
    const name = `image-${String(images.length + 1).padStart(2, "0")}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    images.push({ name, content: bytes.buffer });
    const variants = new Set([source]);
    try {
      variants.add(decodeURI(source));
    } catch {
      /* retain encoded source */
    }
    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(
        new RegExp(
          `(!\\[[^\\]]*\\]\\(\\s*<?)${escaped}(?=>?\\s*(?:[)"']))`,
          "g",
        ),
        `$1${name}`,
      );
      output = output.replace(
        new RegExp(`^(\\[[^\\]]+\\]:\\s*<?)${escaped}(?=>?(?:\\s|$))`, "gm"),
        `$1${name}`,
      );
    }
  }
  return { markdown: output, images };
}
