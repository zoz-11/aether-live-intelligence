#!/usr/bin/env node
import { createAether } from './aether.js';
import { startServer } from './server.js';
import { log } from './util.js';

const l = log('core');

async function main() {
  const aether = await createAether();
  const { port } = await startServer(aether);
  const c = aether.config;
  const model = await aether.models.describe();
  const lines = [
    '',
    '  Aether Core is running',
    `  Local:     http://localhost:${port}`,
    `  Data:      ${c.dataDir}`,
    `  Database:  ${c.databaseUrl ? 'Postgres (DATABASE_URL)' : 'embedded PGlite'}`,
    `  Model:     ${model.provider} / ${model.model}${model.notice ? ` (${model.notice})` : ''}`,
    `  Auth:      ${c.authMode === 'off' ? 'OFF (only use behind a trusted proxy)' : 'owner token required'}`,
    c.authMode === 'off' ? '' : `  Token:     ${c.token}`,
    c.authMode === 'off' ? '' : `  Open:      http://localhost:${port}/#token=${c.token}`,
    '',
  ].filter((x) => x !== '');
  process.stdout.write(lines.join('\n') + '\n\n');
  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    l.info(`${sig} received, shutting down`);
    const t = setTimeout(() => process.exit(0), 8000);
    try { await aether.shutdown(); } catch (e: any) { l.warn(e.message); }
    clearTimeout(t);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('unhandledRejection', (e: any) => l.warn(`unhandled rejection: ${e?.message ?? e}`));
}

main().catch((e) => {
  console.error('Aether Core failed to start:', e);
  process.exit(1);
});
