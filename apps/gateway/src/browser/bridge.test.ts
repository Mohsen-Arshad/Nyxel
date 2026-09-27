import {describe,it,expect} from 'vitest';
import {BrowserBridgeManager} from './bridge.js';

describe('BrowserBridgeManager',()=>{
  it('registers and finds a provider tab by browser and hostname',()=>{
    const bridge=new BrowserBridgeManager();
    const session=bridge.register({browser:'chrome',tabs:[{tabId:7,title:'ChatGPT',url:'https://chatgpt.com/'}]});
    expect(session.browser).toBe('chrome');
    expect(bridge.findTab('chrome','chatgpt.com')?.tabId).toBe(7);
    expect(bridge.findTab('edge','chatgpt.com')).toBeUndefined();
  });
  it('prefers the most recently seen bridge session when duplicate browser sessions exist',()=>{
    const bridge=new BrowserBridgeManager();
    const first=bridge.register({browser:'chrome',tabs:[{tabId:7,title:'ChatGPT',url:'https://chatgpt.com/'}]});
    const second=bridge.register({browser:'chrome',tabs:[{tabId:7,title:'ChatGPT',url:'https://chatgpt.com/'}]});
    expect(first.id).not.toBe(second.id);
    expect(bridge.findTab('chrome','chatgpt.com')?.sessionId).toBe(second.id);
  });
  it('delivers queued commands through poll and resolves them from events',async()=>{
    const bridge=new BrowserBridgeManager();
    const session=bridge.register({browser:'chrome',tabs:[{tabId:7,title:'ChatGPT',url:'https://chatgpt.com/'}]});
    const tab=bridge.findTab('chrome','chatgpt.com')!;
    const pending=bridge.enqueue(tab,{op:'click',locator:{strategies:[{type:'css',value:'button'}]}});
    const commands=bridge.poll(session.id);
    expect(commands).toHaveLength(1);
    bridge.event(session.id,{id:'event',commandId:commands[0]!.id,ok:true,result:{ok:true}});
    await expect(pending).resolves.toMatchObject({ok:true});
  });
});
