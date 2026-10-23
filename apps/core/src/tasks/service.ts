import { Cron } from 'croner';
import type { Aether } from '../types.js';
import { log, parseWhen, uid } from '../util.js';

const l = log('tasks');

export interface TaskRow {
  id: string; title: string; goal: string;
  status: 'queued' | 'scheduled' | 'running' | 'waiting_approval' | 'paused' | 'done' | 'failed' | 'cancelled';
  schedule: string | null; schedule_kind: 'once' | 'cron' | 'reminder' | null;
  next_run_at: string | null; last_run_at: string | null; conversation_id: string | null;
  result: string | null; error: string | null; runs: number; notify: boolean; origin: string | null;
  created_at: string; updated_at: string;
}

/** Durable background tasks and routines: queue, schedule (one-shot or cron), pause/resume/cancel/retry. */
export class TaskService {
  private timer: NodeJS.Timeout | null = null;
  private running = new Map<string, AbortController>();
  private ticking = false;
  maxConcurrent = 2;

  constructor(private getAether: () => Aether) {}
  private get db() { return this.getAether().db; }

  async start() {
    const a = this.getAether();
    await this.db.query(`update tasks set status='queued', updated_at=now() where status in ('running','waiting_approval')`);
    a.bus.on('approval.created', (ev: any) => { const t = ev.data?.task_id; if (t && this.running.has(t)) this.setStatus(t, 'waiting_approval').catch(() => undefined); });
    a.bus.on('approval.resolved', async (ev: any) => {
      const ap = await this.db.one<{ task_id: string | null }>('select task_id from approvals where id=$1', [ev.data?.id]);
      if (ap?.task_id && this.running.has(ap.task_id)) await this.setStatus(ap.task_id, 'running');
    });
    this.timer = setInterval(() => this.tick().catch((e) => l.warn(`tick: ${e.message}`)), 3000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.running.values()) c.abort();
  }

  private async setStatus(id: string, status: TaskRow['status'], extra: Partial<TaskRow> = {}) {
    const sets = ['status=$2', 'updated_at=now()'];
    const vals: unknown[] = [id, status];
    for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
    const row = await this.db.one<TaskRow>(`update tasks set ${sets.join(', ')} where id=$1 returning *`, vals);
    if (row) this.getAether().bus.publish('task.updated', row);
    return row;
  }

  nextCron(expr: string, tz: string): Date | null {
    try { return new Cron(expr, { timezone: tz }).nextRun() ?? null; } catch { return null; }
  }

