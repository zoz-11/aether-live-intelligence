import { parseWhen } from '../util.js';
import type { ChatRequest, ChatResponse, ModelProvider, ToolCall } from './types.js';

let counter = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: `local_${Date.now().toString(36)}_${counter++}`, name, args });

const APPS = ['notes', 'contacts', 'calendar', 'mail', 'reminders', 'alarms', 'maps', 'photos', 'documents', 'shortcuts', 'settings', 'reservations', 'dossier', 'camera', 'computer', 'inbox', 'phone', 'files', 'tasks', 'memory', 'activity', 'home'];
const APP_ALIASES: Record<string, string> = { pages: 'documents', reserve: 'reservations', email: 'inbox', mailbox: 'inbox', desktop: 'computer', terminal: 'computer', calls: 'phone', audit: 'activity' };

function onOff(t: string) { return !/\b(off|disable|deactivate|stop)\b/.test(t); }

function to24h(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function cronFrom(t: string): string | null {
  const time = t.match(/at (\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/);
  const hm = time ? to24h(time[1]) : '08:00';
  if (!hm) return null;
  const [h, m] = hm.split(':').map(Number);
  if (/every weekday|on weekdays/.test(t)) return `${m} ${h} * * 1-5`;
  const days: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  for (const [d, n] of Object.entries(days)) if (new RegExp(`every ${d}`).test(t)) return `${m} ${h} * * ${n}`;
  if (/every hour|hourly/.test(t)) return `0 * * * *`;
  if (/every (day|morning|evening|night)|daily|each day/.test(t)) return `${m} ${h} * * *`;
  return null;
}

/** Deterministic intent engine used when no model is connected. Honest about its limits. */
export function parseIntent(raw: string, has: (n: string) => boolean, tz = 'UTC'): ToolCall[] | string {
  const text = raw.replace(/^\[(voice|telegram|sms|email|phone|task|system)\]\s*/i, '').trim();
  const t = text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  let m: RegExpMatchArray | null;

  if (/^(hi|hello|hey|salam|marhaba|good (morning|evening|afternoon))\b/.test(t) && t.split(' ').length <= 4) {
    return 'Hello. I am running in local mode, so I handle direct commands: device controls, notes, reminders, calendar, memory, my computer, email, phone and tasks. Connect a model in Settings to talk freely.';
  }
  if (/^(help|what can you do|capabilities)/.test(t)) {
    return 'Local mode commands: "turn on the flashlight", "set brightness to 40%", "note: buy milk", "remind me to call Sara in 10 minutes", "every day at 8am send me a briefing", "remember that I prefer window seats", "what do you know about me", "take a screenshot of your computer", "open https://example.com on your computer", "run `ls -la`", "check your inbox", "send an email to sam@example.com saying hi", "call +15551234567 and ask about opening hours". Connect a model in Settings for full conversation.';
  }
  if (/^what time is it|^what's the time|^what is the date|^what's the date|^what day is it/.test(t)) { let now: string; try { now = new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }); } catch { now = new Date().toString(); } return `It is ${now}.`; }

  // Agent computer
  if (/\b(your|the agent'?s?|aether'?s?) (computer|desktop|screen|pc)\b|\bon your computer\b/.test(t) && has('computer')) {
    if ((m = text.match(/(https?:\/\/\S+)/i))) return [call('computer', { action: 'open_url', url: m[1] })];
    if (/\b(start|boot|turn on|launch)\b/.test(t)) return [call('computer', { action: 'start' })];
    if (/\b(stop|shut ?down|turn off)\b/.test(t)) return [call('computer', { action: 'stop' })];
    return [call('computer', { action: 'screenshot' })];
  }
  // URLs → browser on the agent computer
  if ((m = text.match(/\b(?:open|go to|visit|browse(?: to)?|navigate to)\s+(https?:\/\/\S+|[\w-]+(?:\.[\w-]+)+\.?[a-z]{2,}\S*)/i))) {
    const url = /^https?:/i.test(m[1]) ? m[1] : `https://${m[1]}`;
    if (has('browser')) return [call('browser', { action: 'navigate', url })];
    if (has('computer')) return [call('computer', { action: 'open_url', url })];
  }
  // Web search
  if ((m = text.match(/^(?:search(?: the web)?(?: for)?|google|look up|find (?:info(?:rmation)? )?(?:on|about))\s+(.+)/i)) && has('web')) {
    return [call('web', { action: 'search', query: m[1] })];
  }
  // Shell
  if ((m = text.match(/^(?:run|execute)(?: the)?(?: command)?\s+`([^`]+)`/i)) || (m = text.match(/^(?:run|execute) command\s+(.+)/i))) {
    if (has('shell')) return [call('shell', { action: 'run', command: m[1].trim() })];
  }
  if ((m = text.match(/^download\s+(https?:\/\/\S+)(?:\s+(?:to|as)\s+(\S+))?/i)) && has('files')) {
    return [call('files', { action: 'download', url: m[1], path: m[2] })];
  }
  if (/^(list|show)( me)? (my |the |your )?(files|workspace)/.test(t) && has('files')) return [call('files', { action: 'list', path: '.' })];
  if ((m = text.match(/^(?:read|show|open) (?:the )?file\s+(\S+)/i)) && has('files')) return [call('files', { action: 'read', path: m[1] })];
  if ((m = text.match(/^delete (?:the )?file\s+(\S+)/i)) && has('files')) return [call('files', { action: 'delete', path: m[1] })];
  if ((m = text.match(/^(?:create|write) (?:a )?file\s+(\S+)\s+(?:with|containing)\s+([\s\S]+)/i)) && has('files')) return [call('files', { action: 'write', path: m[1], content: m[2] })];

  // Agent email
  if (has('email')) {
    if (/what('s| is) your (email|e-mail)( address)?/.test(t)) return [call('email', { action: 'address' })];
    if ((m = text.match(/\b(?:send|write)\s+(?:an?\s+)?e-?mail\s+to\s+([^\s,]+@[^\s,]+)(?:\s+(?:saying|that says|with|about)\s+([\s\S]+))?/i))) {
      const body = (m[2] ?? '').trim() || 'Hello';
      return [call('email', { action: 'send', to: m[1], subject: body.split(/\s+/).slice(0, 6).join(' '), text: body })];
    }
    if (/\b(check|read|open|show)\b.*\b(inbox|e-?mails?|mail)\b|\bany (new )?e-?mails?\b|\bnew mail\b/.test(t) && !/\bdraft\b/.test(t)) return [call('email', { action: 'inbox' })];
  }
  // Phone
  if (has('phone')) {
    if (/what('s| is) your (phone )?number/.test(t)) return [call('phone', { action: 'status' })];
    if ((m = text.match(/\b(?:text|sms|message)\s+(\+?\d[\d\-() ]{5,}\d)\s+(?:saying\s+|that\s+)?([\s\S]+)/i))) return [call('phone', { action: 'sms', to: m[1].replace(/[\s\-()]/g, ''), body: m[2].trim() })];
    if ((m = text.match(/\bcall\s+(\+?\d[\d\-() ]{5,}\d)(?:\s+(?:and|to)\s+([\s\S]+))?/i))) return [call('phone', { action: 'call', to: m[1].replace(/[\s\-()]/g, '').trim(), goal: (m[2] ?? 'say hello on behalf of my owner and ask how they can help').trim() })];
  }
  // Tasks and routines
  if (has('tasks')) {
    const cron = /\bevery\b|\bdaily\b|\bhourly\b/.test(t) ? cronFrom(t) : null;
    if (cron) {
      const goal = text.replace(/^(every\s+\w+|daily|hourly)(\s+at\s+[\d:]+\s*(am|pm)?)?[,\s]*/i, '').trim() || text;
      return [call('tasks', { action: 'create', title: goal.slice(0, 60), goal, cron })];
    }
    if ((m = text.match(/^remind me to (.+?) (in \d+\s*\w+|at \d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow(?: at \d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)$/i))) {
      const when = m[2];
      if (parseWhen(when)) return [call('tasks', { action: 'create', title: m[1], goal: `Remind the owner: ${m[1]}`, when, kind: 'reminder' })];
    }
    if (/^(list|show)( my)? (tasks|jobs|routines)/.test(t)) return [call('tasks', { action: 'list' })];
  }
  // Memory
  if ((m = text.match(/^(?:please\s+)?remember(?: that)?\s+([\s\S]+)/i)) && has('remember')) return [call('remember', { fact: m[1].trim() })];
  if ((m = text.match(/^forget(?: that| about)?\s+([\s\S]+)/i)) && has('forget')) return [call('forget', { query: m[1].trim() })];
  if (/what do you (know|remember) about me/.test(t) && has('recall')) return [call('recall', { query: 'user profile preferences' })];
  if ((m = t.match(/^what(?:'s| is) my (.+)/)) && has('recall')) return [call('recall', { query: m[1] })];

  // Screen awareness
  if (/what('s| is) on (my |the )?screen|look at (my |the )?screen|^look$|what am i looking at/.test(t)) {
    return has('look_at_screen') ? [call('look_at_screen', {})] : 'Screen awareness is off. Turn on the Screen plugin in Settings, then ask again.';
  }

  // Device controls (original Aether tools)
  if (/\b(flash ?light|torch)\b/.test(t) && has('set_flashlight')) return [call('set_flashlight', { on: onOff(t) })];
  if (/\bbrightness\b|\bbrighter\b|\bdim\b/.test(t)) {
    if ((m = t.match(/(\d{1,3})\s*%?/)) && has('set_brightness')) return [call('set_brightness', { level: Math.min(1, Math.max(0.15, parseInt(m[1], 10) / 100)) })];
    if (/\bdim\b|\blower\b/.test(t) && has('dim_screen')) return [call('dim_screen', {})];
    if (/\b(max|full|brighter|up)\b/.test(t) && has('set_brightness')) return [call('set_brightness', { level: 1 })];
  }
  if (/\bvolume\b|\bmute\b/.test(t) && has('set_volume')) {
    if (/\bmute\b/.test(t)) return [call('set_volume', { level: 0 })];
    if ((m = t.match(/(\d{1,3})\s*%?/))) return [call('set_volume', { level: Math.min(1, parseInt(m[1], 10) / 100) })];
  }
  if (/night ?shift/.test(t) && has('set_night_shift')) return [call('set_night_shift', { on: onOff(t) })];
  if (/do not disturb|\bdnd\b|focus mode/.test(t) && has('set_dnd')) return [call('set_dnd', { on: onOff(t) })];
  if ((m = t.match(/\b(wi-?fi|bluetooth|airplane mode|airplane)\b/)) && has('set_setting')) {
    const key = m[1].startsWith('wi') ? 'wifi' : m[1].startsWith('blue') ? 'bluetooth' : 'airplane';
    return [call('set_setting', { key, value: String(onOff(t)) })];
  }
  if (/\b(dark|light) mode\b/.test(t) && has('set_setting')) return [call('set_setting', { key: 'appearance', value: /dark/.test(t) ? 'dark' : 'light' })];
  if (/\b(restart|reboot)\b/.test(t) && has('restart_device')) return [call('restart_device', {})];

  // Apps
  if ((m = t.match(/^(?:open|show|go to|launch)\s+(?:the\s+|my\s+)?([a-z]+)(?:\s+app)?$/))) {
    const app = APP_ALIASES[m[1]] ?? m[1];
    if (APPS.includes(app) && has('open_app')) return [call('open_app', { app })];
  }
  if ((m = text.match(/^(?:take|make|create|add)\s+(?:a\s+)?note[:\s]+([\s\S]+)/i)) || (m = text.match(/^note[:\s]+([\s\S]+)/i))) {
    if (has('create_note')) {
      const raw = m[1].trim();
      const named = raw.match(/^(?:called|named|titled)\s+["“]?(.+?)["”]?\s+(?:with|saying|that says|:)\s+([\s\S]+)$/i) ?? raw.match(/^(?:called|named|titled)\s+["“]?(.+?)["”]?$/i);
      if (named) return [call('create_note', { title: named[1].trim(), body: (named[2] ?? '').trim() })];
      return [call('create_note', { title: raw.split(/\s+/).slice(0, 5).join(' '), body: raw })];
    }
  }
  if ((m = text.match(/^remind me to\s+(.+)/i)) && has('create_reminder')) return [call('create_reminder', { title: m[1].trim() })];
  if ((m = t.match(/(?:set|create|add)\s+(?:an?\s+)?alarm\s+(?:for|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(?:called|for|labeled)\s+(.+))?/)) && has('set_alarm')) {
    const time = to24h(m[1]);
    if (time) return [call('set_alarm', { time, label: m[2] ? m[2] : 'Alarm' })];
  }
  if ((m = text.match(/^(?:add|create|schedule|book)\s+(?:an?\s+)?(?:event|meeting|appointment|call)\s+(.+?)\s+((?:tomorrow|today|at|on|in)\b.*)$/i)) && has('create_event')) {
    const start = parseWhen(m[2].replace(/^today\s+/i, '')) ?? new Date(Date.now() + 3600e3);
    const end = new Date(start.getTime() + 3600e3);
    return [call('create_event', { title: m[1].replace(/^(called|titled)\s+/i, ''), start: start.toISOString(), end: end.toISOString() })];
  }
  if (/(what'?s on|show|check) (my )?(calendar|schedule|agenda)/.test(t) && has('list_events')) return [call('list_events', { range: /week/.test(t) ? 'week' : 'today' })];
  if (((m = text.match(/^(?:show|find)\s+(.+?)\s+on (?:the )?map/i)) || (m = text.match(/^(?:directions to|navigate to|where is)\s+(.+)/i))) && has('show_map')) return [call('show_map', { query: m[1] })];
  if ((m = text.match(/^add (?:a )?contact\s+([^,]+?)(?:,?\s+(?:number|phone)\s+([+\d][\d\s-]+))?(?:,?\s+email\s+(\S+@\S+))?$/i)) && has('create_contact')) {
    return [call('create_contact', { name: m[1].trim(), phone: m[2]?.trim(), email: m[3] })];
  }
  if ((m = text.match(/^(?:find|look up|search) contacts?\s+(?:for\s+)?(.+)/i)) && has('search_contacts')) return [call('search_contacts', { query: m[1] })];
  if ((m = text.match(/^(?:book|reserve)\s+(?:a table\s+)?(?:at\s+)?(.+?)\s+for\s+(\d+)\s+(?:people\s+)?(?:at|on)\s+(.+)/i)) && has('create_reservation')) {
    return [call('create_reservation', { place: m[1], party: parseInt(m[2], 10), time: m[3] })];
  }
  if ((m = text.match(/^draft (?:an )?e-?mail to\s+(\S+)\s+(?:about|saying)\s+([\s\S]+)/i)) && has('draft_email')) {
    return [call('draft_email', { to: m[1], subject: m[2].split(/\s+/).slice(0, 6).join(' '), body: m[2], send: false })];
  }
  if ((m = text.match(/^(?:search|find) notes?\s+(?:for\s+)?(.+)/i)) && has('search_notes')) return [call('search_notes', { query: m[1] })];

  return `I'm in local mode (no AI model connected), so I only understand direct commands. Try "help" for examples, or connect a model in Settings → Model to talk normally.`;
}

export class LocalEngine implements ModelProvider {
  id = 'local';
  model = 'aether-local';
  vision = false;

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const base = { provider: 'local', model: this.model, stop: 'stop' } as const;
    if (req.json) return { ...base, text: '{"add":[],"update":[],"delete":[]}', toolCalls: [] };
    const msgs = req.messages;
    const last = msgs[msgs.length - 1];
    if (last?.role === 'tool') {
      // Summarize every tool result since the last assistant tool call.
      const results: string[] = [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role !== 'tool') break;
        results.unshift(m.isError ? `That did not work: ${m.content}` : m.content);
      }
      const text = results.join('\n').slice(0, 1800) || 'Done.';
      req.onText?.(text);
      return { ...base, text, toolCalls: [] };
    }
    const userText = last?.role === 'user' ? last.content : '';
    const names = new Set(req.tools.map((t) => t.name));
    const tz = req.system?.match(/Owner timezone: ([A-Za-z_\/+-]+)/)?.[1] ?? 'UTC';
    const out = parseIntent(userText, (n) => names.has(n), tz);
    if (typeof out === 'string') { req.onText?.(out); return { ...base, text: out, toolCalls: [] }; }
    return { ...base, text: '', toolCalls: out };
  }
}
