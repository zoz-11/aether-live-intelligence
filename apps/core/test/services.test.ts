import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeAether } from './helpers.js';
import type { Aether } from '../src/types.js';

let a: Aether; let cleanup: () => Promise<void>;
beforeAll(async () => { ({ a, cleanup } = await makeAether()); });
afterAll(async () => { await cleanup(); });

describe('vault', () => {
  it('encrypts at rest, resolves placeholders and redacts values', async () => {
    await a.vault.set('DEMO_KEY', 'sk-live-123456789');
    const raw = await a.db.one<any>('select * from secrets where name=$1', ['DEMO_KEY']);
    expect(JSON.stringify(raw)).not.toContain('sk-live-123456789');
    expect(await a.vault.get('DEMO_KEY')).toBe('sk-live-123456789');
    expect(await a.vault.resolve({ h: 'Bearer {{secret:DEMO_KEY}}' })).toEqual({ h: 'Bearer sk-live-123456789' });
    expect(await a.vault.redact('token sk-live-123456789 here')).not.toContain('sk-live-123456789');
    expect((await a.vault.list()).map((s) => s.name)).toContain('DEMO_KEY');
  });
});

describe('memory', () => {
  it('stores, finds and forgets facts', async () => {
    await a.memory.addFact('Owner prefers flat white coffee', 'preference', 'owner', false);
    const hits = await a.memory.search('coffee', 5);
    expect(hits.some((h) => h.text.includes('flat white'))).toBe(true);
    const removed = await a.memory.forget('flat white');
    expect(removed.length).toBeGreaterThan(0);
    expect((await a.memory.search('coffee', 5)).some((h) => h.text.includes('flat white'))).toBe(false);
  });
  it('keeps persona files', async () => {
    const files = await a.memory.files();
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'AGENTS.md']));
  });
});

describe('agent loop with approvals', () => {
  it('runs a safe tool without asking', async () => {
    const r = await a.agent.run({ conversationId: 'main', text: 'create a note called Test with hello', channel: 'text' });
    expect(r.toolCalls).toBe(1);
    const notes = (await a.apps.snapshot()).notes as any[];
    expect(notes.some((n) => n.title === 'Test')).toBe(true);
  });
  it('blocks a critical tool until approved, and honors deny', async () => {
    const events: any[] = [];
    const p = a.agent.run({ conversationId: 'main', text: 'text +15551234567 saying hello there', channel: 'text', onEvent: (e) => events.push(e) });
    for (let i = 0; i < 50 && !(await a.sentinel.pending()).length; i++) await new Promise((r) => setTimeout(r, 50));
    const [ap] = await a.sentinel.pending();
    expect(ap.tool).toBe('phone'); expect(ap.risk).toBe('critical');
    await a.sentinel.decide(ap.id, 'deny');
    const r = await p;
    expect(events.some((e) => e.type === 'approval')).toBe(true);
    expect((await a.phone.smsList()).length).toBe(0);
    expect(r.text.toLowerCase()).toContain('denied');
  });
  it('allow_always creates a grant used next time', async () => {
    const p = a.agent.run({ conversationId: 'main', text: 'text +15551234567 saying first', channel: 'text' });
    for (let i = 0; i < 50 && !(await a.sentinel.pending()).length; i++) await new Promise((r) => setTimeout(r, 50));
    const [ap] = await a.sentinel.pending();
    await a.sentinel.decide(ap.id, 'allow_always');
    await p;
    await a.agent.run({ conversationId: 'main', text: 'text +15551234567 saying second', channel: 'text' });
    expect((await a.sentinel.pending()).length).toBe(0);
    expect((await a.phone.smsList()).length).toBe(2);
  });
});

describe('tasks', () => {
  it('fires a reminder and posts to the main thread', async () => {
    await a.tasks.start();
    const t = await a.tasks.create({ title: 'stretch', goal: 'Remind the owner: stretch', when: 'in 3 seconds', kind: 'reminder' });
    expect(t.status).toBe('scheduled');
    for (let i = 0; i < 40; i++) { const row = await a.tasks.get(t.id); if (row?.status === 'done') break; await new Promise((r) => setTimeout(r, 250)); }
    expect((await a.tasks.get(t.id))?.status).toBe('done');
    const msgs = await a.conversations.messages('main', { limit: 3 });
    expect(msgs.some((m: any) => m.channel === 'task' && m.content.includes('stretch'))).toBe(true);
    a.tasks.stop();
  });
  it('rejects bad cron', async () => {
    await expect(a.tasks.create({ title: 'x', goal: 'y', cron: 'not a cron' })).rejects.toThrow(/cron/i);
  });
});
