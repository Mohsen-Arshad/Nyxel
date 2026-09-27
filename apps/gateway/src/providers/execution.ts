import type {AIEvent,AIRequest,ProviderCandidate} from '../domain/types.js';
import type {Provider} from './provider.js';
import {diagnostics} from '../diagnostics.js';

export async function* executeWithFallback(
  request:AIRequest,
  candidates:ProviderCandidate[],
  providers:Provider[],
  activeRequests:Map<string,Provider>,
):AsyncIterable<AIEvent>{
  for(const candidate of candidates){
    const provider=providers.find(item=>item.id===candidate.id);
    if(!provider){ diagnostics.warn('chat.provider.missing',{requestId:request.id,providerId:candidate.id}); continue; }
    let emittedDelta=false;
    let completed=false;
    activeRequests.set(request.id,provider);
    diagnostics.info('chat.provider.attempt',{requestId:request.id,providerId:provider.id,score:candidate.score,reasons:candidate.reasons});
    try{
      for await(const event of provider.execute(request)){
        if(event.type==='delta'&&event.text)emittedDelta=true;
        if(event.type==='cancelled'){yield event;return;}
        if(event.type==='complete')completed=true;
        if(event.type==='error'){
          diagnostics.warn('chat.provider.event-error',{requestId:request.id,providerId:provider.id,error:event.error});
          if(emittedDelta){yield event;return;}
          if (event.error) yield {type:'fallback',requestId:request.id,providerId:provider.id,error:event.error};
          else yield {type:'fallback',requestId:request.id,providerId:provider.id};
          break;
        }
        yield event;
      }
      if(completed)return;
      if(emittedDelta){yield {type:'error',requestId:request.id,error:`Provider ${provider.id} ended without a complete event`};return;}
    }catch(error){
      diagnostics.error('chat.provider.exception',{requestId:request.id,providerId:provider.id,error});
      if(emittedDelta){yield {type:'error',requestId:request.id,error:`Provider ${provider.id} failed after partial output: ${String(error)}`};return;}
      yield {type:'fallback',requestId:request.id,providerId:provider.id,error:String(error)};
    }finally{activeRequests.delete(request.id)}
  }
  diagnostics.error('chat.execution.exhausted',{requestId:request.id,candidates:candidates.map(c=>c.id)});
  yield {type:'error',requestId:request.id,error:'All candidate providers failed'};
}
