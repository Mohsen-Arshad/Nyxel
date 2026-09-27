import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {TaskKind} from '../domain/types.js';

export type ProjectMemory={
  version:1;
  workspace:string;
  projectName:string;
  summary:string;
  architecture:string[];
  technologies:string[];
  conventions:string[];
  constraints:string[];
  importantFiles:string[];
  facts:string[];
  recentTasks:Array<{task:TaskKind;request:string;provider?:string;timestamp:number}>;
  updatedAt:number;
};

const EMPTY=(workspace:string):ProjectMemory=>({version:1,workspace,projectName:workspace.split(/[\\/]/).filter(Boolean).pop()??'project',summary:'',architecture:[],technologies:[],conventions:[],constraints:[],importantFiles:[],facts:[],recentTasks:[],updatedAt:Date.now()});

export class ProjectMemoryStore{
  private cache=new Map<string,ProjectMemory>();
  constructor(private readonly rootDir:string){ }
  private path(workspace:string){const encoded=Buffer.from(workspace).toString('base64url').replace(/[^a-zA-Z0-9_-]/g,'_');return `${this.rootDir}/memory/${encoded}.json`;}
  async load(workspace:string):Promise<ProjectMemory>{
    const cached=this.cache.get(workspace);if(cached)return cached;
    try{const parsed=JSON.parse(await readFile(this.path(workspace),'utf8')) as ProjectMemory;this.cache.set(workspace,parsed);return parsed;}catch{const fresh=EMPTY(workspace);this.cache.set(workspace,fresh);return fresh;}
  }
  async update(workspace:string,patch:Partial<ProjectMemory>):Promise<ProjectMemory>{
    const current=await this.load(workspace);const next:ProjectMemory={...current,...patch,recentTasks:(patch.recentTasks??current.recentTasks).slice(-40),facts:[...new Set(patch.facts??current.facts)].slice(-80),importantFiles:[...new Set(patch.importantFiles??current.importantFiles)].slice(-80),updatedAt:Date.now()};
    this.cache.set(workspace,next);await mkdir(dirname(this.path(workspace)),{recursive:true});await writeFile(this.path(workspace),JSON.stringify(next,null,2),'utf8');return next;
  }

  async bootstrap(workspace:string):Promise<ProjectMemory>{
    const current=await this.load(workspace);
    if(current.summary || current.technologies.length || current.facts.length) return current;
    let packageText=''; let readme='';
    try{packageText=await readFile(`${workspace}/package.json`,'utf8');}catch{/* ignore */}
    try{readme=await readFile(`${workspace}/README.md`,'utf8');}catch{/* ignore */}
    const technologies=new Set<string>(current.technologies);
    if(packageText){
      if(/typescript/i.test(packageText)) technologies.add('TypeScript');
      if(/fastify/i.test(packageText)) technologies.add('Fastify');
      if(/playwright/i.test(packageText)) technologies.add('Playwright');
      if(/vitest/i.test(packageText)) technologies.add('Vitest');
      if(/vscode/i.test(packageText)) technologies.add('VS Code extension');
    }
    const summary=readme.replace(/[#*`]/g,' ').replace(/\s+/g,' ').trim().slice(0,1200);
    return this.update(workspace,{summary,technologies:[...technologies],facts:packageText?[`Root package manifest detected at ${workspace}/package.json`]:current.facts});
  }

  async rememberTask(workspace:string,task:TaskKind,request:string,provider?:string){const memory=await this.load(workspace);await this.update(workspace,{recentTasks:[...memory.recentTasks,{task,request:request.slice(0,1200),...(provider?{provider}:{}),timestamp:Date.now()}]});}
}

export function memoryText(memory:ProjectMemory):string{
  const lines=[
    memory.summary&&`Summary: ${memory.summary}`,
    memory.technologies.length&&`Technologies: ${memory.technologies.join(', ')}`,
    memory.architecture.length&&`Architecture: ${memory.architecture.join(' | ')}`,
    memory.conventions.length&&`Conventions: ${memory.conventions.join(' | ')}`,
    memory.constraints.length&&`Constraints: ${memory.constraints.join(' | ')}`,
    memory.importantFiles.length&&`Important files: ${memory.importantFiles.slice(-20).join(', ')}`,
    memory.facts.length&&`Known facts: ${memory.facts.slice(-30).join(' | ')}`,
    memory.recentTasks.length&&`Recent work: ${memory.recentTasks.slice(-8).map(x=>`${x.task}: ${x.request}`).join(' || ')}`,
  ].filter(Boolean) as string[];
  return lines.join('\n');
}
