import { build } from 'esbuild';
import { builtinModules } from 'node:module';
await build({entryPoints:['src/main.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',outfile:'main.js',external:['obsidian','electron',...builtinModules,...builtinModules.map(n=>`node:${n}`)],legalComments:'eof',footer:{js:'/* nosourcemap */'}});
await build({entryPoints:['demo/main.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:'demo/app.js',legalComments:'eof'});
console.log('Built Obsidian plugin and shared-UI preview.');
