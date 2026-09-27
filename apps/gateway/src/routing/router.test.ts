import {describe,it,expect} from 'vitest';
import {classify,route} from './router.js';

const context = (prompt = '', reason = 'active file (bounded)', content = 'function calculateTotal(items: number[]) { return items.reduce((a, b) => a + b); }') => [{
  path: 'test-file.ts',
  content,
  score: reason === 'active selection' ? 1 : 0.9,
  reason,
}];

const candidates = [
  {id:'fast-api',transport:'api' as const,capabilities:{streaming:true,vision:false,files:true,tools:false,maxContextTokens:32768},health:{healthy:true,latencyMs:25,checkedAt:0},taskStrengths:{debug:0.7,explain:0.75,refactor:0.8,test:0.8,generate:0.75,performance:0.82,security:0.7,architecture:0.84,docs:0.82,chat:0.72} as const,score:0,reasons:[]},
  {id:'local-private',transport:'local' as const,capabilities:{streaming:true,vision:false,files:true,tools:true,maxContextTokens:32768},health:{healthy:true,latencyMs:40,checkedAt:0},taskStrengths:{debug:0.85,explain:0.8,refactor:0.75,test:0.8,generate:0.7,security:0.95,performance:0.74,architecture:0.72,docs:0.65,chat:0.6} as const,score:0,reasons:[]},
];

describe('router classification',()=>{
  it('keeps plain conversation as chat even when code context exists',()=>expect(classify('Hello',context('')).task).toBe('chat'));
  it('classifies explicit debugging language as debug',()=>expect(classify('debug this exception').task).toBe('debug'));
  it('classifies a short fix request as debug',()=>{
    const result=classify('Can you fix this?',context(''));
    expect(result.task).toBe('debug');
    expect(result.source).toBe('hybrid');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it('classifies a short improvement request as refactor',()=>{
    const result=classify('How should I improve this?',context(''));
    expect(result.task).toBe('refactor');
    expect(result.source).toBe('hybrid');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it('classifies vague quality complaints as refactor with code context',()=>{
    expect(classify('This is ugly.',context('')).task).toBe('refactor');
    expect(classify('Can this be made cleaner?',context('')).task).toBe('refactor');
    expect(classify("I don't like how this is structured.",context('')).task).toBe('refactor');
    expect(classify('Make this easier to maintain.',context('')).task).toBe('refactor');
  });
  it('does not turn vague quality language into refactor without code context',()=>{
    expect(classify('This is ugly.').task).toBe('chat');
    expect(classify('Can this be made cleaner?').task).toBe('chat');
    expect(classify("I don't like how this is structured.").task).toBe('chat');
    expect(classify('Make this easier to maintain.').task).toBe('chat');
  });
  it('classifies problem wording as debug',()=>expect(classify('What is wrong here?',context('')).task).toBe('debug'));
  it('classifies a natural empty-array question as debug using prompt and context',()=>{
    const result=classify('when the array is empty?',context(''));
    expect(result.task).toBe('debug');
    expect(result.source).toBe('hybrid');
    expect(result.evidence).toContain('failure-oriented question');
  });
  it('classifies a code failure question as debug using prompt and context',()=>{
    const result=classify('Why does this code fail for an empty array?',context(''));
    expect(result.task).toBe('debug');
    expect(result.source).toBe('hybrid');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it('classifies refactoring explicitly even when the code contains debug-like patterns',()=>{
    const result=classify('Refactor this function to safely handle an empty array.',context(''));
    expect(result.task).toBe('refactor');
    expect(result.evidence).toContain('refactoring language');
  });
  it('classifies unit-test requests as test',()=>expect(classify('Write unit tests for this function.',context('')).task).toBe('test'));
  it('classifies implement-tests wording as test instead of debug or generate',()=>expect(classify('Can you implement tests for this function?',context('')).task).toBe('test'));
  it('classifies "test this" as test',()=>expect(classify('Can you test this?',context('')).task).toBe('test'));
  it('classifies selected-code explanations as explain',()=>{
    const result=classify('Explain the selected code.',context('','active selection'));
    expect(result.task).toBe('explain');
    expect(result.source).toBe('hybrid');
  });
  it('classifies documentation requests as docs',()=>expect(classify('Update the README documentation for this API.').task).toBe('docs'));
  it('classifies implementation requests as generate',()=>expect(classify('Implement a REST endpoint for creating users.').task).toBe('generate'));
  it('classifies rewrite-cleaner requests as refactor',()=>{
    const result=classify('Rewrite this function using a cleaner approach.',context(''));
    expect(result.task).toBe('refactor');
    expect(result.source).toBe('prompt');
  });
  it('classifies security requests as security',()=>expect(classify('Check this code for SQL injection and credential leaks.').task).toBe('security'));
  it('classifies architecture questions about project structure as architecture',()=>expect(classify('How should I structure this application?').task).toBe('architecture'));
  it('classifies performance requests as performance',()=>expect(classify('How can I make this faster?',context('','active selection')).task).toBe('performance'));
  it('keeps performance as the primary task when the user also asks to fix it',()=>expect(classify('This works, but it is extremely slow. Can you fix it?',context('','active selection')).task).toBe('performance'));
  it('uses refactor as the primary task for a cleaner rewrite',()=>expect(classify('Rewrite this function using a cleaner approach.',context('','active selection')).task).toBe('refactor'));
  it('uses debug as the primary task for fix-and-clean compound requests',()=>expect(classify('Fix this function and make it cleaner.',context('','active selection')).task).toBe('debug'));
  it('uses context language detection',()=>expect(classify('Explain this code',context('')).language).toBe('typescript'));
  it('does not let a reduce() context override a refactor request',()=>expect(classify('Can you make this cleaner?',context('')).task).toBe('refactor'));
});

describe('router provider selection',()=>{
  it('honors an explicit override',()=>expect(route({id:'1',prompt:'hello',privacy:'standard',modelOverride:'local-private'},candidates).providerId).toBe('local-private'));
  it('uses task strength and capability signals when ranking providers',()=>{
    const result=route({id:'1',prompt:'check this code for credential leaks',privacy:'standard',context:context('')},candidates);
    expect(result.providerId).toBe('local-private');
    expect(result.candidates[0]?.reasons.some(x=>x.startsWith('taskFit='))).toBe(true);
    expect(result.candidates[0]?.reasons.some(x=>x.startsWith('complexityFit='))).toBe(true);
  });
  it('prefers local providers for strict privacy when task fit is otherwise similar',()=>{
    const result=route({id:'1',prompt:'Explain this code',privacy:'strict',context:context('')},candidates);
    expect(result.providerId).toBe('local-private');
    expect(result.reasons).toContain('privacy=local-preferred');
  });
  it('rejects an unhealthy override instead of bypassing provider health',()=>{
    const base = candidates[0]!;
    const unhealthy={...base,health:{...base.health,healthy:false}};
    expect(()=>route({id:'1',prompt:'hello',privacy:'standard',modelOverride:'fast-api'},[unhealthy])).toThrow('No healthy provider');
  });
  it('rejects providers that cannot fit the context budget',()=>{
    const base = candidates[0]!;
    const tiny={...base,capabilities:{...base.capabilities,maxContextTokens:1}};
    expect(()=>route({id:'1',prompt:'Explain this code',privacy:'standard',context:context('')},[tiny])).toThrow('No healthy provider');
  });
});