  async create(o: { title: string; goal: string; when?: string; cron?: string; kind?: 'reminder' | 'task'; notify?: boolean; origin?: string }): Promise<TaskRow> {
    const a = this.getAether();
    const tz = (await a.settings.get()).owner.timezone || 'UTC';
    let next: Date | null = new Date();
    let kind: TaskRow['schedule_kind'] = o.kind === 'reminder' ? 'reminder' : 'once';
    let schedule: string | null = null;
    if (o.cron) {
      next = this.nextCron(o.cron, tz);
      if (!next) throw new Error(`Invalid cron expression "${o.cron}" (use 5 fields like "0 8 * * *").`);
      kind = 'cron'; schedule = o.cron;
    } else if (o.when) {
      next = parseWhen(o.when, new Date(), tz);
      if (!next) throw new Error(`Could not understand the time "${o.when}". Use "in 10 minutes", "tomorrow at 9am" or an ISO date.`);
      schedule = o.when;
    }
    const status = next && next.getTime() > Date.now() + 1000 ? 'scheduled' : 'queued';
    const row = await this.db.one<TaskRow>(
      `insert into tasks (id, title, goal, status, schedule, schedule_kind, next_run_at, notify, origin) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [uid('task'), o.title.slice(0, 120), o.goal, status, schedule, kind, next, o.notify ?? true, o.origin ?? 'agent'],
    );
    a.bus.publish('task.updated', row);
    await a.activity.add('task', `Task ${status}: ${o.title}`, { id: row!.id, next: next?.toISOString(), schedule }, { taskId: row!.id });
    setTimeout(() => this.tick().catch(() => undefined), 50);
    return row!;
  }

  async list(limit = 100) { return this.db.query<TaskRow>(`select * from tasks order by (status in ('running','waiting_approval','queued','scheduled','paused')) desc, coalesce(next_run_at, created_at) desc limit $1`, [limit]); }
  async get(id: string) { return this.db.one<TaskRow>('select * from tasks where id=$1', [id]); }

  async pause(id: string) { this.running.get(id)?.abort(); return this.setStatus(id, 'paused'); }
  async resume(id: string) {
    const t = await this.get(id);
    if (!t) throw new Error('task not found');
    const future = t.next_run_at && new Date(t.next_run_at).getTime() > Date.now();
    return this.setStatus(id, future ? 'scheduled' : 'queued');
  }
  async cancel(id: string) { this.running.get(id)?.abort(); return this.setStatus(id, 'cancelled', { next_run_at: null } as any); }
  async runNow(id: string) { const r = await this.setStatus(id, 'queued', { next_run_at: new Date().toISOString() } as any); setTimeout(() => this.tick().catch(() => undefined), 20); return r; }
  async remove(id: string) { this.running.get(id)?.abort(); await this.db.query('delete from tasks where id=$1', [id]); this.getAether().bus.publish('task.updated', { id, removed: true }); }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const free = this.maxConcurrent - this.running.size;
      if (free <= 0) return;
      const due = await this.db.query<TaskRow>(`select * from tasks where status in ('queued','scheduled') and (next_run_at is null or next_run_at <= now()) order by next_run_at asc nulls first limit $1`, [free]);
      for (const t of due) if (!this.running.has(t.id)) this.run(t).catch((e) => l.warn(`run ${t.id}: ${e.message}`));
    } finally { this.ticking = false; }
  }

  private async run(t: TaskRow) {
    const a = this.getAether();
    const ctrl = new AbortController();
    this.running.set(t.id, ctrl);
    await this.setStatus(t.id, 'running', { last_run_at: new Date().toISOString(), runs: t.runs + 1 } as any);
    const tz = (await a.settings.get()).owner.timezone || 'UTC';
    try {
      let result: string;
      if (t.schedule_kind === 'reminder') {
        result = t.goal.replace(/^Remind the owner:\s*/i, 'Reminder: ');
      } else {
        let conv = t.conversation_id;
        if (!conv) { conv = (await a.conversations.create(t.title, 'task')).id; await this.db.query('update tasks set conversation_id=$2 where id=$1', [t.id, conv]); }
        const r = await a.agent.run({ conversationId: conv, text: t.runs > 0 ? `Run this routine again now: ${t.goal}` : t.goal, channel: 'task', taskId: t.id, taskGoal: t.goal, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (r.error && r.error !== 'Stopped.') throw new Error(r.error);
        result = r.text;
      }
      const next = t.schedule_kind === 'cron' && t.schedule ? this.nextCron(t.schedule, tz) : null;
      await this.setStatus(t.id, next ? 'scheduled' : 'done', { result: result.slice(0, 8000), error: null, next_run_at: next ? next.toISOString() : null } as any);
      await a.conversations.append('main', { role: 'assistant', channel: 'task', content: t.schedule_kind === 'reminder' ? result : `Task “${t.title}” ${next ? 'ran' : 'finished'}: ${result}`, meta: { taskId: t.id } });
      if (t.notify) await a.notify.send({ title: t.schedule_kind === 'reminder' ? 'Reminder' : `Task done: ${t.title}`, body: result.slice(0, 200), tag: `task-${t.id}`, url: '#tasks' }).catch(() => undefined);
    } catch (e: any) {
      if (ctrl.signal.aborted) return;
      await this.setStatus(t.id, 'failed', { error: String(e?.message ?? e).slice(0, 2000) } as any);
      await a.notify.send({ title: `Task failed: ${t.title}`, body: String(e?.message ?? e).slice(0, 200), tag: `task-${t.id}`, url: '#tasks' }).catch(() => undefined);
    } finally {
      this.running.delete(t.id);
    }
  }
}
