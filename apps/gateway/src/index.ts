import Fastify from 'fastify';
import {diagnostics} from './diagnostics.js';
import {randomUUID} from 'node:crypto';
import {createRuntimeProviders, createConfiguredProvider, type RuntimeProviderConfig} from './providers/runtime/registry.js';
import {providerCandidate} from './providers/provider-candidate.js';
import {classify,route} from './routing/router.js';
import {ProviderStore} from './persistence/provider-store.js';
import type {AIRequest,ProviderCandidate,ContextItem} from './domain/types.js';
import {validateProviderDefinition} from '@nyxelrelay/provider-schema';
import {sanitizeContext} from './security/secrets.js';
import {WebProvider} from './browser/web-provider.js';
import type {Provider} from './providers/provider.js';
import {executeWithFallback} from './providers/execution.js';
import {mkdir} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildIntelligentContext, buildNcp} from './intelligence/context-intelligence.js';
import {ProjectMemoryStore, memoryText} from './intelligence/memory.js';
import {semanticCompress} from './intelligence/semantic-compressor.js';
import {decideIntelligencePolicy} from './intelligence/laya-policy.js';
import {BrowserBridgeManager, type BridgeBrowser} from './browser/bridge.js';

const port=Number(process.env.NYXELRELAY_PORT ?? 4321);
const protocolVersion='phase5.1.0';
const token=process.env.NYXELRELAY_TOKEN ?? '';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const dataDir=process.env.NYXELRELAY_DATA_DIR ? resolve(process.env.NYXELRELAY_DATA_DIR) : resolve(projectRoot,'.nyxelrelay');
const app=Fastify({logger:false});
const runtime=createRuntimeProviders();
const providers:Provider[]=[...runtime.providers];
const runtimeInfo=[...runtime.info];
const webProviders=new Map<string,WebProvider>();
const activeRequests=new Map<string,Provider>();
const runtimeStatuses=new Map<string,'on'|'off'|'error'>();
const store=new ProviderStore(`${dataDir}/providers`);
const memoryStore=new ProjectMemoryStore(dataDir);
const browserBridge=new BrowserBridgeManager();

app.addHook('onRequest',async(req,reply)=>{
  if(req.url==='/health' && req.headers['x-nyxelrelay-token']===token)return;
  if(req.url==='/health' && !token)return;
  if(req.url.startsWith('/bridge/')) return;
  if(token && req.headers['x-nyxelrelay-token']!==token)return reply.code(401).send({error:'unauthorized'});
});
app.get('/health',async()=>({ok:true,service:'nyxelrelay-gateway',version:'0.5.1',protocol:protocolVersion}));
app.post('/bridge/register',async(req)=>{
  const body=req.body as {sessionId?:string;clientId?:string;browser?:BridgeBrowser;tabs?:Array<{tabId:number;title:string;url:string}>};
  const input:{sessionId?:string;clientId?:string;browser:BridgeBrowser;tabs:Array<{tabId:number;title:string;url:string}>}={browser:body?.browser ?? 'unknown',tabs:Array.isArray(body?.tabs)?body.tabs:[]};
  if(body?.sessionId) input.sessionId=body.sessionId;
  if(body?.clientId) input.clientId=body.clientId;
  return browserBridge.register(input);
});
app.post('/bridge/heartbeat',async(req,reply)=>{
  const body=req.body as {sessionId?:string;clientId?:string;tabs?:Array<{tabId:number;title:string;url:string}>};
  if(!body?.sessionId)return reply.code(400).send({error:'sessionId is required'});
  return browserBridge.heartbeat(body.sessionId,body.clientId,Array.isArray(body.tabs)?body.tabs:[]);
});
app.get('/bridge/sessions',async()=>({sessions:browserBridge.list()}));
app.get('/bridge/poll',async(req,reply)=>{const id=(req.query as {sessionId?:string}).sessionId;if(!id)return reply.code(400).send({error:'sessionId is required'});return {commands:browserBridge.poll(id)};});
app.post('/bridge/event',async(req,reply)=>{const body=req.body as {sessionId?:string;event?:unknown};if(!body?.sessionId||!body.event)return reply.code(400).send({error:'sessionId and event are required'});return {ok:browserBridge.event(body.sessionId,body.event as any)};});

