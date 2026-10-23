import type { Aether, Plugin, Risk, ToolDef, ToolResult } from '../../types.js';
import { AETHER_TOOLS } from './catalog.js';
import { uidShort as uid } from './util.js';
import type { ShortcutStep } from './types.js';

const str = (v: unknown, f = '') => (typeof v === 'string' ? v : f);
const num = (v: unknown, f = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : f);
const bool = (v: unknown, f = false) => (typeof v === 'boolean' ? v : v === 'true' || v === 'on' ? true : v === 'false' || v === 'off' ? false : f);

const APPS = new Set(['home', 'notes', 'contacts', 'calendar', 'mail', 'reminders', 'alarms', 'maps', 'photos', 'documents', 'shortcuts', 'settings', 'reservations', 'dossier', 'camera', 'computer', 'inbox', 'phone', 'files', 'tasks', 'memory', 'activity']);

const RISK: Record<string, Risk | ((a: any) => Risk)> = {
  restart_device: 'critical',
  draft_email: (a) => (bool(a?.send) ? 'critical' : 'write'),
  search_notes: 'read', search_contacts: 'read', list_events: 'read', open_app: 'read', show_map: 'read',
};

const DESCRIBE: Record<string, (a: any) => string> = {
  restart_device: () => 'Restart the device',
  draft_email: (a) => (bool(a?.send) ? `Send email from the device to ${a?.to}: “${a?.subject}”` : `Save a draft to ${a?.to}`),
  set_flashlight: (a) => `Flashlight ${bool(a?.on) ? 'on' : 'off'}`,
  create_note: (a) => `Create note “${a?.title ?? ''}”`,
  create_event: (a) => `Add event “${a?.title ?? ''}”`,
  create_reminder: (a) => `Add reminder “${a?.title ?? ''}”`,
};

