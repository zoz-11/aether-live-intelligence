import type { Aether, Plugin, ToolContext, ToolResult } from '../types.js';
import { BrowserController } from '../desktop/browser.js';
import { Workspace, isReadOnlyCommand } from '../dev/workspace.js';

const SHOT_SCALE = 0.8;

function fmtExec(r: { code: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number }) {
  return `exit ${r.code}${r.timedOut ? ' (timed out)' : ''} in ${r.durationMs}ms\n${r.stdout ? '--- stdout ---\n' + r.stdout : ''}${r.stderr ? '\n--- stderr ---\n' + r.stderr : ''}`.trim();
}

let localWs: Workspace | null = null;
async function local(a: Aether) {
  if (!localWs) { localWs = new Workspace(a.config.workspaceDir); await localWs.init(); }
  return localWs;
}

/** Dev work runs inside the remote agent computer when one is configured, else in Core's workspace (same folder as the local desktop). */
async function useRemote(a: Aether) {
  const s = (await a.settings.get()).computer;
  return s.provider === 'remote' && a.plugins.isEnabled('computer') && (await a.computer.reachable());
}

export const devPlugin: Plugin = {
  id: 'dev',
  name: 'Dev Right Hand',
  description: 'Files, shell, background processes, package installs, git and downloads inside the agent workspace — behind approvals.',
  category: 'dev',
  defaultEnabled: true,
  tools: (a) => [
    {
      name: 'files',
      description: 'Workspace files. action=list(path,depth) | read(path) | write(path,content) | append(path,content) | move(path,to) | delete(path) (moves to .trash) | search(query,path) | download(url,path?). Paths are relative to the workspace root.',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'read', 'write', 'append', 'move', 'delete', 'search', 'download'] }, path: { type: 'string' }, to: { type: 'string' }, content: { type: 'string' }, query: { type: 'string' }, url: { type: 'string' }, depth: { type: 'number' } }, required: ['action'] },
      risk: (x) => (['list', 'read', 'search'].includes(x?.action) ? 'read' : x?.action === 'delete' || x?.action === 'download' ? 'danger' : 'write'),
      describe: (x) => x.action === 'download' ? `Download ${x.url}` : `${x.action} ${x.path ?? x.query ?? ''}${x.to ? ' → ' + x.to : ''}`,
      async run(x, ctx) {
        const remote = await useRemote(a);
        const ws = remote ? null : await local(a);
        const call = async (op: string, args: Record<string, unknown>) => (remote ? a.computer.fs(op, args) : null);
        switch (x.action) {
          case 'list': {
            const entries = remote ? (await call('list', { path: x.path ?? '.', depth: x.depth ?? 1 })).entries : await ws!.list(x.path ?? '.', x.depth ?? 1);
            return { ok: true, content: entries.length ? entries.map((e: any) => `${e.type === 'dir' ? 'd' : '-'} ${e.path}${e.type === 'file' ? ` (${e.size} B)` : ''}`).join('\n') : '(empty)', data: entries };
          }
          case 'read': {
            const r = remote ? await call('read', { path: x.path }) : await ws!.read(x.path);
            return { ok: true, content: r.binary ? `${x.path} is a binary file (${r.size} bytes).` : `${r.text}${r.truncated ? '\n…(truncated)' : ''}` };
          }
          case 'write': case 'append': {
            const r = remote ? await call('write', { path: x.path, content: x.content ?? '', append: x.action === 'append' }) : await ws!.write(x.path, x.content ?? '', x.action === 'append');
            a.bus.publish('files.changed', { path: r.path });
            return { ok: true, content: `Wrote ${r.path} (${r.size} bytes).` };
          }
          case 'move': { const r = remote ? await call('move', { from: x.path, to: x.to }) : await ws!.move(x.path, x.to); a.bus.publish('files.changed', r); return { ok: true, content: `Moved ${r.from} → ${r.to}.` }; }
          case 'delete': { const r = remote ? await call('delete', { path: x.path }) : await ws!.remove(x.path); a.bus.publish('files.changed', r); return { ok: true, content: `Moved ${x.path} to the trash (${r.trashed}). It can be restored.` }; }
          case 'search': {
            const hits = remote ? (await call('search', { query: x.query, path: x.path ?? '.' })).hits : await ws!.search(String(x.query ?? ''), x.path ?? '.');
            return { ok: true, content: hits.length ? hits.map((h: any) => `${h.path}:${h.line} ${h.text}`).join('\n') : 'No matches.' };
          }
          case 'download': {
            const r = remote ? await call('download', { url: x.url, path: x.path }) : await ws!.download(String(x.url), x.path, undefined, ctx.signal);
            a.bus.publish('files.changed', r);
            return { ok: true, content: `Downloaded ${x.url} → ${r.path} (${r.size} bytes${r.contentType ? ', ' + r.contentType : ''}).` };
          }
          default: return { ok: false, content: `Unknown action ${x.action}` };
        }
      },
    },
    {
      name: 'shell',
      description: 'Run commands in the agent workspace (bash). action=run(command,cwd?,timeoutSec?,env?) for commands that finish; start(command,name?) for long-running servers/watchers; list; logs(id); stop(id). Use for npm/pip installs, git, builds, tests. Put credentials in env as {{secret:NAME}}.',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['run', 'start', 'list', 'logs', 'stop'] }, command: { type: 'string' }, cwd: { type: 'string' }, timeoutSec: { type: 'number' }, env: { type: 'object', additionalProperties: { type: 'string' } }, id: { type: 'string' }, name: { type: 'string' } }, required: ['action'] },
      risk: (x) => (x?.action === 'list' || x?.action === 'logs' ? 'read' : x?.action === 'stop' ? 'write' : x?.action === 'run' && isReadOnlyCommand(String(x?.command ?? '')) && !x?.env ? 'read' : 'danger'),
      describe: (x) => (x.action === 'run' || x.action === 'start' ? `${x.action === 'start' ? 'Start' : 'Run'}: ${String(x.command ?? '').slice(0, 160)}` : `shell ${x.action} ${x.id ?? ''}`),
      resolveSecrets: true,
      async run(x, ctx) {
        const remote = await useRemote(a);
        const ws = remote ? null : await local(a);
        switch (x.action) {
          case 'run': {
            if (!x.command) return { ok: false, content: 'command is required' };
            const opts = { cwd: x.cwd, timeoutMs: Math.min(Number(x.timeoutSec ?? 120), 1800) * 1000, env: x.env };
            const r = remote ? await a.computer.exec(String(x.command), opts) : await ws!.exec(String(x.command), { ...opts, signal: ctx.signal });
            a.bus.publish('files.changed', {});
            return { ok: r.code === 0, content: fmtExec(r) };
          }
          case 'start': { const r = remote ? await a.computer.proc('start', { cmd: x.command, cwd: x.cwd, env: x.env, name: x.name }) : await ws!.start(String(x.command), { cwd: x.cwd, env: x.env, name: x.name }); return { ok: true, content: `Started ${r.id} (pid ${r.pid}): ${r.cmd}. Check output with shell logs ${r.id}.` }; }
          case 'list': { const list = remote ? (await a.computer.proc('list', {})).processes : ws!.processes(); return { ok: true, content: list.length ? list.map((p: any) => `${p.id} ${p.running ? 'running' : 'exited ' + p.exitCode} — ${p.cmd}`).join('\n') : 'No background processes.' }; }
          case 'logs': { const r = remote ? await a.computer.proc('logs', { id: x.id }) : ws!.logs(String(x.id)); return { ok: true, content: `${r.id} ${r.running ? 'running' : 'exited ' + r.exitCode}\n${r.log || '(no output yet)'}` }; }
          case 'stop': { remote ? await a.computer.proc('stop', { id: x.id }) : ws!.stop(String(x.id)); return { ok: true, content: `Stopped ${x.id}.` }; }
          default: return { ok: false, content: `Unknown action ${x.action}` };
        }
      },
    },
  ],
  prompt: () => 'Dev Right Hand: you can manage files, run shell commands, install packages, use git and download files in your workspace. Verify your work by running it (tests, builds, curl) before saying it works.',
};

