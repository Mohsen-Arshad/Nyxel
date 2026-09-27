import {describe,expect,it} from 'vitest';
import {normalizeWebUrl} from './web-provider.js';

describe('web provider url normalization',()=>{
  it('removes copied line breaks and surrounding whitespace',()=>{
    expect(normalizeWebUrl('  https://chatgpt.com/\n\t')).toBe('https://chatgpt.com/');
  });
  it('extracts a URL from copied markdown-ish text',()=>{
    expect(normalizeWebUrl('https://chatgpt.com/ Call')).toBe('https://chatgpt.com/');
  });
  it('rejects invalid protocols',()=>{
    expect(()=>normalizeWebUrl('file:///tmp/chat')).toThrow(/Unsupported Web Provider URL protocol/);
  });
});
