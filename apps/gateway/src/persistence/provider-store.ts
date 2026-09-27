import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateProviderDefinition, type ProviderDefinition } from '@nyxelrelay/provider-schema';

export class ProviderStore {
  constructor(private readonly directory: string) {}

  async init(): Promise<void> { await mkdir(this.directory, { recursive: true }); }

  async list(): Promise<ProviderDefinition[]> {
    await this.init();
    const names = await readdir(this.directory).catch(() => [] as string[]);
    const result: ProviderDefinition[] = [];
    for (const name of names.filter(n => n.endsWith('.json'))) {
      try { result.push(await this.read(name.slice(0, -5))); } catch { /* ignore invalid definitions */ }
    }
    return result;
  }

  async read(id: string): Promise<ProviderDefinition> {
    const safe = id.replace(/[^a-z0-9._-]/gi, '_');
    const raw = JSON.parse(await readFile(join(this.directory, `${safe}.json`), 'utf8'));
    return validateProviderDefinition(raw);
  }

  async remove(id: string): Promise<void> {
    const safe = id.replace(/[^a-z0-9._-]/gi, '_');
    const { unlink } = await import('node:fs/promises');
    await unlink(join(this.directory, `${safe}.json`)).catch(() => undefined);
  }

  async save(definition: ProviderDefinition): Promise<void> {
    const validated = validateProviderDefinition(definition);
    await this.init();
    await writeFile(join(this.directory, `${validated.provider.id}.json`), JSON.stringify(validated, null, 2), 'utf8');
  }
}
