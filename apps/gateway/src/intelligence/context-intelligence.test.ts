import {describe,it,expect} from 'vitest';
import {buildNcp} from './context-intelligence.js';
import type {AIRequest} from '../domain/types.js';

describe('NCP',()=>{
  it('preserves the exact target context and request',()=>{
    const request:AIRequest={id:'1',prompt:'Fix this bug',task:'debug',privacy:'standard'};
    const ncp=buildNcp(request,[{path:'src/a.ts',content:'return value;',score:1,reason:'active selection'}],'Project uses TypeScript.');
    expect(ncp).toContain('NYXEL CONTEXT PACKET / 1');
    expect(ncp).toContain('Fix this bug');
    expect(ncp).toContain('return value;');
    expect(ncp).toContain('Project uses TypeScript.');
  });
});
