import type { Aether, Card, Channel, ClientContext, RunScope, ToolContext, ToolDef, ToolImage, ToolResult, TurnEvent } from '../types.js';
import type { ChatMessage, ToolCall } from '../models/types.js';
import { buildSystemPrompt } from './prompt.js';
import { log, truncate, uid } from '../util.js';

const l = log('agent');

export interface RunOptions {
  conversationId: string;
  text: string;
  channel: Channel;
  client?: ClientContext;
  images?: ToolImage[];
  taskId?: string;
  taskGoal?: string;
  signal?: AbortSignal;
  onEvent?: (ev: TurnEvent) => void;
  toolFilter?: (t: ToolDef) => boolean;
  systemExtra?: string;
  maxSteps?: number;
  depth?: number;
  scope?: RunScope;
  turnId?: string;
  /** Skip memory extraction (sub-agents, phone calls handle their own). */
  noMemory?: boolean;
}

export interface RunResult {
  turnId: string;
  text: string;
  cards: Card[];
  messageId: string | null;
  toolCalls: number;
  provider: string;
  notice?: string;
  error?: string;
}

const MAX_TOOL_OUTPUT = 12000;

function shortArgs(args: unknown): unknown {
  try {
    const s = JSON.stringify(args ?? {});
    return s.length > 1500 ? JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v))) : args;
  } catch { return {}; }
}

/** The agent loop: model ↔ tools, gated by plugins and Sentinel, streamed as turn events. */
export class AgentRunner {
  private queues = new Map<string, Promise<unknown>>();
  private active = new Map<string, AbortController>();

  constructor(private getAether: () => Aether) {}

  cancel(turnId: string) {
    const c = this.active.get(turnId);
    if (c) { c.abort(); return true; }
    return false;
  }

  activeTurns() { return [...this.active.keys()]; }

  /** Runs one turn. Turns in the same conversation are serialized so history stays consistent. */
  run(opts: RunOptions): Promise<RunResult> {
    const prev = this.queues.get(opts.conversationId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.runInner(opts));
    this.queues.set(opts.conversationId, next.catch(() => undefined));
    return next;
  }

  async executeTool(call: ToolCall, ctx: ToolContext, filter?: (t: ToolDef) => boolean): Promise<ToolResult> {
    const a = this.getAether();
    const found = a.plugins.findTool(call.name);
    if (!found) return { ok: false, content: `Unknown tool "${call.name}".` };
    if (!found.enabled) return { ok: false, content: `The ${found.plugin.name} plugin is turned off, so ${call.name} is unavailable. The owner can enable it in Settings → Plugins.` };
    if (filter && !filter(found.tool)) return { ok: false, content: `${call.name} is not available in this context.` };
    const tool = found.tool;
    let args = call.args ?? {};
    if (args && typeof args === 'object' && '_raw' in args) return { ok: false, content: `Arguments for ${call.name} were not valid JSON. Retry with valid JSON arguments.` };
    const gate = await a.sentinel.check(tool, args, ctx);
    if (!gate.ok) {
      await a.activity.add('tool', `Blocked ${call.name}`, { args: shortArgs(args), reason: gate.reason }, { conversationId: ctx.conversationId, taskId: ctx.taskId, level: 'warn' });
      return { ok: false, content: gate.reason };
    }
    let result: ToolResult;
    try {
      if (tool.resolveSecrets) args = await a.vault.resolve(args);
      result = await tool.run(args, ctx);
    } catch (e: any) {
      result = { ok: false, content: `Error: ${e?.message ?? String(e)}` };
    }
    const content = truncate(await a.vault.redact(String(result.content ?? '')), MAX_TOOL_OUTPUT);
    const action = typeof call.args?.action === 'string' ? ` · ${call.args.action}` : '';
    await a.activity.add('tool', `${call.name}${action}`, { args: shortArgs(call.args), ok: result.ok, result: content.slice(0, 400) },
      { conversationId: ctx.conversationId, taskId: ctx.taskId, level: result.ok ? 'info' : 'warn' });
    return { ...result, content };
  }