function scaleXY(args: any) {
  const out = { ...args };
  for (const k of ['x', 'y', 'toX', 'toY']) if (typeof out[k] === 'number') out[k] = Math.round(out[k] / SHOT_SCALE);
  return out;
}

export const computerPlugin: Plugin = {
  id: 'computer',
  name: 'Agent Computer',
  description: 'Aether\'s own Linux desktop (browser, terminal, files) that you can watch live and take over.',
  category: 'computer',
  defaultEnabled: true,
  tools: (a) => [
    {
      name: 'computer',
      description: `Control your own computer (Linux desktop). Screenshots are ${Math.round(1280 * SHOT_SCALE)}x${Math.round(800 * SHOT_SCALE)}; give x/y in screenshot pixels. Actions: start, stop, status, screenshot, left_click(x,y), right_click, double_click, triple_click, mouse_move, left_click_drag(x,y,toX,toY), type(text), key(keys e.g. "ctrl+l", "Return"), scroll(x,y,direction,amount), wait(seconds), cursor_position, open_url(url), open_app(app: browser|terminal|files). After each action you get a fresh screenshot. Prefer the browser tool for web pages.`,
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'stop', 'status', 'screenshot', 'left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'mouse_move', 'left_click_drag', 'type', 'key', 'scroll', 'wait', 'cursor_position', 'open_url', 'open_app'] }, x: { type: 'number' }, y: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' }, text: { type: 'string' }, keys: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' }, seconds: { type: 'number' }, url: { type: 'string' }, app: { type: 'string' } }, required: ['action'] },
      risk: (x) => (['status', 'screenshot', 'cursor_position', 'wait', 'start'].includes(x?.action) ? 'read' : 'write'),
      describe: (x) => `Computer: ${x.action}${x.url ? ' ' + x.url : ''}${x.text ? ' “' + String(x.text).slice(0, 40) + '”' : ''}${x.keys ? ' ' + x.keys : ''}`,
      resolveSecrets: true,
      async run(x): Promise<ToolResult> {
        const c = a.computer;
        if (x.action === 'status') { const s: any = await c.status(); return { ok: true, content: JSON.stringify({ reachable: s.reachable, running: s.running, vnc: s.vnc, cdp: s.cdp, chromium: !!s.chromium }) }; }
        if (x.action === 'start') { await c.start(); const shot = await c.screenshot(SHOT_SCALE); return { ok: true, content: 'Computer is running.', images: [shot] }; }
        if (x.action === 'stop') { await c.stop(); return { ok: true, content: 'Computer stopped.' }; }
        await c.ready();
        if (x.action === 'screenshot') { const shot = await c.screenshot(SHOT_SCALE); return { ok: true, content: 'Screenshot of your computer attached.', images: [shot] }; }
        const r = await c.action({ ...scaleXY(x), screenshot: true, scale: SHOT_SCALE });
        const cursor = r.cursor ? ` Cursor at (${Math.round(r.cursor.x * SHOT_SCALE)}, ${Math.round(r.cursor.y * SHOT_SCALE)}).` : '';
        return { ok: true, content: `${r.message}.${cursor}`, images: r.screenshot ? [{ mime: 'image/png', base64: r.screenshot }] : undefined };
      },
    },
  ],
  prompt: async (a) => {
    const s: any = await a.computer.status().catch(() => ({ reachable: false }));
    return `Agent Computer: you have your own Linux computer (${s.reachable && s.running ? 'running' : 'not running — it starts automatically when you use it'}). The owner can watch it live in the Computer app and take over.`;
  },
  status: (a) => a.computer.status(),
};

