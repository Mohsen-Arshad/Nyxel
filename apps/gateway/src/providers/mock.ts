import type {AIEvent,AIRequest} from '../domain/types.js'; import type {Provider} from './provider.js';
export class MockProvider implements Provider {
  constructor(public readonly id:string,public readonly transport:'api'|'local'='local'){}
  get manifest(){return {capabilities:{streaming:true,vision:false,files:false,tools:this.transport==='local',maxContextTokens:32768}};}
  async health(){return {healthy:true,latencyMs:this.transport==='local'?18:35};}
  async *execute(r:AIRequest):AsyncIterable<AIEvent>{
    yield {type:'start',requestId:r.id};
    const contextInfo=r.context?.length?`\nContext received: ${r.context.map(x=>`${x.path} [${x.content.length} chars; ${x.reason}]`).join(', ')}`:'';
    const chunks=[`NyxelRelay MVP response from ${this.id}. `,`The request was routed successfully. `,`Task: ${r.task ?? 'auto'}.`,contextInfo,`\n\nPrompt:\n${r.prompt}`];
    for(const text of chunks){yield {type:'delta',requestId:r.id,text}; await new Promise(resolve=>setTimeout(resolve,35));}
    yield {type:'complete',requestId:r.id};
  }
  async cancel(_id:string){}
}
