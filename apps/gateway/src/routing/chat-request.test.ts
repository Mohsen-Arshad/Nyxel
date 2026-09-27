import { describe, expect, it } from 'vitest';
import { classify } from './router.js';

describe('chat request classification', () => {
  it('classifies a plain greeting as chat', () => {
    expect(classify('Hello').task).toBe('chat');
  });
  it('classifies a natural code-question as debug when code context is present', () => {
    const result = classify('Why does this fail when the array is empty?', [{
      path: 'example.ts',
      content: 'const value = items.reduce((a, b) => a + b);',
      score: 1,
      reason: 'active selection',
    }]);
    expect(result.task).toBe('debug');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
