import type { Aether } from './types.js';
import type { Approval } from './agent/sentinel.js';
import { log } from './util.js';

const l = log('notify');

export interface Notification { title: string; body: string; tag?: string; url?: string }

/** Owner notifications: in-app toast (always), Web Push (installed PWA), Telegram (paired owner chats). */
export class Notifier {
  constructor(private getAether: () => Aether) {}

  async vapid(): Promise<{ publicKey: string; privateKey: string }> {
    const a = this.getAether();
    const existing = await a.settings.getKey<{ publicKey: string; privateKey: string }>('vapid');
    if (existing?.publicKey) return existing;
    const webpush = (await import('web-push')).default;
    const keys = webpush.generateVAPIDKeys();
    await a.settings.setKey('vapid', keys);
    return keys;
  }

  async subscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    if (!sub?.endpoint || !sub.keys?.p256dh) throw new Error('invalid subscription');
    await this.getAether().db.query('insert into push_subscriptions (endpoint, data) values ($1,$2::jsonb) on conflict (endpoint) do update set data=excluded.data', [sub.endpoint, sub]);
  }

  async unsubscribe(endpoint: string) { await this.getAether().db.query('delete from push_subscriptions where endpoint=$1', [endpoint]); }

  async send(n: Notification): Promise<string[]> {
    const a = this.getAether();
    const used: string[] = ['app'];
    a.bus.publish('notification', n);
    const s = await a.settings.get();
    if (s.notifications.push) {
      const subs = await a.db.query<{ endpoint: string; data: any }>('select * from push_subscriptions');
      if (subs.length) {
        const webpush = (await import('web-push')).default;
        const keys = await this.vapid();
        webpush.setVapidDetails('mailto:aether@localhost', keys.publicKey, keys.privateKey);
        let ok = 0;
        for (const sub of subs) {
          try { await webpush.sendNotification(sub.data, JSON.stringify(n), { TTL: 3600 }); ok++; } catch (e: any) {
            if (e?.statusCode === 404 || e?.statusCode === 410) await this.unsubscribe(sub.endpoint);
            else l.warn(`push failed: ${e?.message}`);
          }
        }
        if (ok) used.push('push');
      }
    }
    if (s.notifications.telegram && a.telegram.isRunning()) {
      const sent = await a.telegram.sendToOwners(`*${escapeMd(n.title)}*\n${escapeMd(n.body)}`).catch(() => 0);
      if (sent) used.push('telegram');
    }
    return used;
  }

  async approvalRequested(ap: Approval) {
    const a = this.getAether();
    await this.send({ title: 'Approval needed', body: ap.summary, tag: `approval-${ap.id}`, url: '#approvals' });
    if (a.telegram.isRunning() && ap.kind !== 'secret') {
      await a.telegram.sendApproval(ap).catch((e) => l.warn(`telegram approval: ${e.message}`));
    }
  }
}

export function escapeMd(s: string) { return s.replace(/([_*`\[])/g, '\\$1'); }
