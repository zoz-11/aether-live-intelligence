import type { Card, Plugin } from '../types.js';
import { MEMORY_FILES } from '../memory/service.js';
import { Vault } from '../vault.js';

/** Core: always-on essentials — asking the owner for a decision and notifying them. */
export const corePlugin: Plugin = {
  id: 'core',
  name: 'Core',
  description: 'Ask the owner for explicit permission and send notifications.',
  category: 'core',
  defaultEnabled: true,
  tools: () => [
    {
      name: 'request_approval',
      description: 'Ask the owner to approve or deny something before you do it (purchases, account changes, anything irreversible you detect yourself). Returns the decision. You cannot approve on the owner\'s behalf.',
      parameters: { type: 'object', properties: { question: { type: 'string', description: 'What you want to do, in one sentence.' }, details: { type: 'string' } }, required: ['question'] },
      risk: 'read',
      describe: (a) => a.question,
      async run(args, ctx) {
        const r = await ctx.aether.sentinel.request({
          kind: 'question', tool: 'request_approval', risk: 'critical', summary: String(args.question).slice(0, 300), args: { details: args.details ?? '' },
          conversationId: ctx.conversationId, taskId: ctx.taskId, channel: ctx.channel,
        }, ctx);
        if (r.decision === 'deny') return { ok: true, content: 'The owner said NO. Do not proceed.' };
        if (r.decision === 'expired') return { ok: true, content: 'No answer from the owner (timed out). Do not proceed.' };
        return { ok: true, content: 'The owner APPROVED. Proceed.' };
      },
    },
    {
      name: 'notify_owner',
      description: 'Send the owner a push notification (and Telegram if connected). Use for results of background work or time-sensitive alerts.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
      risk: 'write',
      describe: (a) => `Notify: ${a.title}`,
      async run(args, ctx) {
        const sent = await ctx.aether.notify.send({ title: String(args.title), body: String(args.body), tag: 'agent' });
        return { ok: true, content: `Notification delivered via: ${sent.join(', ') || 'in-app only'}.` };
      },
    },
  ],
};

