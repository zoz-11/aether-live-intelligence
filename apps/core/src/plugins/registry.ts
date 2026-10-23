import type { Aether, Channel, ClientContext, Plugin, ToolDef } from '../types.js';
import { log } from '../util.js';

const l = log('plugins');

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  category: Plugin['category'];
  enabled: boolean;
  defaultEnabled: boolean;
  error: string | null;
  tools: { name: string; description: string }[];
  secrets: string[];
  status?: Record<string, unknown>;
}

/**
 * Plugin kernel: "everything is a plugin". Plugins own their tools, prompt hints, lifecycle and
 * status. Tools are gated twice: hidden from the model when the plugin is off, and refused at
 * execute time if the plugin was switched off mid-turn.
 */
export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private enabled = new Map<string, boolean>();
  private errors = new Map<string, string>();
  private toolCache = new Map<string, ToolDef[]>();

  constructor(private getAether: () => Aether) {}

  register(p: Plugin) {
    if (!/^[a-z][a-z0-9_:-]{1,40}$/.test(p.id)) throw new Error(`invalid plugin id ${p.id}`);
    this.plugins.set(p.id, p);
    this.toolCache.delete(p.id);
  }

  async unregister(id: string) {
    const p = this.plugins.get(id);
    if (!p) return;
    if (this.enabled.get(id)) await this.safe(id, () => p.teardown?.(this.getAether()));
    this.plugins.delete(id);
    this.enabled.delete(id);
    this.toolCache.delete(id);
    this.getAether().bus.publish('plugins.changed', null);
  }

  has(id: string) { return this.plugins.has(id); }
  get(id: string) { return this.plugins.get(id); }

  private async safe(id: string, fn: () => unknown) {
    try {
      await fn();
      this.errors.delete(id);
    } catch (e: any) {
      this.errors.set(id, String(e?.message ?? e));
      l.warn(`plugin ${id} failed: ${e?.message ?? e}`);
    }
  }

  async load() {
    const a = this.getAether();
    const rows = await a.db.query<{ id: string; enabled: boolean }>('select id, enabled from plugin_state');
    const state = new Map(rows.map((r) => [r.id, r.enabled]));
    for (const p of this.plugins.values()) {
      const on = state.has(p.id) ? !!state.get(p.id) : p.defaultEnabled;
      this.enabled.set(p.id, on);
      if (on) await this.safe(p.id, () => p.setup?.(a));
    }
  }

  /** Activates a plugin registered after load() (for example an MCP server). */
  async activate(id: string) {
    const p = this.plugins.get(id);
    if (!p) return;
    const a = this.getAether();
    const row = await a.db.one<{ enabled: boolean }>('select enabled from plugin_state where id=$1', [id]);
    const on = row ? !!row.enabled : p.defaultEnabled;
    this.enabled.set(id, on);
    if (on) await this.safe(id, () => p.setup?.(a));
    a.bus.publish('plugins.changed', null);
  }

  isEnabled(id: string) { return !!this.enabled.get(id); }

  async setEnabled(id: string, on: boolean) {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`unknown plugin ${id}`);
    const a = this.getAether();
    const was = this.isEnabled(id);
    await a.db.query(
      `insert into plugin_state (id, enabled) values ($1,$2) on conflict (id) do update set enabled=excluded.enabled, updated_at=now()`,
      [id, on],
    );
    this.enabled.set(id, on);
    if (on && !was) await this.safe(id, () => p.setup?.(a));
    if (!on && was) await this.safe(id, () => p.teardown?.(a));
    this.toolCache.delete(id);
    await a.activity.add('plugin', `${p.name} ${on ? 'enabled' : 'disabled'}`, { id });
    a.bus.publish('plugins.changed', null);
  }

  private pluginTools(p: Plugin): ToolDef[] {
    if (!this.toolCache.has(p.id)) {
      let tools: ToolDef[] = [];
      try { tools = (p.tools?.(this.getAether()) ?? []).map((t) => ({ ...t, plugin: p.id })); } catch (e: any) { this.errors.set(p.id, String(e?.message ?? e)); }
      this.toolCache.set(p.id, tools);
    }
    return this.toolCache.get(p.id)!;
  }

  invalidate(id: string) { this.toolCache.delete(id); }

  /** Tools visible to the model right now. */
  tools(allow?: (t: ToolDef) => boolean): ToolDef[] {
    const out: ToolDef[] = [];
    for (const p of this.plugins.values()) {
      if (!this.isEnabled(p.id)) continue;
      for (const t of this.pluginTools(p)) if (!allow || allow(t)) out.push(t);
    }
    return out;
  }

  /** Finds a tool in any plugin (enabled or not) so the executor can explain why it is unavailable. */
  findTool(name: string): { tool: ToolDef; plugin: Plugin; enabled: boolean } | undefined {
    for (const p of this.plugins.values()) {
      const t = this.pluginTools(p).find((x) => x.name === name);
      if (t) return { tool: t, plugin: p, enabled: this.isEnabled(p.id) };
    }
    return undefined;
  }

  async prompts(ctx: { channel: Channel; client?: ClientContext }): Promise<string[]> {
    const out: string[] = [];
    for (const p of this.plugins.values()) {
      if (!this.isEnabled(p.id) || !p.prompt) continue;
      try {
        const s = await p.prompt(this.getAether(), ctx);
        if (s) out.push(s);
      } catch (e: any) { l.warn(`prompt hint for ${p.id} failed: ${e?.message}`); }
    }
    return out;
  }

  async list(withStatus = false): Promise<PluginInfo[]> {
    const out: PluginInfo[] = [];
    for (const p of this.plugins.values()) {
      let status: Record<string, unknown> | undefined;
      if (withStatus && p.status && this.isEnabled(p.id)) {
        try { status = await p.status(this.getAether()); } catch (e: any) { status = { error: String(e?.message ?? e) }; }
      }
      out.push({
        id: p.id, name: p.name, description: p.description, category: p.category,
        enabled: this.isEnabled(p.id), defaultEnabled: p.defaultEnabled, error: this.errors.get(p.id) ?? null,
        tools: this.pluginTools(p).map((t) => ({ name: t.name, description: t.description })),
        secrets: p.secrets ?? [], status,
      });
    }
    return out;
  }

  async teardownAll() {
    for (const p of this.plugins.values()) if (this.isEnabled(p.id)) await this.safe(p.id, () => p.teardown?.(this.getAether()));
  }
}
