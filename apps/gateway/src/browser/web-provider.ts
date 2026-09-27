import {chromium, type BrowserContext, type Page} from 'playwright';
import {validateProviderDefinition, type ProviderDefinition} from '@nyxelrelay/provider-schema';
import {resolve} from './locator.js';
import {pickElement, type PickedElement} from './picker.js';
import type {BrowserBridgeManager, BridgeTab} from './bridge.js';
import type {AIEvent,AIRequest} from '../domain/types.js';
import type {Provider} from '../providers/provider.js';
import {diagnostics, fingerprint} from '../diagnostics.js';

const INITIAL_RESPONSE_TIMEOUT_MS = 30_000;
const GENERATION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 350;
const RESPONSE_STABLE_MS = 2_000;
const MIN_GENERATION_MS = 450;

type MessageSnapshot = { count:number; lastText:string; texts:string[]; signature:string; userCount:number; userLastText:string; };

type WebProviderState = 'stopped'|'starting'|'ready'|'busy'|'error'|'degraded'|'stopping';

export function normalizeWebUrl(raw:string):string {
  const cleaned=raw.trim().replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ');
  const markdown=cleaned.match(/https?:\/\/[^\s)]+/i);
  const candidate=(markdown?.[0] ?? cleaned).trim();
  let url:URL;
  try { url=new URL(candidate); } catch { throw new Error(`Invalid Web Provider URL: ${JSON.stringify(raw)}. Use a complete http:// or https:// URL.`); }
  if(url.protocol!=='http:' && url.protocol!=='https:') throw new Error(`Unsupported Web Provider URL protocol: ${url.protocol}`);
  return url.toString();
}

function normalizeResponseText(value:string):string {
  return value.replace(/^(?:ChatGPT|Claude|Gemini|DeepSeek|GLM)\s+said\s*:\s*/i,'').trim();
}

export class WebProvider implements Provider {
  public readonly transport='web' as const;
  private context:BrowserContext | undefined;
  private startPromise:Promise<void> | undefined;
  private profileDir:string | undefined;
  private pagePromise:Promise<Page> | undefined;
  private pageInitialized=false;
  private executionQueue:Promise<void>=Promise.resolve();
  private state:WebProviderState='stopped';
  private lastError:string|undefined;

  constructor(public readonly id:string,private definition:ProviderDefinition,private bridge?:BrowserBridgeManager){validateProviderDefinition(definition);}
  requiresRestart(definition:ProviderDefinition):boolean {
    const next=validateProviderDefinition(definition);
    if(this.definition.browser.mode!==next.browser.mode) return true;
    if(this.definition.browser.mode==='managed' && this.definition.website.url!==next.website.url) return true;
    return false;
  }
  updateDefinition(definition:ProviderDefinition){
    const next=validateProviderDefinition(definition);
    const urlChanged=this.definition.website.url!==next.website.url;
    this.definition=next;
    if(this.definition.browser.mode==='managed' && urlChanged) this.pageInitialized=false;
    this.lastError=undefined;
  }
  get manifest(){return {capabilities:{streaming:this.definition.capabilities.streaming,vision:this.definition.capabilities.vision,files:this.definition.capabilities.files,tools:this.definition.capabilities.tools,maxContextTokens:this.definition.capabilities.maxContextTokens}};}

  async start(profileDir:string,headless=false){
    this.profileDir=profileDir;
    if(this.definition.browser.mode==='existing'){
      this.state='starting'; this.lastError=undefined;
      try {
        if(!this.bridge) throw new Error('Existing Browser mode requires the NyxelRelay Browser Bridge extension.');
        diagnostics.debug('web.bridge.resolve',{providerId:this.id,op:'resolve',mode:this.definition.browser.mode,family:this.definition.browser.family});
    const tab=await this.resolveBridgeTab();
        if(!tab) throw new Error(`No connected ${this.definition.browser.family} tab found for ${new URL(this.definition.website.url).hostname}. Open the provider in your browser and install/enable the NyxelRelay Browser Bridge extension.`);
        this.state='ready';
      } catch(error){this.state='error';this.lastError=String(error);throw error;}
      return;
    }
    if(this.context && this.state==='ready') return;
    if(this.context && this.state!=='ready') await this.close();
    this.state='starting';
    this.lastError=undefined;
    if(this.startPromise) return this.startPromise;
    this.startPromise=(async()=>{
      try {
        this.context=await chromium.launchPersistentContext(profileDir,{headless});
        await this.getPage();
        this.state='ready';
      } catch(error) {
        this.state='error';
        this.lastError=String(error);
        const message=String(error);
        if(message.includes('Opening in existing browser session')) {
          throw new Error(`Browser profile is already in use: ${profileDir}. Close the existing NyxelRelay browser window or stop the previous Gateway, then start the provider again.`);
        }
        throw error;
      } finally { this.startPromise=undefined; }
    })();
    return this.startPromise;
  }

