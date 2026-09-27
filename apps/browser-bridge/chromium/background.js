const GATEWAY='http://127.0.0.1:4321';
const SESSION_KEY='nyxelrelay.sessionId';
const CLIENT_KEY='nyxelrelay.clientId';
let sessionId;
let clientId;
let registerPromise;
function browserName(){const ua=navigator.userAgent;return /Edg\//.test(ua)?'edge':'chrome';}
async function tabs(){return (await chrome.tabs.query({})).filter(t=>typeof t.id==='number').map(t=>({tabId:t.id,title:t.title||'',url:t.url||''}));}
async function post(path,body){const r=await fetch(GATEWAY+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`${path}: ${r.status}`);return r.json();}
async function register(){
  if(registerPromise)return registerPromise;
  registerPromise=(async()=>{
    try{
      const stored=await chrome.storage.local.get([SESSION_KEY,CLIENT_KEY]);
      if(!clientId) clientId=typeof stored[CLIENT_KEY]==='string' && stored[CLIENT_KEY] ? stored[CLIENT_KEY] : crypto.randomUUID();
      if(!sessionId) sessionId=typeof stored[SESSION_KEY]==='string' && stored[SESSION_KEY] ? stored[SESSION_KEY] : crypto.randomUUID();
      await chrome.storage.local.set({[CLIENT_KEY]:clientId,[SESSION_KEY]:sessionId});
      const result=await post('/bridge/register',{sessionId,clientId,browser:browserName(),tabs:await tabs()});
      sessionId=result.id;
      await chrome.storage.local.set({[SESSION_KEY]:sessionId});
      return true;
    }catch{
      return false;
    }finally{registerPromise=undefined;}
  })();
  return registerPromise;
}
async function sendEvent(command,ok,result,error){try{await post('/bridge/event',{sessionId,event:{id:crypto.randomUUID(),commandId:command.id,ok,result,error}});}catch{}}
async function execute(command){const tab=await chrome.tabs.get(command.tabId).catch(()=>undefined);if(!tab)return sendEvent(command,false,undefined,'Target tab no longer exists');
  try{
    const response=await chrome.tabs.sendMessage(command.tabId,{type:'nyxelrelay-command',command});
    if(!response?.ok)throw new Error(response?.error||'Content bridge failed');
    await sendEvent(command,true,response.result);
  }catch(e){await sendEvent(command,false,undefined,String(e));}
}
async function poll(){if(!sessionId)await register();if(!sessionId)return;try{const r=await fetch(`${GATEWAY}/bridge/poll?sessionId=${encodeURIComponent(sessionId)}`);if(!r.ok)return;const data=await r.json();for(const command of data.commands||[])await execute(command);}catch{}}
async function heartbeat(){if(!sessionId)await register();if(!sessionId)return;try{await post('/bridge/heartbeat',{sessionId,clientId,tabs:await tabs()});}catch{await register();}}
register();
setInterval(poll,500);
setInterval(heartbeat,5000);
chrome.runtime.onInstalled.addListener(()=>register());