app.get('/providers',async()=>{
  const runtime=await Promise.all(runtimeInfo.map(async x=>{
    const provider=providers.find(p=>p.id===x.id);
    if(!provider) return {...x,health:{healthy:false,latencyMs:0,error:'provider runtime unavailable'}};
    const health=await provider.health();
    const current=runtimeStatuses.get(x.id); return {...x,health,status:current ?? (health.healthy?'on':'error')};
  }));
  const definitions=await Promise.all((await store.list()).map(async d=>({
    id:d.provider.id,
    name:d.provider.name,
    transport:d.transport,
    version:d.provider.version,
    ...(d.transport==='web' && webProviders.has(d.provider.id) ? {health:await webProviders.get(d.provider.id)!.health(),status:webProviders.get(d.provider.id)!.status()} : {status:'off'})
  })));
  return {runtime,definitions};
});
app.get('/providers/:id/health',async(req,reply)=>{const id=(req.params as {id:string}).id;const provider=providers.find(p=>p.id===id);if(!provider)return reply.code(404).send({error:'provider not found'});return {id,health:await provider.health()};});
app.post('/providers/:id/start',async(req,reply)=>{const id=(req.params as {id:string}).id;const provider=webProviders.get(id);if(!provider)return reply.code(404).send({error:'web provider not found'});try{await mkdir(join(dataDir,'profiles',id),{recursive:true});await provider.start(join(dataDir,'profiles',id),false);return {ok:true,id,health:await provider.health()};}catch(e){return reply.code(500).send({error:String(e)});}});
app.post('/providers/:id/stop',async(req,reply)=>{const id=(req.params as {id:string}).id;const provider=webProviders.get(id);if(!provider)return reply.code(404).send({error:'web provider not found'});await provider.close();return {ok:true,id};});
app.post('/shutdown',async(req,reply)=>{for(const provider of webProviders.values()) await provider.close().catch(()=>undefined); reply.send({ok:true}); setImmediate(()=>app.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));});
app.post('/providers/configure',async(req,reply)=>{
  try {
    const body=req.body as RuntimeProviderConfig;
    if(!body || typeof body!=='object' || !body.id || !['api','local'].includes(body.transport) || !body.model) {
      return reply.code(400).send({error:'id, transport and model are required'});
    }
    if(body.transport==='api' && !body.apiKey) return reply.code(400).send({error:'apiKey is required for API providers'});
    const provider=createConfiguredProvider(body);
    const existing=providers.findIndex(p=>p.id===body.id);
    if(existing>=0) providers[existing]=provider; else providers.push(provider);
    const info={id:body.id,transport:body.transport,configured:true,model:body.model,source:'ui' as const};
    const infoIndex=runtimeInfo.findIndex(x=>x.id===body.id);
    if(infoIndex>=0) runtimeInfo[infoIndex]=info; else runtimeInfo.push(info);
    const health=await provider.health();
    runtimeStatuses.set(body.id,health.healthy?'on':'error');
    return {ok:true,provider:{id:body.id,transport:body.transport,model:body.model},health};
  } catch(e){ return reply.code(400).send({error:String(e)}); }
});
app.delete('/providers/:id',async(req,reply)=>{
  const id=(req.params as {id:string}).id;
  const index=providers.findIndex(p=>p.id===id);
  if(index>=0) providers.splice(index,1);
  const infoIndex=runtimeInfo.findIndex(x=>x.id===id);
  if(infoIndex>=0) runtimeInfo.splice(infoIndex,1);
  runtimeStatuses.delete(id);
  const web=webProviders.get(id);
  if(web){ try{ await web.close(); } finally { webProviders.delete(id); } }
  await store.remove(id);
  return {ok:true,id,removed:index>=0 || Boolean(web)};
});
app.post('/providers/:id/scan',async(req,reply)=>{const id=(req.params as {id:string}).id;const body=req.body as {target?:'input'|'send'|'response'};const provider=webProviders.get(id);if(!provider)return reply.code(404).send({error:'web provider not found'});if(!body.target)return reply.code(400).send({error:'target is required'});try{const result=await provider.scan(body.target);diagnostics.info('web.scan',{providerId:id,target:body.target,count:result?.candidates?.length??0,candidates:(result?.candidates??[]).slice(0,20).map((x:any)=>({selector:x.selector,score:x.score,reason:x.reason,tagName:x.tagName,testId:x.testId,ariaLabel:x.ariaLabel,matches:x.matches}))});return {ok:true,target:body.target,...result};}catch(e){diagnostics.error('web.scan.error',{providerId:id,target:body.target,error:e});return reply.code(500).send({error:String(e)});}});
app.post('/providers/:id/pick',async(req,reply)=>{
  const id=(req.params as {id:string}).id; const body=req.body as {target?:'input'|'send'|'response'};
  const provider=webProviders.get(id); if(!provider) return reply.code(404).send({error:'web provider not found'});
  if(!body.target) return reply.code(400).send({error:'target is required'});
  try {
    const picked=await provider.pick(body.target);
    const def=await store.read(id);
    const strategies: Array<{type:'css'|'role'|'attribute';value:string;confidence:number}>=[...(picked.cssCandidates ?? []).map((value:string,index:number)=>({type:'css' as const,value,confidence:index===0?1:0.8}))];
    if(picked.ariaLabel) strategies.push({type:'attribute' as const,value:`aria-label=\"${picked.ariaLabel.replace(/\"/g,'')}\"`,confidence:0.75});
    if(picked.role) strategies.push({type:'role' as const,value:picked.role,confidence:0.5});
    if(!strategies.length) throw new Error('Could not generate a locator for the selected element');
    const locator={strategies,framePath:[],shadowPath:[]};
    const next={...def, input:body.target==='input'?{locator}:def.input, send:body.target==='send'?{mode:'button' as const,locator}:def.send, response:body.target==='response'?{locator,selection:def.response?.selection ?? 'last'}:def.response};
    await store.save(next);
    const current=webProviders.get(id);
    current?.updateDefinition(next);
    return {ok:true,target:body.target,picked,definition:next};
  } catch(e){ return reply.code(500).send({error:String(e)}); }
});
app.post('/providers/import',async(req,reply)=>{try{const def=validateProviderDefinition(req.body);diagnostics.info('provider.save.start',{providerId:def.provider.id,transport:def.transport});await store.save(def);diagnostics.info('provider.save.success',{providerId:def.provider.id,filePath:resolve(dataDir,'providers',`${def.provider.id.replace(/[^a-z0-9._-]/gi,'_')}.json`)});if(def.transport==='web'){const existing=webProviders.get(def.provider.id);if(existing && !existing.requiresRestart(def)){existing.updateDefinition(def);diagnostics.debug('provider.runtime.preserved',{providerId:def.provider.id,status:existing.status()});}else{if(existing) await existing.close();const web=new WebProvider(def.provider.id,def,browserBridge);webProviders.set(def.provider.id,web);const index=providers.findIndex(p=>p.id===def.provider.id);if(index>=0)providers[index]=web;else providers.push(web);diagnostics.debug('provider.runtime.recreated',{providerId:def.provider.id});}}return {ok:true,provider:{id:def.provider.id,name:def.provider.name,transport:def.transport}};}catch(e){diagnostics.error('provider.save.error',{error:e});return reply.code(400).send({error:String(e)});}});
app.get('/providers/:id/export',async(req,reply)=>{try{const id=(req.params as {id:string}).id;const def=await store.read(id);return def;}catch(e){return reply.code(404).send({error:'provider definition not found'});}});
async function candidates():Promise<ProviderCandidate[]>{return Promise.all(providers.map(providerCandidate));}
async function prepareRequest(body:{requestId?:string;prompt?:string;privacy?:'standard'|'strict';modelOverride?:string;context?:AIRequest['context'];task?:AIRequest['task'];workspaceRoot?:string}):Promise<{request:AIRequest;signals:ReturnType<typeof classify>;memoryText:string;usedLocalModel:boolean;compressionReason:string;policy:Awaited<ReturnType<typeof decideIntelligencePolicy>>}> {
  if(!body.prompt?.trim()) throw new Error('prompt is required');
  const incoming=body.context ?? [];
  const safeIncoming=sanitizeContext(incoming).map(x=>({path:x.path,content:x.content,score:incoming.find(c=>c.path===x.path)?.score ?? 0.8,reason:incoming.find(c=>c.path===x.path)?.reason ?? 'gateway-sanitized context'}));
  const baseRequest:AIRequest={id:body.requestId?.trim()||randomUUID(),prompt:body.prompt.trim(),privacy:body.privacy??'standard',...(body.modelOverride?{modelOverride:body.modelOverride}:{}),...(safeIncoming.length?{context:safeIncoming}:{}),...(body.task?{task:body.task}:{}),...(body.workspaceRoot?{workspaceRoot:body.workspaceRoot}: {})};
  const intelligent=await buildIntelligentContext(body.workspaceRoot,baseRequest);
  const signals=classify(baseRequest.prompt,intelligent);
  const policy=await decideIntelligencePolicy(baseRequest,signals,intelligent);

  const selectDepth=(items:ContextItem[]):ContextItem[]=>{
    if(policy.contextDepth==='none') return [];
    if(policy.contextDepth==='selection') {
      const selected=items.filter(x=>x.reason==='active selection');
      return selected.length ? selected : items.slice(0,1);
    }
    if(policy.contextDepth==='file') {
      const active=items.filter(x=>x.reason.includes('active file') || x.reason==='active selection');
      return active.length ? active : items.slice(0,1);
    }
    return items;
  };

  let finalContext=selectDepth(intelligent);
  let memory='';
  if(body.workspaceRoot && policy.memoryDepth!=='none') {
    const currentMemory=await memoryStore.bootstrap(body.workspaceRoot);
    const files=finalContext.map(x=>x.path);
    const technologyHints=new Set(currentMemory.technologies);
    const allText=finalContext.map(x=>x.content).join('\n');
    if(/\bTypeScript\b|\.ts\b/.test(allText)) technologyHints.add('TypeScript');
    if(/Fastify/i.test(allText)) technologyHints.add('Fastify');
    if(/VS Code|vscode/i.test(allText)) technologyHints.add('VS Code extension');
    if(/Playwright/i.test(allText)) technologyHints.add('Playwright');
    if(/Ollama/i.test(allText)) technologyHints.add('Ollama');
    await memoryStore.update(body.workspaceRoot,{technologies:[...technologyHints],importantFiles:[...currentMemory.importantFiles,...files]});
    memory=memoryText(await memoryStore.load(body.workspaceRoot));
    if(policy.memoryDepth==='recent') memory=memory.split('\n').filter(line=>line.startsWith('Recent work:') || line.startsWith('Known facts:')).join('\n');
    if(policy.memoryDepth==='relevant') memory=memory.split('\n').filter(Boolean).slice(0,8).join('\n');
  }

  let usedLocalModel=false;
  let compressionReason=policy.useSemanticCompression?'Laya/deterministic policy requested semantic compression':'deterministic context selected';
  if(policy.useSemanticCompression) {
    const largest=finalContext.filter(x=>x.content.length>12_000).sort((a,b)=>b.content.length-a.content.length)[0];
    if(largest) {
      const result=await semanticCompress({...baseRequest,task:body.task??signals.task,context:finalContext},largest,memory);
      usedLocalModel=result.usedLocalModel;
      compressionReason=result.reason;
      if(result.usedLocalModel) finalContext=finalContext.map(x=>x.path===largest.path?result.context[0]!:x);
    }
  }

  const request:AIRequest={...baseRequest,task:body.task??signals.task,context:finalContext,...(memory?{projectMemory:memory}: {})};
  if(policy.useNcp) request.ncp=buildNcp(request,finalContext,memory,body.workspaceRoot);
  return {request,signals,memoryText:memory,usedLocalModel,compressionReason,policy};
}

