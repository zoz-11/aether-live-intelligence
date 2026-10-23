import { randomUUID } from 'node:crypto';

export const uid = (prefix = '') => (prefix ? `${prefix}_` : '') + randomUUID().replace(/-/g, '').slice(0, 20);

export const now = () => new Date();

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.7);
  const tail = max - head - 40;
  return `${s.slice(0, head)}\n…[${s.length - head - Math.max(tail, 0)} chars truncated]…\n${tail > 0 ? s.slice(-tail) : ''}`;
}

export function safeJson<T = unknown>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: Level = (process.env.AETHER_LOG_LEVEL as Level) || 'info';
export function setLogLevel(l: Level) { minLevel = l; }
function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  if (order[level] < order[minLevel]) return;
  if (process.env.VITEST && level !== 'error') return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${msg}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  if (extra !== undefined) out(line, extra instanceof Error ? extra.message : extra);
  else out(line);
}
export const log = (scope: string) => ({
  debug: (m: string, e?: unknown) => emit('debug', scope, m, e),
  info: (m: string, e?: unknown) => emit('info', scope, m, e),
  warn: (m: string, e?: unknown) => emit('warn', scope, m, e),
  error: (m: string, e?: unknown) => emit('error', scope, m, e),
});

/** Parses phrases like "in 10 minutes", "tomorrow at 8am", "at 17:30", ISO strings. Returns null if unknown. */
/** Minutes that `tz` is ahead of UTC at instant `at`. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch { return -at.getTimezoneOffset(); }
}

/** Wall-clock parts of `at` in `tz`. */
function wallParts(at: Date, tz: string) {
  const off = tzOffsetMinutes(at, tz);
  const w = new Date(at.getTime() + off * 60000);
  return { y: w.getUTCFullYear(), mo: w.getUTCMonth(), d: w.getUTCDate(), h: w.getUTCHours(), mi: w.getUTCMinutes() };
}

/** Converts a wall-clock time in `tz` to a real instant. */
function fromWall(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo, d, h, mi, 0, 0);
  let t = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  t = guess - tzOffsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** Parses "in 10 minutes", "at 9am", "tomorrow at 18:30", "tomorrow" or an ISO date, in the owner's timezone. */
export function parseWhen(input: string, base = new Date(), tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): Date | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const iso = Date.parse(input);
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(input)) return new Date(iso);
  const rel = s.match(/in\s+(\d+(?:\.\d+)?)\s*(second|sec|s|minute|min|m|hour|hr|h|day|d|week|w)s?\b/);
  if (rel) {
    const n = parseFloat(rel[1]);
    const unit = rel[2];
    const ms = unit.startsWith('s') ? 1e3 : unit.startsWith('mi') || unit === 'm' ? 6e4 : unit.startsWith('h') ? 36e5 : unit.startsWith('d') ? 864e5 : 6048e5;
    return new Date(base.getTime() + n * ms);
  }
  const now = wallParts(base, tz);
  const tomorrow = /\btomorrow\b/.test(s);
  const day = now.d + (tomorrow ? 1 : 0);
  const tm = s.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  const hasTimeWord = /\bat\b|am\b|pm\b|:\d{2}/.test(s);
  if (tm && hasTimeWord) {
    let h = parseInt(tm[1], 10);
    const m = tm[2] ? parseInt(tm[2], 10) : 0;
    if (tm[3] === 'pm' && h < 12) h += 12;
    if (tm[3] === 'am' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    let at = fromWall(now.y, now.mo, day, h, m, tz);
    if (!tomorrow && at.getTime() < base.getTime()) at = fromWall(now.y, now.mo, day + 1, h, m, tz);
    return at;
  }
  if (tomorrow) return fromWall(now.y, now.mo, day, 9, 0, tz);
  return null;
}

const SENSITIVE_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|_KEY$|^KEY$|PRIVATE|CREDENTIAL|DATABASE_URL|^AETHER_|^DESKTOPD_TOKEN$|^PG(PASSWORD|USER|HOST|DATABASE)$|SESSION|COOKIE|AUTH)/i;

/** process.env without anything that looks like a credential (for child processes the agent controls). */
export function safeEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !SENSITIVE_ENV.test(k)) out[k] = v;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v;
  return out;
}