let browser: BrowserController | null = null;

export const browserPlugin: Plugin = {
  id: 'browser',
  name: 'Browser',
  description: 'Fast, reliable web control in the agent computer\'s Chromium via CDP with an indexed element snapshot.',
  category: 'computer',
  defaultEnabled: true,
  tools: (a) => [
    {
      name: 'browser',
      description: 'Use the Chromium browser on your computer. navigate(url) returns a snapshot with numbered elements like [12]. Then click(id), type(id,text,submit?), select(id,value), press(keys), scroll(direction,amount), back, reload, extract (full page text), screenshot, tabs, switch_tab(index), new_tab(url?). Always snapshot again after the page changes. For logins use {{secret:NAME}} in text.',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['navigate', 'snapshot', 'click', 'type', 'select', 'press', 'scroll', 'back', 'reload', 'extract', 'screenshot', 'tabs', 'switch_tab', 'new_tab'] }, url: { type: 'string' }, id: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' }, value: { type: 'string' }, keys: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' }, index: { type: 'number' } }, required: ['action'] },
      risk: (x) => (['snapshot', 'extract', 'screenshot', 'tabs'].includes(x?.action) ? 'read' : 'write'),
      describe: (x) => `Browser: ${x.action}${x.url ? ' ' + x.url : ''}${x.id ? ' [' + x.id + ']' : ''}${x.text ? ' “' + String(x.text).slice(0, 40) + '”' : ''}`,
      resolveSecrets: true,
      async run(x): Promise<ToolResult> {
        await a.computer.ready();
        if (!browser) browser = new BrowserController(() => a.computer.cdpUrl());
        const b = browser;
        const url = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
        switch (x.action) {
          case 'navigate': return { ok: true, content: await b.navigate(url(String(x.url ?? ''))) };
          case 'snapshot': return { ok: true, content: await b.snapshot() };
          case 'click': return { ok: true, content: await b.click(Number(x.id)) };
          case 'type': return { ok: true, content: await b.type(Number(x.id), String(x.text ?? ''), !!x.submit) };
          case 'select': return { ok: true, content: await b.select(Number(x.id), String(x.value ?? '')) };
          case 'press': return { ok: true, content: await b.press(String(x.keys ?? 'Enter')) };
          case 'scroll': return { ok: true, content: await b.scroll(x.direction === 'up' ? 'up' : 'down', Number(x.amount ?? 1)) };
          case 'back': return { ok: true, content: await b.back() };
          case 'reload': return { ok: true, content: await b.reload() };
          case 'extract': return { ok: true, content: await b.extract() };
          case 'screenshot': return { ok: true, content: 'Browser screenshot attached.', images: [await b.screenshot()] };
          case 'tabs': return { ok: true, content: await b.tabs() };
          case 'switch_tab': return { ok: true, content: await b.switchTab(Number(x.index ?? 0)) };
          case 'new_tab': return { ok: true, content: await b.newTab(x.url ? url(String(x.url)) : undefined) };
          default: return { ok: false, content: `Unknown action ${x.action}` };
        }
      },
    },
  ],
  teardown: async () => { await browser?.close(); browser = null; },
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

