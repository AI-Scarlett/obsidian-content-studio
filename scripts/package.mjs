import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
if(manifest.id!=='content-studio'||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw new Error('Invalid release manifest');
const packageJson=JSON.parse(await readFile('package.json','utf8'));
if(packageJson.version!==manifest.version)throw new Error('Version mismatch');
const directory=`dist/${manifest.id}`;await mkdir(directory,{recursive:true});
const zip={},hashes={};
await mkdir(`${directory}/docs`,{recursive:true});
for(const name of ['main.js','manifest.json','styles.css','README.md','README.zh-CN.md','LICENSE','THIRD_PARTY_NOTICES.md','docs/privacy.md','docs/verification.md']){const content=await readFile(name);await copyFile(name,`${directory}/${name}`);zip[`${manifest.id}/${name}`]=new Uint8Array(content);hashes[name]={bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};}
const filename=`dist/${manifest.id}-${manifest.version}.zip`;
await writeFile(filename,zipSync(zip));
hashes.zip={bytes:(await stat(filename)).size,sha256:createHash('sha256').update(await readFile(filename)).digest('hex')};
await writeFile(`dist/${manifest.id}-${manifest.version}-checksums.json`,JSON.stringify(hashes,null,2)+'\n');
console.log(`Installable package: ${filename}`);console.log(JSON.stringify(hashes,null,2));
