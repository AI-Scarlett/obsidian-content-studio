import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { sampleArticle } from "./extension-sample.mjs";
const folder = "dist/mogao-browser-extension";
await mkdir(folder, { recursive: true });
await build({
  entryPoints: [
    "browser-extension/src/background.ts",
    "browser-extension/src/importer.ts",
    "browser-extension/src/content.ts",
  ],
  bundle: true,
  outdir: folder,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  legalComments: "eof",
});
for (const name of ["manifest.json", "importer.html", "importer.css"])
  await copyFile(`browser-extension/${name}`, `${folder}/${name}`);
for (const [source, name] of [
  ["browser-extension/README.md", "README.md"],
  ["LICENSE", "LICENSE"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
])
  await copyFile(source, `${folder}/${name}`);
await writeFile(`${folder}/sample-article.html`, sampleArticle());
const files = [
  "sample-article.html",
  "manifest.json",
  "importer.html",
  "importer.css",
  "background.js",
  "content.js",
  "importer.js",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];
const archive = {};
for (const name of files)
  archive[name] = new Uint8Array(await readFile(`${folder}/${name}`));
await writeFile(
  "dist/mogao-browser-extension-0.1.0-preview.zip",
  zipSync(archive),
);
console.log(`Built ${folder} and preview ZIP. No platform acceptance implied.`);
