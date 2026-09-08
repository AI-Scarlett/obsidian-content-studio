import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { sampleArticle } from "./extension-sample.mjs";
const folder = "dist/mogao-browser-extension";
const manifest = JSON.parse(
  await readFile("browser-extension/manifest.json", "utf8"),
);
await mkdir(folder, { recursive: true });
await mkdir(`${folder}/licenses`, { recursive: true });
await build({
  entryPoints: [
    "browser-extension/src/background.ts",
    "browser-extension/src/importer.ts",
    "browser-extension/src/content.ts",
    "browser-extension/src/launcher.ts",
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
for (const name of ["xposter-MIT.txt", "MultiPost-Apache-2.0.txt"])
  await copyFile(
    `browser-extension/licenses/${name}`,
    `${folder}/licenses/${name}`,
  );
const files = [
  "sample-article.html",
  "manifest.json",
  "importer.html",
  "importer.css",
  "background.js",
  "content.js",
  "launcher.js",
  "importer.js",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/xposter-MIT.txt",
  "licenses/MultiPost-Apache-2.0.txt",
];
const archive = {};
for (const name of files)
  archive[name] = new Uint8Array(await readFile(`${folder}/${name}`));
await writeFile(
  `dist/mogao-browser-extension-${manifest.version}-preview.zip`,
  // ZIP stores local calendar fields, without a timezone. Use the same wall time
  // on every builder so the embedded archive and main.js are reproducible.
  zipSync(archive, { mtime: new Date(1980, 0, 1, 0, 0, 0) }),
);
console.log(`Built ${folder} and preview ZIP. No platform acceptance implied.`);
