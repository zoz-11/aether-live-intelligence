import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import type { Aether } from '../types.js';
import { log, uid, sleep } from '../util.js';

const l = log('email');

export interface MailMessage {
  id: string;
  direction: 'in' | 'out';
  status: 'received' | 'sent' | 'failed' | 'undelivered' | 'queued';
  message_id: string | null;
  in_reply_to: string | null;
  thread_id: string | null;
  from_addr: string | null;
  from_name: string | null;
  to_addrs: string[];
  cc_addrs: string[];
  subject: string;
  text_body: string;
  html_body: string | null;
  snippet: string;
  codes: string[];
  links: string[];
  attachments: { filename: string; contentType: string; size: number }[];
  read: boolean;
  error: string | null;
  provider: string | null;
  created_at: string;
  sent_at: string | null;
}

const CODE_KW = /(code|otp|passcode|password|verification|verify|one[- ]time|security|pin|confirm|رمز|كود)/i;

/** Pulls likely one-time codes from an email body (keyword lines first, then a bare 6-digit line). */
export function extractCodes(text: string, subject = ''): string[] {
  const out = new Set<string>();
  const lines = `${subject}\n${text}`.split(/\r?\n/);
  lines.forEach((line, i) => {
    const ctx = `${lines[i - 1] ?? ''} ${line}`;
    if (!CODE_KW.test(ctx)) return;
    for (const m of line.matchAll(/(?<![\d-])(\d{4,8})(?![\d-])/g)) if (!/^(19|20)\d{2}$/.test(m[1]) || m[1].length !== 4) out.add(m[1]);
    for (const m of line.matchAll(/\b([A-Z0-9]{6,8})\b/g)) if (/\d/.test(m[1]) && /[A-Z]/.test(m[1])) out.add(m[1]);
    for (const m of line.matchAll(/\b(\d{3})[- ](\d{3})\b/g)) out.add(m[1] + m[2]);
  });
  if (!out.size) for (const m of text.matchAll(/^\s*(\d{6})\s*$/gm)) out.add(m[1]);
  return [...out].slice(0, 5);
}

/** Collects links, putting verification / magic-login links first. */
export function extractLinks(text: string, html?: string | null): string[] {
  const all = new Set<string>();
  for (const m of `${text}\n${html ?? ''}`.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) all.add(m[0].replace(/[.,;]+$/, '').replace(/&amp;/g, '&'));
  const score = (u: string) => (/verif|confirm|activate|magic|login|signin|sign-in|token|reset|validate|auth/i.test(u) ? 0 : 1);
  return [...all].filter((u) => !/\.(png|jpe?g|gif|svg|css|woff2?)(\?|$)/i.test(u)).sort((a, b) => score(a) - score(b)).slice(0, 20);
}

function addrList(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  return arr.flatMap((x) => x.value.map((v) => (v.address ?? '').toLowerCase()).filter(Boolean));
}

const domainOf = (addr: string) => addr.split('@')[1]?.toLowerCase() ?? '';

/** Aether's own inbox: SMTP listener, raw-MIME webhook, IMAP polling; SMTP/Resend/loopback outbound. */
export class EmailService {
  private smtp: any = null;
  private imapTimer: NodeJS.Timeout | null = null;
  private imapBusy = false;
  smtpPort: number | null = null;

  constructor(private getAether: () => Aether) {}

  private get db() { return this.getAether().db; }

  async address() { return (await this.getAether().settings.get()).email.address.toLowerCase(); }

  async start() {
    const a = this.getAether();
    const s = (await a.settings.get()).email;
    if (s.inboundSmtp.enabled && !this.smtp) await this.startSmtp().catch((e) => l.warn(`SMTP listener not started: ${e.message}`));
    if (s.imap.enabled && !this.imapTimer) {
      const every = Math.max(30, s.imap.intervalSec) * 1000;
      this.imapTimer = setInterval(() => this.pollImap().catch((e) => l.warn(`IMAP poll: ${e.message}`)), every);
      this.pollImap().catch((e) => l.warn(`IMAP poll: ${e.message}`));
    }
  }

