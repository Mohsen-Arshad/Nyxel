import {readFile,writeFile} from 'node:fs/promises'; import {validateProviderDefinition,exportProviderDefinition,ProviderDefinition} from '@nyxelrelay/provider-schema';
export async function importDefinition(path:string):Promise<ProviderDefinition>{return validateProviderDefinition(JSON.parse(await readFile(path,'utf8')))}
export async function exportDefinition(path:string,def:ProviderDefinition){await writeFile(path,exportProviderDefinition(def),'utf8')}
