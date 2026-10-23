import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface DesktopOptions {
  display: number;
  width: number;
  height: number;
  vncPort: number;
  cdpPort: number;
  home: string;
  vncLocalhostOnly: boolean;
  chromiumPath?: string;
}

export interface ActionInput {
  action: string;
  x?: number; y?: number; toX?: number; toY?: number;
  text?: string; keys?: string; direction?: 'up' | 'down' | 'left' | 'right'; amount?: number;
  seconds?: number; url?: string; app?: string; button?: 'left' | 'right' | 'middle';
}

const KEY_MAP: Record<string, string> = {
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', backspace: 'BackSpace', tab: 'Tab', space: 'space',
  delete: 'Delete', del: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', pageup: 'Prior', pagedown: 'Next',
  home: 'Home', end: 'End', cmd: 'super', command: 'super', win: 'super', meta: 'super', super: 'super', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift',
};

export function toXdoKeys(keys: string): string[] {
  return keys.trim().split(/\s+/).filter(Boolean).map((combo) => combo.split('+').map((k) => {
    const low = k.toLowerCase();
    if (KEY_MAP[low]) return KEY_MAP[low];
    if (/^f\d{1,2}$/.test(low)) return low.toUpperCase();
    return k.length === 1 ? k : k;
  }).join('+'));
}

