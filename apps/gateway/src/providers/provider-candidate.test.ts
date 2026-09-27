import {describe,it,expect} from 'vitest';
import {providerCandidate} from './provider-candidate.js';
import {MockProvider} from './mock.js';

describe('provider candidates',()=>{
  it('exposes capability and health metadata',async()=>{
    const candidate=await providerCandidate(new MockProvider('local-demo','local'));
    expect(candidate.health.healthy).toBe(true);
    expect(candidate.capabilities.tools).toBe(true);
    expect(candidate.taskStrengths?.debug).toBeGreaterThan(0);
  });
});
