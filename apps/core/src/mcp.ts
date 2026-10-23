import type { Aether, Plugin, Risk, ToolDef } from './types.js';
import { log } from './util.js';

const l = log('mcp');

export interface McpServerConfig {
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface Conn { client: any; transport: any; tools: any[]; error: string | null }

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/** MCP client: each configured server becomes a plugin whose tools are gated like any other. */
export class McpManager {
  private conns = new Map<string, Conn>();
  constructor(private getAether: () => Aether) {}

  async loadAll() {
    const rows = await this.getAether().db.query<{ name: string; config: McpServerConfig; enabled: boolean }>('select * from mcp_servers');
    for (const r of rows) if (r.enabled) await this.connect(r.name, r.config).catch((e) => l.warn(`${r.name}: ${e.message}`));
  }

  async list() {
    const rows = await this.getAether().db.query<{ name: string; config: McpServerConfig; enabled: boolean; created_at: string }>('select * from mcp_servers order by name');
    return rows.map((r) => {
      const c = this.conns.get(r.name);
      const { env, headers, ...rest } = r.config;
      return { name: r.name, enabled: r.enabled, config: { ...rest, env: env ? Object.keys(env) : undefined, headers: headers ? Object.keys(headers) : undefined }, connected: !!c && !c.error, tools: c?.tools.map((t) => t.name) ?? [], error: c?.error ?? null };
    });
  }

  async add(name: string, config: McpServerConfig) {
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) throw new Error('MCP server names are lowercase-with-dashes.');
    if (config.transport === 'stdio' && !config.command) throw new Error('stdio servers need a command');
    if (config.transport === 'http' && !/^https?:\/\//.test(config.url ?? '')) throw new Error('http servers need a URL');
    await this.getAether().db.query(`insert into mcp_servers (name, config) values ($1,$2::jsonb) on conflict (name) do update set config=excluded.config, enabled=true`, [name, config]);
    await this.disconnect(name);
    await this.connect(name, config);
    return (await this.list()).find((s) => s.name === name);
  }

  async remove(name: string) {
    await this.disconnect(name);
    await this.getAether().db.query('delete from mcp_servers where name=$1', [name]);
  }

  private async disconnect(name: string) {
    const c = this.conns.get(name);
    if (c) { try { await c.client?.close(); } catch { /* ignore */ } this.conns.delete(name); }
    await this.getAether().plugins.unregister(`mcp-${name}`);
  }

  async connect(name: string, config: McpServerConfig) {
    const a = this.getAether();
    const resolved = await a.vault.resolve(config);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const client = new Client({ name: 'aether', version: a.config.version });
    let transport: any;
    try {
      if (resolved.transport === 'stdio') {
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        transport = new StdioClientTransport({ command: resolved.command!, args: resolved.args ?? [], env: { ...(process.env as Record<string, string>), ...(resolved.env ?? {}) }, stderr: 'ignore' });
      } else {
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        transport = new StreamableHTTPClientTransport(new URL(resolved.url!), { requestInit: { headers: resolved.headers ?? {} } });
      }
      await client.connect(transport);
      const { tools } = await client.listTools();
      this.conns.set(name, { client, transport, tools, error: null });
      const plugin: Plugin = {
        id: `mcp-${name}`,
        name: `MCP · ${name}`,
        description: `Tools from the MCP server "${name}" (${resolved.transport}).`,
        category: 'integration',
        defaultEnabled: true,
        tools: () => tools.map((t: any): ToolDef => {
          const ann = t.annotations ?? {};
          const risk: Risk = ann.readOnlyHint ? 'read' : ann.destructiveHint ? 'danger' : 'write';
          return {
            name: safeName(`mcp_${name}__${t.name}`).slice(0, 64),
            description: `[MCP ${name}] ${t.description ?? t.name}`.slice(0, 1000),
            parameters: t.inputSchema ?? { type: 'object', properties: {} },
            risk,
            resolveSecrets: true,
            async run(args) {
              const r: any = await client.callTool({ name: t.name, arguments: args ?? {} });
              const parts = (r.content ?? []) as any[];
              const text = parts.map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : c.type === 'resource' ? `[resource ${c.resource?.uri}]` : JSON.stringify(c))).join('\n');
              const images = parts.filter((c) => c.type === 'image').map((c) => ({ mime: c.mimeType ?? 'image/png', base64: c.data }));
              return { ok: !r.isError, content: text || '(no content)', images: images.length ? images : undefined };
            },
          };
        }),
      };
      a.plugins.register(plugin);
      await a.plugins.activate(plugin.id);
      l.info(`connected ${name} (${tools.length} tools)`);
    } catch (e: any) {
      this.conns.set(name, { client, transport, tools: [], error: String(e?.message ?? e) });
      throw e;
    }
  }

  async closeAll() { for (const n of [...this.conns.keys()]) { try { await this.conns.get(n)?.client?.close(); } catch { /* ignore */ } } this.conns.clear(); }
}
