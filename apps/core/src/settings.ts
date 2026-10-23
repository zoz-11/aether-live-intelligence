import type { Db } from './db/index.js';
import type { EventBus } from './events.js';

export type ProviderId = 'local' | 'xai' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'gemini' | 'ollama' | 'custom';

export interface Settings {
  model: { provider: ProviderId; model: string; baseUrl: string; temperature: number; embeddingModel: string; maxSteps: number };
  voice: { stt: 'browser' | 'openai' | 'groq'; tts: 'browser' | 'openai' | 'xai' | 'elevenlabs' | 'off'; voice: string; speakReplies: boolean; lockMode: 'hold' | 'toggle' };
  customInstructions: string;
  policy: { mode: 'careful' | 'balanced' | 'autonomous'; approvalTimeoutSec: number };
  owner: { name: string; timezone: string; locale: string };
  email: {
    address: string;
    fromName: string;
    outbound: 'loopback' | 'smtp' | 'resend';
    smtp: { host: string; port: number; secure: boolean; user: string };
    inboundSmtp: { enabled: boolean; acceptAll: boolean };
    imap: { enabled: boolean; host: string; port: number; secure: boolean; user: string; intervalSec: number };
    autoTriage: boolean;
  };
  phone: {
    provider: 'mock' | 'twilio';
    number: string;
    mode: 'relay' | 'gather';
    language: string;
    voice: string;
    ownerNumbers: string[];
    inbound: 'assistant' | 'owner-only';
  };
  computer: { provider: 'local' | 'remote' | 'off'; url: string; vncHost: string; vncPort: number; cdpUrl: string; autoStart: boolean; width: number; height: number };
  telegram: { ownerChatIds: string[]; pairingCode: string };
  publicUrl: string;
  notifications: { push: boolean; telegram: boolean };
  onboarding: { done: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  model: { provider: 'local', model: '', baseUrl: '', temperature: 0.4, embeddingModel: '', maxSteps: 14 },
  voice: { stt: 'browser', tts: 'browser', voice: 'eve', speakReplies: true, lockMode: 'toggle' },
  customInstructions: '',
  policy: { mode: 'balanced', approvalTimeoutSec: 600 },
  owner: { name: '', timezone: process.env.TZ || 'Asia/Riyadh', locale: 'en-US' },
  email: {
    address: 'aether@aether.local',
    fromName: 'Aether',
    outbound: 'loopback',
    smtp: { host: '', port: 587, secure: false, user: '' },
    inboundSmtp: { enabled: true, acceptAll: false },
    imap: { enabled: false, host: '', port: 993, secure: true, user: '', intervalSec: 120 },
    autoTriage: false,
  },
  phone: { provider: 'mock', number: '', mode: 'gather', language: 'en-US', voice: 'Polly.Joanna-Neural', ownerNumbers: [], inbound: 'assistant' },
  computer: { provider: 'local', url: 'http://127.0.0.1:9990', vncHost: '127.0.0.1', vncPort: 5900, cdpUrl: 'http://127.0.0.1:9222', autoStart: false, width: 1280, height: 800 },
  telegram: { ownerChatIds: [], pairingCode: '' },
  publicUrl: '',
  notifications: { push: true, telegram: true },
  onboarding: { done: false },
};

function isObj(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }

export function deepMerge<T>(base: T, patch: any): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObj((base as any)[k]) && isObj(v) ? deepMerge((base as any)[k], v) : v;
  }
  return out;
}

/** Settings live in one JSON document; patches are deep-merged and broadcast. */
export class SettingsStore {
  private cached: Settings | null = null;
  constructor(private db: Db, private bus: EventBus) {}

  async get(): Promise<Settings> {
    if (this.cached) return this.cached;
    const row = await this.db.one<{ value: any }>(`select value from settings where key='app'`);
    this.cached = deepMerge(DEFAULT_SETTINGS, row?.value ?? {});
    return this.cached;
  }

  async patch(patch: Partial<Settings> | Record<string, any>): Promise<Settings> {
    const next = deepMerge(await this.get(), patch);
    await this.db.query(
      `insert into settings (key, value) values ('app', $1::jsonb) on conflict (key) do update set value=excluded.value, updated_at=now()`,
      [next],
    );
    this.cached = next;
    this.bus.publish('settings.changed', next);
    return next;
  }

  async getKey<T = any>(key: string): Promise<T | null> {
    const row = await this.db.one<{ value: T }>('select value from settings where key=$1', [key]);
    return row ? row.value : null;
  }

  async setKey(key: string, value: unknown) {
    await this.db.query(
      `insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value=excluded.value, updated_at=now()`,
      [key, value],
    );
  }
}
