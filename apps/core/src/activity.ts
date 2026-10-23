import type { Db } from './db/index.js';
import type { EventBus } from './events.js';

export interface ActivityEntry {
  id: number;
  ts: string;
  kind: string;
  title: string;
  detail: unknown;
  conversation_id: string | null;
  task_id: string | null;
  level: 'info' | 'warn' | 'error';
}

/** Append-only audit trail: every tool call, approval, message from outside, task run. */
export class ActivityLog {
  constructor(private db: Db, private bus: EventBus) {}

  async add(kind: string, title: string, detail?: unknown, opts: { conversationId?: string; taskId?: string; level?: 'info' | 'warn' | 'error' } = {}) {
    const row = await this.db.one<ActivityEntry>(
      `insert into activity (kind, title, detail, conversation_id, task_id, level) values ($1,$2,$3::jsonb,$4,$5,$6) returning *`,
      [kind, title.slice(0, 500), detail ?? null, opts.conversationId ?? null, opts.taskId ?? null, opts.level ?? 'info'],
    );
    if (row) this.bus.publish('activity', row);
    return row;
  }

  async list(limit = 200, before?: number): Promise<ActivityEntry[]> {
    if (before) return this.db.query<ActivityEntry>('select * from activity where id < $1 order by id desc limit $2', [before, limit]);
    return this.db.query<ActivityEntry>('select * from activity order by id desc limit $1', [limit]);
  }
}
