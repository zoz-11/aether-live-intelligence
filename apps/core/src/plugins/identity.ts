import type { Plugin } from '../types.js';

export const emailPlugin: Plugin = {
  id: 'email',
  name: 'Agent Email',
  description: 'Aether\'s own inbox: receive (SMTP listener, webhook, IMAP), send (SMTP or Resend, approval first), threads, OTP and verify-link extraction.',
  category: 'identity',
  defaultEnabled: true,
  secrets: ['SMTP_PASSWORD', 'RESEND_API_KEY', 'IMAP_PASSWORD'],
  setup: (a) => a.email.start(),
  teardown: (a) => a.email.stop(),
  status: (a) => a.email.status(),
  tools: (a) => [
    {
      name: 'email',
      description: 'Your own email inbox. action=address | inbox(limit?) | sent | search(query) | read(id) | thread(id) | send(to,subject,text,cc?) | reply(id,text) | wait_for(from?,subjectContains?,timeoutSec?) — waits for a new message and returns any one-time codes and verification links (use for sign-ups and logins).',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['address', 'inbox', 'sent', 'search', 'read', 'thread', 'send', 'reply', 'wait_for'] }, id: { type: 'string' }, to: { type: 'string' }, cc: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, text: { type: 'string' }, query: { type: 'string' }, from: { type: 'string' }, subjectContains: { type: 'string' }, timeoutSec: { type: 'number' }, limit: { type: 'number' } }, required: ['action'] },
      risk: (x) => (x?.action === 'send' || x?.action === 'reply' ? 'critical' : 'read'),
      describe: (x) => (x.action === 'send' ? `Send email to ${x.to}: “${x.subject}”` : x.action === 'reply' ? `Reply to email ${x.id}` : `Email: ${x.action}`),
      async run(x, ctx) {
        const e = a.email;
        const tz = (await a.settings.get()).owner.timezone;
        const line = (m: any) => `${m.id} · ${m.direction === 'in' ? 'from ' + (m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr) : 'to ' + (m.to_addrs ?? []).join(', ')} · ${m.subject} · ${new Date(m.created_at).toLocaleString('en-US', { timeZone: tz })}${m.read ? '' : ' · unread'}${m.status !== 'received' && m.status !== 'sent' ? ' · ' + m.status : ''}`;
        switch (x.action) {
          case 'address': { const st = await e.status(); return { ok: true, content: `My address is ${st.address}. Outbound: ${st.outbound}${st.outbound === 'loopback' ? ' (not configured for external delivery yet)' : ''}. Inbound SMTP listener: ${st.smtpListening ? 'on port ' + st.smtpPort : 'off'}.` }; }
          case 'inbox': case 'sent': { const rows = await e.list({ folder: x.action, limit: x.limit ?? 15 }); return { ok: true, content: rows.length ? rows.map(line).join('\n') : `No ${x.action === 'inbox' ? 'received' : 'sent'} email yet.` }; }
          case 'search': { const rows = await e.list({ folder: 'all', q: String(x.query ?? ''), limit: 20 }); return { ok: true, content: rows.length ? rows.map(line).join('\n') : 'No matches.' }; }
          case 'read': {
            const m = await e.get(String(x.id));
            if (!m) return { ok: false, content: 'Email not found.' };
            return { ok: true, content: `${line(m)}\n\n${m.text_body.slice(0, 8000)}${m.codes.length ? `\n\nCodes: ${m.codes.join(', ')}` : ''}${m.links.length ? `\nLinks: ${m.links.slice(0, 5).join(' ')}` : ''}${m.attachments.length ? `\nAttachments: ${m.attachments.map((t) => t.filename).join(', ')}` : ''}` };
          }
          case 'thread': { const m = await e.get(String(x.id), false); if (!m) return { ok: false, content: 'Email not found.' }; const rows = await e.thread(m.thread_id ?? m.id); return { ok: true, content: rows.map((r) => `${line(r)}\n${r.text_body.slice(0, 1500)}`).join('\n\n---\n\n') }; }
          case 'send': {
            if (!x.to || !x.subject || !x.text) return { ok: false, content: 'send needs to, subject and text.' };
            const m = await e.send({ to: x.to, cc: x.cc, subject: x.subject, text: x.text });
            return { ok: m.status === 'sent', content: m.status === 'sent' ? `Sent to ${m.to_addrs.join(', ')} via ${m.provider}.` : `Not delivered (${m.status}): ${m.error}` };
          }
          case 'reply': {
            const p = await e.get(String(x.id), false);
            if (!p) return { ok: false, content: 'Email not found.' };
            const m = await e.send({ to: p.direction === 'in' ? p.from_addr! : p.to_addrs, subject: p.subject.startsWith('Re:') ? p.subject : `Re: ${p.subject}`, text: String(x.text ?? ''), inReplyTo: p.id });
            return { ok: m.status === 'sent', content: m.status === 'sent' ? `Reply sent to ${m.to_addrs.join(', ')}.` : `Reply not delivered (${m.status}): ${m.error}` };
          }
          case 'wait_for': {
            const m = await e.waitFor({ from: x.from, subjectContains: x.subjectContains, timeoutSec: x.timeoutSec ?? 90, signal: ctx.signal });
            if (!m) return { ok: false, content: 'No matching email arrived in time.' };
            return { ok: true, content: `${line(m)}\nCodes: ${m.codes.join(', ') || 'none found'}\nLinks: ${m.links.slice(0, 5).join(' ') || 'none'}\n\n${m.text_body.slice(0, 2000)}` };
          }
          default: return { ok: false, content: `Unknown action ${x.action}` };
        }
      },
    },
  ],
  prompt: async (a) => { const s = (await a.settings.get()).email; return `Agent Email: your own address is ${s.address}. Use it for sign-ups and correspondence. Sending always needs the owner's approval unless granted.`; },
};

