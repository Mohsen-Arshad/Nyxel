import {describe,expect,it} from 'vitest';
import {decideIntelligencePolicy} from './laya-policy.js';
import type {AIRequest,TaskClassification} from '../domain/types.js';

const signals=(task:TaskClassification['task'],complexity=.5):TaskClassification=>({task,complexity,confidence:.9,language:'typescript',source:'prompt',evidence:[],scores:[]});
const req=(prompt:string):AIRequest=>({id:'1',prompt,privacy:'standard'});

describe('intelligence policy',()=>{
  it('does not wrap simple conversation in NCP',async()=>{const p=await decideIntelligencePolicy(req('hello'),signals('chat',.1),[]);expect(p.useNcp).toBe(false);expect(p.contextDepth).toBe('none');});
  it('uses selection for focused debug work',async()=>{const p=await decideIntelligencePolicy(req('Why is this broken?'),signals('debug',.54),[{path:'test.ts',content:'items.reduce((a,b)=>a+b)',score:1,reason:'active selection'}]);expect(p.useNcp).toBe(true);expect(p.contextDepth).toBe('selection');});
});
