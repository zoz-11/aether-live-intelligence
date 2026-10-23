import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile, appendFile, realpath, open } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeEnv } from '../util.js';

export interface ExecResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number }
export interface Entry { name: string; path: string; type: 'file' | 'dir' | 'other'; size: number; mtime: string }
interface Proc { id: string; name: string; cmd: string; cwd: string; child: ChildProcess; log: string[]; startedAt: string; exitCode: number | null; running: boolean }

const MAX_OUT = 100_000;
const SKIP = new Set(['node_modules', '.git', '.trash', '.cache', '__pycache__', '.venv', 'dist']);

/** Read-only command allowlist used for risk classification (no shell metacharacters allowed). */
const READ_ONLY_BINS = ['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'whoami', 'date', 'uname', 'df', 'du', 'free', 'ps', 'which', 'file', 'stat', 'tree', 'grep', 'rg', 'uptime', 'id', 'hostname', 'nproc', 'sort', 'uniq', 'cut', 'basename', 'dirname', 'sha256sum', 'md5sum', 'jq', 'nl', 'column', 'true'];

function isReadOnlySegment(seg: string): boolean {
  const parts = seg.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const [bin, ...args] = parts;
  // Anything that points outside the workspace needs approval, even for read-only programs.
  if (args.some((x) => x.startsWith('/') || x.startsWith('~') || x.includes('..'))) return false;
  if (READ_ONLY_BINS.includes(bin)) return true;
  if (bin === 'find') return !args.some((p) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls'].includes(p));
  if (bin === 'git') return ['status', 'log', 'diff', 'branch', 'show', 'remote', 'rev-parse', 'ls-files', 'blame'].includes(args[0] ?? '') && !args.some((x) => ['-d', '-D', '-m', '-M', '--delete', 'add', 'remove', 'rm', 'set-url', 'rename'].includes(x));
  if (['node', 'npm', 'npx', 'python3', 'python', 'pip', 'pip3', 'go', 'rustc', 'cargo', 'java', 'docker', 'git', 'pnpm', 'yarn', 'bun', 'deno'].includes(bin)) return args.length === 1 && ['-v', '--version', 'version', '-V'].includes(args[0]);
  return false;
}

/** True when a shell command only reads (so it can run without approval in balanced mode). Chains of read-only commands are allowed. */
export function isReadOnlyCommand(cmd: string): boolean {
  const c = cmd.trim();
  if (!c || /[`<>(){}\\\n$]/.test(c) || /(^|[^&])&($|[^&])/.test(c)) return false;
  const segments = c.split(/\s*(?:&&|\|\||;|\|)\s*/);
  return segments.length > 0 && segments.every(isReadOnlySegment);
}

/** A confined working directory with files, shell, background processes and downloads. Used on the agent computer and in Core. */
export class Workspace {
  private procs = new Map<string, Proc>();
  private seq = 0;
  constructor(public root: string, private baseEnv: Record<string, string> = {}) {}

  async init() { await mkdir(this.root, { recursive: true }); await mkdir(join(this.root, '.trash'), { recursive: true }); }

  /** Resolves a user path inside the root. Absolute paths are treated as root-relative. Throws on escape. */
  async resolvePath(p = '.'): Promise<string> {
    const rootReal = await realpath(this.root).catch(() => this.root);
    const rel = p.startsWith('/') ? p.replace(/^\/+/, '') : p;
    const abs = resolve(rootReal, rel || '.');
    let check = abs;
    // Resolve symlinks of the deepest existing ancestor.
    for (let cur = abs; ; cur = dirname(cur)) {
      try { const r = await realpath(cur); check = join(r, relative(cur, abs)); break; } catch { if (cur === dirname(cur)) break; }
    }
    if (check !== rootReal && !check.startsWith(rootReal + sep)) throw new Error(`Path escapes the workspace: ${p}`);
    return abs;
  }

  rel(abs: string) { return relative(this.root, abs) || '.'; }

  async list(p = '.', depth = 1): Promise<Entry[]> {
    const base = await this.resolvePath(p);
    const out: Entry[] = [];
    const walk = async (dir: string, d: number) => {
      const items = await readdir(dir, { withFileTypes: true });
      for (const it of items.sort((x, y) => x.name.localeCompare(y.name))) {
        if (it.name === '.trash') continue;
        const full = join(dir, it.name);
        const st = await stat(full).catch(() => null);
        out.push({ name: it.name, path: this.rel(full), type: it.isDirectory() ? 'dir' : it.isFile() ? 'file' : 'other', size: st?.size ?? 0, mtime: st?.mtime.toISOString() ?? '' });
        if (it.isDirectory() && d > 1 && !SKIP.has(it.name) && out.length < 2000) await walk(full, d - 1);
      }
    };
    await walk(base, Math.max(1, Math.min(depth, 6)));
    return out;
  }

  async read(p: string, maxBytes = 200_000): Promise<{ text: string; size: number; binary: boolean; truncated: boolean }> {
    const abs = await this.resolvePath(p);
    const st = await stat(abs);
    if (st.isDirectory()) throw new Error(`${p} is a directory`);
    const fh = await open(abs, 'r');
    try {
      const buf = Buffer.alloc(Math.min(st.size, maxBytes));
      await fh.read(buf, 0, buf.length, 0);
      const binary = buf.subarray(0, 8000).includes(0);
      return { text: binary ? '' : buf.toString('utf8'), size: st.size, binary, truncated: st.size > maxBytes };
    } finally { await fh.close(); }
  }

  async readBuffer(p: string): Promise<Buffer> { return readFile(await this.resolvePath(p)); }

  async write(p: string, content: string | Buffer, append = false) {
    const abs = await this.resolvePath(p);
    await mkdir(dirname(abs), { recursive: true });
    if (append) await appendFile(abs, content); else await writeFile(abs, content);
    const st = await stat(abs);
    return { path: this.rel(abs), size: st.size };
  }

  /** Moves to .trash instead of deleting, so mistakes are recoverable. */
  async remove(p: string) {
    const abs = await this.resolvePath(p);
    if (abs === (await this.resolvePath('.'))) throw new Error('Refusing to delete the workspace root');
    await stat(abs);
    const dest = join(this.root, '.trash', `${Date.now()}-${basename(abs)}`);
    await rename(abs, dest);
    return { trashed: this.rel(dest) };
  }

  async move(from: string, to: string) {
    const a = await this.resolvePath(from);
    const b = await this.resolvePath(to);
    await mkdir(dirname(b), { recursive: true });
    await rename(a, b);
    return { from: this.rel(a), to: this.rel(b) };
  }

  async search(query: string, p = '.', max = 200): Promise<{ path: string; line: number; text: string }[]> {
    const base = await this.resolvePath(p);
    const q = query.toLowerCase();
    const hits: { path: string; line: number; text: string }[] = [];
    const walk = async (dir: string) => {
      for (const it of await readdir(dir, { withFileTypes: true })) {
        if (hits.length >= max) return;
        if (SKIP.has(it.name)) continue;
        const full = join(dir, it.name);
        if (it.isDirectory()) await walk(full);
        else if (it.isFile()) {
          if (it.name.toLowerCase().includes(q)) hits.push({ path: this.rel(full), line: 0, text: '(file name match)' });
          const st = await stat(full).catch(() => null);
          if (!st || st.size > 1_000_000) continue;
          const buf = await readFile(full).catch(() => null);
          if (!buf || buf.subarray(0, 4000).includes(0)) continue;
          const lines = buf.toString('utf8').split('\n');
          for (let i = 0; i < lines.length && hits.length < max; i++) if (lines[i].toLowerCase().includes(q)) hits.push({ path: this.rel(full), line: i + 1, text: lines[i].slice(0, 240) });
        }
      }
    };
    await walk(base);
    return hits;
  }

  private env(extra: Record<string, string> = {}) {
    // Never leak Core's credentials into commands the agent runs; secrets reach commands only via {{secret:NAME}} after approval.
    return safeEnv({ ...this.baseEnv, HOME: process.env.HOME ?? this.root, ...extra });
  }

  async exec(cmd: string, opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal } = {}): Promise<ExecResult> {
    const cwd = await this.resolvePath(opts.cwd ?? '.');
    const started = Date.now();
    return new Promise((resolveP) => {
      const child = spawn('bash', ['-lc', cmd], { cwd, env: this.env(opts.env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', timedOut = false;
      const cap = (cur: string, chunk: Buffer) => (cur.length < MAX_OUT ? cur + chunk.toString('utf8') : cur);
      child.stdout!.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
      child.stderr!.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
      const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
      const timer = setTimeout(() => { timedOut = true; kill(); }, Math.min(opts.timeoutMs ?? 120_000, 30 * 60_000));
      opts.signal?.addEventListener('abort', kill, { once: true });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolveP({ code, stdout: stdout.slice(0, MAX_OUT), stderr: stderr.slice(0, MAX_OUT), timedOut, durationMs: Date.now() - started });
      });
      child.on('error', (e) => { clearTimeout(timer); resolveP({ code: -1, stdout, stderr: String(e.message), timedOut, durationMs: Date.now() - started }); });
    });
  }

  async start(cmd: string, opts: { cwd?: string; env?: Record<string, string>; name?: string } = {}) {
    const cwd = await this.resolvePath(opts.cwd ?? '.');
    const id = `p${++this.seq}`;
    const child = spawn('bash', ['-lc', cmd], { cwd, env: this.env(opts.env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const proc: Proc = { id, name: opts.name ?? cmd.slice(0, 40), cmd, cwd: this.rel(cwd), child, log: [], startedAt: new Date().toISOString(), exitCode: null, running: true };
    const push = (c: Buffer) => { for (const line of c.toString('utf8').split('\n')) if (line) proc.log.push(line); if (proc.log.length > 2000) proc.log.splice(0, proc.log.length - 2000); };
    child.stdout!.on('data', push);
    child.stderr!.on('data', push);
    child.on('close', (code) => { proc.running = false; proc.exitCode = code; });
    child.on('error', (e) => { proc.running = false; proc.log.push(`error: ${e.message}`); });
    this.procs.set(id, proc);
    return this.describe(proc);
  }

  private describe(p: Proc) { return { id: p.id, name: p.name, cmd: p.cmd, cwd: p.cwd, pid: p.child.pid, running: p.running, exitCode: p.exitCode, startedAt: p.startedAt }; }

  processes() { return [...this.procs.values()].map((p) => this.describe(p)); }

  logs(id: string, tail = 200) {
    const p = this.procs.get(id);
    if (!p) throw new Error(`No process ${id}`);
    return { ...this.describe(p), log: p.log.slice(-Math.min(tail, 2000)).join('\n') };
  }

  stop(id: string) {
    const p = this.procs.get(id);
    if (!p) throw new Error(`No process ${id}`);
    try { process.kill(-p.child.pid!, 'SIGTERM'); } catch { try { p.child.kill('SIGTERM'); } catch { /* gone */ } }
    setTimeout(() => { if (p.running) { try { process.kill(-p.child.pid!, 'SIGKILL'); } catch { /* gone */ } } }, 3000).unref();
    return { id, stopped: true };
  }

  stopAll() { for (const p of this.procs.values()) if (p.running) this.stop(p.id); }

  async download(url: string, p?: string, maxBytes = 500 * 1024 * 1024, signal?: AbortSignal) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be downloaded');
    const res = await fetch(url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len && len > maxBytes) throw new Error(`File too large (${len} bytes)`);
    const nameFromUrl = decodeURIComponent(new URL(res.url || url).pathname.split('/').filter(Boolean).pop() || 'download');
    const target = p ? (p.endsWith('/') ? join(p, nameFromUrl) : p) : join('downloads', nameFromUrl);
    const abs = await this.resolvePath(target);
    await mkdir(dirname(abs), { recursive: true });
    let total = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) { total += chunk.byteLength; if (total > maxBytes) ctl.error(new Error('File exceeded the size limit')); else ctl.enqueue(chunk); },
    });
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as any), createWriteStream(abs));
    return { path: this.rel(abs), size: total, contentType: res.headers.get('content-type') };
  }
}
