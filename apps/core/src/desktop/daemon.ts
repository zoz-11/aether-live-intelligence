#!/usr/bin/env node
/**
 * aether-desktopd — runs inside the agent computer (Docker desktop image or any Linux host with Xvfb).
 * REST API: /health, /start, /stop, /screenshot, /action, /exec, /fs, /proc. Optional shared token.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Desktop } from './desktop.js';
import { Workspace } from '../dev/workspace.js';

export interface DaemonOptions {
  port: number;
  host: string;
  token: string | null;
  display: number;
  width: number;
  height: number;
  vncPort: number;
  cdpPort: number;
  home: string;
  vncLocalhostOnly: boolean;
  autoStart: boolean;
}

export function daemonOptionsFromEnv(): DaemonOptions {
  const home = process.env.DESKTOP_HOME ?? join(homedir(), 'workspace');
  return {
    port: Number(process.env.DESKTOPD_PORT ?? 9990),
    host: process.env.DESKTOPD_HOST ?? '127.0.0.1',
    token: process.env.DESKTOPD_TOKEN || null,
    display: Number(process.env.DESKTOP_DISPLAY ?? 99),
    width: Number(process.env.DESKTOP_WIDTH ?? 1280),
    height: Number(process.env.DESKTOP_HEIGHT ?? 800),
    vncPort: Number(process.env.DESKTOP_VNC_PORT ?? 5900),
    cdpPort: Number(process.env.DESKTOP_CDP_PORT ?? 9222),
    home,
    vncLocalhostOnly: (process.env.DESKTOP_VNC_LOCALHOST ?? '1') !== '0',
    autoStart: (process.env.DESKTOP_AUTOSTART ?? '0') === '1',
  };
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 25 * 1024 * 1024) throw new Error('body too large'); chunks.push(c as Buffer); }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function authorized(req: IncomingMessage, token: string | null) {
  if (!token) return true;
  const got = String(req.headers['x-desktop-token'] ?? '');
  const a = Buffer.from(got), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startDaemon(o: DaemonOptions) {
  const desktop = new Desktop({ display: o.display, width: o.width, height: o.height, vncPort: o.vncPort, cdpPort: o.cdpPort, home: o.home, vncLocalhostOnly: o.vncLocalhostOnly });
  const ws = new Workspace(o.home, { DISPLAY: `:${o.display}` });
  await ws.init();
  if (o.autoStart) desktop.start().catch((e) => console.error('[desktopd] autostart failed:', e.message));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname === '/health') return send(res, 200, { ok: true, ...(await desktop.status()) });
      if (!authorized(req, o.token)) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/screenshot') {
        const scale = Number(url.searchParams.get('scale') ?? 1);
        const png = await desktop.screenshot(scale);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        return res.end(png);
      }
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
      const b = await body(req);
      switch (url.pathname) {
        case '/start': return send(res, 200, await desktop.start());
        case '/stop': return send(res, 200, await desktop.stop());
        case '/action': {
          const r = await desktop.action(b);
          let screenshot: string | undefined;
          if (b.screenshot) screenshot = (await desktop.screenshot(Number(b.scale ?? 0.6))).toString('base64');
          return send(res, 200, { ...r, screenshot });
        }
        case '/exec': return send(res, 200, await ws.exec(String(b.cmd ?? ''), { cwd: b.cwd, timeoutMs: b.timeoutMs, env: b.env }));
        case '/fs': {
          switch (b.op) {
            case 'list': return send(res, 200, { entries: await ws.list(b.path ?? '.', b.depth ?? 1) });
            case 'read': return send(res, 200, await ws.read(b.path, b.maxBytes));
            case 'readBase64': return send(res, 200, { base64: (await ws.readBuffer(b.path)).toString('base64') });
            case 'write': return send(res, 200, await ws.write(b.path, b.base64 ? Buffer.from(b.base64, 'base64') : String(b.content ?? ''), !!b.append));
            case 'delete': return send(res, 200, await ws.remove(b.path));
            case 'move': return send(res, 200, await ws.move(b.from, b.to));
            case 'search': return send(res, 200, { hits: await ws.search(String(b.query ?? ''), b.path ?? '.') });
            case 'download': return send(res, 200, await ws.download(String(b.url), b.path));
            default: return send(res, 400, { error: `unknown fs op ${b.op}` });
          }
        }
        case '/proc': {
          switch (b.op) {
            case 'start': return send(res, 200, await ws.start(String(b.cmd), { cwd: b.cwd, env: b.env, name: b.name }));
            case 'list': return send(res, 200, { processes: ws.processes() });
            case 'logs': return send(res, 200, ws.logs(String(b.id), b.tail));
            case 'stop': return send(res, 200, ws.stop(String(b.id)));
            default: return send(res, 400, { error: `unknown proc op ${b.op}` });
          }
        }
        default: return send(res, 404, { error: 'not found' });
      }
    } catch (e: any) {
      return send(res, 500, { error: String(e?.message ?? e) });
    }
  });
  await new Promise<void>((resolve) => server.listen(o.port, o.host, resolve));
  const close = async () => { ws.stopAll(); await desktop.stop(); await new Promise((r) => server.close(() => r(null))); };
  return { server, desktop, workspace: ws, close };
}

const isMain = process.argv[1] && /daemon\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const o = daemonOptionsFromEnv();
  startDaemon(o).then(() => {
    console.log(`[desktopd] listening on http://${o.host}:${o.port} (display :${o.display}, ${o.width}x${o.height}, home ${o.home})`);
  }).catch((e) => { console.error('[desktopd] failed to start:', e); process.exit(1); });
  const stop = () => process.exit(0);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
