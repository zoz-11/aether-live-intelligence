import { createConnection } from 'node:net';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { timingSafeEqual, randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import type { Aether, ClientContext } from './types.js';
import { PROVIDERS } from './models/gateway.js';
import { COLLECTIONS, type Collection } from './plugins/apps-store.js';
import { runAppTool } from './plugins/apps/index.js';
import { Workspace } from './dev/workspace.js';
import { transcribe, synthesize } from './voice.js';
import { Vault } from './vault.js';
import { log } from './util.js';

const l = log('http');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.gif': 'image/gif',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.map': 'application/json', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf',
};

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function tokenFrom(c: Context): string {
  const h = c.req.header('authorization') ?? '';
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return c.req.query('token') ?? '';
}

/** Streams JSON events as SSE. */
function sse(start: (send: (data: unknown) => void, close: () => void) => (() => void) | void | Promise<(() => void) | void>): Response {
  let cleanup: (() => void) | void;
  let hb: NodeJS.Timeout;
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (d: unknown) => { if (closed) return; try { controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch { closed = true; } };
      const close = () => { if (closed) return; closed = true; clearInterval(hb); try { controller.close(); } catch { /* closed */ } cleanup?.(); };
      hb = setInterval(() => { if (!closed) { try { controller.enqueue(enc.encode(': ping\n\n')); } catch { closed = true; } } }, 15000);
      controller.enqueue(enc.encode(': ok\n\n'));
      cleanup = await start(send, close);
    },
    cancel() { closed = true; clearInterval(hb); cleanup?.(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}

export function createApp(a: Aether) {
  const app = new Hono();
  const localWs = new Workspace(a.config.workspaceDir);
  void localWs.init();

  app.onError((err, c) => {
    l.warn(`${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json({ error: err.message }, (err as any).status ?? 500);
  });

  app.use('*', cors({ origin: (o) => o || '*', allowHeaders: ['Authorization', 'Content-Type', 'X-Visitor-Id'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], maxAge: 600 }));

  app.use('/api/*', async (c, next) => {
    const p = c.req.path;
    if (p === '/api/health' || p.startsWith('/api/hooks/') || a.config.authMode === 'off') return next();
    const t = tokenFrom(c);
    if (!t || !safeEqual(t, a.config.token)) return c.json({ error: 'unauthorized', hint: 'Use the owner token printed by Aether Core at startup (Settings → Connection).' }, 401);
    return next();
  });

  const body = async <T = any>(c: Context): Promise<T> => { try { return (await c.req.json()) as T; } catch { return {} as T; } };

  // ---------- health & state ----------
  app.get('/api/health', (c) => c.json({ ok: true, name: 'aether-core', version: a.config.version, auth: a.config.authMode, uptimeSec: Math.round((Date.now() - a.startedAt.getTime()) / 1000) }));

  app.get('/api/state', async (c) => {
    const [settings, model, plugins, apps, messages, approvals, tasks, email, phone, secrets, skills] = await Promise.all([
      a.settings.get(), a.models.describe(), a.plugins.list(false), a.apps.snapshot(), a.conversations.messages('main', { limit: 80 }),
      a.sentinel.pending(), a.tasks.list(40), a.email.status(), a.phone.status(), a.vault.list(), a.skills.list(),
    ]);
    return c.json({ version: a.config.version, auth: a.config.authMode, settings, model, providers: PROVIDERS, plugins, apps, conversation: { id: 'main', messages }, approvals, tasks, email, phone, secrets: secrets.map((s) => ({ name: s.name, description: s.description, updated_at: s.updated_at })), skills: skills.map((s) => ({ name: s.name, description: s.description, source: s.source })) });
  });

  // ---------- chat ----------
  app.post('/api/chat', async (c) => {
    const b = await body<{ text?: string; conversationId?: string; channel?: 'text' | 'voice'; client?: ClientContext; images?: { mime: string; base64: string }[] }>(c);
    const text = String(b.text ?? '').trim();
    if (!text && !b.images?.length) return c.json({ error: 'text is required' }, 400);
    const conversationId = b.conversationId || 'main';
    if (!(await a.conversations.get(conversationId))) return c.json({ error: 'conversation not found' }, 404);
    return sse((send, close) => {
      a.agent.run({ conversationId, text: text || '(image)', channel: b.channel === 'voice' ? 'voice' : 'text', client: b.client, images: b.images?.slice(0, 4), onEvent: send })
        .catch((e) => send({ type: 'error', message: String(e?.message ?? e) }))
        .finally(close);
    });
  });

  app.post('/api/chat/:turnId/cancel', (c) => c.json({ cancelled: a.agent.cancel(c.req.param('turnId')) }));

  app.get('/api/events', () => sse((send) => a.bus.subscribe((ev) => send(ev))));

  // ---------- conversations ----------
  app.get('/api/conversations', async (c) => c.json(await a.conversations.list((c.req.query('kind') as any) || 'chat')));
  app.post('/api/conversations', async (c) => { const b = await body(c); return c.json(await a.conversations.create(b.title ?? null, 'chat')); });
  app.get('/api/conversations/:id/messages', async (c) => {
    const before = c.req.query('before');
    return c.json(await a.conversations.messages(c.req.param('id'), { limit: Number(c.req.query('limit') ?? 100), beforeSeq: before ? Number(before) : undefined }));
  });
  app.patch('/api/conversations/:id', async (c) => { const b = await body(c); await a.conversations.rename(c.req.param('id'), String(b.title ?? '')); return c.json({ ok: true }); });
  app.delete('/api/conversations/:id', async (c) => { await a.conversations.remove(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- approvals & grants ----------
  app.get('/api/approvals', async (c) => c.json({ pending: await a.sentinel.pending(), recent: await a.sentinel.recent(40) }));
  app.post('/api/approvals/:id', async (c) => { const b = await body(c); return c.json(await a.sentinel.decide(c.req.param('id'), b.decision, { input: b.input, via: 'app' })); });
  app.get('/api/grants', async (c) => c.json(await a.sentinel.grants()));
  app.delete('/api/grants/:id', async (c) => { await a.sentinel.revoke(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- plugins, settings, models, secrets ----------
  app.get('/api/plugins', async (c) => c.json(await a.plugins.list(c.req.query('status') === '1')));
  app.patch('/api/plugins/:id', async (c) => { const b = await body(c); await a.plugins.setEnabled(c.req.param('id'), !!b.enabled); return c.json(await a.plugins.list(false)); });
  app.get('/api/settings', async (c) => c.json(await a.settings.get()));
  app.patch('/api/settings', async (c) => {
    const b = await body(c);
    const prev = await a.settings.get();
    const next = await a.settings.patch(b);
    await a.activity.add('settings', 'Settings changed', { keys: Object.keys(b) });
    if (b.email && a.plugins.isEnabled('email')) a.email.restart().catch(() => undefined);
    if (b.telegram === undefined && JSON.stringify(prev.notifications) !== JSON.stringify(next.notifications)) { /* nothing to restart */ }
    return c.json(next);
  });
  app.get('/api/models', async (c) => c.json({ current: await a.models.describe(), providers: PROVIDERS }));
  app.post('/api/models/test', async (c) => {
    const p = await a.models.provider();
    const started = Date.now();
    const r = await p.chat({ system: 'Reply with exactly: ok', messages: [{ role: 'user', content: 'ping' }], tools: [], maxTokens: 20 });
    return c.json({ ok: true, provider: p.id, model: p.model, reply: r.text.slice(0, 100), ms: Date.now() - started, notice: (p as any).notice });
  });
  app.get('/api/secrets', async (c) => c.json(await a.vault.list()));
  app.put('/api/secrets/:name', async (c) => {
    const name = c.req.param('name').toUpperCase();
    if (!Vault.validName(name)) return c.json({ error: 'Use UPPER_SNAKE_CASE names' }, 400);
    const b = await body(c);
    await a.vault.set(name, String(b.value ?? ''), b.description);
    await a.activity.add('secret', `Secret ${name} saved`);
    if (name === 'TELEGRAM_BOT_TOKEN' && a.plugins.isEnabled('telegram')) { a.telegram.stop(); a.telegram.start().catch(() => undefined); }
    a.bus.publish('secrets.changed', null);
    return c.json({ ok: true });
  });
  app.delete('/api/secrets/:name', async (c) => { await a.vault.delete(c.req.param('name')); a.bus.publish('secrets.changed', null); return c.json({ ok: true }); });

  // ---------- memory ----------
  app.get('/api/memory', async (c) => c.json({ files: await a.memory.files(), facts: await a.memory.facts(1000) }));
  app.put('/api/memory/files/:name', async (c) => { const b = await body(c); await a.memory.setFile(c.req.param('name'), String(b.content ?? '')); return c.json({ ok: true }); });
  app.post('/api/memory/facts', async (c) => { const b = await body(c); return c.json(await a.memory.addFact(String(b.text ?? ''), b.kind ?? 'note', 'owner', !!b.pinned)); });
  app.patch('/api/memory/facts/:id', async (c) => { const b = await body(c); await a.memory.updateFact(c.req.param('id'), b); return c.json({ ok: true }); });
  app.delete('/api/memory/facts/:id', async (c) => { await a.memory.removeFact(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/memory/forget', async (c) => { const b = await body(c); return c.json({ removed: await a.memory.forget(String(b.query ?? '')) }); });
  app.post('/api/memory/search', async (c) => { const b = await body(c); return c.json(await a.memory.search(String(b.query ?? ''), 12)); });
  app.post('/api/memory/reset', async (c) => { await a.memory.reset(); await a.activity.add('memory', 'Memory reset by owner'); return c.json({ ok: true }); });
  app.get('/api/memory/export', async (c) => c.body(await a.memory.exportMarkdown(), 200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="aether-memory.md"' }));

  // ---------- device apps ----------
  app.get('/api/apps', async (c) => c.json(await a.apps.snapshot()));
  app.post('/api/apps/tool', async (c) => { const b = await body(c); const r = await runAppTool(a, String(b.name), b.args ?? {}); await a.activity.add('app', `Owner: ${b.name}`, { args: b.args, ok: r.ok }); return c.json(r); });
  app.patch('/api/apps/device', async (c) => c.json(await a.apps.patchDevice(await body(c))));
  app.patch('/api/apps/ui', async (c) => c.json(await a.apps.patchUi(await body(c))));
  app.put('/api/apps/:collection', async (c) => {
    const col = c.req.param('collection') as Collection;
    if (!COLLECTIONS.includes(col)) return c.json({ error: 'unknown collection' }, 404);
    const item = await body(c);
    if (!item?.id) return c.json({ error: 'id required' }, 400);
    return c.json(await a.apps.upsert(col, item));
  });
  app.delete('/api/apps/:collection/:id', async (c) => {
    const col = c.req.param('collection') as Collection;
    if (!COLLECTIONS.includes(col)) return c.json({ error: 'unknown collection' }, 404);
    await a.apps.remove(col, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/api/geocode', async (c) => {
    const q = c.req.query('q') ?? '';
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Aether/1.0 (personal agent)' } });
    const rows: any[] = res.ok ? await res.json() : [];
    if (!rows[0]) return c.json({ ok: false, error: 'Place not found' });
    return c.json({ ok: true, lat: Number(rows[0].lat), lon: Number(rows[0].lon), label: rows[0].display_name });
  });

  // ---------- activity ----------
  app.get('/api/activity', async (c) => { const before = c.req.query('before'); return c.json(await a.activity.list(Number(c.req.query('limit') ?? 150), before ? Number(before) : undefined)); });

  // ---------- tasks ----------
  app.get('/api/tasks', async (c) => c.json(await a.tasks.list(100)));
  app.post('/api/tasks', async (c) => { const b = await body(c); return c.json(await a.tasks.create({ title: String(b.title ?? b.goal ?? 'Task'), goal: String(b.goal ?? b.title ?? ''), when: b.when, cron: b.cron, kind: b.kind, origin: 'owner' })); });
  app.post('/api/tasks/:id/:op', async (c) => {
    const id = c.req.param('id');
    switch (c.req.param('op')) {
      case 'pause': return c.json(await a.tasks.pause(id));
      case 'resume': return c.json(await a.tasks.resume(id));
      case 'cancel': return c.json(await a.tasks.cancel(id));
      case 'run': return c.json(await a.tasks.runNow(id));
      default: return c.json({ error: 'unknown op' }, 400);
    }
  });
  app.delete('/api/tasks/:id', async (c) => { await a.tasks.remove(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- email ----------
  app.get('/api/email', async (c) => c.json(await a.email.list({ folder: (c.req.query('folder') as any) || 'all', q: c.req.query('q') || undefined, limit: Number(c.req.query('limit') ?? 100) })));
  app.get('/api/email/status', async (c) => c.json(await a.email.status()));
  app.get('/api/email/:id', async (c) => { const m = await a.email.get(c.req.param('id')); return m ? c.json(m) : c.json({ error: 'not found' }, 404); });
  app.post('/api/email/send', async (c) => { const b = await body(c); return c.json(await a.email.send({ to: b.to, cc: b.cc, subject: String(b.subject ?? ''), text: String(b.text ?? ''), inReplyTo: b.inReplyTo })); });
  app.delete('/api/email/:id', async (c) => { await a.email.remove(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/hooks/email/inbound', async (c) => {
    const key = c.req.query('key') ?? c.req.header('x-aether-key') ?? '';
    let secret = await a.vault.get('EMAIL_WEBHOOK_SECRET');
    if (!secret) return c.json({ error: 'EMAIL_WEBHOOK_SECRET not set' }, 403);
    if (!safeEqual(key, secret)) return c.json({ error: 'forbidden' }, 403);
    const ctype = c.req.header('content-type') ?? '';
    const raw = ctype.includes('json') ? String((await body(c)).raw ?? '') : Buffer.from(await c.req.arrayBuffer());
    if (!raw || (typeof raw === 'string' && !raw.trim())) return c.json({ error: 'empty message' }, 400);
    const m = await a.email.ingestRaw(raw, 'webhook');
    return c.json({ ok: true, id: m?.id ?? null, duplicate: !m });
  });

  // ---------- phone ----------
  app.get('/api/phone/status', async (c) => c.json(await a.phone.status()));
  app.get('/api/phone/calls', async (c) => c.json(await a.phone.list(100)));
  app.get('/api/phone/calls/:id', async (c) => { const r = await a.phone.get(c.req.param('id')); return r ? c.json(r) : c.json({ error: 'not found' }, 404); });
  app.post('/api/phone/call', async (c) => { const b = await body(c); return c.json(await a.phone.call({ to: String(b.to ?? ''), goal: String(b.goal ?? b.message ?? ''), mode: b.mode, message: b.message })); });
  app.post('/api/phone/calls/:id/end', async (c) => c.json(await a.phone.end(c.req.param('id'))));
  app.get('/api/phone/sms', async (c) => c.json(await a.phone.smsList(100)));
  app.post('/api/phone/sms', async (c) => { const b = await body(c); return c.json(await a.phone.sms({ to: String(b.to ?? ''), body: String(b.body ?? '') })); });
  app.post('/api/phone/softphone', async (c) => c.json(await a.phone.softphoneStart()));
  app.post('/api/phone/softphone/:id/turn', async (c) => { const b = await body(c); return c.json(await a.phone.softphoneTurn(c.req.param('id'), String(b.text ?? ''))); });
  app.post('/api/phone/softphone/:id/end', async (c) => c.json(await a.phone.end(c.req.param('id'))));

  const twilioParams = async (c: Context) => {
    const form = await c.req.parseBody().catch(() => ({}));
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) params[k] = String(v);
    const s = await a.settings.get();
    const u = new URL(c.req.url);
    const url = `${(s.publicUrl || `${u.protocol}//${u.host}`).replace(/\/$/, '')}${u.pathname}${u.search}`;
    return { params, url, sig: c.req.header('x-twilio-signature') };
  };
  const twiml = (c: Context, x: string) => c.body(x, 200, { 'content-type': 'text/xml; charset=utf-8' });
  app.post('/api/hooks/twilio/voice', async (c) => {
    const { params, url, sig } = await twilioParams(c);
    const callId = c.req.query('callId'), t = c.req.query('t');
    if (!(await a.phone.verify(url, params, sig, callId, t))) return c.text('forbidden', 403);
    return twiml(c, await a.phone.voiceTwiml(params, callId));
  });
  app.post('/api/hooks/twilio/gather', async (c) => {
    const { params, url, sig } = await twilioParams(c);
    const callId = c.req.query('callId') ?? '', t = c.req.query('t');
    if (!(await a.phone.verify(url, params, sig, callId, t))) return c.text('forbidden', 403);
    return twiml(c, await a.phone.gatherTwiml(callId, params, c.req.query('silence') === '1'));
  });
  app.post('/api/hooks/twilio/status', async (c) => {
    const { params, url, sig } = await twilioParams(c);
    const callId = c.req.query('callId') ?? '', t = c.req.query('t');
    if (!(await a.phone.verify(url, params, sig, callId, t))) return c.text('forbidden', 403);
    await a.phone.onStatus(callId, params);
    return c.text('ok');
  });
  app.post('/api/hooks/twilio/sms', async (c) => {
    const { params, url, sig } = await twilioParams(c);
    if (!(await a.phone.verify(url, params, sig))) return c.text('forbidden', 403);
    return twiml(c, await a.phone.onInboundSms(params));
  });

  // ---------- computer ----------
  app.get('/api/computer/status', async (c) => c.json(await a.computer.status()));
  app.post('/api/computer/start', async (c) => c.json(await a.computer.start()));
  app.post('/api/computer/stop', async (c) => c.json(await a.computer.stop()));
  app.get('/api/computer/screenshot', async (c) => { const png = await a.computer.screenshotPng(Number(c.req.query('scale') ?? 1)); return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); });
  app.post('/api/computer/action', async (c) => { const b = await body(c); await a.activity.add('computer', `Owner: ${b.action}`, b); return c.json(await a.computer.action(b)); });

  // ---------- files (owner view of the agent workspace) ----------
  const fsRemote = async () => (await a.settings.get()).computer.provider === 'remote' && (await a.computer.reachable());
  app.get('/api/files', async (c) => {
    const path = c.req.query('path') ?? '.';
    const entries = (await fsRemote()) ? (await a.computer.fs('list', { path, depth: 1 })).entries : await localWs.list(path, 1);
    return c.json({ path, entries });
  });
  app.get('/api/files/read', async (c) => { const path = c.req.query('path') ?? ''; return c.json((await fsRemote()) ? await a.computer.fs('read', { path }) : await localWs.read(path)); });
  app.get('/api/files/raw', async (c) => {
    const path = c.req.query('path') ?? '';
    const buf = (await fsRemote()) ? Buffer.from((await a.computer.fs('readBase64', { path })).base64, 'base64') : await localWs.readBuffer(path);
    const name = path.split('/').pop() || 'file';
    return c.body(new Uint8Array(buf), 200, { 'content-type': MIME[extname(name).toLowerCase()] ?? 'application/octet-stream', 'content-disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename="${name.replace(/"/g, '')}"` });
  });
  app.put('/api/files', async (c) => { const b = await body(c); const r = (await fsRemote()) ? await a.computer.fs('write', { path: b.path, content: b.content ?? '' }) : await localWs.write(String(b.path), String(b.content ?? '')); a.bus.publish('files.changed', r); return c.json(r); });
  app.post('/api/files/upload', async (c) => {
    const path = c.req.query('path') ?? 'uploads/file';
    const buf = Buffer.from(await c.req.arrayBuffer());
    const r = (await fsRemote()) ? await a.computer.fs('write', { path, base64: buf.toString('base64') }) : await localWs.write(path, buf);
    a.bus.publish('files.changed', r);
    return c.json(r);
  });
  app.delete('/api/files', async (c) => { const path = c.req.query('path') ?? ''; const r = (await fsRemote()) ? await a.computer.fs('delete', { path }) : await localWs.remove(path); a.bus.publish('files.changed', r); return c.json(r); });
  app.post('/api/files/move', async (c) => { const b = await body(c); const r = (await fsRemote()) ? await a.computer.fs('move', { from: b.from, to: b.to }) : await localWs.move(String(b.from), String(b.to)); a.bus.publish('files.changed', r); return c.json(r); });

  // ---------- skills & MCP ----------
  app.get('/api/skills', async (c) => c.json(await a.skills.list()));
  app.get('/api/skills/:name', async (c) => { const r = await a.skills.read(c.req.param('name')); return r ? c.json(r) : c.json({ error: 'not found' }, 404); });
  app.post('/api/skills', async (c) => { const b = await body(c); const r = await a.skills.create(String(b.name), String(b.description ?? ''), String(b.body ?? '')); a.bus.publish('skills.changed', null); return c.json(r); });
  app.delete('/api/skills/:name', async (c) => { await a.skills.remove(c.req.param('name')); a.bus.publish('skills.changed', null); return c.json({ ok: true }); });
  app.get('/api/mcp', async (c) => c.json(await a.mcp.list()));
  app.post('/api/mcp', async (c) => { const b = await body(c); return c.json(await a.mcp.add(String(b.name), b.config)); });
  app.delete('/api/mcp/:name', async (c) => { await a.mcp.remove(c.req.param('name')); return c.json({ ok: true }); });

  // ---------- voice ----------
  app.post('/api/voice/stt', async (c) => {
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length < 200) return c.json({ error: 'audio too short' }, 400);
    return c.json(await transcribe(a, buf, c.req.header('content-type') ?? 'audio/webm'));
  });
  app.post('/api/voice/tts', async (c) => {
    const b = await body(c);
    const r = await synthesize(a, String(b.text ?? ''), b.voice);
    if (!r) return c.json({ useBrowser: true });
    return c.body(new Uint8Array(r.audio), 200, { 'content-type': r.mime, 'x-tts-provider': r.provider, 'cache-control': 'no-store' });
  });

  // ---------- notifications & channels ----------
  app.get('/api/push/vapid', async (c) => c.json({ publicKey: (await a.notify.vapid()).publicKey }));
  app.post('/api/push/subscribe', async (c) => { await a.notify.subscribe(await body(c)); return c.json({ ok: true }); });
  app.post('/api/push/unsubscribe', async (c) => { const b = await body(c); await a.notify.unsubscribe(String(b.endpoint ?? '')); return c.json({ ok: true }); });
  app.post('/api/push/test', async (c) => c.json({ via: await a.notify.send({ title: 'Aether', body: 'Notifications are working.', tag: 'test' }) }));
  app.get('/api/telegram', async (c) => c.json(await a.telegram.status()));
  app.post('/api/telegram/pairing', async (c) => {
    const code = String(randomInt(100000, 999999));
    await a.settings.patch({ telegram: { pairingCode: code } });
    if (a.plugins.isEnabled('telegram') && !a.telegram.isRunning()) await a.telegram.start();
    return c.json({ code, status: await a.telegram.status() });
  });
  app.post('/api/integrations/email-webhook', async (c) => {
    let secret = await a.vault.get('EMAIL_WEBHOOK_SECRET');
    if (!secret) { secret = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url'); await a.vault.set('EMAIL_WEBHOOK_SECRET', secret, 'Shared secret for the inbound email webhook'); }
    const s = await a.settings.get();
    return c.json({ url: `${(s.publicUrl || '').replace(/\/$/, '') || '<public-core-url>'}/api/hooks/email/inbound`, header: 'x-aether-key', note: 'The secret is stored in the vault as EMAIL_WEBHOOK_SECRET.' });
  });

  // ---------- static web app ----------
  app.get('*', (c) => {
    const dir = a.config.publicDir;
    if (!dir) return c.text('Aether Core is running. Build the web app (npm run build) or open the web app and connect it to this URL.', 200);
    let p = decodeURIComponent(new URL(c.req.url).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(dir, p));
    const inside = file.startsWith(normalize(dir));
    const target = inside && existsSync(file) && statSync(file).isFile() ? file : join(dir, 'index.html');
    const ext = extname(target).toLowerCase();
    const cache = target.includes(`${join(dir, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    return c.body(new Uint8Array(readFileSync(target)), 200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': cache });
  });

  return app;
}

/** Starts HTTP + WebSocket (VNC bridge, Twilio ConversationRelay). */
export async function startServer(a: Aether, port = a.config.port, host = a.config.host) {
  const app = createApp(a);
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port, hostname: host }, () => resolve(s as unknown as Server)) as unknown as Server;
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false) });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname === '/api/computer/vnc') {
        const t = url.searchParams.get('token') ?? '';
        if (a.config.authMode !== 'off' && !safeEqual(t, a.config.token)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
        const target = await a.computer.vncTarget();
        wss.handleUpgrade(req, socket, head, (ws) => {
          const tcp = createConnection(target.port, target.host);
          tcp.on('data', (d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
          ws.on('message', (d) => tcp.write(d as Buffer));
          const end = () => { try { tcp.destroy(); } catch { /* ignore */ } try { ws.close(); } catch { /* ignore */ } };
          tcp.on('error', end); tcp.on('close', end); ws.on('close', end); ws.on('error', end);
        });
        return;
      }
      if (url.pathname === '/api/hooks/twilio/relay') {
        const callId = url.searchParams.get('callId') ?? '';
        if (!callId || url.searchParams.get('t') !== a.phone.callToken(callId)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
        wss.handleUpgrade(req, socket, head, (ws) => a.phone.handleRelay(ws, callId));
        return;
      }
      socket.destroy();
    } catch { socket.destroy(); }
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { server, port: actualPort, close: () => new Promise<void>((r) => { wss.close(); server.close(() => r()); }) };
}
