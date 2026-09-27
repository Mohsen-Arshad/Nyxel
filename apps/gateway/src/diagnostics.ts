import {appendFile, mkdir, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';

export type LogLevel='debug'|'info'|'warn'|'error';
const levels:Record<LogLevel,number>={debug:10,info:20,warn:30,error:40};

function safe(value:unknown,depth=0):unknown{
  if(depth>6)return '[max-depth]';
  if(value instanceof Error) return {name:value.name,message:value.message,stack:value.stack};
  if(typeof value==='string') return value.length>8000 ? `${value.slice(0,8000)}…[truncated]` : value;
  if(typeof value==='number' || typeof value==='boolean' || value===null || value===undefined)return value;
  if(Array.isArray(value)) return value.slice(0,100).map(v=>safe(v,depth+1));
  if(value && typeof value==='object'){
    const out:Record<string,unknown>={};
    for(const [k,v] of Object.entries(value as Record<string,unknown>)){
      if(/(?:token|secret|password|api.?key|authorization|cookie|set-cookie)/i.test(k)) out[k]='[redacted]';
      else out[k]=safe(v,depth+1);
    }
    return out;
  }
  return String(value);
}

export function fingerprint(value:string):string{return createHash('sha256').update(value).digest('hex').slice(0,16);}

export class DiagnosticsLogger{
  readonly filePath:string;
  private readonly threshold:LogLevel;
  private readonly instanceId=randomUUID();
  private sequence=0;
  private ready:Promise<void>;
  private writeChain:Promise<void>=Promise.resolve();
  constructor(root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..')){
    const configured=String(process.env.NYXELRELAY_LOG_LEVEL||'debug').toLowerCase() as LogLevel;
    this.threshold=levels[configured] ? configured : 'debug';
    this.filePath=process.env.NYXELRELAY_DATA_DIR
      ? resolve(process.cwd(),process.env.NYXELRELAY_DATA_DIR,'logs','gateway.ndjson')
      : resolve(root,'.nyxelrelay','logs','gateway.ndjson');
    this.ready=mkdir(dirname(this.filePath),{recursive:true}).then(()=>undefined);
  }
  log(level:LogLevel,event:string,data:Record<string,unknown>={}){
    if(levels[level]<levels[this.threshold]) return;
    // Vitest unit tests share the process-level diagnostics singleton. Never let
    // test telemetry contaminate the user's runtime gateway.ndjson.
    if(process.env.NODE_ENV==='test' || process.env.VITEST==='true') return;
    const record={ts:new Date().toISOString(),seq:++this.sequence,instanceId:this.instanceId,level,event,pid:process.pid,...safe(data) as Record<string,unknown>};
    const line=JSON.stringify(record)+'\n';
    this.writeChain=this.writeChain.then(()=>this.ready.then(()=>appendFile(this.filePath,line))).catch(()=>undefined);
  }
  debug(event:string,data:Record<string,unknown>={}){this.log('debug',event,data);}
  info(event:string,data:Record<string,unknown>={}){this.log('info',event,data);}
  warn(event:string,data:Record<string,unknown>={}){this.log('warn',event,data);}
  error(event:string,data:Record<string,unknown>={}){this.log('error',event,data);}
  async tail(lines=500):Promise<string>{
    try{const text=await readFile(this.filePath,'utf8');return text.split('\n').filter(Boolean).slice(-Math.max(1,Math.min(lines,10000))).join('\n')+'\n';}
    catch{return '';}
  }
}

export const diagnostics=new DiagnosticsLogger();
export function newCorrelationId():string{return randomUUID();}