async function webSearch(a: Aether, q: string, signal?: AbortSignal): Promise<{ title: string; url: string; snippet: string }[]> {
  const brave = await a.vault.get('BRAVE_API_KEY');
  if (brave) {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`, { headers: { 'X-Subscription-Token': brave, accept: 'application/json' }, signal });
    const j: any = await r.json();
    return (j.web?.results ?? []).map((x: any) => ({ title: x.title, url: x.url, snippet: htmlToText(x.description ?? '') }));
  }
  const tavily = await a.vault.get('TAVILY_API_KEY');
  if (tavily) {
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: tavily, query: q, max_results: 8 }), signal });
    const j: any = await r.json();
    return (j.results ?? []).map((x: any) => ({ title: x.title, url: x.url, snippet: x.content?.slice(0, 300) ?? '' }));
  }
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html' }, signal });
  const html = await res.text();
  const out: { title: string; url: string; snippet: string }[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 8) {
    let url = m[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    out.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3] ?? '') });
  }
  return out;
}

export const webPlugin: Plugin = {
  id: 'web',
  name: 'Web',
  description: 'Web search (keyless fallback, Brave or Tavily with keys), page fetch to readable text, and HTTP requests with secret placeholders.',
  category: 'core',
  defaultEnabled: true,
  secrets: ['BRAVE_API_KEY', 'TAVILY_API_KEY'],
  tools: (a) => [
    {
      name: 'web',
      description: 'action=search(query) returns results; fetch(url) returns readable page text; request(method,url,headers?,body?) for APIs (use {{secret:NAME}} in headers). Cite URLs you used.',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['search', 'fetch', 'request'] }, query: { type: 'string' }, url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, body: { type: 'string' } }, required: ['action'] },
      risk: (x) => (x?.action === 'request' && String(x?.method ?? 'GET').toUpperCase() !== 'GET' ? 'danger' : 'read'),
      describe: (x) => (x.action === 'search' ? `Search: ${x.query}` : `${(x.method ?? 'GET').toUpperCase()} ${x.url}`),
      resolveSecrets: true,
      async run(x, ctx: ToolContext): Promise<ToolResult> {
        if (x.action === 'search') {
          const results = await webSearch(a, String(x.query ?? ''), ctx.signal);
          if (!results.length) return { ok: false, content: 'No results (the keyless search may be rate limited; add BRAVE_API_KEY or TAVILY_API_KEY in the vault, or use the browser tool).' };
          return { ok: true, content: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n'), card: { type: 'links', title: `Results: ${x.query}`, links: results.slice(0, 6).map((r) => ({ title: r.title, url: r.url, note: r.snippet.slice(0, 120) })) } };
        }
        if (x.action === 'fetch') {
          const res = await fetch(String(x.url), { headers: { 'user-agent': 'Mozilla/5.0 AetherAgent/1.0' }, signal: ctx.signal, redirect: 'follow' });
          const type = res.headers.get('content-type') ?? '';
          const raw = await res.text();
          const text = type.includes('html') ? htmlToText(raw) : raw;
          return { ok: res.ok, content: `HTTP ${res.status} ${res.url}\n\n${text.slice(0, 15000)}` };
        }
        const res = await fetch(String(x.url), { method: String(x.method ?? 'GET').toUpperCase(), headers: x.headers, body: x.body, signal: ctx.signal });
        const t = await res.text();
        return { ok: res.ok, content: `HTTP ${res.status}\n${t.slice(0, 15000)}` };
      },
    },
  ],
};
