(() => {
  const root = globalThis;
  function text(el) { return (el?.innerText ?? el?.textContent ?? '').trim(); }
  function cssPath(el) {
    if (!(el instanceof Element)) return [];
    const out=[]; let node=el;
    while(node && node.nodeType===1 && node!==document.documentElement){
      let part=node.tagName.toLowerCase();
      if(node.id){part += `#${CSS.escape(node.id)}`; out.unshift(part); break;}
      const classes=[...node.classList].filter(Boolean).slice(0,2);
      if(classes.length) part += '.'+classes.map(CSS.escape).join('.');
      const parent=node.parentElement;
      if(parent){const same=[...parent.children].filter(x=>x.tagName===node.tagName); if(same.length>1) part += `:nth-of-type(${same.indexOf(node)+1})`;}
      out.unshift(part); node=parent;
    }
    return out;
  }
  function candidates(el){
    if (!(el instanceof Element)) return {cssCandidates:[],role:undefined,ariaLabel:undefined,tagName:undefined,text:''};
    const css=[];
    const add=(v)=>{if(v && !css.includes(v)) css.push(v);};
    const tag=el.tagName.toLowerCase();
    const testId=el.getAttribute('data-testid') || undefined;
    const ariaLabel=el.getAttribute('aria-label') || undefined;
    const placeholder=el.getAttribute('placeholder') || undefined;
    const role=el.getAttribute('role') || undefined;
    const author=el.getAttribute('data-message-author-role') || undefined;
    const turn=el.getAttribute('data-turn') || undefined;
    if(testId) add(`[data-testid="${CSS.escape(testId)}"]`);
    if(author) add(`[data-message-author-role="${CSS.escape(author)}"]`);
    if(turn) add(`[data-turn="${CSS.escape(turn)}"]`);
    if(ariaLabel) add(`[aria-label="${CSS.escape(ariaLabel)}"]`);
    if(placeholder) add(`${tag}[placeholder="${CSS.escape(placeholder)}"]`);
    if(el.id) add(`#${CSS.escape(el.id)}`);
    if(tag==='textarea') add('textarea');
    if(el.getAttribute('contenteditable')==='true') add('[contenteditable="true"]');
    // Only generate a long CSS path as a last-resort fallback. Stable semantic
    // selectors above must always win, otherwise a harmless DOM re-render breaks the provider.
    if(!css.length){
      const path=cssPath(el);
      if(path.length) add(path.join(' > '));
    }
    return {cssCandidates:css,role,ariaLabel,placeholder,testId,tagName:tag,text:text(el).slice(0,200)};
  }
  function resolveAll(locator){
    const out=[]; const seen=new Set();
    const add=(el)=>{if(el && el instanceof Element && !seen.has(el)){seen.add(el);out.push(el);}};
    const strategies=locator?.strategies ?? [];
    for(const s of strategies){
      try{
        if(s.type==='css') document.querySelectorAll(s.value).forEach(add);
        else if(s.type==='attribute'){
          const m=s.value.match(/^([\w:-]+)="(.*)"$/);
          if(m) document.querySelectorAll(`[${m[1]}="${CSS.escape(m[2])}"]`).forEach(add);
        } else if(s.type==='role'){
          document.querySelectorAll(`[role="${CSS.escape(s.value)}"]`).forEach(add);
        } else if(s.type==='text'){
          for(const el of document.querySelectorAll('button,[role="button"],textarea,input,[contenteditable="true"],div')) if(text(el)===s.value) add(el);
        }
      }catch{/* try next strategy */}
    }
    return out;
  }
  function resolve(locator){ return resolveAll(locator)[0] ?? null; }
  function isUsableEditor(el){
    if(!(el instanceof HTMLElement) || !elementVisible(el)) return false;
    if(!isEditor(el)) return false;
    return !el.matches(':disabled,[aria-disabled="true"]') && !el.readOnly;
  }
  function resolveEditor(locator){
    const matches=resolveAll(locator);
    for(const el of matches){
      if(isUsableEditor(el)) return el;
      const nested=el.querySelector?.('textarea,input,[contenteditable="true"],[role="textbox"]');
      if(isUsableEditor(nested)) return nested;
    }
    const visible=[...document.querySelectorAll('textarea,input:not([type="hidden"]),[contenteditable="true"],[role="textbox"]')].filter(isUsableEditor);
    return visible[0] ?? null;
  }
  function closestUseful(node, target) {
    if (!(node instanceof Element)) return null;
    if (target === 'input') {
      return node.closest('textarea,input,[contenteditable="true"],[role="textbox"]') ||
        (node.matches('textarea,input,[contenteditable="true"],[role="textbox"]') ? node : null);
    }
    if (target === 'send') {
      return node.closest('button,[role="button"]') ||
        (node.matches('button,[role="button"]') ? node : null);
    }
    if (target === 'response') {
      return node.closest('[data-message-author-role="assistant"],[data-testid="conversation-turn-assistant"],[data-turn="assistant"]') || node;
    }
    return node;
  }
  function collectAssistantNodes(){
    const seen=new Set();
    const raw=[];
    const selectors=[
      '[data-message-author-role=\"assistant\"]',
      '[data-testid=\"conversation-turn-assistant\"]',
      '[data-testid*=\"conversation-turn\"][data-turn=\"assistant\"]',
      '[data-turn=\"assistant\"]',
      'article[data-message-author-role=\"assistant\"]',
      'article[data-turn=\"assistant\"]'
    ];
    for(const selector of selectors){
      for(const node of document.querySelectorAll(selector)){
        if(seen.has(node)) continue;
        seen.add(node);
        if(text(node)) raw.push(node);
      }
    }
    // Prefer the most specific assistant node. Nested assistant wrappers otherwise
    // produce duplicate/combined text and make turn counting unreliable.
    return raw.filter(node => !raw.some(other => other!==node && node.contains(other) && text(other)));
  }
  function collectAssistantTexts(){
    return collectAssistantNodes().map(text).filter(Boolean);
  }
  function collectConversationFallbackTexts(){
    const out=[]; const seen=new Set();
    for(const node of document.querySelectorAll('main article, main [role="article"]')){
      if(seen.has(node)) continue;
      seen.add(node);
      const value=text(node);
      if(!value) continue;
      const assistant=String(node.getAttribute('data-message-author-role')||node.getAttribute('data-turn')||'').toLowerCase();
      if(assistant==='assistant') out.push(value);
    }
    return out;
  }
  function collectUserTexts(){
    const seen=new Set(); const out=[];
    const selectors=[
      '[data-message-author-role="user"]',
      '[data-testid="conversation-turn-user"]',
      '[data-testid*="conversation-turn"][data-turn="user"]',
      '[data-turn="user"]',
      'article[data-message-author-role="user"]',
      'article[data-turn="user"]'
    ];
    for(const selector of selectors){
      for(const node of document.querySelectorAll(selector)){
        if(seen.has(node)) continue;
        seen.add(node);
        const value=text(node);
        if(value) out.push(value);
      }
    }
    return out;
  }
  function isEditor(el){
    return el instanceof HTMLElement && el.matches('textarea,input,[contenteditable="true"],[role="textbox"]');
  }
  function editorValue(el){
    if(!el) return '';
    if(typeof el.value==='string') return el.value;
    return text(el);
  }
  function dispatchEditorInput(el,value){
    try { el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:value})); } catch {}
    try { el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value})); }
    catch { el.dispatchEvent(new Event('input',{bubbles:true})); }
    try { el.dispatchEvent(new Event('change',{bubbles:true})); } catch {}
  }
  function setTextEditor(el,value){
    el.focus?.();
    if(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement){
      const proto=Object.getPrototypeOf(el);
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter) setter.call(el,value); else el.value=value;
      try { el.setSelectionRange(value.length,value.length); } catch {}
      dispatchEditorInput(el,value);
      return;
    }
    const selection=window.getSelection();
    const range=document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted=false;
    try { inserted=document.execCommand('insertText',false,value); } catch {}
    if(!inserted || editorValue(el)!==value){
      range.deleteContents();
      const node=document.createTextNode(value);
      range.insertNode(node);
      range.setStartAfter(node); range.collapse(true);
      selection?.removeAllRanges(); selection?.addRange(range);
    }
    dispatchEditorInput(el,value);
  }
  function findEditorForVerification(locator){
    const direct=locator ? resolve(locator) : null;
    if(direct && isEditor(direct)) return direct;
    if(direct){
      const nested=direct.querySelector?.('textarea,input,[contenteditable="true"],[role="textbox"]');
      if(nested && isEditor(nested)) return nested;
    }
    const active=document.activeElement;
    if(isEditor(active)) return active;
    return null;
  }
  function responseSnapshot(locator){
    const assistantTexts=collectAssistantTexts();
    const fallbackAssistantTexts=assistantTexts.length ? assistantTexts : collectConversationFallbackTexts();
    const userTexts=collectUserTexts();
    const container=locator ? resolve(locator) : null;
    let texts=[];
    let locatorText='';
    if(container){
      locatorText=text(container);
      const nodes=[...container.children];
      const childTexts=(nodes.length?nodes.map(text):[]).map(x=>x.trim()).filter(Boolean);
      const role=(container.getAttribute('data-message-author-role')||container.getAttribute('data-turn')||'').toLowerCase();
      if(role==='assistant' || container.matches('[data-testid="conversation-turn-assistant"]')) texts=[locatorText];
      else texts=childTexts.length ? childTexts : [locatorText];
    }
    const buttons=[...document.querySelectorAll('button,[role="button"]')];
    const stopVisible=buttons.some(b=>/\bstop(?: generating| generation)?\b/i.test((b.getAttribute('aria-label')||b.getAttribute('title')||text(b)).trim()) && elementVisible(b));
    const sendEnabled=buttons.some(b=>{
      const label=(b.getAttribute('aria-label')||b.getAttribute('title')||text(b)).trim();
      if(!/^(send|send message|submit)$/i.test(label) && !/\bsend(?: message)?\b/i.test(label)) return false;
      return !b.matches(':disabled,[aria-disabled="true"]') && elementVisible(b);
    });
    const editors=[...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')].filter(elementVisible).slice(-10).map(x=>({tag:x.tagName.toLowerCase(),placeholder:x.getAttribute('placeholder')||'',valueLength:editorValue(x).length,ariaLabel:x.getAttribute('aria-label')||'',testId:x.getAttribute('data-testid')||''}));
    return {texts,lastText:texts.at(-1)||'',assistantTexts:fallbackAssistantTexts,assistantLastText:fallbackAssistantTexts.at(-1)||'',assistantCount:fallbackAssistantTexts.length,userTexts,userCount:userTexts.length,userLastText:userTexts.at(-1)||'',locatorText,stopVisible,sendEnabled,editors};
  }
  function elementVisible(el) {
    if (!(el instanceof Element)) return false;
    const r=el.getBoundingClientRect();
    const cs=getComputedStyle(el);
    return r.width>0 && r.height>0 && cs.visibility!=='hidden' && cs.display!=='none';
  }
  function stableSelector(el) {
    const c=candidates(el);
    for(const selector of c.cssCandidates){
      try {
        const count=document.querySelectorAll(selector).length;
        if(count===1) return selector;
      } catch {}
    }
    const path=cssPath(el);
    return path.join(' > ');
  }
  function scanElements(target) {
    const found=[]; const seen=new Set();
    const add=(el,score,reason)=>{
      if (!(el instanceof Element) || seen.has(el) || !elementVisible(el)) return;
      seen.add(el); const c=candidates(el); const selector=stableSelector(el); if(!selector)return;
      let matches=0; try { matches=document.querySelectorAll(selector).length; } catch {}
      if(matches!==1) return;
      found.push({selector,score,reason,tagName:c.tagName,ariaLabel:c.ariaLabel||'',placeholder:c.placeholder||'',testId:c.testId||'',role:c.role||'',text:c.text||'',matches});
    };
    if(target==='input'){
      for(const el of document.querySelectorAll('textarea')) add(el,.78,'textarea candidate');
      for(const el of document.querySelectorAll('input:not([type="hidden"])')) add(el,.78,'text input candidate');
      for(const el of document.querySelectorAll('[contenteditable="true"],[role="textbox"]')) add(el,.92,'editable textbox');
      for(const el of document.querySelectorAll('[aria-label*="chat" i],[placeholder*="ask" i],[placeholder*="message" i]')) add(el,.98,'chat input semantic attribute');
    } else if(target==='send') {
      for(const el of document.querySelectorAll('[data-testid*="send" i]')) add(el,1,'data-testid contains send');
      for(const el of document.querySelectorAll('button,[role="button"]')) {
        const label=(el.getAttribute('aria-label')||el.getAttribute('title')||text(el)).trim();
        if(/\bsend(?: message)?\b|\bsubmit\b/i.test(label)) add(el,.98,'send label');
      }
    } else if(target==='response') {
      for(const el of document.querySelectorAll('[data-message-author-role="assistant"]')) add(el,1,'assistant author attribute');
      for(const el of document.querySelectorAll('[data-testid="conversation-turn-assistant"],[data-testid*="conversation-turn"][data-turn="assistant"],[data-turn="assistant"]')) add(el,.98,'assistant turn attribute');
      for(const el of document.querySelectorAll('article')) {
        const v=text(el); if(v.length>20 && /(assistant|response|answer)/i.test(el.getAttribute('aria-label')||'')) add(el,.75,'article semantic label');
      }
      const assistant=collectAssistantNodes(); for(const el of assistant) add(el,.97,'detected assistant message');
    }
    found.sort((a,b)=>b.score-a.score || a.matches-b.matches || a.selector.length-b.selector.length);
    return found.slice(0,20);
  }
  async function handle(command){
    switch(command.op){
      case 'fill': {
        let el=resolveEditor(command.locator);
        const value=command.value??'';
        if(!el){
          const matches=resolveAll(command.locator);
          const details=matches.slice(0,8).map(x=>({tag:x.tagName.toLowerCase(),visible:elementVisible(x),placeholder:x.getAttribute('placeholder')||'',aria:x.getAttribute('aria-label')||'',display:getComputedStyle(x).display,visibility:getComputedStyle(x).visibility}));
          throw new Error(`Input locator did not resolve to a visible editable element. matches=${JSON.stringify(details)}`);
        }
        if(!isEditor(el)) throw new Error(`Resolved input locator is not an editable element. tag=${el.tagName?.toLowerCase()||''}`);
        setTextEditor(el,value);
        // React/Vue-controlled editors can commit on a microtask. Give the page
        // a few ticks, then verify the actual editor state rather than trusting DOM mutation.
        await new Promise(r=>setTimeout(r,60));
        let actual=editorValue(el);
        if(actual!==value){
          setTextEditor(el,value);
          await new Promise(r=>setTimeout(r,120));
          actual=editorValue(el);
        }
        const activeElement=(document.activeElement?.tagName||'').toLowerCase();
        if(actual!==value){
          throw new Error(`Input fill verification failed: expected ${value.length} chars, got ${actual.length}. tag=${el.tagName.toLowerCase()} placeholder=${JSON.stringify(el.getAttribute('placeholder')||'')} aria=${JSON.stringify(el.getAttribute('aria-label')||'')} active=${activeElement}`);
        }
        const sendButtons=[...document.querySelectorAll('button,[role="button"]')].filter(b=>elementVisible(b) && !b.matches(':disabled,[aria-disabled="true"]')).map(b=>(b.getAttribute('aria-label')||b.getAttribute('title')||text(b)).trim()).filter(x=>/\bsend(?: message)?\b/i.test(x));
        return {ok:true,tag:el.tagName.toLowerCase(),valueLength:value.length,actualValueLength:actual.length,actualText:text(el).slice(0,160),activeElement,sendCandidates:sendButtons.slice(-6)};
      }
      case 'click': {const el=resolve(command.locator);if(!el)throw new Error('Click locator did not match');el.click();return {ok:true};}
      case 'clickSend': {
        const inputEl=command.inputLocator ? resolveEditor(command.inputLocator) : null;
        const form=inputEl?.closest?.('form') ?? null;
        const configured=command.locator ? resolve(command.locator) : null;
        const configuredCss=command.locator?.strategies?.find?.(s=>s?.type==='css')?.value || '';
        const genericCss=/^(button|\[role=["']?button["']?\])$/i.test(String(configuredCss).trim());
        const isUsable=(node)=>{
          if(!node || !(node instanceof HTMLElement)) return false;
          if(node.matches(':disabled,[aria-disabled="true"]')) return false;
          const r=node.getBoundingClientRect();
          return r.width>0 && r.height>0;
        };
        const labelOf=(node)=>(node?.getAttribute('aria-label')||node?.getAttribute('title')||text(node)).trim();
        const isSend=(node)=>isUsable(node) && (/^(send|send message|submit|send prompt)$/i.test(labelOf(node)) || /\bsend(?: message| prompt)?\b/i.test(labelOf(node)));
        const score=(node)=>{
          if(!isSend(node)) return -1;
          const label=labelOf(node);
          let score=0;
          if(node===configured && !genericCss) score+=100;
          if(node.closest('form')===form && form) score+=50;
          if(node.getAttribute('data-testid')?.toLowerCase().includes('send')) score+=40;
          if(/^send prompt$/i.test(label)) score+=35;
          if(/^send(?: message)?$/i.test(label)) score+=30;
          if(/\bsend\b/i.test(label)) score+=10;
          return score;
        };
        const all=[...document.querySelectorAll('button,[role="button"]')].filter(isUsable);
        let candidates=all.filter(isSend).sort((a,b)=>score(b)-score(a));
        let el=candidates[0] || null;
        let selectionMode='semantic';
        if(configured && !genericCss && isSend(configured)) {
          el=configured;
          selectionMode='configured';
        }
        // Some web AI UIs render an icon-only send control with no stable
        // aria-label/title/text. Rank visible enabled buttons near the editor.
        if(!el && inputEl){
          const excluded=/voice|microphone|dictat|attach|upload|file|image|search|menu|settings/i;
          const region=inputEl.closest('form') || inputEl.parentElement?.parentElement?.parentElement || inputEl.parentElement?.parentElement || inputEl.parentElement;
          const nearby=[...(region?.querySelectorAll?.('button,[role="button"]')||[])]
            .filter(isUsable)
            .filter(node=>!excluded.test(labelOf(node)))
            .map(node=>{
              let proximity=0;
              if(node.closest('form') && form && node.closest('form')===form) proximity+=100;
              let distance=0, cursor=node;
              while(cursor && cursor!==region && distance<12){distance++;cursor=cursor.parentElement;}
              proximity += Math.max(0,40-distance*3);
              const label=labelOf(node);
              if(node.getAttribute('data-testid')?.toLowerCase().includes('send')) proximity+=80;
              if(/^(send|submit)$/i.test(label)) proximity+=70;
              return {node,proximity};
            })
            .sort((a,b)=>b.proximity-a.proximity);
          if(nearby.length){
            el=nearby[0].node;
            candidates=[el,...candidates.filter(x=>x!==el)];
            selectionMode='composer-proximity';
          }
        }
        if(!el){
          const visible=all.slice(-30).map(node=>({tag:node.tagName.toLowerCase(),ariaLabel:node.getAttribute('aria-label')||'',title:node.getAttribute('title')||'',text:text(node).slice(0,80),testId:node.getAttribute('data-testid')||'',disabled:node.matches(':disabled,[aria-disabled="true"]')}));
          throw new Error(`Send button not found or not enabled. candidates=${JSON.stringify(visible)}`);
        }
        const meta={tag:el.tagName.toLowerCase(),ariaLabel:el.getAttribute('aria-label')||'',title:el.getAttribute('title')||'',text:text(el).slice(0,100),testId:el.getAttribute('data-testid')||'',sameForm:Boolean(form && el.closest('form')===form)};
        el.focus?.();
        try { el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'mouse',button:0})); } catch {}
        try { el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0})); } catch {}
        el.click();
        try { el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0})); } catch {}
        // React apps occasionally attach submit handling to the form rather than the button.
        // Use requestSubmit only as a fallback if the click did not create a user turn.
        const beforeCount=Number(command.beforeUserCount ?? -1);
        let submitted=beforeCount<0;
        const deadline=Date.now()+1800;
        while(!submitted && Date.now()<deadline){
          await new Promise(r=>setTimeout(r,100));
          const count=collectUserTexts().length;
          if(count>beforeCount) submitted=true;
        }
        let method='click';
        if(!submitted && form && typeof form.requestSubmit==='function'){
          try { form.requestSubmit(el instanceof HTMLButtonElement ? el : undefined); method='requestSubmit'; } catch {}
          const secondDeadline=Date.now()+1800;
          while(!submitted && Date.now()<secondDeadline){
            await new Promise(r=>setTimeout(r,100));
            const count=collectUserTexts().length;
            if(count>beforeCount) submitted=true;
          }
        }
        if(beforeCount>=0 && !submitted){
          throw new Error(`Send control was clicked but no new user message appeared. method=${method} button=${JSON.stringify(meta)}`);
        }
        return {ok:true,clicked:true,submitted,method,selectionMode,configuredLocator:configuredCss||undefined,meta,candidateCount:candidates.length};
      }
      case 'press': {
        const el=command.locator?resolve(command.locator):document.activeElement;
        const target=el||document.body; const key=command.key||'Enter';
        target.focus?.();
        const before=editorValue(findEditorForVerification(command.locator));
        target.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true}));
        target.dispatchEvent(new KeyboardEvent('keypress',{key,code:key,bubbles:true,cancelable:true}));
        target.dispatchEvent(new KeyboardEvent('keyup',{key,code:key,bubbles:true}));
        if(key==='Escape') target.blur?.();
        await new Promise(r=>setTimeout(r,80));
        const editor=findEditorForVerification(command.locator);
        const after=editorValue(editor);
        return {ok:true,key,valueLength:after.length,tag:target.tagName?.toLowerCase()||'',beforeLength:before.length,afterLength:after.length,changed:before!==after};
      }
      case 'scan': return {target:command.target,candidates:scanElements(command.target)};
      case 'snapshot': return responseSnapshot(command.locator);
      case 'extract': {const container=resolve(command.locator);if(!container)throw new Error('Response locator did not match');const nodes=[...container.children];const texts=(nodes.length?nodes.map(text):[text(container)]).map(x=>x.trim()).filter(Boolean);return {text:texts.at(-1)||text(container)};}
      case 'navigate': location.href=command.value; return {ok:true};
      case 'pick': {return await new Promise(resolvePick=>{
        const handler=(ev)=>{ev.preventDefault();ev.stopPropagation();document.removeEventListener('click',handler,true);document.removeEventListener('keydown',cancel,true);const target=closestUseful(ev.target,command.target);resolvePick(candidates(target || ev.target));};
        const cancel=()=>{document.removeEventListener('click',handler,true);document.removeEventListener('keydown',cancel,true);resolvePick({cssCandidates:[]});};
        document.addEventListener('click',handler,true);document.addEventListener('keydown',cancel,true);
      });}
      default: throw new Error(`Unsupported browser command: ${command.op}`);
    }
  }
  root.__nyxelRelayHandle = handle;
})();
chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
  if(message?.type!=='nyxelrelay-command') return;
  Promise.resolve(globalThis.__nyxelRelayHandle?.(message.command)).then(result=>sendResponse({ok:true,result})).catch(error=>sendResponse({ok:false,error:String(error)}));
  return true;
});
