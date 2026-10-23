import type { Aether, Risk, ToolContext, ToolDef } from '../types.js';
import { uid } from '../util.js';

export type Decision = 'allow_once' | 'allow_task' | 'allow_always' | 'deny';

export interface Approval {
  id: string;
  kind: 'tool' | 'question' | 'secret';
  tool: string;
  action: string | null;
  risk: Risk;
  summary: string;
  args: any;
  conversation_id: string | null;
  task_id: string | null;
  channel: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decision: Decision | null;
  input_schema: any;
  created_at: string;
  decided_at: string | null;
}

export function needsApproval(risk: Risk, mode: 'careful' | 'balanced' | 'autonomous'): boolean {
  if (risk === 'critical') return true;
  if (risk === 'read') return false;
  if (mode === 'careful') return true; // write + danger
  if (mode === 'balanced') return risk === 'danger';
  return false; // autonomous: only critical
}

/**
 * Sentinel sits outside the model. It decides whether a tool call may run, asks the user when
 * needed, and records the decision. The model cannot approve anything: approvals are resolved
 * only through authenticated user gestures (app, Telegram buttons from the owner chat).
 */
export class Sentinel {
  private waiters = new Map<string, (r: { decision: Decision | 'expired' }) => void>();

  constructor(private getAether: () => Aether) {}

  async init() {
    await this.getAether().db.query(`update approvals set status='expired', decided_at=now() where status='pending'`);
  }

  riskOf(tool: ToolDef, args: any): Risk {
    try { return typeof tool.risk === 'function' ? tool.risk(args ?? {}) : tool.risk; } catch { return 'danger'; }
  }

  async hasGrant(tool: string, action: string) {
    const row = await this.getAether().db.one(`select id from grants where tool=$1 and (action=$2 or action='*')`, [tool, action]);
    return !!row;
  }

  async check(tool: ToolDef, args: any, ctx: ToolContext): Promise<{ ok: true; asked: boolean } | { ok: false; reason: string }> {
    const a = this.getAether();
    const risk = this.riskOf(tool, args);
    const { policy } = await a.settings.get();
    if (!needsApproval(risk, policy.mode)) return { ok: true, asked: false };
    const action = typeof args?.action === 'string' ? args.action : '';
    const key = `${tool.name}:${action}`;
    // Grants are explicit user choices ("this task" or "always") for this exact tool + action.
    if (ctx.scope.grants.has(key) || ctx.scope.grants.has(`${tool.name}:*`)) return { ok: true, asked: false };
    if (await this.hasGrant(tool.name, action)) return { ok: true, asked: false };
    const summary = (() => { try { return tool.describe?.(args) ?? `${tool.name}${action ? ' · ' + action : ''}`; } catch { return tool.name; } })();
    const res = await this.request({
      kind: 'tool', tool: tool.name, action, risk, summary, args,
      conversationId: ctx.conversationId, taskId: ctx.taskId, channel: ctx.channel,
    }, ctx);
    switch (res.decision) {
      case 'allow_once': return { ok: true, asked: true };
      case 'allow_task': ctx.scope.grants.add(key); return { ok: true, asked: true };
      case 'allow_always':
        await a.db.query('insert into grants (id, tool, action, note) values ($1,$2,$3,$4)', [uid('gr'), tool.name, action, summary]);
        return { ok: true, asked: true };
      case 'deny': return { ok: false, reason: 'The user denied this action. Do not retry it; offer an alternative or ask what they prefer.' };
      default: return { ok: false, reason: 'The approval request timed out without an answer. Nothing was done.' };
    }
  }

