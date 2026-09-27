import { describe, expect, it } from 'vitest';
import { classify } from './router.js';

type Case = { prompt: string; task: string; context?: { path: string; content: string; score: number; reason: string }[] };

const code = [{
  path: 'src/example.ts',
  content: 'function calculateTotal(items: number[]) { return items.reduce((a, b) => a + b); }',
  score: 0.9,
  reason: 'active file (bounded)',
}];

const cases: Case[] = [
  { prompt: 'Hello', task: 'chat' },
  { prompt: 'Can you help me with something?', task: 'chat' },
  { prompt: 'This is ugly.', task: 'refactor', context: code },
  { prompt: 'Can this be made cleaner?', task: 'refactor', context: code },
  { prompt: "I don't like how this is structured.", task: 'refactor', context: code },
  { prompt: 'Make this easier to maintain.', task: 'refactor', context: code },
  { prompt: 'Rewrite this function using a cleaner approach.', task: 'refactor', context: code },
  { prompt: 'Explain what this function does.', task: 'explain', context: code },
  { prompt: 'Why does this code fail?', task: 'debug', context: code },
  { prompt: 'Can you fix this?', task: 'debug', context: code },
  { prompt: 'What is wrong here?', task: 'debug', context: code },
  { prompt: 'When the array is empty, what happens?', task: 'debug', context: code },
  { prompt: 'Why is this TypeScript exception happening?', task: 'debug' },
  { prompt: 'Refactor this function to make it cleaner.', task: 'refactor', context: code },
  { prompt: 'Clean up this class without changing behavior.', task: 'refactor', context: code },
  { prompt: 'Write unit tests for this function.', task: 'test', context: code },
  { prompt: 'Can you implement tests for this function?', task: 'test', context: code },
  { prompt: 'Add integration tests for this endpoint.', task: 'test' },
  { prompt: 'Implement a REST endpoint for creating users.', task: 'generate' },
  { prompt: 'Create a helper function for parsing dates.', task: 'generate' },
  { prompt: 'Update the README documentation for this API.', task: 'docs' },
  { prompt: 'Document this public API.', task: 'docs' },
  { prompt: 'Optimize this database query because it is slow.', task: 'performance', context: code },
  { prompt: 'How should I structure this application?', task: 'architecture' },
  { prompt: 'Design the service boundaries for this system.', task: 'architecture' },
  { prompt: 'Check this code for SQL injection.', task: 'security' },
  { prompt: 'How do I prevent credential leaks?', task: 'security' },
  { prompt: 'How can I make this faster?', task: 'performance', context: code },
  { prompt: 'This works, but it is extremely slow. Can you fix it?', task: 'performance', context: code },
  { prompt: 'What does this do?', task: 'explain', context: code },
  { prompt: 'Can you test this?', task: 'test', context: code },
  { prompt: 'Fix this function and make it cleaner.', task: 'debug', context: code },
  { prompt: 'چرا این کد خطا میده؟', task: 'debug' },
  { prompt: 'این کد را توضیح بده', task: 'explain' },
  { prompt: 'تست واحد برای این تابع بنویس', task: 'test' },
  { prompt: 'این کوئری را بهینه کن', task: 'performance' },
  { prompt: 'مستندات API را بنویس', task: 'docs' },
  { prompt: 'معماری این برنامه را چطور طراحی کنم؟', task: 'architecture' },
  { prompt: 'این کد را بازنویسی کن', task: 'refactor' },
  { prompt: 'یک endpoint برای کاربران ایجاد کن', task: 'generate' },
];

describe('routing golden dataset', () => {
  for (const item of cases) {
    it(`${item.task}: ${item.prompt}`, () => {
      const result = classify(item.prompt, item.context ?? []);
      expect(result.task).toBe(item.task);
      if (item.task !== 'chat') expect(result.confidence).toBeGreaterThanOrEqual(0.72);
    });
  }
});
