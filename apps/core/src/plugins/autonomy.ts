import type { Plugin } from '../types.js';

export const tasksPlugin: Plugin = {
  id: 'tasks',
  name: 'Tasks & Routines',
  description: 'Background tasks, reminders at a time, and recurring routines (cron) that run on their own and report back.',
  category: 'autonomy',
  defaultEnabled: true,
  setup: (a) => a.tasks.start(),
  teardown: (a) => a.tasks.stop(),
  tools: (a) => [
    {
      name: 'tasks',
      description: 'action=create(title, goal, when? like "in 10 minutes"/"tomorrow at 9am"/ISO, cron? like "0 8 * * *", kind?: task|reminder) | list | pause(id) | resume(id) | cancel(id) | run(id). Reminders just notify the owner at the time; tasks run you in the background with the goal and report the result.',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'list', 'pause', 'resume', 'cancel', 'run'] }, title: { type: 'string' }, goal: { type: 'string' }, when: { type: 'string' }, cron: { type: 'string' }, kind: { type: 'string', enum: ['task', 'reminder'] }, id: { type: 'string' } }, required: ['action'] },
      risk: (x) => (x?.action === 'list' ? 'read' : 'write'),
      describe: (x) => (x.action === 'create' ? `${x.kind === 'reminder' ? 'Reminder' : 'Task'}: ${x.title}${x.when ? ' (' + x.when + ')' : ''}${x.cron ? ' (cron ' + x.cron + ')' : ''}` : `Task ${x.action} ${x.id ?? ''}`),
      async run(x) {
        const t = a.tasks;
        switch (x.action) {
          case 'create': {
            if (!x.title || !x.goal) return { ok: false, content: 'create needs title and goal.' };
            const row = await t.create({ title: x.title, goal: x.goal, when: x.when, cron: x.cron, kind: x.kind, origin: 'agent' });
            const tz = (await a.settings.get()).owner.timezone;
            const at = row.next_run_at ? new Date(row.next_run_at).toLocaleString('en-US', { timeZone: tz }) : 'now';
            return { ok: true, content: `${row.schedule_kind === 'reminder' ? 'Reminder' : row.schedule_kind === 'cron' ? 'Routine' : 'Task'} “${row.title}” ${row.status === 'queued' ? 'started' : 'scheduled for ' + at}${row.schedule_kind === 'cron' ? ` (repeats: ${row.schedule})` : ''}. Id ${row.id}.` };
          }
          case 'list': {
            const rows = await t.list(20);
            const tz = (await a.settings.get()).owner.timezone;
            return { ok: true, content: rows.length ? rows.map((r) => `${r.id} · ${r.status} · ${r.title}${r.next_run_at && ['scheduled', 'queued'].includes(r.status) ? ' · next ' + new Date(r.next_run_at).toLocaleString('en-US', { timeZone: tz }) : ''}${r.result ? ' · ' + r.result.slice(0, 80) : ''}`).join('\n') : 'No tasks.' };
          }
          case 'pause': await t.pause(String(x.id)); return { ok: true, content: `Paused ${x.id}.` };
          case 'resume': await t.resume(String(x.id)); return { ok: true, content: `Resumed ${x.id}.` };
          case 'cancel': await t.cancel(String(x.id)); return { ok: true, content: `Cancelled ${x.id}.` };
          case 'run': await t.runNow(String(x.id)); return { ok: true, content: `Running ${x.id} now.` };
          default: return { ok: false, content: `Unknown action ${x.action}` };
        }
      },
    },
    {
      name: 'delegate',
      description: 'Hand a self-contained sub-task to a helper agent with its own scratch thread (for research, multi-step browsing, coding chores). Returns the helper\'s final report. Optionally restrict tools by name.',
      parameters: { type: 'object', properties: { goal: { type: 'string' }, tools: { type: 'array', items: { type: 'string' } }, maxSteps: { type: 'number' } }, required: ['goal'] },
      risk: 'write',
      describe: (x) => `Delegate: ${String(x.goal).slice(0, 120)}`,
      async run(x, ctx) {
        if (ctx.depth >= 2) return { ok: false, content: 'Delegation depth limit reached; do it yourself.' };
        const allow: string[] | null = Array.isArray(x.tools) && x.tools.length ? x.tools.map(String) : null;
        const conv = await a.conversations.create(`Helper: ${String(x.goal).slice(0, 60)}`, 'subagent');
        const r = await a.agent.run({
          conversationId: conv.id, text: String(x.goal), channel: 'task', taskId: ctx.taskId, taskGoal: String(x.goal), signal: ctx.signal,
          toolFilter: (t) => (!allow || allow.includes(t.name)) && !(t.name === 'delegate' && ctx.depth + 1 >= 2),
          maxSteps: Math.min(Number(x.maxSteps ?? 10), 20), depth: ctx.depth + 1, noMemory: true, scope: ctx.scope,
          onEvent: (ev) => { if (ev.type === 'approval' || ev.type === 'approval.resolved') ctx.emit(ev); },
        });
        return { ok: !r.error, content: `Helper report (${r.toolCalls} tool calls):\n${r.text}` };
      },
    },
  ],
  prompt: () => 'Tasks & Routines: for anything that should happen later, repeatedly, or takes long, create a task instead of making the owner wait. Use reminders for simple "remind me" requests.',
};