  /** Creates an approval request and waits for the user's decision. */
  async request(
    input: { kind: Approval['kind']; tool: string; action?: string; risk: Risk; summary: string; args?: any; conversationId?: string; taskId?: string; channel?: string; inputSchema?: any },
    ctx?: Pick<ToolContext, 'emit' | 'signal'> & { taskId?: string },
  ): Promise<{ decision: Decision | 'expired'; approval: Approval }> {
    const a = this.getAether();
    const approval = await a.db.one<Approval>(
      `insert into approvals (id, kind, tool, action, risk, summary, args, conversation_id, task_id, channel, input_schema)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb) returning *`,
      [uid('ap'), input.kind, input.tool, input.action ?? null, input.risk, input.summary, input.args ?? null,
        input.conversationId ?? null, input.taskId ?? null, input.channel ?? null, input.inputSchema ?? null],
    );
    if (!approval) throw new Error('failed to create approval');
    a.bus.publish('approval.created', approval);
    ctx?.emit({ type: 'approval', approval });
    await a.activity.add('approval', `Approval requested: ${input.summary}`, { id: approval.id, risk: input.risk, tool: input.tool }, { conversationId: input.conversationId, taskId: input.taskId });
    a.notify.approvalRequested(approval).catch(() => undefined);

    const { policy } = await a.settings.get();
    const timeoutMs = (input.taskId ? 24 * 3600 : policy.approvalTimeoutSec) * 1000;
    const decision = await new Promise<Decision | 'expired'>((resolve) => {
      const timer = setTimeout(() => finish('expired'), timeoutMs);
      const onAbort = () => finish('expired');
      const finish = (d: Decision | 'expired') => {
        clearTimeout(timer);
        ctx?.signal?.removeEventListener('abort', onAbort);
        this.waiters.delete(approval.id);
        resolve(d);
      };
      ctx?.signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(approval.id, (r) => finish(r.decision));
    });
    if (decision === 'expired') {
      await a.db.query(`update approvals set status='expired', decided_at=now() where id=$1 and status='pending'`, [approval.id]);
      a.bus.publish('approval.resolved', { id: approval.id, decision: 'expired' });
    }
    ctx?.emit({ type: 'approval.resolved', id: approval.id, decision });
    return { decision, approval };
  }

  /** Resolves a pending approval. For secret requests the value goes straight to the vault, never to the model. */
  async decide(id: string, decision: Decision, opts: { input?: string; via?: string } = {}) {
    const a = this.getAether();
    const ap = await a.db.one<Approval>('select * from approvals where id=$1', [id]);
    if (!ap) throw new Error('approval not found');
    if (ap.status !== 'pending') throw new Error(`approval already ${ap.status}`);
    if (!['allow_once', 'allow_task', 'allow_always', 'deny'].includes(decision)) throw new Error('invalid decision');
    if (ap.kind === 'secret' && decision !== 'deny') {
      const name = ap.args?.name;
      if (!opts.input) throw new Error('secret value required');
      await a.vault.set(name, opts.input, ap.args?.description);
    }
    const status = decision === 'deny' ? 'denied' : 'approved';
    await a.db.query('update approvals set status=$2, decision=$3, decided_at=now() where id=$1', [id, status, decision]);
    await a.activity.add('approval', `${status === 'approved' ? 'Approved' : 'Denied'}: ${ap.summary}`, { id, decision, via: opts.via ?? 'app' }, { conversationId: ap.conversation_id ?? undefined, taskId: ap.task_id ?? undefined });
    a.bus.publish('approval.resolved', { id, decision });
    const w = this.waiters.get(id);
    if (w) w({ decision });
    return { ...ap, status, decision };
  }

  async pending(): Promise<Approval[]> {
    return this.getAether().db.query<Approval>(`select * from approvals where status='pending' order by created_at asc`);
  }

  async recent(limit = 50): Promise<Approval[]> {
    return this.getAether().db.query<Approval>('select * from approvals order by created_at desc limit $1', [limit]);
  }

  async grants() {
    return this.getAether().db.query('select * from grants order by created_at desc');
  }

  async revoke(id: string) {
    await this.getAether().db.query('delete from grants where id=$1', [id]);
    this.getAether().bus.publish('grants.changed', null);
  }
}
