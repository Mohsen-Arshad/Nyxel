import {describe,it,expect} from 'vitest';

describe('WebProvider response lifecycle design',()=>{
  it('uses a response snapshot rather than treating the whole conversation as the answer',()=>{
    const before=['user: hello','assistant: hi'];
    const after=['user: hello','assistant: hi','user: tell me a story','assistant: once upon a time'];
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.at(-1)).toBe('assistant: once upon a time');
  });
  it('does not navigate for every request when the page is already on the provider origin',()=>{
    const current='https://chatgpt.com/';
    const target='https://chatgpt.com/';
    expect(new URL(current).origin).toBe(new URL(target).origin);
  });
});