  status(): 'on'|'off'|'error'|'degraded' {
    if(this.state==='error') return 'error';
    if(this.state==='degraded') return 'degraded';
    if(this.state==='ready' || this.state==='busy') return 'on';
    return 'off';
  }

  async health(){
    if(this.state==='error') return {healthy:false,latencyMs:0,error:this.lastError ?? 'provider error'};
    if(this.state==='stopped') return {healthy:false,latencyMs:0,error:'provider stopped'};
    if(this.definition.browser.mode==='existing'){
      try {
        const tab=await this.resolveBridgeTab();
        return tab ? {healthy:true,latencyMs:0} : {healthy:false,latencyMs:0,error:this.lastError ?? 'browser bridge tab not connected'};
      } catch(error){return {healthy:false,latencyMs:0,error:String(error)};}
    }
    return this.context ? {healthy:true,latencyMs:0} : {healthy:false,latencyMs:0,error:this.lastError ?? 'browser worker not started'};
  }

  private async resolveBridgeTab():Promise<BridgeTab|undefined>{
    if(!this.bridge) return undefined;
    const host=new URL(normalizeWebUrl(this.definition.website.url)).hostname;
    const family=this.definition.browser.family;
    return this.bridge.findTab(family==='chromium'?'unknown':family,host);
  }

  private async bridgeCommand(op:'navigate'|'fill'|'click'|'clickSend'|'press'|'snapshot'|'extract'|'pick'|'scan',args:Record<string,unknown>={},timeoutMs=30_000,requestId?:string):Promise<any>{
    const tab=await this.resolveBridgeTab();
    if(!tab || !this.bridge){ diagnostics.error('web.bridge.no_tab',{providerId:this.id,op}); throw new Error('No connected browser tab is available. Open the provider page and keep the Browser Bridge extension enabled.'); }
    diagnostics.debug('web.bridge.command',{providerId:this.id,requestId,op,tabId:tab.tabId,sessionId:tab.sessionId,locator:args.locator,valueLength:typeof args.value==='string'?args.value.length:0,target:args.target});
    const result=await this.bridge.enqueue(tab,{op,requestId,...args} as any,timeoutMs);
    if(!result.ok){ diagnostics.error('web.bridge.failed',{providerId:this.id,requestId,op,error:result.error}); throw new Error(result.error ?? `Browser Bridge command failed: ${op}`); }
    diagnostics.debug('web.bridge.success',{providerId:this.id,requestId,op,result:result.result});
    return result.result;
  }

  private async getPage():Promise<Page>{
    if(!this.context) throw new Error('Browser worker is not running');
    if(this.pagePromise) return this.pagePromise;
    this.pagePromise=(async()=>{
      const pages=this.context!.pages();
      const page=pages[0] ?? await this.context!.newPage();
      const target=normalizeWebUrl(this.definition.website.url);
      // Navigate exactly once per browser session. This guarantees that clicking
      // Start opens the configured website, while later chat requests keep the
      // same page and conversation instead of reloading it.
      if(!this.pageInitialized) {
        let lastError:unknown;
        for(let attempt=1;attempt<=3;attempt++){
          try {
            await page.goto(target,{waitUntil:'domcontentloaded',timeout:30_000});
            await page.waitForLoadState('domcontentloaded').catch(()=>undefined);
            this.pageInitialized=true;
            lastError=undefined;
            break;
          } catch(error) {
            lastError=error;
            if(attempt<3) await page.waitForTimeout(500*attempt);
          }
        }
        if(!this.pageInitialized) throw new Error(`Web Provider could not open ${target}: ${String(lastError)}`);
      }
      await page.bringToFront().catch(()=>undefined);
      return page;
    })();
    try { return await this.pagePromise; }
    finally { this.pagePromise=undefined; }
  }

  private async enqueue<T>(work:()=>Promise<T>):Promise<T>{
    const previous=this.executionQueue;
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    this.executionQueue=previous.then(()=>gate).catch(()=>gate);
    await previous.catch(()=>undefined);
    try { return await work(); }
    finally { release(); }
  }