app.post('/route',async(req,reply)=>{try{const body=req.body as {prompt?:string;privacy?:'standard'|'strict';modelOverride?:string;context?:AIRequest['context'];task?:AIRequest['task'];workspaceRoot?:string};const prepared=await prepareRequest(body);const decision=route(prepared.request,await candidates(),prepared.signals);return {signals:prepared.signals,decision,contextSummary:{items:prepared.request.context?.length??0,chars:prepared.request.context?.reduce((n,x)=>n+x.content.length,0)??0,selected:prepared.request.context?.filter(x=>x.reason.includes('selection')).length??0,localCompression:prepared.usedLocalModel,compressionReason:prepared.compressionReason,memory:prepared.memoryText?true:false,ncp:Boolean(prepared.request.ncp),ncpChars:prepared.request.ncp?.length??0,intelligence:prepared.policy}};}catch(error){return reply.code(400).send({error:String(error)});}});
app.post('/cancel',async(req,reply)=>{const body=req.body as {requestId?:string};if(!body.requestId)return reply.code(400).send({error:'requestId is required'});const provider=activeRequests.get(body.requestId);if(!provider)return {ok:false,cancelled:false};await provider.cancel(body.requestId);activeRequests.delete(body.requestId);return {ok:true,cancelled:true};});
app.get('/diagnostics/logs',async(req,reply)=>{const q=req.query as {lines?:string}; const lines=Math.min(5000,Math.max(1,Number(q.lines)||1000)); reply.type('text/plain; charset=utf-8'); return diagnostics.tail(lines);});
app.get('/diagnostics/status',async()=>({ok:true,logFile:diagnostics.filePath,bridgeSessions:browserBridge.list()}));
app.post('/chat',async(req,reply)=>{const body=req.body as {requestId?:string;prompt?:string;privacy?:'standard'|'strict';modelOverride?:string;context?:ContextItem[];task?:any;workspaceRoot?:string};let prepared;try{prepared=await prepareRequest(body)}catch(error){diagnostics.error('chat.prepare.error',{error});return reply.code(400).send({error:String(error)})}const list=await candidates();let decision:ReturnType<typeof route>;try{decision=route(prepared.request,list,prepared.signals);diagnostics.info('chat.route',{requestId:prepared.request.id,providerId:decision.providerId,candidates:decision.candidates.map(c=>({id:c.id,score:c.score,reasons:c.reasons})),task:prepared.request.task,contextItems:prepared.request.context?.length??0,ncpChars:prepared.request.ncp?.length??0});}catch(error){diagnostics.error('chat.route.error',{requestId:prepared.request.id,error});return reply.code(503).send({error:String(error)})}if(body.workspaceRoot){await memoryStore.rememberTask(body.workspaceRoot,prepared.request.task??'chat',prepared.request.prompt,decision.providerId)}reply.raw.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','transfer-encoding':'chunked','cache-control':'no-cache'});try{for await(const event of executeWithFallback(prepared.request,decision.candidates,providers,activeRequests)){
  const eventProvider=event.providerId ?? decision.providerId;
  if(event.type==='error') runtimeStatuses.set(eventProvider,'error');
  if(event.type==='complete') runtimeStatuses.set(eventProvider,'on');
  diagnostics.debug('chat.event',{requestId:prepared.request.id,type:event.type,providerId:eventProvider,error:event.type==='error'?event.error:undefined});
  reply.raw.write(JSON.stringify(event)+'\n');
}}catch(error){diagnostics.error('chat.execution.error',{requestId:prepared.request.id,error});reply.raw.write(JSON.stringify({type:'error',requestId:prepared.request.id,error:String(error)})+'\n')}finally{activeRequests.delete(prepared.request.id);reply.raw.end()}});

app.listen({port,host:'127.0.0.1'}).then(async()=>{diagnostics.info('gateway.start',{port,dataDir,logFile:diagnostics.filePath,providerDir:resolve(dataDir,'providers')});await store.init();for(const def of await store.list()){if(def.transport!=='web')continue;const web=new WebProvider(def.provider.id,def,browserBridge);webProviders.set(def.provider.id,web);if(!providers.some(p=>p.id===def.provider.id))providers.push(web);}console.log(`NyxelRelay Gateway listening on 127.0.0.1:${port}`);}).catch(e=>{console.error(e);process.exit(1)});
