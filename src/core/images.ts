export const isEmbeddedImage=(value:string|undefined):boolean => /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z\d+/]+={0,2}$/.test(value||'');
export interface ImageOptions {
  assets?:Record<string,string>;
  onProgress?:(loaded:number,total:number,finished:number)=>void;
}
export interface ImageResult {assets:Record<string,string>;warnings:string[]}

/** Resolve each distinct source once, retaining source order even when downloads finish out of order. */
export async function resolveImageAssets(sources:string[],read:(source:string)=>Promise<string>,options:ImageOptions={}):Promise<ImageResult> {
  const unique=[...new Set(sources)],limited=unique.slice(0,40);
  const values=new Map<string,string>(),errors=new Map<string,string>();
  let cursor=0,finished=0;
  const progress=()=>options.onProgress?.(values.size,unique.length,finished);
  progress();
  await Promise.all(Array.from({length:Math.min(3,limited.length)},async()=>{
    while(cursor<limited.length){
      const index=cursor++,src=limited[index];
      try{
        const cached=options.assets?.[src];
        const data=isEmbeddedImage(cached)?cached!:await read(src);
        if(!isEmbeddedImage(data))throw new Error('图片数据无效。');
        values.set(src,data);
      }catch(error){errors.set(src,`第 ${index+1} 张图片载入失败（${src.length>120?src.slice(0,117)+'…':src}）：${error instanceof Error?error.message:String(error)}`);}
      finished++;progress();
    }
  }));
  const warnings=limited.flatMap(src=>errors.has(src)?[errors.get(src)!]:[]);
  if(unique.length>40)warnings.push('每篇最多嵌入 40 张不同图片，请拆分笔记后导出。');
  return {assets:Object.fromEntries(limited.filter(src=>values.has(src)).map(src=>[src,values.get(src)!])),warnings};
}
