import { createHmac } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Aether } from '../types.js';
import type { ChatMessage } from '../models/types.js';
import { log, uid } from '../util.js';
import { TwilioClient, twimlGather, twimlRelay, twimlSayHangup, validateTwilioSignature } from './twilio.js';

const l = log('phone');

export interface CallTurn { role: 'agent' | 'other'; text: string; at: string }
export interface CallRow {
  id: string; provider: string; direction: 'in' | 'out'; from_number: string | null; to_number: string | null;
  status: string; goal: string | null; mode: 'conversation' | 'notify'; transcript: CallTurn[]; summary: string | null;
  provider_sid: string | null; error: string | null; created_at: string; started_at: string | null; ended_at: string | null;
}

const END_TOOL = { name: 'end_call', description: 'Hang up after saying goodbye, when the goal is done or the other side wants to end.', parameters: { type: 'object', properties: { reason: { type: 'string' } } } };
const NOTE_TOOL = { name: 'take_note', description: 'Save an important detail from the call (names, numbers, times, decisions).', parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } };

/** Aether's phone line: Twilio (speech Gather loop or ConversationRelay), a mock carrier and an in-app softphone. */
export class PhoneService {
  private notes = new Map<string, string[]>();
  private ending = new Set<string>();
  constructor(private getAether: () => Aether) {}

  private get db() { return this.getAether().db; }

  async cfg() { return (await this.getAether().settings.get()).phone; }

  /** Per-call token embedded in webhook URLs (second factor next to Twilio signatures). */
  callToken(callId: string) { return createHmac('sha256', this.getAether().config.masterKey).update(`call:${callId}`).digest('base64url').slice(0, 24); }

  async twilio(): Promise<TwilioClient | null> {
    const a = this.getAether();
    const sid = await a.vault.get('TWILIO_ACCOUNT_SID');
    const token = await a.vault.get('TWILIO_AUTH_TOKEN');
    return sid && token ? new TwilioClient(sid, token) : null;
  }

  async status() {
    const a = this.getAether();
    const c = await this.cfg();
    const s = await a.settings.get();
    const twilioReady = !!(await this.twilio()) && !!c.number && !!s.publicUrl;
    return { provider: c.provider, number: c.number || null, mode: c.mode, twilioReady, publicUrl: s.publicUrl || null, note: c.provider === 'mock' ? 'Mock carrier: calls are simulated end-to-end; no real phone call is placed.' : twilioReady ? 'Twilio ready.' : 'Twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, a number and a public URL.' };
  }

  async list(limit = 50) { return this.db.query<CallRow>('select * from calls order by created_at desc limit $1', [limit]); }
  async get(id: string) { return this.db.one<CallRow>('select * from calls where id=$1', [id]); }