  private assertInteractionConfigured(): void {
    if(!this.definition.input) throw new Error('Web Provider input locator is not configured. Start the provider and use Pick Input.');
    if(!this.definition.response && this.definition.browser.mode!=='existing') throw new Error('Web Provider response locator is not configured. Start the provider and use Pick Response.');
  }

  private async snapshotResponse(page?:Page):Promise<MessageSnapshot>{
    const response=this.definition.response;
    if(this.definition.browser.mode==='existing'){
      const result=await this.bridgeCommand('snapshot',response ? {locator:response.locator} : {});
      const assistantTexts=Array.isArray(result?.assistantTexts)?result.assistantTexts.map((x:unknown)=>String(x).trim()).filter(Boolean):[];
      const locatorText=String(result?.locatorText ?? '').trim();
      const locatorTexts=Array.isArray(result?.texts)?result.texts.map((x:unknown)=>String(x).trim()).filter(Boolean):[];
      const texts=assistantTexts.length ? assistantTexts : (locatorTexts.length ? locatorTexts : (locatorText ? [locatorText] : []));
      const lastText=texts.at(-1) ?? '';
      return {count:texts.length,lastText,texts,signature:texts.join('\u241e'),userCount:Number(result?.userCount ?? 0),userLastText:String(result?.userLastText ?? '')};
    }
    if(!response) throw new Error('Web Provider response locator is not configured. Start the provider and use Pick Response.');
    if(!page) throw new Error('Managed browser page is unavailable');
    const container=await resolve(page,response.locator);
    const children=container.locator(':scope > *');
    const texts=await children.allInnerTexts().catch(async()=>[(await container.innerText()).trim()]);
    const meaningful=texts.map((text:string)=>text.trim()).filter(Boolean);
    const lastText=meaningful.at(-1) ?? '';
    return {count:meaningful.length,lastText,texts:meaningful,signature:meaningful.join('\u241e'),userCount:0,userLastText:''};
  }

  private async readLatestResponse(page?:Page):Promise<string>{
    const response=this.definition.response;
    if(this.definition.browser.mode==='existing'){
      const result=await this.bridgeCommand('snapshot',response ? {locator:response.locator} : {});
      const assistantTexts=Array.isArray(result?.assistantTexts)?result.assistantTexts.map((x:unknown)=>String(x).trim()).filter(Boolean):[];
      const textValue=assistantTexts.at(-1) ?? (Array.isArray(result?.texts)?String(result.texts.at(-1) ?? ''):'');
      return normalizeResponseText(textValue);
    }
    if(!response) throw new Error('Web Provider response locator is not configured. Start the provider and use Pick Response.');
    if(!page) throw new Error('Managed browser page is unavailable');
    const container=await resolve(page,response.locator);
    const children=container.locator(':scope > *');
    const texts=await children.allInnerTexts().catch(async()=>[(await container.innerText()).trim()]);
    const meaningful=texts.map((text:string)=>text.trim()).filter(Boolean);
    return normalizeResponseText(meaningful.at(-1) ?? (await container.innerText()).trim());
  }

  private async clickManagedSend(page:Page):Promise<void>{
    const buttons=page.locator('button,[role=\"button\"]');
    const count=await buttons.count();
    for(let i=count-1;i>=0;i--){
      const button=buttons.nth(i);
      if(!(await button.isVisible().catch(()=>false))) continue;
      if(await button.isDisabled().catch(()=>false)) continue;
      const label=((await button.getAttribute('aria-label').catch(()=>null))|| (await button.getAttribute('title').catch(()=>null)) || (await button.innerText().catch(()=>''))).trim();
      if(/^(send|send message|submit)$/i.test(label) || /\bsend(?: message)?\b/i.test(label)){ await button.click(); return; }
    }
    throw new Error('Send button not found after entering the message. The provider may still show the voice button or its send control uses a different accessible label.');
  }