  async stop() {
    if (this.imapTimer) { clearInterval(this.imapTimer); this.imapTimer = null; }
    if (this.smtp) { await new Promise((r) => this.smtp.close(r)); this.smtp = null; this.smtpPort = null; }
  }

  async restart() { await this.stop(); await this.start(); }

  private async startSmtp() {
    const a = this.getAether();
    const { SMTPServer } = await import('smtp-server');
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['AUTH'],
      banner: 'Aether mail',
      size: 25 * 1024 * 1024,
      logger: false,
      onRcptTo: async (address: any, _session: any, cb: (err?: Error) => void) => {
        const s = (await a.settings.get()).email;
        const to = String(address.address).toLowerCase();
        const own = s.address.toLowerCase();
        if (to === own || (s.inboundSmtp.acceptAll && domainOf(to) === domainOf(own))) return cb();
        const err: any = new Error('Mailbox unavailable'); err.responseCode = 550; return cb(err);
      },
      onData: (stream: any, _session: any, cb: (err?: Error) => void) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => { this.ingestRaw(Buffer.concat(chunks), 'smtp').then(() => cb(), (e) => cb(e)); });
      },
    } as any);
    server.on('error', (e: Error) => l.warn(`SMTP error: ${e.message}`));
    const port = a.config.smtpPort;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, a.config.smtpHost, () => resolve());
    });
    this.smtp = server;
    this.smtpPort = (server as any).server?.address()?.port ?? port;
    l.info(`SMTP listener on ${a.config.smtpHost}:${this.smtpPort}`);
  }

  /** Parses and stores an inbound message (from SMTP, webhook or IMAP). */
  async ingestRaw(raw: Buffer | string, via: string): Promise<MailMessage | null> {
    const a = this.getAether();
    const p: ParsedMail = await simpleParser(raw);
    const messageId = p.messageId ?? null;
    if (messageId) {
      const dup = await this.db.one('select id from mail_messages where message_id=$1 and direction=$2', [messageId, 'in']);
      if (dup) return null;
    }
    const text = (p.text ?? (typeof p.html === 'string' ? p.html.replace(/<[^>]+>/g, ' ') : '')).trim();
    const from = p.from?.value?.[0];
    const inReplyTo = typeof p.inReplyTo === 'string' ? p.inReplyTo : null;
    let threadId: string | null = null;
    if (inReplyTo) threadId = (await this.db.one<{ thread_id: string }>('select thread_id from mail_messages where message_id=$1', [inReplyTo]))?.thread_id ?? null;
    const id = uid('em');
    const row = await this.db.one<MailMessage>(
      `insert into mail_messages (id, direction, status, message_id, in_reply_to, thread_id, from_addr, from_name, to_addrs, cc_addrs, subject, text_body, html_body, snippet, codes, links, attachments, provider)
       values ($1,'in','received',$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16) returning *`,
      [id, messageId, inReplyTo, threadId ?? id, from?.address?.toLowerCase() ?? null, from?.name ?? null, addrList(p.to), addrList(p.cc), p.subject ?? '(no subject)',
        text.slice(0, 200_000), typeof p.html === 'string' ? p.html.slice(0, 400_000) : null, text.replace(/\s+/g, ' ').slice(0, 180),
        extractCodes(text, p.subject ?? ''), extractLinks(text, typeof p.html === 'string' ? p.html : null),
        (p.attachments ?? []).map((x) => ({ filename: x.filename ?? 'attachment', contentType: x.contentType, size: x.size })), via],
    );
    a.bus.publish('email.received', row);
    await a.activity.add('email', `Email from ${row!.from_addr}: ${row!.subject}`, { id, via });
    const s = await a.settings.get();
    if (row!.from_addr !== s.email.address.toLowerCase()) {
      a.notify.send({ title: `Email from ${row!.from_name || row!.from_addr}`, body: row!.subject, tag: 'email', url: '#inbox' }).catch(() => undefined);
      if (s.email.autoTriage && a.plugins.isEnabled('tasks')) {
        await a.tasks.create({ title: `Triage email: ${row!.subject}`.slice(0, 80), goal: `A new email arrived in your inbox (id ${id}) from ${row!.from_addr} with subject "${row!.subject}". Read it with the email tool, summarize it in two sentences, and if it needs the owner's action, say exactly what. Do not reply unless the owner has a standing instruction to.`, origin: 'email' });
      }
    }
    return row!;
  }

  async list(opts: { folder?: 'inbox' | 'sent' | 'all'; limit?: number; q?: string } = {}): Promise<MailMessage[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.folder === 'inbox') where.push(`direction='in'`);
    if (opts.folder === 'sent') where.push(`direction='out'`);
    if (opts.q) { params.push(`%${opts.q}%`); where.push(`(subject ilike $${params.length} or text_body ilike $${params.length} or from_addr ilike $${params.length})`); }
    params.push(Math.min(opts.limit ?? 50, 500));
    return this.db.query<MailMessage>(`select * from mail_messages ${where.length ? 'where ' + where.join(' and ') : ''} order by created_at desc limit $${params.length}`, params);
  }

  async get(id: string, markRead = true) {
    const m = await this.db.one<MailMessage>('select * from mail_messages where id=$1', [id]);
    if (m && markRead && !m.read) { await this.db.query('update mail_messages set read=true where id=$1', [id]); this.getAether().bus.publish('email.updated', { id, read: true }); }
    return m;
  }

  async thread(threadId: string) { return this.db.query<MailMessage>('select * from mail_messages where thread_id=$1 order by created_at asc', [threadId]); }

  async unreadCount() { return Number((await this.db.one<{ n: number }>(`select count(*)::int as n from mail_messages where direction='in' and not read`))?.n ?? 0); }

  async remove(id: string) { await this.db.query('delete from mail_messages where id=$1', [id]); this.getAether().bus.publish('email.updated', { id, removed: true }); }

  async send(input: { to: string | string[]; cc?: string[]; subject: string; text: string; html?: string; inReplyTo?: string }): Promise<MailMessage> {
    const a = this.getAether();
    const s = (await a.settings.get()).email;
    const to = (Array.isArray(input.to) ? input.to : String(input.to).split(/[,;]\s*/)).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!to.length || to.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && !x.endsWith('.local'))) throw new Error(`Invalid recipient: ${to.join(', ')}`);
    const own = s.address.toLowerCase();
    const id = uid('em');
    const messageId = `<${id}@${domainOf(own) || 'aether.local'}>`;
    let threadId = id;
    let references: string | undefined;
    if (input.inReplyTo) {
      const parent = await this.db.one<MailMessage>('select * from mail_messages where id=$1 or message_id=$1', [input.inReplyTo]);
      if (parent) { threadId = parent.thread_id ?? parent.id; references = parent.message_id ?? undefined; }
    }
    let status: MailMessage['status'] = 'sent';
    let error: string | null = null;
    let provider = s.outbound;
    try {
      if (s.outbound === 'smtp') {
        const pass = await a.vault.get('SMTP_PASSWORD');
        if (!s.smtp.host) throw new Error('SMTP host is not set (Settings → Email)');
        const nodemailer = await import('nodemailer');
        const t = nodemailer.createTransport({ host: s.smtp.host, port: s.smtp.port, secure: s.smtp.secure, auth: s.smtp.user ? { user: s.smtp.user, pass: pass ?? '' } : undefined });
        await t.sendMail({ from: `"${s.fromName}" <${own}>`, to, cc: input.cc, subject: input.subject, text: input.text, html: input.html, messageId, inReplyTo: references, references });
      } else if (s.outbound === 'resend') {
        const key = await a.vault.get('RESEND_API_KEY');
        if (!key) throw new Error('RESEND_API_KEY is not set');
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: `${s.fromName} <${own}>`, to, cc: input.cc, subject: input.subject, text: input.text, html: input.html, headers: references ? { 'In-Reply-To': references, References: references } : undefined }),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } else {
        provider = 'loopback';
        const local = to.filter((x) => domainOf(x) === domainOf(own));
        const external = to.filter((x) => domainOf(x) !== domainOf(own));
        if (external.length) { status = 'undelivered'; error = `No outbound provider is configured, so mail to ${external.join(', ')} was not delivered. Set up SMTP or Resend in Settings → Email.`; }
        if (local.length) {
          const raw = [`From: "${s.fromName}" <${own}>`, `To: ${local.join(', ')}`, `Subject: ${input.subject}`, `Message-ID: ${messageId}`, references ? `In-Reply-To: ${references}` : '', 'Content-Type: text/plain; charset=utf-8', '', input.text].filter((x) => x !== '').join('\r\n');
          setTimeout(() => this.ingestRaw(raw.replace(`Message-ID: ${messageId}`, `Message-ID: <in-${id}@loopback>`), 'loopback').catch(() => undefined), 50);
        }
      }
    } catch (e: any) { status = 'failed'; error = String(e?.message ?? e); }
    const row = await this.db.one<MailMessage>(
      `insert into mail_messages (id, direction, status, message_id, in_reply_to, thread_id, from_addr, from_name, to_addrs, cc_addrs, subject, text_body, html_body, snippet, read, error, provider, sent_at)
       values ($1,'out',$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,true,$14,$15,$16) returning *`,
      [id, status, messageId, references ?? null, threadId, own, s.fromName, to, input.cc ?? [], input.subject, input.text, input.html ?? null, input.text.replace(/\s+/g, ' ').slice(0, 180), error, provider, status === 'sent' ? new Date() : null],
    );
    a.bus.publish('email.updated', row);
    await a.activity.add('email', `Email ${status} to ${to.join(', ')}: ${input.subject}`, { id, provider, error }, { level: status === 'sent' ? 'info' : 'warn' });
    return row!;
  }

  /** Waits for a new inbound message matching filters (for sign-ups and OTPs). */
  async waitFor(f: { from?: string; subjectContains?: string; since?: Date; timeoutSec?: number; signal?: AbortSignal }): Promise<MailMessage | null> {
    const since = f.since ?? new Date(Date.now() - 2 * 60_000);
    const deadline = Date.now() + Math.min(f.timeoutSec ?? 90, 600) * 1000;
    while (Date.now() < deadline) {
      const params: unknown[] = [since];
      let sql = `select * from mail_messages where direction='in' and created_at >= $1`;
      if (f.from) { params.push(`%${f.from.toLowerCase()}%`); sql += ` and from_addr ilike $${params.length}`; }
      if (f.subjectContains) { params.push(`%${f.subjectContains}%`); sql += ` and subject ilike $${params.length}`; }
      const hit = await this.db.one<MailMessage>(sql + ' order by created_at desc limit 1', params);
      if (hit) return hit;
      await sleep(2000, f.signal);
    }
    return null;
  }

  async pollImap() {
    if (this.imapBusy) return;
    const a = this.getAether();
    const s = (await a.settings.get()).email.imap;
    if (!s.enabled || !s.host || !s.user) return;
    const pass = await a.vault.get('IMAP_PASSWORD');
    if (!pass) throw new Error('IMAP_PASSWORD is not set');
    this.imapBusy = true;
    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass }, logger: false as any });
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids: number[] = [];
        for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
          if (msg.source) await this.ingestRaw(msg.source, 'imap');
          uids.push(msg.uid);
        }
        if (uids.length) await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      } finally { lock.release(); }
      await client.logout();
    } finally { this.imapBusy = false; }
  }

  async status() {
    const s = (await this.getAether().settings.get()).email;
    return { address: s.address, outbound: s.outbound, smtpListening: !!this.smtp, smtpPort: this.smtpPort, imap: s.imap.enabled, unread: await this.unreadCount() };
  }
}
