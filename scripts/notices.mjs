import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
const paths = execFileSync(
  "npm",
  ["ls", "--omit=dev", "--all", "--parseable"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .slice(1);
let output =
  "# Third-party notices\n\nProduction dependencies distributed with Mogao Content Studio. Licenses below apply to their respective components. Generated from the installed lockfile with `node scripts/notices.mjs`.\n";
for (const path of [...new Set(paths)].sort()) {
  const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  output += `\n## ${pkg.name} ${pkg.version}\n\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}\n`;
  const files = (await readdir(path)).filter((f) =>
    /^(license|licence|copying|notice)([.-]|$)/i.test(f),
  );
  if (!files.length) throw Error(`Missing license text: ${pkg.name}`);
  for (const file of files)
    output += `\n### ${basename(file)}\n\n\u0060\u0060\u0060text\n${(await readFile(join(path, file), "utf8")).replace(/[ \t]+$/gm, "").trim()}\n\u0060\u0060\u0060\n`;
}
for (const [name, source, file] of [
  [
    "xPoster draft editor helpers (modified)",
    "https://github.com/nevertoday/xposter/tree/ac93d21dfe8482496441034e3e35d46aceefcbba",
    "xposter-MIT.txt",
  ],
  [
    "MultiPost WeChat material and draft protocol (modified)",
    "https://github.com/leaperone/MultiPost-Extension/tree/fdbc6c3b2f3c03f57be8a59b46e33860689ba509",
    "MultiPost-Apache-2.0.txt",
  ],
]) {
  output += `\n## ${name}\n\nSource: ${source}\n\nAdapted in the browser extension. Modification notices are retained in the corresponding source files.\n\n\u0060\u0060\u0060text\n${(await readFile(join("browser-extension/licenses", file), "utf8")).trim()}\n\u0060\u0060\u0060\n`;
}
await writeFile("THIRD_PARTY_NOTICES.md", output);
console.log(`Collected notices for ${paths.length} production dependencies.`);