  private async responseExistsAfter(page:Page|undefined,before:MessageSnapshot,prompt:string):Promise<boolean>{
    const current=await this.snapshotResponse(page);
    const normalizedPrompt=prompt.trim().replace(/\s+/g,' ');
    const normalizedBefore=before.lastText.replace(/\s+/g,' ');
    const normalizedCurrent=current.lastText.replace(/\s+/g,' ');
    const isOutgoing=(value:string)=>{
      const normalized=value.replace(/\s+/g,' ');
      return !normalized || normalized===normalizedPrompt || normalized.endsWith(normalizedPrompt) || normalized.includes('NYXEL CONTEXT PACKET / 1');
    };
    // A new assistant turn may have exactly the same text as the previous one.
    // Count changes therefore matter, but only when the newest turn is not our
    // own outgoing prompt/NCP.
    if(current.count>before.count && !isOutgoing(normalizedCurrent)) return true;
    if(normalizedCurrent && normalizedCurrent!==normalizedBefore && !isOutgoing(normalizedCurrent)) return true;
    // If the configured response locator points directly at the active assistant
    // turn, its text can change while the number of matched nodes stays constant.
    if(current.lastText && before.lastText && normalizedCurrent!==normalizedBefore && !isOutgoing(normalizedCurrent)) return true;
    return false;
  }

  private async generationState(page?:Page):Promise<{stopVisible:boolean;sendEnabled:boolean}>{
    const send=this.definition.send;
    if(this.definition.browser.mode==='existing'){
      const result=send?.locator ? await this.bridgeCommand('snapshot',{locator:send.locator}) : await this.bridgeCommand('snapshot');
      return {stopVisible:Boolean(result?.stopVisible),sendEnabled:result?.sendEnabled!==false};
    }
    if(!page) return {stopVisible:false,sendEnabled:true};
    const stopVisible=await page.locator('button,[role="button"]').evaluateAll((elements:Element[])=>elements.some((element:Element)=>{
      const el=element as HTMLElement;
      const label=(el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent||'').trim().toLowerCase();
      return /stop(?: generating| generation)?\b/.test(label) || label==='stop';
    })).catch(()=>false);
    let sendEnabled=true;
    try { if(send?.locator) { const sendElement=await resolve(page,send.locator); sendEnabled=await sendElement.isEnabled().catch(()=>true) && !(await sendElement.getAttribute('aria-disabled').catch(()=>null)==='true'); } } catch { sendEnabled=true; }
    return {stopVisible,sendEnabled};
  }

