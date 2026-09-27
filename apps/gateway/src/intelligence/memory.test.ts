import {describe,it,expect} from 'vitest';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectMemoryStore,memoryText} from './memory.js';

describe('ProjectMemoryStore',()=>{
  it('persists project facts and recent work locally',async()=>{
    const root=await mkdtemp(join(tmpdir(),'nyxel-memory-'));
    const store=new ProjectMemoryStore(root);
    await store.update('C:/demo',{summary:'Local-first coding gateway',technologies:['TypeScript'],facts:['Web providers are primary']});
    await store.rememberTask('C:/demo','debug','Fix router fallback','chatgpt-web');
    const other=new ProjectMemoryStore(root);
    const memory=await other.load('C:/demo');
    expect(memory.summary).toContain('Local-first');
    expect(memory.recentTasks[0]?.provider).toBe('chatgpt-web');
    expect(memoryText(memory)).toContain('Web providers are primary');
    expect(await readFile((root+'/memory/'+Buffer.from('C:/demo').toString('base64url')+'.json'),'utf8')).toContain('debug');
  });
});
