import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Db } from './db/index.js';

const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PLACEHOLDER_RE = /\{\{\s*secret:([A-Z][A-Z0-9_]{1,63})\s*\}\}/g;

export interface SecretMeta { name: string; description: string | null; created_at: string; updated_at: string; last_used_at: string | null; source: 'vault' | 'env' }

/**
 * Encrypted secrets vault (AES-256-GCM). The model only ever sees secret names and
 * `{{secret:NAME}}` placeholders; real values are swapped in at the tool boundary and
 * scrubbed from anything that flows back to the model.
 */
export class Vault {
  private cache = new Map<string, string>();
  constructor(private db: Db, private key: Buffer) {}

  static validName(name: string) { return NAME_RE.test(name); }

  private encrypt(plain: string) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
  }

  private decrypt(row: { ciphertext: string; iv: string; tag: string }) {
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv, 'base64'));
    d.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(row.ciphertext, 'base64')), d.final()]).toString('utf8');
  }

  async set(name: string, value: string, description?: string) {
    if (!Vault.validName(name)) throw new Error('Secret names use UPPER_SNAKE_CASE, e.g. OPENAI_API_KEY');
    if (!value) throw new Error('Secret value is empty');
    const enc = this.encrypt(value);
    await this.db.query(
      `insert into secrets (name, ciphertext, iv, tag, description) values ($1,$2,$3,$4,$5)
       on conflict (name) do update set ciphertext=excluded.ciphertext, iv=excluded.iv, tag=excluded.tag,
       description=coalesce(excluded.description, secrets.description), updated_at=now()`,
      [name, enc.ciphertext, enc.iv, enc.tag, description ?? null],
    );
    this.cache.set(name, value);
  }

  async delete(name: string) {
    await this.db.query('delete from secrets where name=$1', [name]);
    this.cache.delete(name);
  }

  /** Returns the decrypted value from the vault, falling back to the process environment. */
  async get(name: string): Promise<string | null> {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const row = await this.db.one<{ ciphertext: string; iv: string; tag: string }>('select ciphertext, iv, tag from secrets where name=$1', [name]);
    if (row) {
      const v = this.decrypt(row);
      this.cache.set(name, v);
      this.db.query('update secrets set last_used_at=now() where name=$1', [name]).catch(() => undefined);
      return v;
    }
    const env = process.env[name];
    return env && env.trim() ? env.trim() : null;
  }

  async has(name: string) { return (await this.get(name)) !== null; }

  async list(): Promise<SecretMeta[]> {
    const rows = await this.db.query<any>('select name, description, created_at, updated_at, last_used_at from secrets order by name');
    return rows.map((r) => ({ ...r, source: 'vault' as const }));
  }

  /** Replaces {{secret:NAME}} placeholders inside any JSON-like value. Throws if a secret is missing. */
  async resolve<T>(value: T): Promise<T> {
    const names = new Set<string>();
    const walk = (v: unknown) => {
      if (typeof v === 'string') for (const m of v.matchAll(PLACEHOLDER_RE)) names.add(m[1]);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(value);
    if (!names.size) return value;
    const values = new Map<string, string>();
    for (const n of names) {
      const s = await this.get(n);
      if (s === null) throw new Error(`Secret ${n} is not set. Ask the user to add it (secrets tool, action "request").`);
      values.set(n, s);
    }
    const sub = (v: unknown): unknown => {
      if (typeof v === 'string') return v.replace(PLACEHOLDER_RE, (_m, n: string) => values.get(n) ?? '');
      if (Array.isArray(v)) return v.map(sub);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
      return v;
    };
    return sub(value) as T;
  }

  /** Scrubs every known secret value (length >= 6) from text, replacing it with its placeholder. */
  async redact(text: string): Promise<string> {
    if (!text) return text;
    const rows = await this.db.query<{ name: string }>('select name from secrets');
    let out = text;
    for (const { name } of rows) {
      const v = await this.get(name);
      if (v && v.length >= 6 && out.includes(v)) out = out.split(v).join(`{{secret:${name}}}`);
    }
    return out;
  }
}
