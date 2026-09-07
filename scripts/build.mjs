import { build } from "esbuild";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
const license = await readFile("LICENSE", "utf8");
const notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  external: [
    "obsidian",
    ...builtinModules,
    ...builtinModules.map((n) => `node:${n}`),
  ],
  legalComments: "eof",
  footer: {
    js: `/*\n${[license, notices].join("\n").replaceAll("*/", "* /")}\n*/`,
  },
});
console.log("Built Obsidian plugin.");
