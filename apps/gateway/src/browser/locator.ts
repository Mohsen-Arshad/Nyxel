import type {Locator} from '@nyxelrelay/provider-schema';
export type ElementLike={locator:(selector:string)=>any};
export function selectorCandidates(locator:Locator):string[]{return [...locator.strategies].sort((a,b)=>(b.confidence??0.5)-(a.confidence??0.5)).map(s=>s.type==='css'?s.value:s.type==='attribute'?`[${s.value}]`:s.type==='text'?`text=${JSON.stringify(s.value)}`:`role=${JSON.stringify(s.value)}`);}
export async function resolve(frame:any,locator:Locator){for(const s of selectorCandidates(locator)){try{const loc=s.startsWith('text=')||s.startsWith('role=')?frame.locator(s):frame.locator(s);if(await loc.count())return loc.last();}catch{}}throw new Error('Configured element could not be resolved');}
