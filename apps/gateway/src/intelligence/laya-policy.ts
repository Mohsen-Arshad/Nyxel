import type {AIRequest, ContextItem, TaskClassification, TaskKind} from '../domain/types.js';

export type IntelligencePolicy = {
  useNcp:boolean;
  contextDepth:'none'|'selection'|'file'|'related';
  memoryDepth:'none'|'recent'|'relevant';
  useSemanticCompression:boolean;
  reasons:string[];
  source:'laya'|'deterministic';
  confidence:number;
};

type LayaChoice = 'none'|'selection'|'file'|'related';

type LayaResponse = {
  answers?: Record<string,{choice?:string;score?:number;noul?:number}>;
};

function deterministicPolicy(request:AIRequest, signals:TaskClassification, context:ContextItem[]):IntelligencePolicy {
  const hasSelection=context.some(x=>x.reason==='active selection');
  const hasCode=context.some(x=>/\.(ts|tsx|js|jsx|py|java|cs|go|rs|cpp|h|sql)$/i.test(x.path));
  const chars=context.reduce((n,x)=>n+x.content.length,0);
  const task=signals.task;
  const conversational=/^(hi|hello|hey|thanks|thank you|ok|okay|good morning|good evening|how are you)[!.?\s]*$/i.test(request.prompt.trim());
  const codeIntent=['debug','refactor','test','generate','performance','security','architecture','explain','docs'].includes(task);
  if(conversational && !hasCode) return {useNcp:false,contextDepth:'none',memoryDepth:'none',useSemanticCompression:false,reasons:['simple conversational request'],source:'deterministic',confidence:.99};
  if(!codeIntent && !hasSelection && chars===0) return {useNcp:false,contextDepth:'none',memoryDepth:'none',useSemanticCompression:false,reasons:['no project context required'],source:'deterministic',confidence:.92};
  const contextDepth: LayaChoice=hasSelection ? 'selection' : chars>24000 ? 'related' : hasCode ? 'file' : 'none';
  const memoryDepth=(task==='architecture'||task==='refactor'||task==='security'||task==='performance')?'relevant':(codeIntent?'recent':'none');
  const useSemanticCompression=chars>24000 || (signals.complexity>=.72 && chars>12000);
  return {useNcp:true,contextDepth,memoryDepth,useSemanticCompression,reasons:[
    ...(hasSelection?['active selection is relevant']:[]),
    ...(codeIntent?[`task=${task} requires developer context`]:[]),
    ...(chars>12000?['context is large']:[]),
    ...(useSemanticCompression?['semantic compression may improve information density']:[]),
  ],source:'deterministic',confidence:Math.min(.94,Math.max(.62,signals.confidence))};
}

function buildState(request:AIRequest,signals:TaskClassification,context:ContextItem[]):Record<string,unknown>{
  return {
    request:request.prompt,
    task:signals.task,
    complexity:signals.complexity,
    confidence:signals.confidence,
    contextItems:context.map(x=>({path:x.path,reason:x.reason,score:x.score,content:x.content.slice(0,3000)})),
    contextChars:context.reduce((n,x)=>n+x.content.length,0),
    hasSelection:context.some(x=>x.reason==='active selection'),
  };
}

function parseLaya(payload:LayaResponse, fallback:IntelligencePolicy):IntelligencePolicy|undefined {
  const answers=payload.answers;
  if(!answers) return undefined;
  const choice=(name:string):string|undefined=>answers[name]?.choice;
  const score=(name:string):number=>Number(answers[name]?.score ?? answers[name]?.noul ?? 0);
  const depth=choice('context_depth') as LayaChoice|undefined;
  const memory=choice('memory_depth') as IntelligencePolicy['memoryDepth']|undefined;
  const semantic=score('semantic_compression') >= .55;
  const useNcp=score('needs_context') >= .45 || Boolean(depth && depth!=='none');
  if(!useNcp && !depth) return {...fallback,source:'laya',confidence:Math.min(.99,Math.max(.5,score('needs_context') || fallback.confidence))};
  return {
    ...fallback,
    useNcp,
    contextDepth:depth && ['none','selection','file','related'].includes(depth)?depth:fallback.contextDepth,
    memoryDepth:memory && ['none','recent','relevant'].includes(memory)?memory:fallback.memoryDepth,
    useSemanticCompression:semantic || fallback.useSemanticCompression,
    reasons:[...fallback.reasons,'Laya policy decision'],
    source:'laya',
    confidence:Math.min(.99,Math.max(.5,Math.max(score('needs_context'),score('semantic_compression'),fallback.confidence))),
  };
}

export async function decideIntelligencePolicy(request:AIRequest,signals:TaskClassification,context:ContextItem[]):Promise<IntelligencePolicy>{
  const fallback=deterministicPolicy(request,signals,context);
  const baseUrl=process.env.NYXELRELAY_LAYA_URL?.trim();
  if(!baseUrl) return fallback;
  const questions={
    needs_context:{type:'noul',instructions:'Does this developer request require project/code context beyond the raw user request?'},
    context_depth:{type:'choice',instructions:'How much project context is needed?',criteria:{none:'No project context',selection:'Only the explicitly selected code',file:'The active file or directly relevant file',related:'Multiple related files or dependencies'}},
    memory_depth:{type:'choice',instructions:'How much persistent project memory is useful?',criteria:{none:'No memory',recent:'Recent project work only',relevant:'Relevant architecture, conventions, facts and recent work'}},
    semantic_compression:{type:'noul',instructions:'Would local semantic compression materially improve the context representation?'}
  };
  try {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Number(process.env.NYXELRELAY_LAYA_TIMEOUT_MS ?? 1500));
    const response=await fetch(`${baseUrl.replace(/\/$/,'')}/v1/systemone`,{method:'POST',headers:{'content-type':'application/json',...(process.env.NYXELRELAY_LAYA_API_KEY?{authorization:`Bearer ${process.env.NYXELRELAY_LAYA_API_KEY}`}:{})},body:JSON.stringify({state:buildState(request,signals,context),questions}),signal:controller.signal});
    clearTimeout(timer);
    if(!response.ok) return fallback;
    return parseLaya(await response.json() as LayaResponse,fallback) ?? fallback;
  } catch { return fallback; }
}
