import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAether } from '../src/aether.js';
import type { Aether } from '../src/types.js';

export async function makeAether(opts: { background?: boolean } = {}): Promise<{ a: Aether; dir: string; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'aether-test-'));
  const a = await createAether({ config: { dataDir: dir, smtpPort: 0, smtpHost: '127.0.0.1', authMode: 'token' }, memoryDb: true, skipBackground: !opts.background });
  return { a, dir, cleanup: async () => { await a.shutdown().catch(() => undefined); rmSync(dir, { recursive: true, force: true }); } };
}
