import {randomUUID} from 'node:crypto';
import {diagnostics,fingerprint} from '../diagnostics.js';

export type BridgeBrowser = 'chrome'|'edge'|'firefox'|'unknown';
export type BridgeTab = {tabId:number; title:string; url:string; browser:BridgeBrowser; sessionId:string; updatedAt:number};
export type BridgeCommand = {id:string; requestId?:string; tabId:number; op:'navigate'|'fill'|'click'|'clickSend'|'press'|'snapshot'|'extract'|'pick'|'scan'; locator?:unknown; inputLocator?:unknown; beforeUserCount?:number; value?:string; key?:string; target?:'input'|'send'|'response'};
export type BridgeEvent = {id:string; commandId:string; ok:boolean; result?:unknown; error?:string};

type Session={id:string;clientId?:string;browser:BridgeBrowser;tabs:Map<number,BridgeTab>;queue:BridgeCommand[];waiters:Map<string,{resolve:(v:BridgeEvent)=>void,reject:(e:Error)=>void,timer:ReturnType<typeof setTimeout>}>;lastSeen:number;generation:number};

export class BrowserBridgeManager {
  private sessions=new Map<string,Session>();
  private generation=0;
  register(input:{sessionId?:string;clientId?:string;browser:BridgeBrowser;tabs:Array<{tabId:number;title:string;url:string}>}){
    const id=input.sessionId?.trim() || randomUUID();
    const clientId=input.clientId?.trim() || undefined;
    if(clientId){
      for(const [existingId,existing] of this.sessions){
        if(existingId!==id && existing.clientId===clientId){
          diagnostics.warn('bridge.session.replaced',{oldSessionId:existingId,newSessionId:id,clientId});
          this.unregister(existingId);
        }
      }
    }
    // A single local Chrome profile should expose one active bridge for a given
    // browser/tab set. This also cleans up stale extension contexts that can
    // survive a reload and otherwise produce several sessions for tab 7.
    const incomingTabs=new Set(input.tabs.map(t=>`${t.tabId}|${t.url.split('?')[0]}`));
    if(incomingTabs.size){
      for(const [existingId,existing] of this.sessions){
        if(existingId===id || existing.browser!==input.browser) continue;
        const overlap=[...existing.tabs.values()].some(t=>incomingTabs.has(`${t.tabId}|${t.url.split('?')[0]}`));
        if(overlap){
          diagnostics.warn('bridge.session.overlap-replaced',{oldSessionId:existingId,newSessionId:id,browser:input.browser,overlapTabs:[...existing.tabs.values()].filter(t=>incomingTabs.has(`${t.tabId}|${t.url.split('?')[0]}`)).map(t=>t.tabId)});
          this.unregister(existingId);
        }
      }
    }
    let session=this.sessions.get(id);
    if(!session){
      const created:Session={id,browser:input.browser,tabs:new Map(),queue:[],waiters:new Map(),lastSeen:Date.now(),generation:++this.generation};
      if(clientId) created.clientId=clientId;
      this.sessions.set(id,created);
      session=created;
    }
    if(clientId) session.clientId=clientId;
    session.browser=input.browser;
    session.lastSeen=Date.now();
    diagnostics.debug('bridge.register',{sessionId:id,clientId:clientId?fingerprint(clientId):undefined,browser:input.browser,tabs:input.tabs.map(tab=>({tabId:tab.tabId,title:tab.title,url:tab.url.split('?')[0]}))});
    for(const tab of input.tabs) session.tabs.set(tab.tabId,{...tab,browser:input.browser,sessionId:id,updatedAt:Date.now()});
    return this.publicSession(session);
  }
  heartbeat(id:string,clientId:string|undefined,tabs:Array<{tabId:number;title:string;url:string}>){
    const input:{sessionId:string;clientId?:string;browser:BridgeBrowser;tabs:Array<{tabId:number;title:string;url:string}>}={sessionId:id,browser:this.sessions.get(id)?.browser ?? 'unknown',tabs};
    if(clientId) input.clientId=clientId;
    return this.register(input);
  }
  unregister(id:string){const s=this.sessions.get(id); if(!s)return; for(const w of s.waiters.values()){clearTimeout(w.timer);w.reject(new Error('Browser bridge disconnected'));} this.sessions.delete(id);}
  list(){return [...this.sessions.values()].map(s=>this.publicSession(s));}
  findTab(browser:BridgeBrowser,hostname:string){
    const wanted=hostname.toLowerCase();
    const now=Date.now();
    for(const [id,s] of this.sessions){
      if(now-s.lastSeen>15_000) this.unregister(id);
    }
    const sessions=[...this.sessions.values()]
      .filter(s=>browser==='unknown'||s.browser===browser)
      .sort((a,b)=>b.lastSeen-a.lastSeen || b.generation-a.generation);
    for(const s of sessions) for(const tab of s.tabs.values()){
      try{if(new URL(tab.url).hostname.toLowerCase()===wanted)return tab;}catch{/* ignore */}
    }
    return undefined;
  }
  enqueue(tab:BridgeTab,command:Omit<BridgeCommand,'id'|'tabId'>,timeoutMs=30_000){
    const session=this.sessions.get(tab.sessionId); if(!session) return Promise.reject(new Error('Browser bridge session is disconnected'));
    const full:BridgeCommand={...command,id:randomUUID(),tabId:tab.tabId};
    diagnostics.debug('bridge.command.queued',{sessionId:session.id,requestId:full.requestId,commandId:full.id,tabId:tab.tabId,op:full.op,target:full.target,hasLocator:Boolean(full.locator),locator:full.locator,valueLength:typeof full.value==='string'?full.value.length:0,key:full.key});
    session.queue.push(full);
    return new Promise<BridgeEvent>((resolve,reject)=>{
      const timer=setTimeout(()=>{session.waiters.delete(full.id);diagnostics.error('bridge.command.timeout',{sessionId:session.id,requestId:full.requestId,commandId:full.id,tabId:tab.tabId,op:full.op,timeoutMs,queueDepth:session.queue.length});reject(new Error(`Browser bridge command timed out: ${full.op}`));},timeoutMs);
      session.waiters.set(full.id,{resolve,reject,timer});
    });
  }
  poll(id:string){const s=this.sessions.get(id);if(!s)return [];s.lastSeen=Date.now();const out=s.queue.splice(0,s.queue.length);return out;}
  event(id:string,event:BridgeEvent){const s=this.sessions.get(id);if(!s)return false;const waiter=s.waiters.get(event.commandId);if(!waiter)return false;s.waiters.delete(event.commandId);clearTimeout(waiter.timer);diagnostics.debug('bridge.command.result',{sessionId:id,commandId:event.commandId,ok:event.ok,error:event.error,result:event.result});waiter.resolve(event);return true;}
  private publicSession(s:Session){return {id:s.id,browser:s.browser,lastSeen:s.lastSeen,tabs:[...s.tabs.values()]};}
}
