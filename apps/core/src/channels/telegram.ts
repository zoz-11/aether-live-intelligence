import type { Aether } from '../types.js';
import type { Approval, Decision } from '../agent/sentinel.js';
import { log, sleep } from '../util.js';

const l = log('telegram');

/** Telegram channel: owner-only chat with Aether on the main thread, plus approval buttons. Long polling, no public URL needed. */
export class TelegramChannel {
  private running = false;
  private offset = 0;
  private ctrl: AbortController | null = null;
  private me: { username?: string } | null = null;
  private lastError: string | null = null;
  private warned = new Set<string>();

  constructor(private getAether: () => Aether) {}

  isRunning() { return this.running; }

  private async token() { return this.getAether().vault.get('TELEGRAM_BOT_TOKEN'); }

  async api(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<any> {
    const token = await this.token();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? res.status}`);
    return j.result;
  }

  async start() {
    if (this.running || !(await this.token())) return;
    try { this.me = await this.api('getMe'); } catch (e: any) { this.lastError = e.message; l.warn(e.message); return; }
    this.running = true;
    this.ctrl = new AbortController();
    void this.loop(this.ctrl.signal);
    l.info(`polling as @${this.me?.username}`);
  }

  stop() { this.running = false; this.ctrl?.abort(); this.ctrl = null; }

  private async loop(signal: AbortSignal) {
    while (this.running && !signal.aborted) {
      try {
        const updates: any[] = await this.api('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, signal);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          this.handle(u).catch((e) => l.warn(`update: ${e.message}`));
        }
        this.lastError = null;
      } catch (e: any) {
        if (signal.aborted) break;
        this.lastError = e.message;
        await sleep(5000, signal).catch(() => undefined);
      }
    }
  }

  private async owners(): Promise<string[]> { return (await this.getAether().settings.get()).telegram.ownerChatIds.map(String); }

  private async handle(u: any) {
    const a = this.getAether();
    if (u.callback_query) {
      const q = u.callback_query;
      const chat = String(q.message?.chat?.id ?? '');
      if (!(await this.owners()).includes(chat)) return this.api('answerCallbackQuery', { callback_query_id: q.id, text: 'Not authorized' });
      const [kind, id, decision] = String(q.data ?? '').split(':');
      if (kind === 'ap') {
        try {
          await a.sentinel.decide(id, decision as Decision, { via: 'telegram' });
          await this.api('answerCallbackQuery', { callback_query_id: q.id, text: decision === 'deny' ? 'Denied' : 'Approved' });
          await this.api('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        } catch (e: any) { await this.api('answerCallbackQuery', { callback_query_id: q.id, text: e.message.slice(0, 180) }); }
      }
      return;
    }
    const m = u.message;
    if (!m?.chat?.id) return;
    const chat = String(m.chat.id);
    const text: string = m.text ?? m.caption ?? '';
    const s = await a.settings.get();
    const pair = text.match(/^\/pair\s+(\S+)/);
    if (pair) {
      if (s.telegram.pairingCode && pair[1] === s.telegram.pairingCode) {
        await a.settings.patch({ telegram: { ownerChatIds: [...new Set([...s.telegram.ownerChatIds, chat])], pairingCode: '' } });
        await a.activity.add('telegram', `Telegram chat paired (${m.chat.username ?? chat})`);
        return this.api('sendMessage', { chat_id: chat, text: 'Paired. You can talk to Aether here, and approve actions with buttons.' });
      }
      return this.api('sendMessage', { chat_id: chat, text: 'That pairing code is not valid. Generate a new one in Aether → Settings → Telegram.' });
    }
    if (!(await this.owners()).includes(chat)) {
      if (!this.warned.has(chat)) { this.warned.add(chat); await this.api('sendMessage', { chat_id: chat, text: 'This is a private assistant. Pair it from Aether → Settings → Telegram, then send /pair CODE.' }); }
      return;
    }
    if (!text.trim() || text === '/start') return this.api('sendMessage', { chat_id: chat, text: 'Aether is listening.' });
    await this.api('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => undefined);
    const r = await a.agent.run({ conversationId: 'main', text, channel: 'telegram' });
    const cardText = r.cards.map((c) => [c.title, c.body, ...(c.items ?? []).map((i) => `• ${typeof i === 'string' ? i : i.title}`), ...(c.rows ?? []).map((x) => `${x.label}: ${x.value}`), ...(c.links ?? []).map((x) => `${x.title}: ${x.url}`)].filter(Boolean).join('\n')).join('\n\n');
    const out = [r.text, cardText].filter(Boolean).join('\n\n') || 'Done.';
    for (let i = 0; i < out.length; i += 3900) await this.api('sendMessage', { chat_id: chat, text: out.slice(i, i + 3900) });
  }

  async sendToOwners(text: string, markup?: unknown): Promise<number> {
    let n = 0;
    for (const chat of await this.owners()) {
      try { await this.api('sendMessage', { chat_id: chat, text, parse_mode: 'Markdown', reply_markup: markup }); n++; } catch (e: any) {
        try { await this.api('sendMessage', { chat_id: chat, text: text.replace(/\\([_*`\[])/g, '$1'), reply_markup: markup }); n++; } catch { l.warn(`send failed: ${e.message}`); }
      }
    }
    return n;
  }

  async sendApproval(ap: Approval) {
    const buttons = [[
      { text: 'Allow once', callback_data: `ap:${ap.id}:allow_once` },
      { text: 'Always', callback_data: `ap:${ap.id}:allow_always` },
      { text: 'Deny', callback_data: `ap:${ap.id}:deny` },
    ]];
    return this.sendToOwners(`Approval needed (${ap.risk}): ${ap.summary}`, { inline_keyboard: buttons });
  }

  async status() {
    const s = await this.getAether().settings.get();
    return { configured: !!(await this.token()), running: this.running, bot: this.me?.username ?? null, owners: s.telegram.ownerChatIds.length, pairingCode: s.telegram.pairingCode || null, error: this.lastError };
  }
}
