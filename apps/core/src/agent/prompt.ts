import type { Aether, Channel, ClientContext } from '../types.js';

export interface PromptOptions {
  channel: Channel;
  client?: ClientContext;
  query: string;
  summary?: string | null;
  taskGoal?: string;
  extra?: string;
  toolNames: string[];
}

function clip(s: string, n: number) { return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s; }

/** Assembles the system prompt: persona files, owner facts, retrieved memories, live context, plugin hints, rules. */
export async function buildSystemPrompt(a: Aether, o: PromptOptions): Promise<string> {
  const s = await a.settings.get();
  const files = await a.memory.files();
  const memoryOn = a.plugins.isEnabled('memory');
  const facts = memoryOn ? await a.memory.relevant(o.query, 8) : [];
  const tz = s.owner.timezone || 'UTC';
  let nowStr: string;
  try { nowStr = new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }); } catch { nowStr = new Date().toString(); }
  const hints = await a.plugins.prompts({ channel: o.channel, client: o.client });
  const skills = await a.skills.list().catch(() => []);
  const parts: string[] = [];

  parts.push(clip(files['IDENTITY.md'], 1500));
  parts.push(clip(files['SOUL.md'], 2500));
  parts.push(clip(files['AGENTS.md'], 2500));
  if (memoryOn) {
    parts.push(clip(files['USER.md'], 2500));
    parts.push(clip(files['MEMORY.md'], 3000));
    if (facts.length) parts.push('# Relevant memories\n' + facts.map((f) => `- ${f.text}`).join('\n'));
  } else {
    parts.push('# Memory\nThe Memory plugin is off: do not claim to remember past conversations beyond this thread.');
  }
  if (s.customInstructions.trim()) parts.push('# Owner custom instructions (follow these)\n' + clip(s.customInstructions.trim(), 4000));

  const ctx: string[] = [
    `Now: ${nowStr}. Owner timezone: ${tz}.`,
    `Owner: ${s.owner.name || 'not set yet'}.`,
    `Channel: ${o.channel}${o.channel === 'voice' ? ' (spoken reply — keep it to 1-3 short sentences, no markdown, no lists)' : ''}.`,
  ];
  if (o.client?.openApp) ctx.push(`Owner's open Aether app: ${o.client.openApp}.`);
  parts.push('# Context\n' + ctx.map((x) => `- ${x}`).join('\n'));
  if (o.summary) parts.push('# Earlier in this conversation (summary)\n' + clip(o.summary, 4000));
  if (o.taskGoal) parts.push(`# Background task\nYou are running a background task on your own. Goal: ${o.taskGoal}\nWork step by step with tools, then reply with a short, concrete result for the owner. If you need a decision you cannot make, use request_approval.`);
  if (hints.length) parts.push('# Capabilities\n' + hints.join('\n'));
  if (skills.length) parts.push('# Skills (read with the skills tool before following one)\n' + skills.slice(0, 40).map((k) => `- ${k.name}: ${k.description}`).join('\n'));
  parts.push(`# Rules
- Only claim actions that a tool actually performed in this conversation. If a tool fails or is unavailable, say so plainly.
- Risky actions are checked by Sentinel, which may show the owner an approval card. Just call the tool; do not ask the owner to type "yes". If denied, accept it.
- Secrets: refer to them as {{secret:NAME}}. Never ask for passwords or keys in chat; use the secrets tool (action "request").
- Prefer acting over asking when intent is clear. Ask one short question when it is not.
- Keep replies short unless the owner asks for detail.${o.extra ? '\n' + o.extra : ''}`);
  parts.push(`Available tools right now: ${o.toolNames.join(', ') || 'none'}.`);
  return parts.filter(Boolean).join('\n\n');
}
