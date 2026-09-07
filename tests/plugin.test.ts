import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire,builtinModules} from 'node:module';
import {BUILTIN_TEMPLATES,userTemplate} from '../src/core/templates';

const compiled=await build({entryPoints:['src/main.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',write:false,external:['obsidian','electron',...builtinModules,...builtinModules.map(m=>`node:${m}`)]});
function harness(saved:any=null){
  class TFile{constructor(public path:string,public extension='md',public stat={size:10},public name=path.split('/').pop()||path){}}
  class MarkdownView{}
  const note=new TFile('Notes/原笔记.md');const picture=new TFile('Attachments/test.png','png');
  const original='# 原笔记\n\n正文不会被导出覆盖。';const files=new Map<string,unknown>([[note.path,original],[picture.path,new Uint8Array([1,2,3]).buffer]]);const folders=new Set<string>();const notices:string[]=[];let data=saved;let clip:any;
  const app={workspace:{getActiveFile:()=>note,getActiveViewOfType:()=>null,on:()=>({}),getLeavesOfType:()=>[]},vault:{getMarkdownFiles:()=>[note],cachedRead:async(file:TFile)=>files.get(file.path),readBinary:async(file:TFile)=>files.get(file.path),getAbstractFileByPath:(path:string)=>files.has(path)?new TFile(path):folders.has(path)?{}:null,createFolder:async(path:string)=>{if(folders.has(path))throw new Error('exists');folders.add(path);},create:async(path:string,content:string)=>{if(files.has(path))throw new Error('overwrite');files.set(path,content);},createBinary:async(path:string,content:ArrayBuffer)=>{if(files.has(path))throw new Error('overwrite');files.set(path,content);}},metadataCache:{getFirstLinkpathDest:()=>picture}};
  class Plugin{app=app;commands:any[]=[];ribbons:any[]=[];views:any[]=[];async loadData(){return data;}async saveData(value:any){data=structuredClone(value);}registerEvent(){}registerView(...args:any[]){this.views.push(args);}addRibbonIcon(...args:any[]){this.ribbons.push(args);}addCommand(command:any){this.commands.push(command);}addSettingTab(){}}
  const obsidian={Plugin,ItemView:class{},MarkdownView,TFile,FuzzySuggestModal:class{},PluginSettingTab:class{},Setting:class{},Notice:class{constructor(message:string){notices.push(message);}},normalizePath:(p:string)=>p.replace(/\\/g,'/')};
  const require=createRequire(import.meta.url);const module={exports:{} as any};
  vm.runInNewContext(compiled.outputFiles[0].text,{require:(name:string)=>name==='obsidian'?obsidian:name==='electron'?{clipboard:{write:(value:any)=>{clip=value;},writeText:(text:string)=>{clip={text};}}}:require(name),module,exports:module.exports,console,setTimeout,clearTimeout,URL,Buffer,TextDecoder,TextEncoder,AbortSignal,fetch,crypto,structuredClone,atob,btoa});
  return {plugin:new module.exports.default(),safeFolder:module.exports.safeFolder,app,files,folders,note,original,getData:()=>data,getClip:()=>clip};
}
test('built plugin loads and registers an Obsidian view, commands and ribbon',async()=>{const h=harness();await h.plugin.onload();assert.equal(h.plugin.commands.length,2);assert.equal(h.plugin.views[0][0],'content-studio-view');assert.equal(h.plugin.ribbons[0][0],'newspaper');});
test('host reads notes and writes unique content packages without changing the source',async()=>{const h=harness();await h.plugin.onload();const host=h.plugin.host();const draft=await host.currentNote();assert.equal(draft.title,'原笔记');const first=await host.saveFiles([{name:'article.md',content:'# 导出'}],'同一标题');const second=await host.saveFiles([{name:'article.md',content:'# 第二版'}],'同一标题');assert.notEqual(first,second);assert.equal(h.files.get(h.note.path),h.original);assert.equal(h.files.get(`${first}/article.md`),'# 导出');assert.equal(h.files.get(`${second}/article.md`),'# 第二版');});
test('host embeds Vault attachments and writes rich clipboard formats',async()=>{const h=harness();await h.plugin.onload();const host=h.plugin.host();const r=await host.resolveImages({title:'附件',markdown:'![[test.png]]',sourcePath:h.note.path},false);assert.equal(Object.values(r.assets)[0],'data:image/png;base64,AQID');await host.copy('正文','<p>正文</p>');assert.equal(h.getClip().html,'<p>正文</p>');});
test('custom templates persist and reload through plugin data',async()=>{const h=harness();await h.plugin.onload();const host=h.plugin.host();const t=userTemplate(BUILTIN_TEMPLATES[1],'测试模板');await host.saveSettings({...host.settings,customTemplates:[t],templateId:t.id});const next=harness(h.getData());await next.plugin.onload();assert.equal(next.plugin.settings.customTemplates[0].name,'测试模板');assert.equal(next.plugin.settings.templateId,t.id);});
test('export folder validation rejects traversal and configuration directories',()=>{const h=harness();for(const path of ['/tmp','../note','.obsidian/plugins','safe/../../target','safe//target'])assert.throws(()=>h.safeFolder(path));assert.equal(h.safeFolder('墨稿导出/草稿'),'墨稿导出/草稿');});