export const skillsPlugin: Plugin = {
  id: 'skills',
  name: 'Skills',
  description: 'SKILL.md playbooks: bundled and owner-made, read on demand; Aether can propose new skills (approval required).',
  category: 'autonomy',
  defaultEnabled: true,
  tools: (a) => [
    {
      name: 'skills',
      description: 'action=list | read(name) — read a skill before following it | read_file(name,file) | create(name,description,body) — save a reusable playbook you learned (needs approval) | delete(name).',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'read', 'read_file', 'create', 'delete'] }, name: { type: 'string' }, file: { type: 'string' }, description: { type: 'string' }, body: { type: 'string' } }, required: ['action'] },
      risk: (x) => (x?.action === 'create' || x?.action === 'delete' ? 'danger' : 'read'),
      describe: (x) => (x.action === 'create' ? `Save new skill “${x.name}”` : x.action === 'delete' ? `Delete skill ${x.name}` : `Skills: ${x.action} ${x.name ?? ''}`),
      async run(x) {
        const s = a.skills;
        switch (x.action) {
          case 'list': { const l = await s.list(); return { ok: true, content: l.length ? l.map((k) => `${k.name} (${k.source}): ${k.description}`).join('\n') : 'No skills installed.' }; }
          case 'read': { const r = await s.read(String(x.name)); return r ? { ok: true, content: `${r.body.slice(0, 20000)}${r.files.length ? `\n\nFiles: ${r.files.join(', ')}` : ''}` } : { ok: false, content: 'Skill not found.' }; }
          case 'read_file': return { ok: true, content: await s.readFile(String(x.name), String(x.file)) };
          case 'create': { if (!x.name || !x.description || !x.body) return { ok: false, content: 'create needs name, description and body.' }; await s.create(String(x.name), String(x.description), String(x.body)); a.bus.publish('skills.changed', null); return { ok: true, content: `Skill “${x.name}” saved.` }; }
          case 'delete': await s.remove(String(x.name)); a.bus.publish('skills.changed', null); return { ok: true, content: `Skill ${x.name} deleted.` };
          default: return { ok: false, content: `Unknown action ${x.action}` };
        }
      },
    },
  ],
};

export const telegramPlugin: Plugin = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Talk to Aether from Telegram (owner-only, paired) and approve actions with buttons. Long polling; no public URL needed.',
  category: 'channel',
  defaultEnabled: true,
  secrets: ['TELEGRAM_BOT_TOKEN'],
  setup: (a) => a.telegram.start(),
  teardown: (a) => a.telegram.stop(),
  status: (a) => a.telegram.status(),
};
