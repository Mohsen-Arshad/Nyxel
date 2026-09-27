import type { AIEvent, AIRequest, ProviderHealth } from '../../domain/types.js';
import type { Provider } from '../provider.js';
import { parseSse, readError } from '../../streaming/sse.js';

export type AnthropicOptions = { id:string; apiKey:string; model:string; baseUrl?:string; latencyTimeoutMs?:number };

export class AnthropicProvider implements Provider {
  readonly transport='api' as const;
  private readonly baseUrl: string;
  private readonly controllers = new Map<string,AbortController>();
  constructor(private readonly options:AnthropicOptions){this.baseUrl=(options.baseUrl??'https://api.anthropic.com').replace(/\/$/,'');}
  get id(){return this.options.id;}
  async health():Promise<Omit<ProviderHealth,'checkedAt'>>{
    const started=Date.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.options.latencyTimeoutMs??2500);
    try{
      const response=await fetch(`${this.baseUrl}/v1/models`,{headers:{'x-api-key':this.options.apiKey,'anthropic-version':'2023-06-01'},signal:controller.signal});
      return response.ok?{healthy:true,latencyMs:Date.now()-started}:{healthy:false,latencyMs:Date.now()-started,error:await readError(response)};
    }catch(error){return {healthy:false,latencyMs:Date.now()-started,error:String(error)}}finally{clearTimeout(timer)}
  }
  async *execute(request:AIRequest):AsyncIterable<AIEvent>{
    const controller=new AbortController(); this.controllers.set(request.id,controller); yield {type:'start',requestId:request.id};
    try{
      const context=request.context?.length?`\n\nRelevant project context:\n${request.context.map(x=>`--- ${x.path} (${x.reason}) ---\n${x.content}`).join('\n')}`:'';
      const response=await fetch(`${this.baseUrl}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','x-api-key':this.options.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:this.options.model,max_tokens:4096,stream:true,messages:[{role:'user',content:`${request.prompt}${context}`}]}),signal:controller.signal});
      if(!response.ok)throw new Error(await readError(response)); if(!response.body)throw new Error('Provider returned no response stream');
      for await(const event of parseSse(response.body)){
        try{const payload=JSON.parse(event.data) as {type?:string;delta?:{type?:string;text?:string}}; if(payload.type==='content_block_delta'&&payload.delta?.text)yield {type:'delta',requestId:request.id,text:payload.delta.text}; if(payload.type==='message_stop')break;}catch{/* ignore malformed metadata */}
      }
      yield {type:'complete',requestId:request.id};
    }catch(error){yield controller.signal.aborted ? {type:'cancelled',requestId:request.id,error:'Request cancelled'} : {type:'error',requestId:request.id,error:String(error)}}finally{this.controllers.delete(request.id)}
  }
  async cancel(requestId:string){this.controllers.get(requestId)?.abort()}
}