/** Executes one original Aether device tool against server-side app data. */
export async function runAppTool(a: Aether, name: string, args: Record<string, unknown>, depth = 0): Promise<ToolResult> {
  const s = a.apps;
  const ok = (content: string, data?: unknown): ToolResult => ({ ok: true, content, data });
  switch (name) {
    case 'set_flashlight': { const on = bool(args.on); await s.patchDevice({ flashlight: on }); return ok(on ? 'Flashlight on.' : 'Flashlight off.'); }
    case 'set_brightness': { let level = num(args.level, 0.8); if (level > 1) level = level / 100; level = Math.min(1, Math.max(0.15, level)); await s.patchDevice({ brightness: level }); return ok(`Brightness set to ${Math.round(level * 100)}%.`); }
    case 'dim_screen': await s.patchDevice({ brightness: 0.22 }); return ok('Screen dimmed.');
    case 'set_volume': { let level = num(args.level, 0.5); if (level > 1) level = level / 100; level = Math.min(1, Math.max(0, level)); await s.patchDevice({ volume: level }); return ok(`Volume set to ${Math.round(level * 100)}%.`); }
    case 'set_night_shift': { const on = bool(args.on); await s.patchDevice({ nightShift: on }); return ok(on ? 'Night Shift on.' : 'Night Shift off.'); }
    case 'set_dnd': { const on = bool(args.on); await s.patchDevice({ dnd: on }); return ok(on ? 'Do Not Disturb on.' : 'Do Not Disturb off.'); }
    case 'set_setting': {
      const key = str(args.key); const value = str(args.value);
      if (key === 'appearance') { const v = value === 'light' ? 'light' : 'dark'; await s.patchDevice({ appearance: v }); return ok(`Appearance set to ${v}.`); }
      if (key === 'wifi' || key === 'bluetooth' || key === 'airplane') {
        const on = value === 'true' || value === 'on';
        await s.patchDevice({ [key]: on } as any);
        if (key === 'airplane' && on) await s.patchDevice({ wifi: false, bluetooth: false });
        return ok(`${key} ${on ? 'on' : 'off'}.`);
      }
      return { ok: false, content: `Unknown setting ${key}.` };
    }
    case 'restart_device': {
      await s.patchDevice({ locked: true, flashlight: false });
      await s.patchUi({ openApp: 'home' });
      return ok('Restarting the Aether device surface (simulated in the web app; a real iPhone needs the Shortcuts bridge).');
    }
    case 'open_app': {
      const app = str(args.app);
      if (!APPS.has(app)) return { ok: false, content: `No app named ${app}.` };
      await s.patchUi({ openApp: app });
      return ok(app === 'home' ? 'Returned home.' : `Opened ${app}.`);
    }
    case 'create_note': {
      const note = { id: uid('nt'), title: str(args.title, 'Untitled'), body: str(args.body), updatedAt: new Date().toISOString() };
      await s.upsert('notes', note); await s.patchUi({ openApp: 'notes' });
      return ok(`Note created: ${note.title}`, note);
    }
    case 'search_notes': {
      const q = str(args.query).toLowerCase();
      const hits = (await s.list<any>('notes')).filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
      return ok(hits.length ? hits.map((n) => `${n.id} — ${n.title}: ${n.body.slice(0, 140)}`).join('\n') : 'No matching notes.');
    }
    case 'create_contact': {
      const c = { id: uid('ct'), name: str(args.name, 'Unknown'), phone: str(args.phone) || undefined, email: str(args.email) || undefined, company: str(args.company) || undefined };
      await s.upsert('contacts', c); await s.patchUi({ openApp: 'contacts' });
      return ok(`Contact saved: ${c.name}`, c);
    }
    case 'search_contacts': {
      const q = str(args.query).toLowerCase();
      const hits = (await s.list<any>('contacts')).filter((c) => [c.name, c.email, c.company, c.phone].some((x: string | undefined) => x?.toLowerCase().includes(q)));
      return ok(hits.length ? hits.map((c) => `${c.name} · ${c.email ?? ''} · ${c.phone ?? ''}`).join('\n') : 'No matching contacts.');
    }
    case 'create_event': {
      const e = { id: uid('ev'), title: str(args.title, 'Event'), start: str(args.start), end: str(args.end) || str(args.start), location: str(args.location) || undefined, notes: str(args.notes) || undefined };
      await s.upsert('events', e); await s.patchUi({ openApp: 'calendar' });
      return ok(`Event created: ${e.title} from ${e.start} to ${e.end}`, e);
    }
    case 'list_events': {
      const range = str(args.range, 'today');
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + (range === 'week' ? 7 : 1));
      const hits = (await s.list<any>('events')).filter((e) => { const t = new Date(e.start).getTime(); return t >= start.getTime() && t < end.getTime(); })
        .sort((x, y) => new Date(x.start).getTime() - new Date(y.start).getTime());
      return ok(hits.length ? hits.map((e) => `${e.start} ${e.title}${e.location ? ' @ ' + e.location : ''}`).join('\n') : 'No events in that range.');
    }
    case 'create_reminder': {
      const r = { id: uid('rm'), title: str(args.title, 'Reminder'), due: str(args.due) || undefined, done: false };
      await s.upsert('reminders', r); await s.patchUi({ openApp: 'reminders' });
      return ok(`Reminder set: ${r.title}${r.due ? ' at ' + r.due : ''}`, r);
    }
    case 'complete_reminder': {
      const id = str(args.id); const title = str(args.title).toLowerCase();
      const hit = (await s.list<any>('reminders')).find((r) => r.id === id || (title && r.title.toLowerCase().includes(title)));
      if (!hit) return { ok: false, content: 'Reminder not found.' };
      await s.upsert('reminders', { ...hit, done: true });
      return ok(`Completed: ${hit.title}`);
    }
    case 'set_alarm': {
      const al = { id: uid('al'), time: str(args.time, '07:00'), label: str(args.label, 'Alarm'), enabled: true };
      await s.upsert('alarms', al); await s.patchUi({ openApp: 'alarms' });
      return ok(`Alarm set for ${al.time} (${al.label}).`, al);
    }
    case 'draft_email': {
      const send = bool(args.send);
      const m = { id: uid('ml'), to: str(args.to), subject: str(args.subject), body: str(args.body), status: send ? 'sent' : 'draft', createdAt: new Date().toISOString() };
      await s.upsert('mail', m); await s.patchUi({ openApp: 'mail' });
      return ok(send ? `Marked as sent in the device Mail app (simulated device mail; use the email tool for Aether's real inbox): ${m.subject}` : `Draft saved to ${m.to}: ${m.subject}`, m);
    }
    case 'create_document': {
      const d = { id: uid('dc'), title: str(args.title, 'Untitled'), body: str(args.body), updatedAt: new Date().toISOString() };
      await s.upsert('documents', d); await s.patchUi({ openApp: 'documents' });
      return ok(`Document created: ${d.title}`, d);
    }
    case 'show_map': { const query = str(args.query); await s.patchUi({ map: { query }, openApp: 'maps' }); return ok(`Showing map for ${query}.`); }
    case 'enhance_photo': {
      const filter = (str(args.filter, 'vivid') || 'vivid') as 'none' | 'vivid' | 'mono' | 'warm' | 'cool';
      const live = bool(args.live);
      const photos = await s.list<any>('photos');
      const id = str(args.id) || (await s.ui()).selectedPhoto || photos[0]?.id;
      if (!id) return { ok: false, content: 'No photos to enhance.' };
      await s.patch('photos', id, { filter, live: live || undefined });
      await s.patchUi({ selectedPhoto: id, openApp: 'photos' });
      return ok(`Photo ${id} enhanced (${filter}${live ? ', live' : ''}).`);
    }
    case 'create_shortcut': {
      const steps = Array.isArray(args.steps) ? (args.steps as ShortcutStep[]) : [];
      const sc = { id: uid('sc'), name: str(args.name, 'Shortcut'), steps };
      await s.upsert('shortcuts', sc); await s.patchUi({ openApp: 'shortcuts' });
      return ok(`Shortcut “${sc.name}” saved with ${steps.length} steps.`);
    }
    case 'run_shortcut': {
      if (depth > 2) return { ok: false, content: 'Shortcut nesting too deep.' };
      const name = str(args.name).toLowerCase();
      const sc = (await s.list<any>('shortcuts')).find((x) => x.name.toLowerCase() === name);
      if (!sc) return { ok: false, content: `No shortcut named ${args.name}.` };
      const results: string[] = [];
      for (const st of sc.steps as ShortcutStep[]) {
        if (st.tool === 'restart_device' || (st.tool === 'draft_email' && bool(st.args?.send))) { results.push(`Skipped ${st.tool} (needs approval; run it directly).`); continue; }
        results.push((await runAppTool(a, st.tool, st.args ?? {}, depth + 1)).content);
      }
      return ok(`Ran ${sc.name}: ${results.join(' ')}`);
    }
    case 'create_reservation': {
      const r = { id: uid('rs'), place: str(args.place), time: str(args.time), party: num(args.party, 2), notes: str(args.notes) || undefined, status: 'held' as const };
      await s.upsert('reservations', r); await s.patchUi({ openApp: 'reservations' });
      return ok(`Reservation held at ${r.place} for ${r.party} at ${r.time} (held in the Reserve app; no restaurant was contacted).`, r);
    }
    default: return { ok: false, content: `Tool ${name} is not available on this device.` };
  }
}

export const appsPlugin: Plugin = {
  id: 'apps',
  name: 'Aether Apps',
  description: 'The original Aether device apps: notes, contacts, calendar, reminders, alarms, device mail, maps, photos, pages, shortcuts, reservations and device settings.',
  category: 'device',
  defaultEnabled: true,
  tools: (a) => AETHER_TOOLS.filter((t) => !['remember', 'recall'].includes(t.function.name)).map((t): ToolDef => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters as Record<string, unknown>,
    risk: RISK[t.function.name] ?? 'write',
    describe: DESCRIBE[t.function.name],
    run: (args) => runAppTool(a, t.function.name, args ?? {}),
  })),
  prompt: () => 'Aether Apps: device apps live in the Aether surface the owner sees (simulated iPad/iPhone data synced across devices). Device mail drafts are not Aether\'s real inbox; for real email use the email tool.',
};
