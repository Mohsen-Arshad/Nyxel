import { z } from 'zod';

export const LocatorStrategy = z.object({
  type: z.enum(['css','role','text','attribute']),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1).optional()
});

export const Locator = z.object({
  strategies: z.array(LocatorStrategy).min(1).max(12),
  framePath: z.array(z.string()).max(8).default([]),
  shadowPath: z.array(z.string()).max(8).default([])
});

export type Locator = z.infer<typeof Locator>;

export const ProviderDefinition = z.object({
  schemaVersion: z.literal(1),
  provider: z.object({ id:z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/), name:z.string().min(1).max(100), version:z.string().default('1.0.0') }),
  transport: z.enum(['web','api','local']),
  website: z.object({ url:z.string().url() }),
  browser: z.object({
    mode: z.enum(['managed','existing']).default('managed'),
    family: z.enum(['chromium','chrome','edge','firefox']).default('chromium')
  }).default({mode:'managed',family:'chromium'}),
  input: z.object({ locator:Locator }).optional(),
  send: z.object({ mode:z.enum(['keyboard','button']), key:z.string().optional(), locator:Locator.optional() }).optional(),
  response: z.object({ locator:Locator, selection:z.enum(['last','all']).default('last') }).optional(),
  streaming: z.object({ enabled:z.boolean().default(true), completionSignals:z.array(z.enum(['mutation-idle','stop-button-disappears','send-enabled','response-stable'])).default(['mutation-idle']) }).default({enabled:true,completionSignals:['mutation-idle']}),
  capabilities:z.object({ streaming:z.boolean().default(true), vision:z.boolean().default(false), files:z.boolean().default(false), tools:z.boolean().default(false), maxContextTokens:z.number().int().positive().default(32768) }).default({streaming:true,vision:false,files:false,tools:false,maxContextTokens:32768}),
  metadata:z.object({ homepage:z.string().url().optional(), notes:z.string().max(2000).optional() }).optional()
}).strict();

export type ProviderDefinition = z.infer<typeof ProviderDefinition>;

export function validateProviderDefinition(value: unknown): ProviderDefinition {
  return ProviderDefinition.parse(value);
}

export function exportProviderDefinition(definition: ProviderDefinition): string {
  return JSON.stringify(definition, null, 2);
}
