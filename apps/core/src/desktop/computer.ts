import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { Aether, ToolImage } from '../types.js';
import { log, safeEnv } from '../util.js';

const l = log('computer');
const here = dirname(fileURLToPath(import.meta.url));

/** Core-side client for the agent computer (aether-desktopd), local child process or remote container. */
export class ComputerService {
  private child: ChildProcess | null = null;
  private token: string;
  private lastAction: { action: string; at: string; x?: number; y?: number } | null = null;

  constructor(private getAether: () => Aether) {
    const a = getAether;
    const file = join(a().config.dataDir, 'desktop.token');
    if (process.env.AETHER_DESKTOP_TOKEN) this.token = process.env.AETHER_DESKTOP_TOKEN;
    else if (existsSync(file)) this.token = readFileSync(file, 'utf8').trim();
    else { this.token = randomBytes(18).toString('base64url'); writeFileSync(file, this.token, { mode: 0o600 }); }
  }

  private async cfg() {
    const a = this.getAether();
    const s = (await a.settings.get()).computer;
    const url = a.config.desktopUrl || s.url;
    return { ...s, url };
  }

  async enabled() { return (await this.cfg()).provider !== 'off'; }

  private async request(path: string, init: { method?: string; body?: unknown; raw?: boolean; timeoutMs?: number } = {}) {
    const c = await this.cfg();
    if (c.provider === 'off') throw new Error('The agent computer is turned off in Settings → Computer.');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${c.url.replace(/\/$/, '')}${path}`, {
        method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
        headers: { 'content-type': 'application/json', 'x-desktop-token': this.token },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctrl.signal,
      });
      if (init.raw) { if (!res.ok) throw new Error(`desktop ${res.status}: ${await res.text()}`); return res; }
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `desktop ${res.status}`);
      return j;
    } finally { clearTimeout(t); }
  }

  async reachable(): Promise<boolean> {
    try {
      const c = await this.cfg();
      const res = await fetch(`${c.url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch { return false; }
  }

  /** Spawns a local desktopd when the provider is "local" and nothing answers yet. */
  async ensureDaemon() {
    const c = await this.cfg();
    if (c.provider === 'off') throw new Error('The agent computer is turned off in Settings → Computer.');
    if (await this.reachable()) return;
    if (c.provider !== 'local') throw new Error(`The agent computer at ${c.url} is not reachable. Start the desktop container (docker compose up desktop).`);
    if (process.platform !== 'linux') throw new Error('A local agent computer needs Linux (Xvfb). On macOS/Windows run the Docker desktop image and set provider to "remote".');
    const u = new URL(c.url);
    const ts = join(here, 'daemon.ts');
    const js = join(here, 'daemon.js');
    const args = existsSync(js) ? [js] : ['--import', 'tsx', ts];
    const a = this.getAether();
    const tz = (await a.settings.get()).owner.timezone || 'UTC';
    this.child = spawn(process.execPath, args, {
      env: safeEnv({
        TZ: tz,
        DESKTOPD_PORT: u.port || '9990', DESKTOPD_HOST: '127.0.0.1', DESKTOPD_TOKEN: this.token,
        DESKTOP_WIDTH: String(c.width), DESKTOP_HEIGHT: String(c.height), DESKTOP_VNC_PORT: String(c.vncPort),
        DESKTOP_CDP_PORT: new URL(c.cdpUrl).port || '9222', DESKTOP_HOME: a.config.workspaceDir, DESKTOP_VNC_LOCALHOST: '1',
      }),
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: join(here, '..', '..'),
    });
    this.child.on('exit', (code) => { l.info(`desktopd exited (${code})`); this.child = null; });
    for (let i = 0; i < 60; i++) { if (await this.reachable()) return; await new Promise((r) => setTimeout(r, 250)); }
    throw new Error('desktopd did not come up');
  }

  async status() {
    const c = await this.cfg();
    if (c.provider === 'off') return { provider: 'off', reachable: false, running: false };
    try {
      const res = await fetch(`${c.url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1500) });
      const j: any = await res.json();
      return { provider: c.provider, reachable: true, ...j, lastAction: this.lastAction };
    } catch {
      return { provider: c.provider, reachable: false, running: false, url: c.url };
    }
  }

  async start() {
    await this.ensureDaemon();
    const r = await this.request('/start', { body: {}, timeoutMs: 60_000 });
    this.getAether().bus.publish('computer.status', await this.status());
    return r;
  }

  async stop() {
    const r = await this.request('/stop', { body: {} }).catch((e) => ({ error: e.message }));
    this.getAether().bus.publish('computer.status', await this.status());
    return r;
  }

  /** Makes sure the desktop is up (used by tools before acting). */
  async ready() {
    const s: any = await this.status();
    if (!s.reachable || !s.running) await this.start();
  }

  async screenshot(scale = 0.75): Promise<ToolImage> {
    const res = (await this.request(`/screenshot?scale=${scale}`, { raw: true })) as Response;
    const buf = Buffer.from(await res.arrayBuffer());
    return { mime: 'image/png', base64: buf.toString('base64') };
  }

  async screenshotPng(scale = 1): Promise<Buffer> {
    const res = (await this.request(`/screenshot?scale=${scale}`, { raw: true })) as Response;
    return Buffer.from(await res.arrayBuffer());
  }

  async action(args: Record<string, unknown>) {
    const r = await this.request('/action', { body: args });
    this.lastAction = { action: String(args.action), at: new Date().toISOString(), x: args.x as number | undefined, y: args.y as number | undefined };
    this.getAether().bus.publish('computer.action', this.lastAction);
    return r;
  }

  async exec(cmd: string, opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}) {
    return this.request('/exec', { body: { cmd, ...opts }, timeoutMs: (opts.timeoutMs ?? 120_000) + 5000 });
  }

  async fs(op: string, args: Record<string, unknown>) { return this.request('/fs', { body: { op, ...args }, timeoutMs: 600_000 }); }
  async proc(op: string, args: Record<string, unknown>) { return this.request('/proc', { body: { op, ...args } }); }

  async vncTarget() { const c = await this.cfg(); return { host: c.vncHost, port: c.vncPort }; }
  async cdpUrl() { return (await this.cfg()).cdpUrl; }

  async shutdown() {
    if (this.child) { try { await this.request('/stop', { body: {}, timeoutMs: 3000 }); } catch { /* ignore */ } this.child.kill('SIGTERM'); this.child = null; }
  }
}
