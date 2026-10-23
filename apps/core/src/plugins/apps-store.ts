import type { Db } from '../db/index.js';
import type { EventBus } from '../events.js';
import type { DeviceState } from './apps/types.js';
import {
  seedAlarms, seedContacts, seedDocs, seedEvents, seedMail, seedNotes, seedPhotos, seedReminders, seedReservations, seedShortcuts,
} from './apps/seed.js';

export const COLLECTIONS = ['notes', 'contacts', 'events', 'reminders', 'alarms', 'mail', 'documents', 'photos', 'shortcuts', 'reservations'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const DEFAULT_DEVICE: DeviceState = {
  brightness: 0.82, flashlight: false, dnd: false, volume: 0.6, nightShift: false,
  wifi: true, bluetooth: true, airplane: false, appearance: 'dark', locked: false,
};

export interface UiState { openApp: string; selectedPhoto: string | null; map: { query: string } | null }

/** Server-side data for the Aether device apps (notes, calendar, …). Shared by every client and every channel. */
export class AppsStore {
  constructor(private db: Db, private bus: EventBus) {}

  async seedIfEmpty() {
    const flag = await this.db.one(`select 1 as x from settings where key='apps_seeded'`);
    if (flag) return false;
    const seeds: Record<Collection, () => any[]> = {
      notes: seedNotes, contacts: seedContacts, events: seedEvents, reminders: seedReminders, alarms: seedAlarms,
      mail: seedMail, documents: seedDocs, photos: seedPhotos, shortcuts: seedShortcuts, reservations: seedReservations,
    };
    for (const c of COLLECTIONS) for (const item of seeds[c]()) await this.upsert(c, item, false);
    await this.db.query(`insert into settings (key, value) values ('apps_seeded', 'true'::jsonb) on conflict do nothing`);
    return true;
  }

  async list<T = any>(c: Collection): Promise<T[]> {
    const rows = await this.db.query<{ data: T }>('select data from app_items where collection=$1 order by created_at asc', [c]);
    return rows.map((r) => r.data);
  }

  async get<T = any>(c: Collection, id: string): Promise<T | undefined> {
    const row = await this.db.one<{ data: T }>('select data from app_items where collection=$1 and id=$2', [c, id]);
    return row?.data;
  }

  async upsert<T extends { id: string }>(c: Collection, item: T, publish = true): Promise<T> {
    await this.db.query(
      `insert into app_items (collection, id, data) values ($1,$2,$3::jsonb)
       on conflict (collection, id) do update set data=excluded.data, updated_at=now()`,
      [c, item.id, item],
    );
    if (publish) await this.publish(c);
    return item;
  }

  async patch<T = any>(c: Collection, id: string, partial: Partial<T>): Promise<T | undefined> {
    const cur = await this.get<T>(c, id);
    if (!cur) return undefined;
    const next = { ...cur, ...partial } as any;
    await this.upsert(c, next);
    return next;
  }

  async remove(c: Collection, id: string) {
    await this.db.query('delete from app_items where collection=$1 and id=$2', [c, id]);
    await this.publish(c);
  }

  private async publish(c: Collection) {
    this.bus.publish('apps.changed', { collection: c, items: await this.list(c) });
  }

  async device(): Promise<DeviceState> {
    const row = await this.db.one<{ value: DeviceState }>(`select value from settings where key='device'`);
    return { ...DEFAULT_DEVICE, ...(row?.value ?? {}) };
  }

  async patchDevice(p: Partial<DeviceState>): Promise<DeviceState> {
    const next = { ...(await this.device()), ...p };
    await this.db.query(`insert into settings (key, value) values ('device', $1::jsonb) on conflict (key) do update set value=excluded.value, updated_at=now()`, [next]);
    this.bus.publish('device.changed', next);
    return next;
  }

  async ui(): Promise<UiState> {
    const row = await this.db.one<{ value: UiState }>(`select value from settings where key='ui'`);
    return { openApp: 'home', selectedPhoto: null, map: null, ...(row?.value ?? {}) };
  }

  async patchUi(p: Partial<UiState>): Promise<UiState> {
    const next = { ...(await this.ui()), ...p };
    await this.db.query(`insert into settings (key, value) values ('ui', $1::jsonb) on conflict (key) do update set value=excluded.value, updated_at=now()`, [next]);
    this.bus.publish('ui.changed', next);
    return next;
  }

  async snapshot() {
    const out: Record<string, unknown> = {};
    for (const c of COLLECTIONS) out[c] = await this.list(c);
    out.device = await this.device();
    out.ui = await this.ui();
    return out;
  }

  /** Structured, text-only description of what is on the Aether screen (HeyClicky-style "look", no pixels). */
  async screenSummary(openApp?: string | null): Promise<string> {
    const app = openApp || (await this.ui()).openApp || 'home';
    const d = await this.device();
    const lines: string[] = [`Open app: ${app}.`, `Device: brightness ${Math.round(d.brightness * 100)}%, volume ${Math.round(d.volume * 100)}%, ${d.dnd ? 'Do Not Disturb on' : 'DND off'}, ${d.flashlight ? 'flashlight on' : 'flashlight off'}, appearance ${d.appearance}.`];
    const top = async (c: Collection, fmt: (x: any) => string, n = 6) => (await this.list(c)).slice(-n).reverse().map(fmt);
    switch (app) {
      case 'notes': lines.push('Notes:', ...(await top('notes', (n) => `- ${n.title}: ${String(n.body).slice(0, 80)}`))); break;
      case 'calendar': lines.push('Upcoming events:', ...(await top('events', (e) => `- ${e.start} ${e.title}${e.location ? ' @ ' + e.location : ''}`, 8))); break;
      case 'reminders': lines.push('Reminders:', ...(await top('reminders', (r) => `- [${r.done ? 'x' : ' '}] ${r.title}${r.due ? ' (due ' + r.due + ')' : ''}`, 10))); break;
      case 'mail': lines.push('Mail drafts/sent:', ...(await top('mail', (m) => `- ${m.status} to ${m.to}: ${m.subject}`))); break;
      case 'contacts': lines.push('Contacts:', ...(await top('contacts', (c) => `- ${c.name}${c.company ? ' (' + c.company + ')' : ''}`, 10))); break;
      case 'maps': lines.push(`Map: ${(await this.ui()).map?.query ?? 'no search'}`); break;
      case 'photos': lines.push('Photos:', ...(await top('photos', (p) => `- ${p.title} (${p.filter})`))); break;
      case 'documents': lines.push('Documents:', ...(await top('documents', (x) => `- ${x.title}`))); break;
      case 'alarms': lines.push('Alarms:', ...(await top('alarms', (a) => `- ${a.time} ${a.label} ${a.enabled ? 'on' : 'off'}`))); break;
      case 'reservations': lines.push('Reservations:', ...(await top('reservations', (r) => `- ${r.place} ${r.time} party ${r.party} (${r.status})`))); break;
      default: lines.push('Home screen with widgets (date, weather, reminders) and the app grid.');
    }
    return lines.join('\n');
  }
}
