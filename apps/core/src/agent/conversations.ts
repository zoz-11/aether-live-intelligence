import type { Db } from '../db/index.js';
import type { EventBus } from '../events.js';
import type { Card, Channel } from '../types.js';
import type { ChatMessage, ToolCall } from '../models/types.js';
import { uid } from '../util.js';

export const MAIN_CONVERSATION = 'main';

export interface StoredMessage {
  id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  channel: Channel;
  content: string;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  cards: Card[] | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  kind: 'chat' | 'task' | 'subagent' | 'call';
  summary: string | null;
  summary_upto: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

/** One main thread shared by voice, text, Telegram, email and phone summaries; plus side, task and sub-agent threads. */
export class ConversationStore {
  constructor(private db: Db, private bus: EventBus) {}

  async ensureMain() {
    await this.db.query(
      `insert into conversations (id, title, kind) values ($1, 'Aether', 'chat') on conflict (id) do nothing`,
      [MAIN_CONVERSATION],
    );
  }

  async create(title: string | null, kind: Conversation['kind'] = 'chat'): Promise<Conversation> {
    const row = await this.db.one<Conversation>('insert into conversations (id, title, kind) values ($1,$2,$3) returning *', [uid('cv'), title, kind]);
    this.bus.publish('conversation.created', row);
    return row!;
  }

  async get(id: string) { return this.db.one<Conversation>('select * from conversations where id=$1', [id]); }

  async list(kind: Conversation['kind'] = 'chat'): Promise<(Conversation & { last: string | null; count: number })[]> {
    return this.db.query(
      `select c.*, (select content from messages m where m.conversation_id=c.id and m.role in ('user','assistant') and m.content <> '' order by seq desc limit 1) as last,
       (select count(*)::int from messages m where m.conversation_id=c.id and m.role in ('user','assistant')) as count
       from conversations c where c.kind=$1 and not c.archived order by (c.id='main') desc, c.updated_at desc limit 100`,
      [kind],
    );
  }

  async rename(id: string, title: string) {
    await this.db.query('update conversations set title=$2, updated_at=now() where id=$1', [id, title]);
    this.bus.publish('conversation.updated', { id, title });
  }

  async remove(id: string) {
    if (id === MAIN_CONVERSATION) {
      await this.db.query('delete from messages where conversation_id=$1', [id]);
      await this.db.query(`update conversations set summary=null, summary_upto=0, updated_at=now() where id=$1`, [id]);
    } else {
      await this.db.query('delete from conversations where id=$1', [id]);
    }
    this.bus.publish('conversation.deleted', { id });
  }

  async append(conversationId: string, m: {
    role: StoredMessage['role']; channel: Channel; content?: string; toolCalls?: ToolCall[]; toolCallId?: string; toolName?: string; cards?: Card[]; meta?: Record<string, unknown>;
  }): Promise<StoredMessage> {
    const row = await this.db.one<StoredMessage>(
      `insert into messages (id, conversation_id, role, channel, content, tool_calls, tool_call_id, tool_name, cards, meta)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb) returning *`,
      [uid('msg'), conversationId, m.role, m.channel, m.content ?? '', m.toolCalls?.length ? m.toolCalls : null, m.toolCallId ?? null, m.toolName ?? null,
        m.cards?.length ? m.cards : null, m.meta ?? null],
    );
    await this.db.query('update conversations set updated_at=now() where id=$1', [conversationId]);
    this.bus.publish('message.created', row);
    return row!;
  }

  async messages(conversationId: string, opts: { limit?: number; beforeSeq?: number; afterSeq?: number } = {}): Promise<StoredMessage[]> {
    const limit = Math.min(opts.limit ?? 200, 1000);
    if (opts.afterSeq !== undefined) {
      return this.db.query<StoredMessage>('select * from messages where conversation_id=$1 and seq > $2 order by seq asc limit $3', [conversationId, opts.afterSeq, limit]);
    }
    const rows = opts.beforeSeq
      ? await this.db.query<StoredMessage>('select * from messages where conversation_id=$1 and seq < $2 order by seq desc limit $3', [conversationId, opts.beforeSeq, limit])
      : await this.db.query<StoredMessage>('select * from messages where conversation_id=$1 order by seq desc limit $2', [conversationId, limit]);
    return rows.reverse().map((r) => ({ ...r, seq: Number(r.seq) }));
  }

  async setSummary(id: string, summary: string, upto: number) {
    await this.db.query('update conversations set summary=$2, summary_upto=$3 where id=$1', [id, summary, upto]);
  }

  async countSince(id: string, seq: number): Promise<number> {
    const r = await this.db.one<{ n: number }>('select count(*)::int as n from messages where conversation_id=$1 and seq > $2', [id, seq]);
    return Number(r?.n ?? 0);
  }

  /** Builds model-ready history after the rolling summary, keeping tool calls and results paired. */
  async history(conversationId: string, limit = 40): Promise<{ summary: string | null; messages: ChatMessage[] }> {
    const conv = await this.get(conversationId);
    const upto = Number(conv?.summary_upto ?? 0);
    let rows = await this.db.query<StoredMessage>(
      'select * from messages where conversation_id=$1 and seq > $2 order by seq desc limit $3',
      [conversationId, upto, limit],
    );
    rows = rows.reverse();
    // Never start on a tool result or on an assistant tool call whose results were cut off.
    while (rows.length && (rows[0].role === 'tool' || (rows[0].role === 'assistant' && rows[0].tool_calls?.length))) rows.shift();
    const out: ChatMessage[] = [];
    const answered = new Set(rows.filter((r) => r.role === 'tool' && r.tool_call_id).map((r) => r.tool_call_id!));
    const seenCalls = new Set<string>();
    for (const r of rows) {
      if (r.role === 'user') out.push({ role: 'user', content: channelPrefix(r.channel) + r.content });
      else if (r.role === 'assistant') {
        const calls = (r.tool_calls ?? []).filter((c) => answered.has(c.id));
        calls.forEach((c) => seenCalls.add(c.id));
        if (!r.content && !calls.length) continue;
        out.push({ role: 'assistant', content: r.content, toolCalls: calls.length ? calls : undefined });
      } else if (r.role === 'tool' && r.tool_call_id && seenCalls.has(r.tool_call_id)) {
        out.push({ role: 'tool', toolCallId: r.tool_call_id, name: r.tool_name ?? 'tool', content: r.content });
      }
    }
    return { summary: conv?.summary ?? null, messages: out };
  }
}

function channelPrefix(ch: Channel): string {
  switch (ch) {
    case 'voice': return '[voice] ';
    case 'telegram': return '[telegram] ';
    case 'sms': return '[sms] ';
    case 'email': return '[email] ';
    case 'phone': return '[phone] ';
    case 'task': return '[task] ';
    case 'system': return '[system] ';
    default: return '';
  }
}