export function findChromium(explicit?: string): string | null {
  const cands = [explicit, process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean) as string[];
  for (const c of cands) if (existsSync(c)) return c;
  const pw = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(pw)) {
    const dirs = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) for (const sub of ['chrome-linux64', 'chrome-linux']) {
      const p = join(pw, d, sub, 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function which(bin: string) { try { await execFileP('which', [bin]); return true; } catch { return false; } }

export function portOpen(port: number, host = '127.0.0.1', timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port, host });
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The agent's own Linux desktop: Xvfb + Openbox + tint2 + Chromium (CDP) + x11vnc, driven with xdotool.
 * Bytebot-style: a separate daemon owns the desktop; Core talks to it over HTTP.
 */
export class Desktop {
  private procs: Record<string, ChildProcess | undefined> = {};
  constructor(public o: DesktopOptions) { mkdirSync(o.home, { recursive: true }); }

  get display() { return `:${this.o.display}`; }
  private env() { return { ...process.env, DISPLAY: this.display, HOME: process.env.HOME ?? this.o.home } as Record<string, string>; }

  private spawnBg(name: string, cmd: string, args: string[]) {
    const p = spawn(cmd, args, { env: this.env(), stdio: 'ignore', detached: false });
    p.on('error', () => { this.procs[name] = undefined; });
    p.on('exit', () => { if (this.procs[name] === p) this.procs[name] = undefined; });
    this.procs[name] = p;
    return p;
  }

  async xRunning() { return existsSync(`/tmp/.X11-unix/X${this.o.display}`) && (await this.xdo(['getdisplaygeometry']).then(() => true, () => false)); }

  async start() {
    if (!(await which('Xvfb'))) throw new Error('Xvfb is not installed on this machine. Use the Docker desktop image or install xvfb, openbox, x11vnc and xdotool.');
    if (!(await this.xRunning())) {
      this.spawnBg('xvfb', 'Xvfb', [this.display, '-screen', '0', `${this.o.width}x${this.o.height}x24`, '-ac', '-nolisten', 'tcp']);
      for (let i = 0; i < 50 && !(await this.xRunning()); i++) await wait(100);
      if (!(await this.xRunning())) throw new Error('Xvfb did not start');
    }
    if (!this.procs.wm && (await which('openbox'))) this.spawnBg('wm', 'openbox', []);
    if (!this.procs.panel && (await which('tint2'))) this.spawnBg('panel', 'tint2', []);
    if (await which('xsetroot')) await execFileP('xsetroot', ['-solid', '#1d2733'], { env: this.env() }).catch(() => undefined);
    if (!(await portOpen(this.o.vncPort)) && (await which('x11vnc'))) {
      const args = ['-display', this.display, '-forever', '-shared', '-nopw', '-rfbport', String(this.o.vncPort), '-quiet', '-noxdamage', '-cursor', 'arrow'];
      if (this.o.vncLocalhostOnly) args.push('-localhost');
      this.spawnBg('vnc', 'x11vnc', args);
      for (let i = 0; i < 40 && !(await portOpen(this.o.vncPort)); i++) await wait(150);
    }
    await this.startBrowser();
    return this.status();
  }

  async startBrowser(url?: string) {
    if (await portOpen(this.o.cdpPort)) {
      if (url) this.launchChromium([url]);
      return;
    }
    const bin = findChromium(this.o.chromiumPath);
    if (!bin) return;
    this.launchChromium(url ? [url] : ['about:blank']);
    for (let i = 0; i < 60 && !(await portOpen(this.o.cdpPort)); i++) await wait(200);
  }

  private launchChromium(urls: string[]) {
    const bin = findChromium(this.o.chromiumPath);
    if (!bin) throw new Error('Chromium not found (set CHROMIUM_PATH)');
    const args = [
      `--remote-debugging-port=${this.o.cdpPort}`, `--user-data-dir=${join(this.o.home, '.aether-chromium')}`,
      '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--password-store=basic', '--disable-features=Translate,MediaRouter',
      `--window-position=0,0`, `--window-size=${this.o.width},${this.o.height - 30}`, '--start-maximized', '--test-type',
    ];
    if (process.getuid?.() === 0) args.push('--no-sandbox');
    const p = spawn(bin, [...args, ...urls], { env: this.env(), stdio: 'ignore', detached: false });
    p.on('error', () => undefined);
    if (!this.procs.chrome) { this.procs.chrome = p; p.on('exit', () => { if (this.procs.chrome === p) this.procs.chrome = undefined; }); }
  }

  async stop() {
    for (const k of ['chrome', 'vnc', 'panel', 'wm', 'xvfb']) {
      const p = this.procs[k];
      if (p) { try { p.kill('SIGTERM'); } catch { /* gone */ } this.procs[k] = undefined; }
    }
    return { stopped: true };
  }

  async status() {
    const x = await this.xRunning();
    return {
      running: x,
      display: this.display,
      width: this.o.width,
      height: this.o.height,
      vnc: await portOpen(this.o.vncPort),
      vncPort: this.o.vncPort,
      cdp: await portOpen(this.o.cdpPort),
      cdpPort: this.o.cdpPort,
      chromium: findChromium(this.o.chromiumPath),
      tools: { xvfb: await which('Xvfb'), xdotool: await which('xdotool'), x11vnc: await which('x11vnc'), import: await which('import') },
      home: this.o.home,
    };
  }

  private async xdo(args: string[]) {
    const { stdout } = await execFileP('xdotool', args, { env: this.env(), timeout: 20_000 });
    return stdout.trim();
  }

  async screenshot(scale = 1): Promise<Buffer> {
    if (!(await this.xRunning())) throw new Error('The agent computer is not running. Start it first.');
    const args = ['-display', this.display, '-window', 'root'];
    if (scale > 0 && scale < 1) args.push('-resize', `${Math.round(scale * 100)}%`);
    args.push('png:-');
    const { stdout } = await execFileP('import', args, { env: this.env(), encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, timeout: 20_000 }) as unknown as { stdout: Buffer };
    return stdout;
  }

  async cursor(): Promise<{ x: number; y: number }> {
    const out = await this.xdo(['getmouselocation', '--shell']);
    const x = Number(out.match(/X=(\d+)/)?.[1] ?? 0);
    const y = Number(out.match(/Y=(\d+)/)?.[1] ?? 0);
    return { x, y };
  }

  private clamp(x?: number, y?: number) {
    const cx = Math.max(0, Math.min(this.o.width - 1, Math.round(Number(x ?? 0))));
    const cy = Math.max(0, Math.min(this.o.height - 1, Math.round(Number(y ?? 0))));
    return [String(cx), String(cy)];
  }

  async action(a: ActionInput): Promise<{ ok: boolean; message: string; cursor?: { x: number; y: number } }> {
    if (!['start', 'status', 'wait'].includes(a.action) && !(await this.xRunning())) throw new Error('The agent computer is not running. Start it first.');
    const moveIf = async () => { if (a.x !== undefined && a.y !== undefined) await this.xdo(['mousemove', '--sync', ...this.clamp(a.x, a.y)]); };
    switch (a.action) {
      case 'mouse_move': await moveIf(); break;
      case 'left_click': await moveIf(); await this.xdo(['click', '1']); break;
      case 'right_click': await moveIf(); await this.xdo(['click', '3']); break;
      case 'middle_click': await moveIf(); await this.xdo(['click', '2']); break;
      case 'double_click': await moveIf(); await this.xdo(['click', '--repeat', '2', '--delay', '80', '1']); break;
      case 'triple_click': await moveIf(); await this.xdo(['click', '--repeat', '3', '--delay', '80', '1']); break;
      case 'left_click_drag': {
        await moveIf();
        await this.xdo(['mousedown', '1']);
        await this.xdo(['mousemove', '--sync', ...this.clamp(a.toX, a.toY)]);
        await this.xdo(['mouseup', '1']);
        break;
      }
      case 'type': {
        const text = String(a.text ?? '');
        for (let i = 0; i < text.length; i += 200) await this.xdo(['type', '--delay', '8', '--', text.slice(i, i + 200)]);
        break;
      }
      case 'key': for (const k of toXdoKeys(String(a.keys ?? a.text ?? ''))) await this.xdo(['key', '--', k]); break;
      case 'scroll': {
        await moveIf();
        const btn = { up: '4', down: '5', left: '6', right: '7' }[a.direction ?? 'down'];
        await this.xdo(['click', '--repeat', String(Math.max(1, Math.min(a.amount ?? 3, 30))), '--delay', '30', btn]);
        break;
      }
      case 'wait': await wait(Math.min((a.seconds ?? 1) * 1000, 30_000)); break;
      case 'cursor_position': break;
      case 'open_url': {
        if (!a.url || !/^https?:\/\//i.test(a.url)) throw new Error('open_url needs an http(s) url');
        await this.startBrowser(a.url);
        await wait(800);
        break;
      }
      case 'open_app': {
        const app = (a.app ?? 'browser').toLowerCase();
        if (app === 'browser' || app === 'chromium') await this.startBrowser();
        else if (app === 'terminal' || app === 'xterm') this.spawnBg(`term${Date.now()}`, 'xterm', ['-fa', 'DejaVu Sans Mono', '-fs', '11', '-bg', '#0f1419', '-fg', '#d8dee9', '-geometry', '110x32+60+60', '-e', 'bash', '-l']);
        else if (app === 'files' || app === 'file manager') this.spawnBg(`files${Date.now()}`, 'pcmanfm', [this.o.home]);
        else throw new Error(`Unknown app ${app}. Use browser, terminal or files.`);
        await wait(700);
        break;
      }
      default: throw new Error(`Unknown action ${a.action}`);
    }
    const cursor = await this.cursor().catch(() => undefined);
    return { ok: true, message: `${a.action} done`, cursor };
  }
}
