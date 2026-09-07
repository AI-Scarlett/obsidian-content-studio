import { readFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));
const version = process.env.RELEASE_VERSION;
if (
  !version ||
  !/^\d+\.\d+\.\d+$/.test(version) ||
  manifest.version !== version ||
  pkg.version !== version ||
  versions[version] !== manifest.minAppVersion
)
  throw new Error(
    "Release tag, package, manifest and compatibility versions must agree.",
  );
await readFile(`docs/releases/${version}.md`, "utf8");
console.log(`Release metadata validated: ${version}`);
