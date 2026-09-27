import type {AIRequest, ContextItem} from '../domain/types.js';

export type CompressionResult={memory:string;context:ContextItem[];usedLocalModel:boolean;reason:string};

export async function semanticCompress(request:AIRequest,context:ContextItem,memory:string,options?:{baseUrl?:string;model?:string;timeoutMs?:number}):Promise<CompressionResult>{
  const base=(options?.baseUrl??process.env.NYXELRELAY_OLLAMA_BASE_URL??'http://127.0.0.1:11434').replace(/\/$/,'');
  const model=options?.model??process.env.NYXELRELAY_CONTEXT_MODEL??process.env.OLLAMA_MODEL;
  if(!model || context.content.length<12_000)return {memory,context:[context],usedLocalModel:false,reason:'deterministic context was sufficient'};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options?.timeoutMs??7_000);
  try{
    const prompt=`You are NyxelRelay's LOCAL context analyst. Produce a compact factual project-context note for another AI. Never invent facts. Preserve exact symbol names, file paths, errors, APIs and constraints. Do not output code unless a tiny signature is essential.\n\nTASK:\n${request.prompt}\n\nPROJECT MEMORY:\n${memory}\n\nFILE ${context.path}:\n${context.content.slice(0,36_000)}`;
    const r=await fetch(`${base}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:false,options:{temperature:0.1},messages:[{role:'system',content:'Return concise factual context only.'},{role:'user',content:prompt}]}),signal:controller.signal});
    if(!r.ok)throw new Error(`Ollama ${r.status}`);
    const data=await r.json() as {message?:{content?:string}};const compact=data.message?.content?.trim();
    if(!compact)throw new Error('Ollama returned empty context');
    return {memory,context:[{...context,content:`[LOCAL SEMANTIC CONTEXT]\n${compact}`,reason:`semantic compression of ${context.reason}`}],usedLocalModel:true,reason:'large context compressed by local Ollama'};
  }catch(error){return {memory,context:[context],usedLocalModel:false,reason:`local compression unavailable: ${String(error)}`};}
  finally{clearTimeout(timer)}
}
