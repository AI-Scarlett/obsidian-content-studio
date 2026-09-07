import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
await build({entryPoints:['src/core/network.ts'],bundle:true,platform:'node',format:'esm',outfile:'artifacts/network.mjs',packages:'external'});
const {downloadPublic}=await import('../artifacts/network.mjs');
const host='127.0.0.1',port=39271;
const staticFiles={'/':['demo/index.html','text/html'],'/app.js':['demo/app.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/sample.md':['demo/sample.md','text/plain'],'/favicon.ico':[null,'image/x-icon']};
http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
    if(req.method==='GET'&&staticFiles[req.url]){const [file,mime]=staticFiles[req.url];res.writeHead(file?200:204,{'Content-Type':`${mime}; charset=utf-8`,'Cache-Control':'no-store'});res.end(file?await readFile(file):undefined);return;}
    if(req.method!=='POST'||!['/api/learn','/api/image'].includes(req.url)){send(404,{error:'Not found'});return;}
    const origin=req.headers.origin;
    if(origin!==`http://${host}:${port}`){send(403,{error:'仅允许本地预览页面调用。'});return;}
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000){send(413,{error:'请求过大'});return;}}
    const {url}=JSON.parse(raw);
    if(typeof url!=='string'){send(400,{error:'请输入文章链接'});return;}
    if(req.url==='/api/image'){const result=await downloadPublic(url,'image');send(200,{dataUrl:`data:${result.contentType};base64,${Buffer.from(result.data).toString('base64')}`});return;}
    const page=await downloadPublic(url);const html=new TextDecoder().decode(page.data);
    const doc=new JSDOM(html);const links=Array.from(doc.window.document.querySelectorAll('link[rel~="stylesheet"][href]')).slice(0,3).map(el=>new URL(el.getAttribute('href'),page.finalUrl).href);doc.window.close();
    const results=await Promise.allSettled(links.map(link=>downloadPublic(link,'css')));
    send(200,{html,finalUrl:page.finalUrl,css:results.flatMap(r=>r.status==='fulfilled'?[new TextDecoder().decode(r.value.data)]:[]),cssWarnings:results.some(r=>r.status==='rejected')});
  }catch(error){send(400,{error:error.message});}
}).listen(port,host,()=>console.log(`墨稿共享界面预览：http://${host}:${port}`));
