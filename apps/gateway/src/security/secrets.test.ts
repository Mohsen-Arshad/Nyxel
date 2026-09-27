import {describe,it,expect} from 'vitest';
import {sanitizeContext,scanSecret} from './secrets.js';

describe('secret scanner',()=>{
  it('blocks env files and detects keys',()=>{
    expect(scanSecret('.env','OPENAI_API_KEY=secret')).toHaveLength(1);
    expect(scanSecret('a.ts','const token = "eyJabcdefghijkl.abcdefghijkl.abcdefghijkl"')).toHaveLength(1);
  });
  it('keeps safe code context',()=>{
    const result=sanitizeContext([{path:'src/example.ts',content:'export function add(a: number, b: number) { return a + b; }'}]);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('src/example.ts');
  });
  it('drops secrets even when they are hidden inside an otherwise valid code file',()=>{
    const result=sanitizeContext([{path:'src/config.ts',content:'export const password = "super-secret-value-1234";'}]);
    expect(result).toHaveLength(0);
  });
});