export const phonePlugin: Plugin = {
  id: 'phone',
  name: 'Agent Phone',
  description: 'Aether\'s phone line: outbound and inbound calls with a live speech loop (Twilio), SMS, a mock carrier for testing and an in-app softphone.',
  category: 'identity',
  defaultEnabled: true,
  secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  status: (a) => a.phone.status(),
  tools: (a) => [
    {
      name: 'phone',
      description: 'Your phone line. action=status | call(to,goal,mode?: conversation|notify, message?) places a call and talks on the owner\'s behalf (returns immediately; the summary arrives in the main thread when the call ends) | call_status(id) | end_call(id) | calls | sms(to,body) | sms_list. Numbers in E.164 (+15551234567).',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'call', 'call_status', 'end_call', 'calls', 'sms', 'sms_list'] }, to: { type: 'string' }, goal: { type: 'string' }, mode: { type: 'string', enum: ['conversation', 'notify'] }, message: { type: 'string' }, body: { type: 'string' }, id: { type: 'string' } }, required: ['action'] },
      risk: (x) => (x?.action === 'call' || x?.action === 'sms' ? 'critical' : x?.action === 'end_call' ? 'write' : 'read'),
      describe: (x) => (x.action === 'call' ? `Call ${x.to}: ${x.goal ?? x.message ?? ''}` : x.action === 'sms' ? `Text ${x.to}: “${String(x.body ?? '').slice(0, 80)}”` : `Phone: ${x.action}`),
      async run(x) {
        const p = a.phone;
        switch (x.action) {
          case 'status': { const s = await p.status(); return { ok: true, content: `Provider: ${s.provider}. Number: ${s.number ?? 'not set'}. ${s.note}` }; }
          case 'call': {
            if (!x.to || !(x.goal || x.message)) return { ok: false, content: 'call needs to and goal (or message for notify mode).' };
            const c = await p.call({ to: String(x.to), goal: String(x.goal ?? x.message), mode: x.mode, message: x.message });
            if (c.status === 'failed') return { ok: false, content: `Call failed: ${c.error}` };
            return { ok: true, content: `${c.provider === 'mock' ? 'Simulated call (mock carrier, no real call placed)' : 'Call'} ${c.id} to ${c.to_number} is ${c.status}. I will post the summary when it ends.` };
          }
          case 'call_status': { const c = await p.get(String(x.id)); if (!c) return { ok: false, content: 'Call not found.' }; return { ok: true, content: `${c.id} ${c.status}${c.summary ? ' — ' + c.summary : ''}\n${c.transcript.map((t) => `${t.role === 'agent' ? 'Aether' : 'Other'}: ${t.text}`).join('\n')}` }; }
          case 'end_call': { const c = await p.end(String(x.id)); return { ok: true, content: `Call ${c?.id} ended.` }; }
          case 'calls': { const rows = await p.list(10); return { ok: true, content: rows.length ? rows.map((c) => `${c.id} · ${c.direction} · ${c.direction === 'out' ? c.to_number : c.from_number} · ${c.status}${c.summary ? ' · ' + c.summary.slice(0, 120) : ''}`).join('\n') : 'No calls yet.' }; }
          case 'sms': { if (!x.to || !x.body) return { ok: false, content: 'sms needs to and body.' }; const r = await p.sms({ to: String(x.to), body: String(x.body) }); return { ok: r.status !== 'failed', content: r.status === 'simulated' ? `SMS recorded as simulated (mock carrier) to ${r.to_number}.` : r.status === 'failed' ? `SMS failed: ${r.error}` : `SMS ${r.status} to ${r.to_number}.` }; }
          case 'sms_list': { const rows: any[] = await p.smsList(15); return { ok: true, content: rows.length ? rows.map((r) => `${r.direction === 'in' ? 'from ' + r.from_number : 'to ' + r.to_number} · ${r.status} · ${r.body.slice(0, 120)}`).join('\n') : 'No SMS yet.' }; }
          default: return { ok: false, content: `Unknown action ${x.action}` };
        }
      },
    },
  ],
  prompt: async (a) => { const s = await a.phone.status(); return `Agent Phone: provider ${s.provider}${s.number ? ', number ' + s.number : ''}. Calls and SMS always need approval. ${s.provider === 'mock' ? 'Calls are simulated until Twilio is configured; say so.' : ''}`; },
};
