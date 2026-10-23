import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export interface Config {
  version: string;
  port: number;
  host: string;
  dataDir: string;
  dbDir: string;
  workspaceDir: string;
  filesDir: string;
  skillsDirs: string[];
  publicDir: string | null;
  databaseUrl: string | null;
  databaseSsl: boolean;
  authMode: 'token' | 'off';
  token: string;
  masterKey: Buffer;
  smtpPort: number;
  smtpHost: string;
  desktopUrl: string | null;
  runtime: 'node' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
  return p;
}

/** Reads a secret-ish value from env or from a file in the data dir, generating it on first run. */
function persistentSecret(dataDir: string, file: string, envName: string, bytes: number): string {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const p = join(dataDir, file);
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const value = randomBytes(bytes).toString('base64url');
  writeFileSync(p, value + '\n', { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* best effort */ }
  return value;
}

export function findRepoRoot(start = here): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'skills')) && existsSync(join(dir, 'apps'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return resolve(here, '../../..');
}

export function loadConfig(overrides: Partial<Config> & { dataDir?: string } = {}): Config {
  const root = findRepoRoot();
  const dataDir = ensureDir(resolve(overrides.dataDir ?? process.env.AETHER_DATA_DIR ?? join(root, 'data')));
  const dbDir = ensureDir(join(dataDir, 'db'));
  const workspaceDir = ensureDir(resolve(process.env.AETHER_WORKSPACE ?? join(dataDir, 'workspace')));
  const filesDir = ensureDir(join(dataDir, 'files'));
  ensureDir(join(dataDir, 'skills'));

  const token = persistentSecret(dataDir, 'owner.token', 'AETHER_TOKEN', 24);
  const masterKeyB64 = persistentSecret(dataDir, 'master.key', 'AETHER_MASTER_KEY', 32);
  let masterKey = Buffer.from(masterKeyB64, 'base64url');
  if (masterKey.length !== 32) masterKey = Buffer.from(masterKeyB64, 'base64');
  if (masterKey.length !== 32) throw new Error('AETHER_MASTER_KEY must be 32 bytes (base64 or base64url).');

  const candidates = [
    process.env.AETHER_PUBLIC_DIR,
    resolve(here, '../public'),
    resolve(here, '../../web/dist'),
  ].filter(Boolean) as string[];
  const publicDir = candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;

  let version = '1.0.0';
  try {
    version = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')).version ?? version;
  } catch { /* ignore */ }

  const cfg: Config = {
    version,
    port: Number(process.env.PORT ?? process.env.AETHER_PORT ?? 8787),
    host: process.env.AETHER_HOST ?? '0.0.0.0',
    dataDir,
    dbDir,
    workspaceDir,
    filesDir,
    skillsDirs: [join(root, 'skills'), join(dataDir, 'skills')],
    publicDir,
    databaseUrl: process.env.DATABASE_URL ?? null,
    databaseSsl: /^(1|true|require)$/i.test(process.env.DATABASE_SSL ?? ''),
    authMode: (process.env.AETHER_AUTH ?? 'token') === 'off' ? 'off' : 'token',
    token,
    masterKey,
    smtpPort: Number(process.env.AETHER_SMTP_PORT ?? 2525),
    smtpHost: process.env.AETHER_SMTP_HOST ?? '0.0.0.0',
    desktopUrl: process.env.AETHER_DESKTOP_URL ?? null,
    runtime: process.env.VITEST ? 'test' : 'node',
    logLevel: (process.env.AETHER_LOG_LEVEL as Config['logLevel']) ?? 'info',
    ...overrides,
  };
  return cfg;
}
