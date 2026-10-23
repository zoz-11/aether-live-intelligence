import { MIGRATIONS } from './migrations.js';
import { log } from '../util.js';

const l = log('db');

/** Minimal database contract shared by embedded Postgres (PGlite) and server Postgres (pg / Supabase). */
export interface Db {
  kind: 'pglite' | 'postgres';
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

function normalizeParams(params: unknown[] = []): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (p instanceof Date) return p.toISOString();
    if (p !== null && typeof p === 'object' && !Buffer.isBuffer(p)) return JSON.stringify(p);
    return p;
  });
}

export async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dir ? await PGlite.create(dir) : await PGlite.create();
  // PGlite runs a single connection; serialize to keep transactions and multi-statement execs safe.
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };
  const db: Db = {
    kind: 'pglite',
    async query<T>(sql: string, params?: unknown[]) {
      const res = await run(() => pg.query(sql, normalizeParams(params)));
      return res.rows as T[];
    },
    async one<T>(sql: string, params?: unknown[]) {
      const rows = await db.query<T>(sql, params);
      return rows[0];
    },
    async exec(sql: string) { await run(() => pg.exec(sql)); },
    async close() { await pg.close(); },
  };
  return db;
}

export async function openPostgres(url: string, ssl: boolean): Promise<Db> {
  const pgMod = await import('pg');
  const Pool = (pgMod as any).default?.Pool ?? (pgMod as any).Pool;
  const pool = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 5 });
  const db: Db = {
    kind: 'postgres',
    async query<T>(sql: string, params?: unknown[]) {
      const res = await pool.query(sql, normalizeParams(params));
      return res.rows as T[];
    },
    async one<T>(sql: string, params?: unknown[]) {
      const rows = await db.query<T>(sql, params);
      return rows[0];
    },
    async exec(sql: string) { await pool.query(sql); },
    async close() { await pool.end(); },
  };
  return db;
}

export async function migrate(db: Db): Promise<number> {
  await db.exec(`create table if not exists _migrations (id integer primary key, name text not null, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ id: number }>('select id from _migrations')).map((r) => Number(r.id)));
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.exec(m.sql);
    await db.query('insert into _migrations (id, name) values ($1, $2)', [m.id, m.name]);
    applied++;
    l.info(`applied migration ${m.id} ${m.name}`);
  }
  return applied;
}

export async function openDb(opts: { url: string | null; ssl: boolean; dir: string | null }): Promise<Db> {
  const db = opts.url ? await openPostgres(opts.url, opts.ssl) : await openPglite(opts.dir);
  await migrate(db);
  return db;
}
