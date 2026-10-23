import { describe, expect, it } from 'vitest';
import { isReadOnlyCommand, Workspace } from '../src/dev/workspace.js';
import { extractCodes, extractLinks } from '../src/email/service.js';
import { twilioSignature, validateTwilioSignature, twimlGather, twimlRelay } from '../src/phone/twilio.js';
import { parseIntent } from '../src/models/local.js';
import { needsApproval } from '../src/agent/sentinel.js';
import { parseWhen, safeEnv } from '../src/util.js';
import { parseSkill } from '../src/skills.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('approval policy', () => {
  it('always asks for critical actions, in every mode', () => {
    for (const m of ['careful', 'balanced', 'autonomous'] as const) expect(needsApproval('critical', m)).toBe(true);
  });
  it('balanced asks for danger, not for write/read', () => {
    expect(needsApproval('danger', 'balanced')).toBe(true);
    expect(needsApproval('write', 'balanced')).toBe(false);
    expect(needsApproval('read', 'balanced')).toBe(false);
  });
  it('careful asks for write; autonomous only for critical', () => {
    expect(needsApproval('write', 'careful')).toBe(true);
    expect(needsApproval('danger', 'autonomous')).toBe(false);
  });
});

describe('shell classifier', () => {
  const cases: [string, boolean][] = [
    ['ls -la && node --version', true], ['ls | grep a | wc -l', true], ['git status', true], ['find . -name "*.ts"', true],
    ['cat ../master.key', false], ['cat /etc/passwd', false], ['echo $HOME', false], ['rm -rf x', false], ['ls > out.txt', false],
    ['git branch -D main', false], ['find . -delete', false], ['sleep 10 &', false], ['ls; rm a', false], ['npm install', false], ['cat $(echo x)', false],
  ];
  it.each(cases)('%s -> %s', (cmd, expected) => expect(isReadOnlyCommand(cmd)).toBe(expected));
});

describe('workspace confinement', () => {
  it('blocks escapes and allows inside paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    const ws = new Workspace(root);
    await ws.init();
    await ws.write('a/b.txt', 'hello');
    expect((await ws.read('a/b.txt')).text).toBe('hello');
    await expect(ws.read('../../etc/passwd')).rejects.toThrow(/escapes/);
    expect((await ws.read('/a/b.txt')).text).toBe('hello');
    const r = await ws.exec('echo $AETHER_TOKEN-x', { env: {} });
    expect(r.stdout.trim()).toBe('-x');
  });
  it('scrubs credentials from child env', () => {
    process.env.AETHER_TOKEN = 'secret'; process.env.OPENAI_API_KEY = 'sk'; process.env.DATABASE_URL = 'postgres://x';
    const env = safeEnv({ EXTRA: '1' });
    expect(env.AETHER_TOKEN).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.DATABASE_URL).toBeUndefined();
    expect(env.EXTRA).toBe('1'); expect(env.PATH).toBeDefined();
  });
});

describe('email extraction', () => {
  it('finds OTP codes and verification links', () => {
    expect(extractCodes('Your verification code is 482913.\nThanks')).toEqual(['482913']);
    expect(extractCodes('Use code: AB12CD to sign in')).toContain('AB12CD');
    expect(extractCodes('Meeting in 2026 at room 5')).toEqual([]);
    const links = extractLinks('See https://site.com/blog and https://site.com/verify?token=1 now', null);
    expect(links[0]).toBe('https://site.com/verify?token=1');
  });
});

describe('twilio', () => {
  it('signs and validates requests, rejects tampering', () => {
    const url = 'https://example.com/api/hooks/twilio/voice?callId=c1&t=x';
    const params = { CallSid: 'CA123', From: '+15550001111', To: '+15552223333' };
    const sig = twilioSignature('token123', url, params);
    expect(validateTwilioSignature('token123', sig, url, params)).toBe(true);
    expect(validateTwilioSignature('token123', sig, url, { ...params, To: '+1999' })).toBe(false);
    expect(validateTwilioSignature('other', sig, url, params)).toBe(false);
    expect(validateTwilioSignature('token123', undefined, url, params)).toBe(false);
  });
  it('builds escaped TwiML', () => {
    const x = twimlGather({ say: 'Hi & <welcome>', action: 'https://h/g?a=1&b=2', voice: 'Polly.Joanna', language: 'en-US', redirect: 'https://h/g?s=1' });
    expect(x).toContain('Hi &amp; &lt;welcome&gt;');
    expect(x).toContain('a=1&amp;b=2');
    expect(twimlRelay({ wsUrl: 'wss://h/r?c=1&t=2', greeting: 'Hello', language: 'en-US' })).toContain('<ConversationRelay url="wss://h/r?c=1&amp;t=2"');
  });
});

describe('local engine intents', () => {
  const all = () => true;
  const first = (t: string) => { const r = parseIntent(t, all, 'Asia/Riyadh'); return typeof r === 'string' ? r : r[0]; };
  it('parses common commands', () => {
    expect(first('turn on the flashlight')).toMatchObject({ name: 'set_flashlight', args: { on: true } });
    expect(first('create a note called Groceries with milk and eggs')).toMatchObject({ name: 'create_note', args: { title: 'Groceries', body: 'milk and eggs' } });
    expect(first('call +1 (555) 123-4567 and ask about opening hours')).toMatchObject({ name: 'phone', args: { action: 'call', to: '+15551234567', goal: 'ask about opening hours' } });
    expect(first('remind me to stretch in 10 minutes')).toMatchObject({ name: 'tasks', args: { action: 'create', kind: 'reminder', title: 'stretch' } });
    expect(first('remember that I prefer window seats')).toMatchObject({ name: 'remember' });
    expect(first('check your inbox')).toMatchObject({ name: 'email', args: { action: 'inbox' } });
    expect(first('run `ls -la`')).toMatchObject({ name: 'shell', args: { command: 'ls -la' } });
  });
});

describe('time parsing', () => {
  it('uses the owner timezone', () => {
    const base = new Date('2026-10-23T05:00:00Z'); // 08:00 in Riyadh
    expect(parseWhen('at 9am', base, 'Asia/Riyadh')?.toISOString()).toBe('2026-10-23T06:00:00.000Z');
    expect(parseWhen('at 7am', base, 'Asia/Riyadh')?.toISOString()).toBe('2026-10-24T04:00:00.000Z');
    expect(parseWhen('tomorrow at 18:30', base, 'Asia/Riyadh')?.toISOString()).toBe('2026-10-24T15:30:00.000Z');
    expect(parseWhen('in 10 minutes', base)?.toISOString()).toBe('2026-10-23T05:10:00.000Z');
    expect(parseWhen('whenever', base)).toBeNull();
  });
});

describe('skills', () => {
  it('parses SKILL.md frontmatter', () => {
    const { meta, body } = parseSkill('---\nname: demo\ndescription: "Does a thing"\n---\n\n# Steps\n1. go');
    expect(meta.name).toBe('demo'); expect(meta.description).toBe('Does a thing'); expect(body).toContain('# Steps');
  });
});
