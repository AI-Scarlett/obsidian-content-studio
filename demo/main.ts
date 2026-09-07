import { Studio, type Host } from '../src/ui/studio';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/types';
import { draftFromNote } from '../src/core/render';
import { learnTemplate } from '../src/core/learn';
import { validateTemplate } from '../src/core/templates';
import { zipSync, strToU8 } from 'fflate';

const sample=await (await fetch('/sample.md')).text();
let settings:Settings=structuredClone(DEFAULT_SETTINGS);
try{const saved=JSON.parse(localStorage.getItem('mogao-demo-settings')||'null');if(saved){settings={...settings,...saved,customTemplates:(saved.customTemplates||[]).map(validateTemplate)};}}catch{/* demo starts with defaults if its settings are invalid */}
function saveBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const host:Host={
  settings,
  saveSettings:async s=>{localStorage.setItem('mogao-demo-settings',JSON.stringify(s));},
  currentNote:async()=>draftFromNote(sample,'示例/让笔记走出笔记本.md'),
  chooseNote:()=>new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.id='demo-picker';dialog.innerHTML='<h3>选择示例笔记</h3><p>安装到 Obsidian 后，这里会显示你自己的笔记。</p><button data-example>让笔记走出笔记本</button><button data-long>长文分页测试 · 保留完整内容</button><button data-cancel>取消</button>';document.body.append(dialog);dialog.showModal();const finish=(draft:ReturnType<typeof draftFromNote>|null)=>{dialog.close();dialog.remove();resolve(draft);};dialog.querySelector('[data-example]')!.addEventListener('click',()=>finish(draftFromNote(sample,'示例/让笔记走出笔记本.md')));dialog.querySelector('[data-long]')!.addEventListener('click',()=>finish(draftFromNote('# 长文分页测试\n\n'+Array.from({length:8},(_,i)=>`## 第 ${i+1} 节\n\n${'这是用于检查分页的完整段落，包含中文、emoji 🌿 和连续的内容。'.repeat(12)}\n\n`).join(''),'示例/长文分页测试.md')));dialog.querySelector('[data-cancel]')!.addEventListener('click',()=>finish(null));dialog.addEventListener('cancel',()=>finish(null));}),
  resolveImages:async(draft,remote,options)=>{
    const {imageSources}=await import('../src/core/render');
    const {resolveImageAssets}=await import('../src/core/images');
    return resolveImageAssets(imageSources(draft),async src=>{
      if(!remote||!/^https?:\/\//.test(src))throw new Error('浏览器示例无法读取 Vault 附件，请在 Obsidian 中打开。');
      const response=await fetch('/api/image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:src})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);return data.dataUrl;
    },options);
  },
  learnUrl:async url=>{const response=await fetch('/api/learn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});const data=await response.json();if(!response.ok)throw new Error(data.error);const t=learnTemplate(data.html,data.finalUrl,data.css);if(data.cssWarnings)t.source!.notes.push('部分外部样式未能读取。');return t;},
  copy:async(text,html)=>{if(html){await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([text],{type:'text/plain'}),'text/html':new Blob([html],{type:'text/html'})})]);}else await navigator.clipboard.writeText(text);},
  saveFiles:async(files,title)=>{const data:Record<string,Uint8Array>={};for(const file of files)data[file.name]=typeof file.content==='string'?strToU8(file.content):new Uint8Array(file.content);const zip=zipSync(data);saveBlob(new Blob([new Uint8Array(zip)],{type:'application/zip'}),`${title.replace(/[\\/:*?"<>|]/g,'-').slice(0,60)}.zip`);return '浏览器下载目录（ZIP 内容包）';},
};
const studio=new Studio(document.getElementById('app')!,host);
await studio.openDraft(draftFromNote(sample,'示例/让笔记走出笔记本.md'));