export const memoryPlugin: Plugin = {
  id: 'memory',
  name: 'Memory',
  description: 'Unified long-term memory for voice, text and every channel: facts, persona files, automatic extraction.',
  category: 'memory',
  defaultEnabled: true,
  tools: () => [
    {
      name: 'remember',
      description: 'Save a durable fact about the owner or their world to long-term memory.',
      parameters: { type: 'object', properties: { fact: { type: 'string' }, kind: { type: 'string', enum: ['profile', 'preference', 'relationship', 'plan', 'project', 'note'] }, pinned: { type: 'boolean' } }, required: ['fact'] },
      risk: 'write',
      describe: (a) => `Remember: ${a.fact}`,
      async run(args, ctx) {
        const fact = String(args.fact ?? '').trim();
        if (/\{\{\s*secret:/.test(fact)) return { ok: false, content: 'Secrets are never stored in memory; they live in the vault.' };
        const r = await ctx.aether.memory.addFact(fact, args.kind ?? 'note', `conversation:${ctx.conversationId}`, !!args.pinned);
        return { ok: true, content: r.duplicate ? `Already remembered: ${r.fact.text}` : `Remembered: ${r.fact.text}` };
      },
    },
    {
      name: 'recall',
      description: 'Search long-term memory.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      risk: 'read',
      async run(args, ctx) {
        const hits = await ctx.aether.memory.search(String(args.query ?? ''), 10);
        const all = hits.length ? hits : (await ctx.aether.memory.facts(10));
        return { ok: true, content: all.length ? all.map((f) => `- ${f.text}`).join('\n') : 'Nothing in memory yet.' };
      },
    },
    {
      name: 'forget',
      description: 'Delete memories matching a topic or a memory id.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      risk: 'danger',
      describe: (a) => `Forget memories about “${a.query}”`,
      async run(args, ctx) {
        const gone = await ctx.aether.memory.forget(String(args.query ?? ''));
        return { ok: true, content: gone.length ? `Forgot ${gone.length}: ${gone.map((g) => g.text).join(' | ')}` : 'No matching memories.' };
      },
    },
    {
      name: 'update_memory_file',
      description: `Rewrite or append to one of your persona/memory files (${MEMORY_FILES.join(', ')}). USER.md holds what you know about the owner; MEMORY.md durable notes; SOUL.md your personality.`,
      parameters: { type: 'object', properties: { file: { type: 'string', enum: [...MEMORY_FILES] }, mode: { type: 'string', enum: ['append', 'replace'] }, content: { type: 'string' } }, required: ['file', 'mode', 'content'] },
      risk: (a) => (a?.file === 'SOUL.md' || a?.file === 'AGENTS.md' || a?.mode === 'replace' ? 'danger' : 'write'),
      describe: (a) => `${a.mode === 'replace' ? 'Rewrite' : 'Append to'} ${a.file}`,
      async run(args, ctx) {
        if (/\{\{\s*secret:/.test(String(args.content))) return { ok: false, content: 'Secrets are never written to memory files.' };
        if (args.mode === 'replace') await ctx.aether.memory.setFile(args.file, String(args.content));
        else await ctx.aether.memory.appendToFile(args.file, String(args.content));
        return { ok: true, content: `${args.file} updated.` };
      },
    },
  ],
};

const CARD_TYPES = ['text', 'list', 'kv', 'table', 'steps', 'progress', 'links', 'actions', 'image', 'chart', 'code'];

export const smartUiPlugin: Plugin = {
  id: 'smart-ui',
  name: 'Smart UI',
  description: 'Rich answers as native cards (lists, tables, charts, steps, actions) and sandboxed HTML artifacts.',
  category: 'ui',
  defaultEnabled: true,
  tools: () => [
    {
      name: 'show_card',
      description: 'Show a native UI card with your answer. Types: text{body}, list{items}, kv{rows:[{label,value}]}, table{columns,table}, steps{steps:[{label,done}]}, progress{value 0-100}, links{links:[{title,url}]}, actions{actions:[{label,prompt}]} (buttons that send the prompt), image{image:{url,alt}}, chart{chart:{kind:bar|line,labels,series:[{name,data}]}}, code{code:{language,text}}. Keep the spoken/text reply short when you show a card.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: CARD_TYPES }, title: { type: 'string' }, body: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] } },
          columns: { type: 'array', items: { type: 'string' } },
          table: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          steps: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, done: { type: 'boolean' } }, required: ['label'] } },
          value: { type: 'number' },
          links: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, note: { type: 'string' } }, required: ['title', 'url'] } },
          actions: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, prompt: { type: 'string' }, style: { type: 'string', enum: ['primary', 'secondary', 'danger'] } }, required: ['label', 'prompt'] } },
          image: { type: 'object', properties: { url: { type: 'string' }, alt: { type: 'string' } } },
          chart: { type: 'object', properties: { kind: { type: 'string', enum: ['bar', 'line'] }, labels: { type: 'array', items: { type: 'string' } }, series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, data: { type: 'array', items: { type: 'number' } } } } } } },
          code: { type: 'object', properties: { language: { type: 'string' }, text: { type: 'string' } } },
        },
        required: ['type'],
      },
      risk: 'read',
      async run(args) {
        if (!CARD_TYPES.includes(args.type)) return { ok: false, content: `Unknown card type ${args.type}` };
        const card = { ...args } as Card;
        return { ok: true, content: `Card shown: ${args.title ?? args.type}`, card };
      },
    },
    {
      name: 'show_artifact',
      description: 'Render a small self-contained HTML/CSS/JS widget (calculator, mini app, visualization) in a sandboxed frame. No network access to the owner\'s data. Max 60KB.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, html: { type: 'string' } }, required: ['title', 'html'] },
      risk: 'read',
      async run(args, ctx) {
        const html = String(args.html ?? '');
        if (html.length > 60000) return { ok: false, content: 'Artifact too large (60KB max).' };
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const { join } = await import('node:path');
        const dir = join(ctx.aether.config.workspaceDir, 'artifacts');
        mkdirSync(dir, { recursive: true });
        const file = `${String(args.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'artifact'}-${Date.now().toString(36)}.html`;
        writeFileSync(join(dir, file), html);
        return { ok: true, content: `Artifact “${args.title}” rendered and saved to artifacts/${file}.`, card: { type: 'artifact', title: String(args.title), html } };
      },
    },
  ],
  prompt: (_a, ctx) => ctx.channel === 'voice' || ctx.channel === 'text'
    ? 'Smart UI: when the answer is structured (options, comparisons, schedules, steps, numbers), call show_card and keep your words brief. Use actions cards to offer next steps.'
    : undefined,
};

