import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeAether } from './helpers.js';
import { createApp } from '../src/server.js';
import type { Aether } from '../src/types.js';

let a: Aether; let cleanup: () => Promise<void>; let app: ReturnType<typeof createApp>; let auth: Record<string, string>;
beforeAll(async () => { ({ a, cleanup } = await makeAether()); app = createApp(a); auth = { authorization: `Bearer ${a.config.token}`, 'content-type': 'application/json' }; });
afterAll(async () => { await cleanup(); });

const readSse = async (res: Response) => (await res.text()).split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)));

describe('HTTP API', () => {
  it('health is public; everything else needs the owner token', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/api/state')).status).toBe(401);
    expect((await app.request('/api/state', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    const ok = await app.request('/api/state', { headers: auth });
    expect(ok.status).toBe(200);
    const s = await ok.json();
    expect(s.conversation.id).toBe('main');
    expect(s.plugins.length).toBeGreaterThan(10);
  });
  it('streams a chat turn as SSE', async () => {
    const res = await app.request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ text: 'set brightness to 40%' }) });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const evs = await readSse(res);
    expect(evs[0].type).toBe('turn.start');
    expect(evs.some((e) => e.type === 'tool.end' && e.ok)).toBe(true);
    expect(evs.at(-1).type).toBe('turn.end');
    expect((await a.apps.snapshot()).device.brightness).toBe(0.4);
  });
  it('never returns secret values', async () => {
    await app.request('/api/secrets/OPENAI_API_KEY', { method: 'PUT', headers: auth, body: JSON.stringify({ value: 'sk-test-abcdef123456' }) });
    const list = await (await app.request('/api/secrets', { headers: auth })).text();
    expect(list).toContain('OPENAI_API_KEY');
    expect(list).not.toContain('sk-test-abcdef123456');
  });
  it('rejects unsigned Twilio webhooks and accepts capability-token ones', async () => {
    const bad = await app.request('/api/hooks/twilio/voice', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'CallSid=CA1&From=%2B1555' });
    expect(bad.status).toBe(403);
    const call = await a.phone.create({ provider: 'twilio', direction: 'out', to: '+15550001111', goal: 'say hi', mode: 'notify' });
    const t = a.phone.callToken(call.id);
    const good = await app.request(`/api/hooks/twilio/voice?callId=${call.id}&t=${t}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'CallSid=CA1&CallStatus=in-progress' });
    expect(good.status).toBe(200);
    expect(await good.text()).toContain('<Response>');
  });
  it('accepts inbound mail on the webhook only with the shared key', async () => {
    await a.vault.set('EMAIL_WEBHOOK_SECRET', 'k3y');
    const raw = 'From: a@b.com\r\nTo: aether@aether.local\r\nSubject: Hook\r\nMessage-ID: <x1@b.com>\r\n\r\nYour code is 551199';
    expect((await app.request('/api/hooks/email/inbound?key=nope', { method: 'POST', headers: { 'content-type': 'message/rfc822' }, body: raw })).status).toBe(403);
    const r = await app.request('/api/hooks/email/inbound?key=k3y', { method: 'POST', headers: { 'content-type': 'message/rfc822' }, body: raw });
    expect((await r.json()).ok).toBe(true);
    const [m] = await a.email.list({ folder: 'inbox', q: 'Hook' });
    expect(m.codes).toEqual(['551199']);
  });
});
