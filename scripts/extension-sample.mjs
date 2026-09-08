import { deflateSync } from "node:zlib";

// Deterministic test pictures generated from pixels; no private note or media is used.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type),
    size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, checksum]);
}
function png(color, count) {
  const width = 640,
    height = 360,
    pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const square =
        y > 100 &&
        y < 260 &&
        Array.from({ length: count }, (_, index) => 90 + index * 230).some(
          (left) => x > left && x < left + 150,
        );
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      const rgb = square ? [245, 242, 226] : color;
      rgb.forEach((value, index) => {
        pixels[offset + index] = value;
      });
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function sampleArticle() {
  const first = png([46, 96, 80], 1).toString("base64"),
    second = png([180, 74, 54], 2).toString("base64");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>墨稿整篇图文导入测试（请勿发表）</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"></head><body><section style="font-size:16px;line-height:1.8;color:#243b33;max-width:680px;margin:auto"><h1>墨稿整篇图文导入测试（请勿发表）</h1><p>这是一份合成测试稿，不含私人笔记。下一张应是绿色背景、一个浅色方块。</p><p><img alt="第一张：一个方块" src="data:image/png;base64,${first}" style="max-width:100%"></p><p>图一说明。此段必须保留在两张图片之间。</p><p><img alt="第二张：两个方块" src="data:image/png;base64,${second}" style="max-width:100%"></p><p>图二说明。第二张应是红色背景、两个浅色方块。</p><p>这是正文结尾。请在平台自动保存后重新打开草稿，确认标题分开、两张图片显示且顺序正确。</p></section></body></html>`;
}
