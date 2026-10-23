import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';
import { makeAether } from './helpers.js';
import type { Aether } from '../src/types.js';

let a: Aether; let cleanup: () => Promise<void>;
beforeAll(async () => { ({ a, cleanup } = await makeAether()); await a.email.start(); });
afterAll(async () => { await cleanup(); });

describe('agent email over SMTP', () => {
  it('receives mail for its own address, extracts the code and rejects others', async () => {
    const port = a.email.smtpPort!;
    expect(port).toBeGreaterThan(0);
    const t = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, tls: { rejectUnauthorized: false } });
    await t.sendMail({ from: 'Service <no-reply@service.com>', to: 'aether@aether.local', subject: 'Confirm your account', text: 'Your code is 739201\nhttps://service.com/confirm?k=abc' });
    const waited = await a.email.waitFor({ from: 'service.com', timeoutSec: 10 });
    expect(waited?.codes).toEqual(['739201']);
    expect(waited?.links[0]).toContain('/confirm');
    await expect(t.sendMail({ from: 'x@y.com', to: 'nobody@elsewhere.com', subject: 'x', text: 'x' })).rejects.toThrow(/550|rejected/);
  });
  it('is honest about undelivered external mail without a provider', async () => {
    const m = await a.email.send({ to: 'someone@example.com', subject: 'Hi', text: 'Hello' });
    expect(m.status).toBe('undelivered');
    expect(m.error).toMatch(/No outbound provider/);
  });
  it('threads replies', async () => {
    const [inbound] = await a.email.list({ folder: 'inbox', limit: 1 });
    const reply = await a.email.send({ to: inbound.from_addr!, subject: `Re: ${inbound.subject}`, text: 'Thanks', inReplyTo: inbound.id });
    expect(reply.thread_id).toBe(inbound.thread_id);
  });
});
