import type { AIEvent, AIRequest, ProviderHealth } from '../../domain/types.js';
import type { Provider } from '../provider.js';
import { parseSse, readError } from '../../streaming/sse.js';

export type GeminiOptions={id:string;apiKey:string;model:string;baseUrl?:string;latencyTimeoutMs?:number};

export class GeminiProvider implements Provider {
  readonly transport='api' as const;
  private readonly baseUrl:string;
  private readonly controllers=new Map<string,AbortController>();
  constructor(private readonly options:GeminiOptions){this.baseUrl=(options.baseUrl??'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'')}
  get id(){return this.options.id}
  readonly manifest={capabilities:{streaming:true,vision:false,files:false,tools:false,maxContextTokens:32768}};
  async health():Promise<Omit<ProviderHealth,'checkedAt'>>{
    const started=Date.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.options.latencyTimeoutMs??2500);
    try{const response=await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.options.model)}`,{headers:{'x-goog-api-key':this.options.apiKey},signal:controller.signal});return response.ok?{healthy:true,latencyMs:Date.now()-started}:{healthy:false,latencyMs:Date.now()-started,error:await readError(response)}}catch(error){return {healthy:false,latencyMs:Date.now()-started,error:String(error)}}finally{clearTimeout(timer)}
  }
  async *execute(request:AIRequest):AsyncIterable<AIEvent>{
    const controller=new AbortController();this.controllers.set(request.id,controller);yield {type:'start',requestId:request.id};
    try{
      const context=request.context?.length?`\n\nRelevant project context:\n${request.context.map(x=>`--- ${x.path} (${x.reason}) ---\n${x.content}`).join('\n')}`:'';
      const url=`${this.baseUrl}/models/${encodeURIComponent(this.options.model)}:streamGenerateContent?alt=sse`;
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':this.options.apiKey},body:JSON.stringify({contents:[{role:'user',parts:[{text:`${request.prompt}${context}`}]}]}),signal:controller.signal});
      if(!response.ok)throw new Error(await readError(response));if(!response.body)throw new Error('Provider returned no response stream');
      for await(const event of parseSse(response.body)){try{const payload=JSON.parse(event.data) as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;const text=payload.candidates?.[0]?.content?.parts?.map(x=>x.text??'').join('')??'';if(text)yield {type:'delta',requestId:request.id,text};}catch{/* ignore metadata */}}
      yield {type:'complete',requestId:request.id};
    }catch(error){yield controller.signal.aborted ? {type:'cancelled',requestId:request.id,error:'Request cancelled'} : {type:'error',requestId:request.id,error:String(error)}}finally{this.controllers.delete(request.id)}
  }
  async cancel(requestId:string){this.controllers.get(requestId)?.abort()}
}