  private async waitForResponse(page:Page|undefined,before:MessageSnapshot,requestId:string,prompt:string):Promise<string>{
    const started=Date.now();
    let sawResponse=false;
    let lastText='';
    let lastChange=Date.now();
    let generationStartedAt=Date.now();
    let lastDiagnostic=0;

    diagnostics.debug('web.response.wait.start',{providerId:this.id,requestId,beforeCount:before.count,beforeLastFingerprint:before.lastText?fingerprint(before.lastText):'',promptFingerprint:fingerprint(prompt)});
    while(Date.now()-started<GENERATION_TIMEOUT_MS){
      if(!sawResponse){
        if(await this.responseExistsAfter(page,before,prompt)) {
          sawResponse=true;
          generationStartedAt=Date.now();
          lastChange=Date.now();
        } else if(Date.now()-started>INITIAL_RESPONSE_TIMEOUT_MS) {
          const snapshot=await this.snapshotResponse(page).catch(()=>({count:0,lastText:'',texts:[],signature:'',userCount:0,userLastText:''}));
          diagnostics.error('web.response.initial-timeout',{providerId:this.id,requestId,elapsedMs:Date.now()-started,currentCount:snapshot.count,currentLastFingerprint:snapshot.lastText?fingerprint(snapshot.lastText):'',currentTextCount:snapshot.texts.length});
          throw new Error(`Timed out waiting for the web provider to create a new assistant response (request ${requestId}). Check the response locator.`);
        }
      }

      if(sawResponse){
        const text=await this.readLatestResponse(page);
        if(text!==lastText){lastText=text;lastChange=Date.now();}
        const state=await this.generationState(page);
        if(Date.now()-lastDiagnostic>5000){ lastDiagnostic=Date.now(); diagnostics.debug('web.response.progress',{providerId:this.id,requestId,textLength:text.length,textFingerprint:text?fingerprint(text):'',stopVisible:state.stopVisible,sendEnabled:state.sendEnabled,stableFor:Date.now()-lastChange}); }
        const stableFor=Date.now()-lastChange;
        const minimumGenerationReached=Date.now()-generationStartedAt>=MIN_GENERATION_MS;
        const configured=this.definition.streaming.completionSignals;
        const stopSignal=configured.includes('stop-button-disappears') && !state.stopVisible && minimumGenerationReached;
        const sendSignal=configured.includes('send-enabled') && state.sendEnabled && minimumGenerationReached;
        const stableSignal=configured.includes('response-stable') || configured.includes('mutation-idle') || configured.length===0;
        if(stableFor>=RESPONSE_STABLE_MS && minimumGenerationReached && (stopSignal || sendSignal || stableSignal)) return text;
      }

      await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for the web provider response to finish (request ${requestId}).`);
  }

  async *execute(request:AIRequest):AsyncIterable<AIEvent>{
    if(this.state!=='ready') {
      if(this.definition.browser.mode==='existing') await this.start(this.profileDir ?? '',false);
      else { if(!this.profileDir) throw new Error('Browser worker is not running. Start the web provider first.'); await this.start(this.profileDir,false); }
    }
    if(this.state!=='ready') throw new Error(this.lastError ?? 'Browser provider is not ready');
    yield {type:'start',requestId:request.id};
    this.state='busy';
    let responseText='';
    try {
      await this.enqueue(async()=>{
        this.assertInteractionConfigured();
        const inputConfig=this.definition.input!;
        const sendConfig=this.definition.send;
        const page=this.definition.browser.mode==='existing' ? undefined : await this.getPage();
        diagnostics.debug('web.request.phase',{providerId:this.id,requestId:request.id,phase:'snapshot.before'});
        const before=await this.snapshotResponse(page);
        diagnostics.debug('web.request.snapshot.before',{providerId:this.id,requestId:request.id,count:before.count,userCount:before.userCount,lastFingerprint:before.lastText?fingerprint(before.lastText):'',userLastFingerprint:before.userLastText?fingerprint(before.userLastText):''});
        const payload=request.ncp ? request.ncp : request.prompt;
        diagnostics.info('web.request.start',{providerId:this.id,requestId:request.id,promptFingerprint:fingerprint(request.prompt),payloadLength:payload.length,beforeCount:before.count,beforeLastFingerprint:before.lastText?fingerprint(before.lastText):'',inputConfigured:Boolean(inputConfig),sendConfigured:Boolean(sendConfig),responseConfigured:Boolean(this.definition.response)});
        if(this.definition.browser.mode==='existing') {
          diagnostics.debug('web.request.phase',{providerId:this.id,requestId:request.id,phase:'fill.start',payloadLength:payload.length});
          const fillResult=await this.bridgeCommand('fill',{locator:inputConfig.locator,value:payload},30_000,request.id);
          diagnostics.debug('web.request.fill',{providerId:this.id,requestId:request.id,fillResult,verified:Boolean(fillResult?.ok),activeElement:fillResult?.activeElement,actualValueLength:fillResult?.actualValueLength});
          if(fillResult?.ok!==true || Number(fillResult?.actualValueLength ?? -1)!==payload.length) {
            throw new Error(`Web Provider input could not be filled and verified. expected=${payload.length} actual=${Number(fillResult?.actualValueLength ?? -1)} tag=${String(fillResult?.tag ?? '')}`);
          }
          // Let the controlled web editor commit before submitting. Prefer the actual
          // Send button because synthetic KeyboardEvents are not trusted browser input
          // and modern React editors may ignore them. Enter remains the fallback.
          await new Promise<void>(resolve=>setTimeout(resolve,350));
          let submitted=false;
          if(sendConfig?.locator){
            try {
              diagnostics.debug('web.request.send',{providerId:this.id,requestId:request.id,mode:'button'});
              await this.bridgeCommand('clickSend',{locator:sendConfig.locator,inputLocator:inputConfig.locator,beforeUserCount:before.userCount},30_000,request.id);
              submitted=true;
            } catch(error){
              diagnostics.debug('web.request.send.fallback',{providerId:this.id,requestId:request.id,reason:'configured-send-failed',error:String(error)});
            }
          }
          if(!submitted){
            try {
              diagnostics.debug('web.request.send.auto',{providerId:this.id,requestId:request.id,mode:'button-auto'});
              await this.bridgeCommand('clickSend',{inputLocator:inputConfig.locator,beforeUserCount:before.userCount},30_000,request.id);
              submitted=true;
            } catch(error){
              diagnostics.debug('web.request.send.fallback',{providerId:this.id,requestId:request.id,reason:'auto-send-failed',error:String(error)});
            }
          }
          if(!submitted){
            diagnostics.debug('web.request.send.keyboard',{providerId:this.id,requestId:request.id,key:sendConfig?.key ?? 'Enter'});
            await this.bridgeCommand('press',{locator:inputConfig.locator,key:sendConfig?.key ?? 'Enter'},30_000,request.id);
          }
          const submitDeadline=Date.now()+8_000;
          let submittedTurn=false;
          while(Date.now()<submitDeadline){
            const afterSubmit=await this.snapshotResponse(undefined);
            if(afterSubmit.userCount>before.userCount){ submittedTurn=true; diagnostics.debug('web.request.submitted',{providerId:this.id,requestId:request.id,userCountBefore:before.userCount,userCountAfter:afterSubmit.userCount}); break; }
            await new Promise<void>(resolve=>setTimeout(resolve,250));
          }
          if(!submittedTurn){ const finalSubmit=await this.snapshotResponse(undefined).catch(()=>undefined); diagnostics.error('web.request.submit-timeout',{providerId:this.id,requestId:request.id,userCountBefore:before.userCount,userCountAfter:finalSubmit?.userCount ?? -1,userLastFingerprint:finalSubmit?.userLastText?fingerprint(finalSubmit.userLastText):'',lastTextFingerprint:finalSubmit?.lastText?fingerprint(finalSubmit.lastText):''}); throw new Error(`Web Provider submitted the editor but no new user message appeared within 8s. The provider may not have accepted the filled text.`); }
        } else {
          const input=await resolve(page!,inputConfig.locator);
          await input.fill(payload);
          await page!.waitForTimeout(150);
          if(sendConfig?.mode==='keyboard') await input.press(sendConfig.key ?? 'Enter');
          else if(sendConfig?.locator) {
            const button=await resolve(page!,sendConfig.locator).catch(()=>undefined);
            if(button) await button.click();
            else await this.clickManagedSend(page!);
          } else await this.clickManagedSend(page!);
        }
        diagnostics.debug('web.request.phase',{providerId:this.id,requestId:request.id,phase:'response.wait.start'});
        responseText=await this.waitForResponse(page,before,request.id,payload);
        diagnostics.info('web.request.complete',{providerId:this.id,requestId:request.id,responseLength:responseText.length,responseFingerprint:responseText?fingerprint(responseText):''});
      });
      yield {type:'delta',requestId:request.id,text:responseText};
      yield {type:'complete',requestId:request.id};
      this.state='ready';
    } catch(error) {
      this.state=this.definition.browser.mode==='existing' ? 'degraded' : 'error';
      this.lastError=String(error);
      diagnostics.error('web.request.error',{providerId:this.id,requestId:request.id,error});
      yield {type:'error',requestId:request.id,error:String(error)};
    }
  }

  async scan(target:'input'|'send'|'response'):Promise<any>{
    if(this.definition.browser?.mode==='existing'){
      return await this.bridgeCommand('scan',{target});
    }
    throw new Error('Page scanner is available for Existing Browser transport');
  }

  async pick(target:'input'|'send'|'response'):Promise<PickedElement>{
    if(this.definition.browser.mode==='existing'){
      if(this.state!=='ready') await this.start(this.profileDir ?? '',false);
      const result=await this.bridgeCommand('pick',{target});
      return result as PickedElement;
    }
    if(!this.context) throw new Error('Browser is not running. Start the provider first.');
    const page=await this.getPage();
    const prompts={input:'Click the message input field.',send:'Click the Send button.',response:'Click the conversation container or assistant response element.'};
    return pickElement(page,prompts[target]);
  }

  async cancel(_requestId:string){
    if(this.definition.browser.mode==='existing'){
      try { await this.bridgeCommand('press',{key:'Escape'},5_000); } catch {/* best effort */}
      this.state='ready'; return;
    }
    const page=this.context?.pages()[0];
    if(!page) return;
    try {
      const stop=page.locator('button,[role="button"]').filter({hasText:/stop/i}).last();
      if(await stop.count() && await stop.isVisible().catch(()=>false)) {await stop.click().catch(()=>undefined);return;}
    } catch { /* fallback below */ }
    await page.keyboard.press('Escape').catch(()=>undefined);
  }

  async close(){
    this.state='stopping';
    if(this.definition.browser.mode==='existing'){ this.state='stopped'; this.lastError=undefined; return; }
    const context=this.context;
    this.context=undefined;
    this.startPromise=undefined;
    this.pagePromise=undefined;
    this.pageInitialized=false;
    if(context) await context.close().catch(()=>undefined);
    this.state='stopped';
  }
}
