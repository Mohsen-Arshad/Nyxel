import type {Provider} from './provider.js';
import type {ProviderCandidate} from '../domain/types.js';
import {DEMO_STRENGTH, LOCAL_STRENGTH, REAL_API_STRENGTH} from './runtime/task-strengths.js';

export async function providerCandidate(provider:Provider):Promise<ProviderCandidate>{
  const health=await provider.health();
  const strengths=provider.manifest?.taskStrengths ?? (provider.transport==='api'?REAL_API_STRENGTH:provider.transport==='local'?(provider.id.includes('demo')?DEMO_STRENGTH:LOCAL_STRENGTH):REAL_API_STRENGTH);
  return {id:provider.id,transport:provider.transport,capabilities:provider.manifest?.capabilities ?? {streaming:true,vision:false,files:false,tools:provider.transport==='local',maxContextTokens:32768},health:{...health,checkedAt:Date.now()},taskStrengths:strengths,score:0,reasons:[]};
}
