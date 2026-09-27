import type { Provider } from '../provider.js';
import { MockProvider } from '../mock.js';
import { OpenAICompatibleProvider } from '../api/openai-compatible.js';
import { AnthropicProvider } from '../api/anthropic.js';
import { GeminiProvider } from '../api/gemini.js';
import { OllamaProvider } from '../local/ollama.js';

export type RuntimeProviderInfo = { id:string; transport:string; configured:boolean; model?:string; source:'env'|'demo'|'ui' };
export type RuntimeProviderConfig = { id:string; transport:'api'|'local'; model:string; baseUrl?:string; apiKey?:string };

export function createConfiguredProvider(config: RuntimeProviderConfig): Provider {
  if (config.transport === 'local' && config.id === 'ollama') {
    return new OllamaProvider({id:config.id,model:config.model,...(config.baseUrl?{baseUrl:config.baseUrl}:{})});
  }
  if (config.id === 'anthropic') return new AnthropicProvider({id:config.id,model:config.model,apiKey:config.apiKey ?? '',...(config.baseUrl?{baseUrl:config.baseUrl}:{})});
  if (config.id === 'gemini') return new GeminiProvider({id:config.id,model:config.model,apiKey:config.apiKey ?? '',...(config.baseUrl?{baseUrl:config.baseUrl}:{})});
  const defaultBase=config.id==='openai'?'https://api.openai.com/v1':config.id==='deepseek'?'https://api.deepseek.com':config.id==='lmstudio'?'http://127.0.0.1:1234/v1':'http://127.0.0.1:1234/v1';
  if(config.id==='ollama') {
    return new OllamaProvider({id:'ollama',model:config.model,baseUrl:config.baseUrl ?? 'http://127.0.0.1:11434'});
  }
  return new OpenAICompatibleProvider({id:config.id,model:config.model,baseUrl:config.baseUrl ?? defaultBase,...(config.apiKey?{apiKey:config.apiKey}:{})});
}
const env=(name:string):string|undefined=>process.env[name]?.trim() || undefined;
function addInfo(info:RuntimeProviderInfo[],value:RuntimeProviderInfo){info.push(value)}
export function createRuntimeProviders():{providers:Provider[];info:RuntimeProviderInfo[]}{
  const providers:Provider[]=[]; const info:RuntimeProviderInfo[]=[]; const add=(p:Provider,i:RuntimeProviderInfo)=>{providers.push(p);addInfo(info,i)};
  const demo=process.env.NYXELRELAY_ENABLE_DEMO!=='false';
  const openaiKey=env('OPENAI_API_KEY'); const openaiModel=env('OPENAI_MODEL')??'gpt-5-mini'; if(openaiKey){add(new OpenAICompatibleProvider({id:'openai',baseUrl:env('OPENAI_BASE_URL')??'https://api.openai.com/v1',apiKey:openaiKey,model:openaiModel}),{id:'openai',transport:'api',configured:true,model:openaiModel,source:'env'})}
  const deepseekKey=env('DEEPSEEK_API_KEY'); const deepseekModel=env('DEEPSEEK_MODEL')??'deepseek-flash'; if(deepseekKey){add(new OpenAICompatibleProvider({id:'deepseek',baseUrl:env('DEEPSEEK_BASE_URL')??'https://api.deepseek.com',apiKey:deepseekKey,model:deepseekModel}),{id:'deepseek',transport:'api',configured:true,model:deepseekModel,source:'env'})}
  const anthropicKey=env('ANTHROPIC_API_KEY'); const anthropicModel=env('ANTHROPIC_MODEL')??'claude-sonnet-4-6'; const anthropicBase=env('ANTHROPIC_BASE_URL'); if(anthropicKey){add(new AnthropicProvider({id:'anthropic',apiKey:anthropicKey,model:anthropicModel,...(anthropicBase?{baseUrl:anthropicBase}:{})}),{id:'anthropic',transport:'api',configured:true,model:anthropicModel,source:'env'})}
  const googleKey=env('GOOGLE_API_KEY'); const googleModel=env('GOOGLE_MODEL')??'gemini-3.8-flash'; const googleBase=env('GOOGLE_BASE_URL'); if(googleKey){add(new GeminiProvider({id:'gemini',apiKey:googleKey,model:googleModel,...(googleBase?{baseUrl:googleBase}:{})}),{id:'gemini',transport:'api',configured:true,model:googleModel,source:'env'})}
  const ollamaModel=env('OLLAMA_MODEL'); const ollamaBase=env('OLLAMA_BASE_URL'); if(ollamaModel){add(new OllamaProvider({id:'ollama',model:ollamaModel,...(ollamaBase?{baseUrl:ollamaBase}:{})}),{id:'ollama',transport:'local',configured:true,model:ollamaModel,source:'env'})}
  const lmModel=env('LMSTUDIO_MODEL'); const lmBase=env('LMSTUDIO_BASE_URL')??'http://127.0.0.1:1234/v1'; const lmKey=env('LMSTUDIO_API_KEY'); if(lmModel){add(new OpenAICompatibleProvider({id:'lmstudio',baseUrl:lmBase,model:lmModel,...(lmKey?{apiKey:lmKey}:{})}),{id:'lmstudio',transport:'local',configured:true,model:lmModel,source:'env'})}
  if(demo){add(new MockProvider('local-demo','local'),{id:'local-demo',transport:'local',configured:true,source:'demo'});add(new MockProvider('api-demo','api'),{id:'api-demo',transport:'api',configured:true,source:'demo'})}
  return {providers,info};
}
