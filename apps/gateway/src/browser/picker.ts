import type { Page } from 'playwright';

export type PickedElement = {
  tag:string; role?:string; ariaLabel?:string; placeholder?:string; testId?:string;
  cssCandidates:string[]; textPreview?:string;
};

/** User-driven DOM picker. It never records screen coordinates as a locator. */
export async function pickElement(page:Page, prompt:string):Promise<PickedElement>{
  return page.evaluate(async (message) => {
    const w=window as any;
    if(w.__nyxelrelayPickerPromise) return w.__nyxelrelayPickerPromise;
    w.__nyxelrelayPickerPromise=new Promise(resolve=>{
      const banner=document.createElement('div');
      banner.textContent=message;
      Object.assign(banner.style,{position:'fixed',zIndex:'2147483647',top:'12px',left:'50%',transform:'translateX(-50%)',padding:'10px 14px',background:'#111',color:'#fff',font:'14px sans-serif',borderRadius:'8px',boxShadow:'0 4px 18px #0008'});
      document.body.appendChild(banner);
      const previous=(window as any).__nyxelrelayPrevOutline;
      const move=(e:MouseEvent)=>{const el=e.target as HTMLElement;if(previous)previous.style.outline=''; if(el)el.style.outline='2px solid #4ade80';(window as any).__nyxelrelayPrevOutline=el;};
      const click=(e:MouseEvent)=>{e.preventDefault();e.stopPropagation();const el=e.target as HTMLElement;if(!el)return;const attrs=(name:string)=>el.getAttribute(name)||undefined;const css:string[]=[];const add=(v:string)=>{if(v&&!css.includes(v))css.push(v)};const testId=attrs('data-testid');const ph=attrs('placeholder');const aria=attrs('aria-label');const author=attrs('data-message-author-role');const turn=attrs('data-turn');if(testId)add(`[data-testid="${CSS.escape(testId)}"]`);if(author)add(`[data-message-author-role="${CSS.escape(author)}"]`);if(turn)add(`[data-turn="${CSS.escape(turn)}"]`);if(aria)add(`[aria-label="${CSS.escape(aria)}"]`);if(ph)add(`${el.tagName.toLowerCase()}[placeholder="${CSS.escape(ph)}"]`);if(el.id)add(`#${CSS.escape(el.id)}`);if(el.tagName.toLowerCase()==='textarea')add('textarea');if(el.getAttribute('contenteditable')==='true')add('[contenteditable="true"]');document.removeEventListener('mousemove',move,true);document.removeEventListener('click',click,true);banner.remove();if((window as any).__nyxelrelayPrevOutline)(window as any).__nyxelrelayPrevOutline.style.outline='';delete (window as any).__nyxelrelayPickerPromise;resolve({tag:el.tagName.toLowerCase(),role:attrs('role'),ariaLabel:aria,placeholder:ph,testId,cssCandidates:[...new Set(css)],textPreview:(el.textContent||'').trim().slice(0,120)});};
      document.addEventListener('mousemove',move,true);document.addEventListener('click',click,true);
    });
    return w.__nyxelrelayPickerPromise;
  },prompt) as Promise<PickedElement>;
}
