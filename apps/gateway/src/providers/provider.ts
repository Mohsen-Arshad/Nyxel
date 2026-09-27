import type {AIEvent,AIRequest,ProviderCapabilities,ProviderHealth,TaskKind,TransportType} from '../domain/types.js';
export type ProviderManifest = {capabilities:ProviderCapabilities;taskStrengths?:Partial<Record<TaskKind,number>>};
export interface Provider { readonly id:string; readonly transport:TransportType; readonly manifest?:ProviderManifest; health():Promise<Omit<ProviderHealth,'checkedAt'>>; execute(request:AIRequest):AsyncIterable<AIEvent>; cancel(requestId:string):Promise<void>; }
