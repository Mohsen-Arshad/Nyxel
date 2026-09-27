import {describe,it,expect} from 'vitest';
import type {AIEvent,AIRequest,ProviderCandidate} from '../domain/types.js';
import type {Provider} from './provider.js';
import {executeWithFallback} from './execution.js';

const request:AIRequest={id:'req-1',prompt:'hello',privacy:'standard'};
const candidate=(id:string):ProviderCandidate=>({id,transport:'api',capabilities:{streaming:true,vision:false,files:false,tools:false,maxContextTokens:32768},health:{healthy:true,latencyMs:10,checkedAt:0},score:1,reasons:[]});
class FailingProvider implements Provider{readonly transport='api' as const;constructor(public readonly id:string){}async health(){return {healthy:true,latencyMs:1}}async *execute(r:AIRequest):AsyncIterable<AIEvent>{yield {type:'start',requestId:r.id};yield {type:'error',requestId:r.id,error:'boom'}}async cancel(){}}
class WorkingProvider implements Provider{readonly transport='api' as const;constructor(public readonly id:string){}async health(){return {healthy:true,latencyMs:1}}async *execute(r:AIRequest):AsyncIterable<AIEvent>{yield {type:'start',requestId:r.id};yield {type:'delta',requestId:r.id,text:'ok'};yield {type:'complete',requestId:r.id}}async cancel(){}}

describe('provider execution fallback',()=>{
  it('falls back when the first provider fails before output',async()=>{
    const events=[] as AIEvent[];for await(const event of executeWithFallback(request,[candidate('bad'),candidate('good')],[new FailingProvider('bad'),new WorkingProvider('good')],new Map()))events.push(event);
    expect(events.some(e=>e.type==='fallback'&&e.providerId==='bad')).toBe(true);
    expect(events.some(e=>e.type==='delta'&&e.text==='ok')).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
  });
  it('does not silently replace partial output',async()=>{
    const provider:Provider={id:'partial',transport:'api',health:async()=>({healthy:true,latencyMs:1}),execute:async function*(){yield {type:'delta',requestId:'req-1',text:'partial'};yield {type:'error',requestId:'req-1',error:'boom'}},cancel:async()=>{}};
    const events=[] as AIEvent[];for await(const event of executeWithFallback(request,[candidate('partial'),candidate('good')],[provider,new WorkingProvider('good')],new Map()))events.push(event);
    expect(events.some(e=>e.type==='fallback')).toBe(false);
    expect(events.at(-1)?.type).toBe('error');
  });
});