  private async update(id: string, patch: Partial<CallRow>) {
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(patch)) { vals.push(k === 'transcript' ? JSON.stringify(v) : v); sets.push(`${k}=$${vals.length}${k === 'transcript' ? '::jsonb' : ''}`); }
    const row = await this.db.one<CallRow>(`update calls set ${sets.join(', ')} where id=$1 returning *`, vals);
    if (row) this.getAether().bus.publish('call.updated', row);
    return row;
  }

  private async addTurn(id: string, role: CallTurn['role'], text: string) {
    const c = await this.get(id);
    if (!c) return;
    const transcript = [...(c.transcript ?? []), { role, text, at: new Date().toISOString() }];
    await this.update(id, { transcript });
  }

  async create(o: { provider: string; direction: 'in' | 'out'; from?: string | null; to?: string | null; goal?: string; mode?: 'conversation' | 'notify'; status?: string; sid?: string }) {
    const row = await this.db.one<CallRow>(
      `insert into calls (id, provider, direction, from_number, to_number, status, goal, mode, provider_sid, started_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now()) returning *`,
      [uid('call'), o.provider, o.direction, o.from ?? null, o.to ?? null, o.status ?? 'queued', o.goal ?? null, o.mode ?? 'conversation', o.sid ?? null],
    );
    this.getAether().bus.publish('call.updated', row);
    return row!;
  }

  /** Places an outbound call (approval is enforced by the phone tool before this runs). */
  async call(o: { to: string; goal: string; mode?: 'conversation' | 'notify'; message?: string }): Promise<CallRow> {
    const a = this.getAether();
    const c = await this.cfg();
    const to = o.to.replace(/[^\d+]/g, '');
    if (!/^\+?\d{6,15}$/.test(to)) throw new Error(`Invalid phone number ${o.to}. Use E.164 like +15551234567.`);
    const mode = o.mode ?? 'conversation';
    if (c.provider === 'twilio') {
      const tw = await this.twilio();
      const s = await a.settings.get();
      if (!tw) throw new Error('Twilio credentials are missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).');
      if (!c.number) throw new Error('Set Aether\'s Twilio number in Settings → Phone.');
      if (!s.publicUrl) throw new Error('Set a public HTTPS URL for Core in Settings → Connection so Twilio can reach it.');
      const row = await this.create({ provider: 'twilio', direction: 'out', from: c.number, to, goal: o.goal, mode });
      if (o.message) this.notes.set(row.id, [`message:${o.message}`]);
      const base = s.publicUrl.replace(/\/$/, '');
      const t = this.callToken(row.id);
      try {
        const r = await tw.call({ to, from: c.number, url: `${base}/api/hooks/twilio/voice?callId=${row.id}&t=${t}`, statusCallback: `${base}/api/hooks/twilio/status?callId=${row.id}&t=${t}` });
        return (await this.update(row.id, { provider_sid: r.sid, status: r.status ?? 'queued' }))!;
      } catch (e: any) {
        return (await this.update(row.id, { status: 'failed', error: e.message, ended_at: new Date().toISOString() }))!;
      }
    }
    const row = await this.create({ provider: 'mock', direction: 'out', from: c.number || '+10000000000', to, goal: o.goal, mode, status: 'in-progress' });
    this.simulate(row.id, o.message).catch((e) => l.warn(`mock call failed: ${e.message}`));
    return row;
  }

  async end(id: string) {
    const c = await this.get(id);
    if (!c) throw new Error('call not found');
    if (c.provider === 'twilio' && c.provider_sid && !c.ended_at) { const tw = await this.twilio(); await tw?.hangup(c.provider_sid).catch(() => undefined); }
    this.ending.add(id);
    if (!c.ended_at) await this.finalize(id, 'completed');
    return this.get(id);
  }

  private async systemPrompt(call: CallRow) {
    const a = this.getAether();
    const s = await a.settings.get();
    const files = await a.memory.files();
    const owner = s.owner.name || 'my owner';
    const facts = a.plugins.isEnabled('memory') ? await a.memory.relevant(call.goal ?? 'phone call', 6) : [];
    const role = call.direction === 'out'
      ? `You are Aether, an AI assistant, on a live phone call you placed on behalf of ${owner}. Goal: ${call.goal}. Introduce yourself as ${owner}'s AI assistant in your first sentence.`
      : call.provider === 'browser'
        ? `You are Aether, on a live voice call with your owner ${owner} (in-app softphone). Be their assistant: answer, help, and confirm actions.`
        : `You are Aether, ${owner}'s AI assistant, answering an incoming call to ${owner}'s line. Find out who is calling and why, take a clear message (name, reason, callback number, urgency) with take_note, and promise to pass it on. Do not share private information.`;
    return `${role}
Speak like a real person on the phone: one or two short sentences per turn, no lists, no markdown, no emojis. Never invent facts or commit ${owner} to anything beyond the goal. If you reach voicemail, leave a brief message and end the call. When the goal is complete or the other person wants to stop, say goodbye and call end_call.
${facts.length ? 'Useful facts:\n' + facts.map((f) => '- ' + f.text).join('\n') : ''}
Persona: ${files['IDENTITY.md'].slice(0, 400)}`;
  }

  /** Produces the agent's next spoken line for a call. */
  async respond(id: string, heard: string | null): Promise<{ reply: string; end: boolean }> {
    const a = this.getAether();
    const call = await this.get(id);
    if (!call) return { reply: 'Sorry, something went wrong. Goodbye.', end: true };
    if (heard) await this.addTurn(id, 'other', heard);
    const fresh = (await this.get(id))!;
    if (fresh.mode === 'notify') {
      const msg = (this.notes.get(id) ?? []).find((n) => n.startsWith('message:'))?.slice(8) ?? fresh.goal ?? 'Hello.';
      await this.addTurn(id, 'agent', msg);
      return { reply: msg, end: true };
    }
    const provider = await a.models.provider();
    let reply = '';
    let end = false;
    if (provider.id === 'local') {
      const turns = fresh.transcript.filter((t) => t.role === 'agent').length;
      if (turns === 0) {
        const goal = String(fresh.goal ?? '').replace(/^to\s+/i, '').replace(/[.!]+$/, '');
        reply = fresh.direction === 'out' ? `Hello, this is Aether, an AI assistant calling for ${(await a.settings.get()).owner.name || 'my owner'}. I'm calling to ${goal.charAt(0).toLowerCase()}${goal.slice(1)}.` : 'Hello, this is Aether. How can I help?';
      }
      else if (/\b(bye|goodbye|that's all|no thanks)\b/i.test(heard ?? '') || turns >= 3) { reply = 'Thank you for your help. Goodbye.'; end = true; }
      else reply = 'Thank you, I have noted that. Is there anything else I should pass on?';
    } else {
      const messages: ChatMessage[] = fresh.transcript.map((t) => (t.role === 'agent' ? { role: 'assistant', content: t.text } : { role: 'user', content: t.text })) as ChatMessage[];
      if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: fresh.direction === 'out' ? '(The call connected. The other person picked up.)' : '(Incoming call connected.)' });
      const r = await provider.chat({ system: await this.systemPrompt(fresh), messages, tools: [END_TOOL, NOTE_TOOL], temperature: 0.5, maxTokens: 300 });
      reply = r.text.trim();
      for (const tc of r.toolCalls) {
        if (tc.name === 'end_call') end = true;
        if (tc.name === 'take_note' && tc.args?.note) this.notes.set(id, [...(this.notes.get(id) ?? []), String(tc.args.note)]);
      }
      if (!reply) reply = end ? 'Thank you. Goodbye.' : 'Sorry, could you say that again?';
    }
    await this.addTurn(id, 'agent', reply);
    return { reply, end };
  }

  /** Summarizes, stores and announces a finished call. */
  async finalize(id: string, status = 'completed') {
    const a = this.getAether();
    const call = await this.get(id);
    if (!call || call.ended_at) return call;
    await this.update(id, { status, ended_at: new Date().toISOString() });
    const notes = (this.notes.get(id) ?? []).filter((n) => !n.startsWith('message:'));
    const transcript = call.transcript.map((t) => `${t.role === 'agent' ? 'Aether' : 'Other'}: ${t.text}`).join('\n');
    let summary = transcript ? `Call ${call.direction === 'out' ? 'to' : 'from'} ${call.direction === 'out' ? call.to_number : call.from_number}: ${call.transcript.length} turns.` : 'No conversation took place.';
    const provider = await a.models.provider();
    if (provider.id !== 'local' && transcript) {
      try {
        const r = await provider.chat({ system: 'Summarize this phone call for the owner in 2-4 sentences: outcome, key facts (names, numbers, times), and any follow-up needed.', messages: [{ role: 'user', content: `Goal: ${call.goal ?? '(inbound)'}\nNotes: ${notes.join('; ')}\n\n${transcript}` }], tools: [], temperature: 0 });
        summary = r.text.trim() || summary;
      } catch { /* keep simple summary */ }
    } else if (notes.length) summary += ` Notes: ${notes.join('; ')}`;
    if (call.provider === 'mock') summary = `[Simulated call] ${summary}`;
    await this.update(id, { summary });
    this.notes.delete(id);
    if (call.provider !== 'browser') {
      await a.conversations.append('main', { role: 'assistant', channel: 'phone', content: `Phone call ${call.direction === 'out' ? 'to ' + call.to_number : 'from ' + call.from_number} ended. ${summary}`, meta: { callId: id } });
      a.notify.send({ title: `Call ${call.direction === 'out' ? 'to ' + call.to_number : 'from ' + call.from_number} ended`, body: summary.slice(0, 180), tag: 'call', url: '#phone' }).catch(() => undefined);
    }
    await a.activity.add('call', `Call ${status}: ${call.direction === 'out' ? call.to_number : call.from_number}`, { id, summary: summary.slice(0, 300) });
    return this.get(id);
  }

  /** Mock carrier: a model role-plays the callee (or a short script without a model). Clearly marked as simulated. */
  private async simulate(id: string, message?: string) {
    const a = this.getAether();
    if (message) this.notes.set(id, [`message:${message}`]);
    const provider = await a.models.provider();
    let heard: string | null = 'Hello?';
    for (let i = 0; i < 8 && !this.ending.has(id); i++) {
      const { reply, end } = await this.respond(id, heard);
      if (end) break;
      if (provider.id === 'local') heard = i === 0 ? 'Sure, I can help with that. Noted.' : 'No, that is all. Goodbye.';
      else {
        const call = (await this.get(id))!;
        const msgs: ChatMessage[] = call.transcript.map((t) => (t.role === 'agent' ? { role: 'user', content: t.text } : { role: 'assistant', content: t.text })) as ChatMessage[];
        const r = await provider.chat({ system: `You are role-playing the person or business at ${call.to_number} who just answered a phone call. Be realistic, brief (one or two sentences), and cooperative if the request is reasonable. Make up plausible details. Say goodbye when the caller wraps up.`, messages: msgs.length ? msgs : [{ role: 'user', content: reply }], tools: [], temperature: 0.7, maxTokens: 120 });
        heard = r.text.trim() || 'Okay. Goodbye.';
      }
    }
    this.ending.delete(id);
    await this.finalize(id, 'completed');
  }

  // ---------- Twilio webhooks ----------

  async verify(url: string, params: Record<string, string>, signature: string | undefined, callId?: string, t?: string): Promise<boolean> {
    // A valid per-call capability token (only ever given to Twilio inside our own TwiML/REST calls) is sufficient.
    if (callId && t && t === this.callToken(callId)) return true;
    const token = await this.getAether().vault.get('TWILIO_AUTH_TOKEN');
    return !!token && validateTwilioSignature(token, signature, url, params);
  }

  private async urls(callId: string) {
    const base = ((await this.getAether().settings.get()).publicUrl || '').replace(/\/$/, '');
    const t = this.callToken(callId);
    return { gather: `${base}/api/hooks/twilio/gather?callId=${callId}&t=${t}`, ws: `${base.replace(/^http/, 'ws')}/api/hooks/twilio/relay?callId=${callId}&t=${t}` };
  }

  /** TwiML for the first leg of a call (outbound answered or inbound ringing). */
  async voiceTwiml(params: Record<string, string>, callId?: string): Promise<string> {
    const c = await this.cfg();
    let id = callId;
    if (!id) {
      const owner = c.ownerNumbers.includes(params.From ?? '');
      if (c.inbound === 'owner-only' && !owner) return twimlSayHangup('This line only accepts calls from its owner. Goodbye.', c.voice, c.language);
      const row = await this.create({ provider: 'twilio', direction: 'in', from: params.From, to: params.To, sid: params.CallSid, status: 'in-progress', goal: owner ? 'Owner calling: act as their assistant.' : undefined });
      id = row.id;
    } else await this.update(id, { status: 'in-progress', provider_sid: params.CallSid ?? null });
    const u = await this.urls(id);
    if (c.mode === 'relay') {
      const first = await this.respond(id, null);
      if (first.end) { await this.finalize(id); return twimlSayHangup(first.reply, c.voice, c.language); }
      return twimlRelay({ wsUrl: u.ws, greeting: first.reply, language: c.language });
    }
    const first = await this.respond(id, null);
    if (first.end) { setTimeout(() => this.finalize(id!).catch(() => undefined), 1000); return twimlSayHangup(first.reply, c.voice, c.language); }
    return twimlGather({ say: first.reply, action: u.gather, voice: c.voice, language: c.language, redirect: `${u.gather}&silence=1` });
  }

  async gatherTwiml(callId: string, params: Record<string, string>, silence: boolean): Promise<string> {
    const c = await this.cfg();
    const u = await this.urls(callId);
    const speech = (params.SpeechResult ?? '').trim();
    if (!speech && silence) {
      const call = await this.get(callId);
      const silent = (call?.transcript ?? []).slice(-2).every((t) => t.text === '(silence)');
      await this.addTurn(callId, 'other', '(silence)');
      if (silent) { await this.finalize(callId); return twimlSayHangup('I will let you go. Goodbye.', c.voice, c.language); }
      return twimlGather({ say: 'Are you still there?', action: u.gather, voice: c.voice, language: c.language, redirect: `${u.gather}&silence=1` });
    }
    const r = await this.respond(callId, speech || '(inaudible)');
    if (r.end) { setTimeout(() => this.finalize(callId).catch(() => undefined), 500); return twimlSayHangup(r.reply, c.voice, c.language); }
    return twimlGather({ say: r.reply, action: u.gather, voice: c.voice, language: c.language, redirect: `${u.gather}&silence=1` });
  }

  async onStatus(callId: string, params: Record<string, string>) {
    const st = params.CallStatus ?? 'unknown';
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(st)) await this.finalize(callId, st);
    else await this.update(callId, { status: st });
  }

  /** ConversationRelay WebSocket: Twilio does STT/TTS, we stream text replies. */
  handleRelay(ws: WebSocket, callId: string) {
    ws.on('message', async (raw) => {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      try {
        if (m.type === 'setup') await this.update(callId, { status: 'in-progress', provider_sid: m.callSid ?? null });
        else if (m.type === 'prompt' && m.last !== false) {
          const r = await this.respond(callId, String(m.voicePrompt ?? ''));
          ws.send(JSON.stringify({ type: 'text', token: r.reply, last: true }));
          if (r.end) setTimeout(() => { try { ws.send(JSON.stringify({ type: 'end' })); } catch { /* closed */ } }, 2500);
        } else if (m.type === 'error') l.warn(`relay error: ${m.description}`);
      } catch (e: any) { l.warn(`relay: ${e.message}`); }
    });
    ws.on('close', () => { this.finalize(callId).catch(() => undefined); });
  }

  async sms(o: { to: string; body: string }) {
    const a = this.getAether();
    const c = await this.cfg();
    const to = o.to.replace(/[^\d+]/g, '');
    let status = 'simulated'; let sid: string | null = null; let error: string | null = null; let provider = 'mock';
    if (c.provider === 'twilio') {
      provider = 'twilio';
      const tw = await this.twilio();
      try {
        if (!tw || !c.number) throw new Error('Twilio is not configured (credentials and number).');
        const r = await tw.sms({ to, from: c.number, body: o.body });
        status = r.status ?? 'queued'; sid = r.sid;
      } catch (e: any) { status = 'failed'; error = e.message; }
    }
    const row = await this.db.one('insert into sms_messages (id, direction, from_number, to_number, body, status, provider, provider_sid, error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
      [uid('sms'), 'out', c.number || null, to, o.body, status, provider, sid, error]);
    a.bus.publish('sms.updated', row);
    await a.activity.add('sms', `SMS ${status} to ${to}`, { body: o.body.slice(0, 200), error });
    return row as any;
  }

  async smsList(limit = 50) { return this.db.query('select * from sms_messages order by created_at desc limit $1', [limit]); }

  async onInboundSms(params: Record<string, string>): Promise<string> {
    const a = this.getAether();
    const c = await this.cfg();
    const row = await this.db.one('insert into sms_messages (id, direction, from_number, to_number, body, status, provider, provider_sid) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
      [uid('sms'), 'in', params.From ?? null, params.To ?? null, params.Body ?? '', 'received', 'twilio', params.MessageSid ?? null]);
    a.bus.publish('sms.updated', row);
    if (c.ownerNumbers.includes(params.From ?? '')) {
      a.agent.run({ conversationId: 'main', text: params.Body ?? '', channel: 'sms' }).then((r) => this.sms({ to: params.From!, body: r.text.slice(0, 1500) })).catch((e) => l.warn(`sms agent: ${e.message}`));
    } else {
      a.notify.send({ title: `SMS from ${params.From}`, body: (params.Body ?? '').slice(0, 180), tag: 'sms', url: '#phone' }).catch(() => undefined);
    }
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  // ---------- In-app softphone (talk to Aether as a phone call, no carrier) ----------
  async softphoneStart() {
    const row = await this.create({ provider: 'browser', direction: 'in', from: 'owner', to: 'aether', status: 'in-progress', goal: 'Owner voice call in the app.' });
    const first = await this.respond(row.id, null);
    return { call: await this.get(row.id), reply: first.reply };
  }

  async softphoneTurn(id: string, text: string) {
    const call = await this.get(id);
    if (!call || call.ended_at) throw new Error('call is not active');
    const r = await this.respond(id, text);
    if (r.end) await this.finalize(id);
    return r;
  }
}