export const screenPlugin: Plugin = {
  id: 'screen',
  name: 'Screen Awareness',
  description: 'On-demand look at what is open in Aether (and the agent computer when it is running). Never always-on.',
  category: 'device',
  defaultEnabled: false,
  tools: () => [
    {
      name: 'look_at_screen',
      description: 'Look at what the owner currently has open in Aether. Only call when the owner asks you to look or refers to what is on screen.',
      parameters: { type: 'object', properties: { includeAgentComputer: { type: 'boolean', description: 'Also screenshot your own computer if running.' } } },
      risk: 'read',
      async run(args, ctx) {
        const a = ctx.aether;
        const summary = await a.apps.screenSummary(ctx.client?.openApp ?? null);
        const extra = ctx.client?.screen ? `\nClient-reported view: ${String(ctx.client.screen).slice(0, 1500)}` : '';
        if (args.includeAgentComputer && a.plugins.isEnabled('computer')) {
          try {
            const shot = await a.computer.screenshot();
            return { ok: true, content: summary + extra + '\nAgent computer screenshot attached.', images: [shot] };
          } catch { /* computer not running */ }
        }
        return { ok: true, content: summary + extra };
      },
    },
  ],
  prompt: () => 'Screen Awareness is ON but on-demand: call look_at_screen only when the owner asks you to look or says "this/that on my screen". It returns a structured summary, not pixels.',
};

export const secretsPlugin: Plugin = {
  id: 'secrets',
  name: 'Secrets Vault',
  description: 'Encrypted vault (AES-256-GCM). The agent sees only names and uses {{secret:NAME}} placeholders, swapped in at the tool boundary.',
  category: 'core',
  defaultEnabled: true,
  tools: () => [
    {
      name: 'secrets',
      description: 'Manage credentials without seeing them. action=list (names only), request (ask the owner to securely enter a secret by name; you never see the value), delete. Use secrets in other tools as {{secret:NAME}} (shell env, http headers, browser typing).',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'request', 'delete'] }, name: { type: 'string', description: 'UPPER_SNAKE_CASE' }, description: { type: 'string', description: 'What it is for, shown to the owner.' } }, required: ['action'] },
      risk: (a) => (a?.action === 'delete' ? 'danger' : 'read'),
      describe: (a) => (a.action === 'delete' ? `Delete secret ${a.name}` : a.action === 'request' ? `Request secret ${a.name}` : 'List secret names'),
      async run(args, ctx) {
        const v = ctx.aether.vault;
        if (args.action === 'list') {
          const rows = await v.list();
          return { ok: true, content: rows.length ? rows.map((r) => `${r.name}${r.description ? ' — ' + r.description : ''}`).join('\n') : 'The vault is empty.' };
        }
        const name = String(args.name ?? '').trim().toUpperCase();
        if (!Vault.validName(name)) return { ok: false, content: 'Use an UPPER_SNAKE_CASE name like GITHUB_TOKEN.' };
        if (args.action === 'delete') { await v.delete(name); return { ok: true, content: `Deleted ${name}.` }; }
        if (await v.has(name)) return { ok: true, content: `${name} is already set. Use {{secret:${name}}}.` };
        const r = await ctx.aether.sentinel.request({
          kind: 'secret', tool: 'secrets', action: 'request', risk: 'critical', summary: `Aether needs ${name}${args.description ? ': ' + args.description : ''}`,
          args: { name, description: args.description ?? '' }, inputSchema: { type: 'password', name },
          conversationId: ctx.conversationId, taskId: ctx.taskId, channel: ctx.channel,
        }, ctx);
        if (r.decision === 'deny') return { ok: true, content: `The owner declined to provide ${name}.` };
        if (r.decision === 'expired') return { ok: true, content: `No answer; ${name} was not provided.` };
        return { ok: true, content: `${name} saved in the vault. Use it as {{secret:${name}}}.` };
      },
    },
  ],
};
