import { build } from "esbuild";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
await import("./build-extension.mjs");
const extensionManifest = JSON.parse(
  await readFile("browser-extension/manifest.json", "utf8"),
);
const extensionZip = await readFile(
  `dist/mogao-browser-extension-${extensionManifest.version}-preview.zip`,
);
const license = await readFile("LICENSE", "utf8");
const notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
await build({
  define: {
    MOGAO_EXTENSION_ZIP: JSON.stringify(extensionZip.toString("base64")),
    MOGAO_EXTENSION_VERSION: JSON.stringify(extensionManifest.version),
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  external: [
    "obsidian",
    "electron",
    ...builtinModules,
    ...builtinModules.map((n) => `node:${n}`),
  ],
  // Juice's client API only needs HTML parsing; omit Cheerio's URL/file loaders.
  alias: { cheerio: "cheerio/slim" },
  legalComments: "eof",
  footer: {
    js: `/*\n${[license, notices].join("\n").replaceAll("*/", "* /")}\n*/`,
  },
});
console.log("Built Obsidian plugin.");