  private async runInner(o: RunOptions): Promise<RunResult> {
    const a = this.getAether();
    const turnId = o.turnId ?? uid('turn');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    this.active.set(turnId, controller);
    const signal = controller.signal;
    const emit = (ev: TurnEvent) => { try { o.onEvent?.({ ...ev, turnId }); } catch { /* client gone */ } };
    const scope: RunScope = o.scope ?? { grants: new Set(), taskId: o.taskId };
    const settings = await a.settings.get();
    const maxSteps = Math.max(1, Math.min(o.maxSteps ?? settings.model.maxSteps ?? 14, 40));
    const cards: Card[] = [];
    let toolCount = 0;
    let finalText = '';
    let errorText: string | undefined;

    try {
      const userMsg = await a.conversations.append(o.conversationId, { role: 'user', channel: o.channel, content: o.text, meta: o.images?.length ? { images: o.images.length } : undefined });
      emit({ type: 'turn.start', conversationId: o.conversationId, userMessage: userMsg });
      const provider = await a.models.provider();
      if (provider.notice) emit({ type: 'status', notice: provider.notice });
      const tools = a.plugins.tools(o.toolFilter);
      const specs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
      const hist = await a.conversations.history(o.conversationId, 40);
      const messages: ChatMessage[] = hist.messages;
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser && o.images?.length && lastUser.role === 'user') lastUser.images = o.images;
      const system = await buildSystemPrompt(a, {
        channel: o.channel, client: o.client, query: o.text, summary: hist.summary, taskGoal: o.taskGoal, extra: o.systemExtra, toolNames: specs.map((s) => s.name),
      });
      const ctx: ToolContext = { aether: a, conversationId: o.conversationId, taskId: o.taskId, channel: o.channel, signal, emit, client: o.client, scope, depth: o.depth ?? 0 };

      for (let step = 0; step < maxSteps; step++) {
        if (signal.aborted) throw new Error('cancelled');
        const resp = await provider.chat({
          system, messages, tools: specs, signal, temperature: settings.model.temperature,
          onText: (d) => emit({ type: 'text.delta', text: d, step }),
        });
        if (!resp.toolCalls.length) { finalText = resp.text; break; }
        const calls = resp.toolCalls.slice(0, 8);
        await a.conversations.append(o.conversationId, { role: 'assistant', channel: o.channel, content: resp.text, toolCalls: calls });
        messages.push({ role: 'assistant', content: resp.text, toolCalls: calls });
        for (const c of calls) {
          if (signal.aborted) throw new Error('cancelled');
          const found = a.plugins.findTool(c.name);
          let summary = c.name;
          try { summary = found?.tool.describe?.(c.args ?? {}) ?? c.name; } catch { /* ignore */ }
          emit({ type: 'tool.start', id: c.id, name: c.name, args: shortArgs(c.args), summary });
          const r = await this.executeTool(c, ctx, o.toolFilter);
          toolCount++;
          await a.conversations.append(o.conversationId, { role: 'tool', channel: o.channel, content: r.content, toolCallId: c.id, toolName: c.name, meta: { ok: r.ok } });
          messages.push({ role: 'tool', toolCallId: c.id, name: c.name, content: r.content, images: r.images, isError: !r.ok });
          if (r.card) { cards.push(r.card); emit({ type: 'card', card: r.card }); }
          emit({ type: 'tool.end', id: c.id, name: c.name, ok: r.ok, content: r.content.slice(0, 600), card: r.card, hasImage: !!r.images?.length });
        }
        if (step === maxSteps - 1) {
          const wrap = await provider.chat({ system: system + '\n\nYou reached the step limit. Summarize what was done and what remains, without calling tools.', messages, tools: [], signal, onText: (d) => emit({ type: 'text.delta', text: d, step: step + 1 }) });
          finalText = wrap.text || 'I reached my step limit for this turn.';
        }
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      errorText = msg === 'cancelled' || msg === 'aborted' || signal.aborted ? 'Stopped.' : msg;
      if (!finalText) finalText = errorText === 'Stopped.' ? 'Stopped.' : `I hit an error: ${errorText.slice(0, 300)}`;
      if (errorText !== 'Stopped.') { l.warn(`turn failed: ${msg}`); emit({ type: 'error', message: errorText }); }
    } finally {
      this.active.delete(turnId);
      o.signal?.removeEventListener('abort', onAbort);
    }

    const provider = await a.models.describe();
    const finalMsg = await a.conversations.append(o.conversationId, {
      role: 'assistant', channel: o.channel, content: finalText || (cards.length ? '' : 'Done.'), cards,
      meta: { provider: provider.provider, model: provider.model, tools: toolCount, error: errorText ?? null },
    });
    emit({ type: 'turn.end', message: finalMsg });

    if (!o.noMemory && !errorText && a.plugins.isEnabled('memory') && o.channel !== 'task') {
      a.memory.extract(`conversation:${o.conversationId}`, o.text, finalText).catch((e) => l.warn(`memory extract: ${e?.message}`));
    }
    this.maybeCompact(o.conversationId).catch((e) => l.warn(`compaction: ${e?.message}`));
    return { turnId, text: finalMsg.content, cards, messageId: finalMsg.id, toolCalls: toolCount, provider: provider.provider, error: errorText };
  }

  /** Rolls old messages into a summary once a thread gets long. */
  async maybeCompact(conversationId: string) {
    const a = this.getAether();
    const conv = await a.conversations.get(conversationId);
    if (!conv) return;
    const since = await a.conversations.countSince(conversationId, Number(conv.summary_upto));
    if (since < 80) return;
    const all = await a.conversations.messages(conversationId, { afterSeq: Number(conv.summary_upto), limit: 1000 });
    const cut = all.length - 24;
    if (cut <= 0) return;
    const chunk = all.slice(0, cut).filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content));
    const upto = Number(all[cut - 1].seq);
    const provider = await a.models.provider();
    let summary = conv.summary ?? '';
    const transcript = chunk.map((m) => `${m.role === 'user' ? 'Owner' : 'Aether'} (${m.channel}): ${m.content.slice(0, 500)}`).join('\n');
    if (provider.id === 'local') {
      summary = (summary + '\n' + chunk.slice(-12).map((m) => `- ${m.role}: ${m.content.slice(0, 160)}`).join('\n')).slice(-4000);
    } else {
      const r = await provider.chat({
        system: 'Summarize this conversation segment for your own future reference: decisions, facts, open loops, promises, and preferences. Be dense and factual. Max 250 words.',
        messages: [{ role: 'user', content: `${summary ? 'Previous summary:\n' + summary + '\n\n' : ''}New segment:\n${transcript.slice(0, 30000)}` }], tools: [], temperature: 0,
      });
      summary = r.text.trim() || summary;
    }
    await a.conversations.setSummary(conversationId, summary, upto);
  }
}
