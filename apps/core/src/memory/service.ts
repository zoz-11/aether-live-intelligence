import type { Aether } from '../types.js';
import { uid, log, safeJson } from '../util.js';

const l = log('memory');

export const MEMORY_FILES = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'AGENTS.md'] as const;
export type MemoryFileName = (typeof MEMORY_FILES)[number];

export const DEFAULT_FILES: Record<MemoryFileName, string> = {
  'SOUL.md': `# Soul\n\nCalm, warm, precise. Speaks like a trusted chief of staff, not a chatbot.\n- Act first when the request is clear; ask one short question when it is not.\n- Be honest about limits. Never claim an action that a tool did not perform.\n- Protect the owner's time, money, privacy and reputation.\n- Short answers by default; detail on request.\n`,
  'IDENTITY.md': `# Identity\n\nName: Aether\nRole: Personal agent and right hand.\nHas: its own computer, its own email inbox, its own phone line (when configured).\nVoice: clear, unhurried, friendly.\n`,
  'USER.md': `# About my owner\n\n(Aether fills this in as it learns. Edit freely.)\n`,
  'MEMORY.md': `# Long-term notes\n\n(Durable notes Aether keeps across conversations.)\n`,
  'AGENTS.md': `# Operating rules\n\n1. Use tools to act. Report what actually happened, including failures.\n2. Risky actions go through approvals. Never ask the owner to type "yes" in chat for that; the approval card handles it.\n3. Prefer the agent computer for web tasks, downloads and development work.\n4. Keep secrets as {{secret:NAME}} placeholders. Never ask for passwords in chat; use the secrets tool to request them.\n5. When a background job is better, create a task and tell the owner it is running.\n`,
};

export interface Fact {
  id: string;
  text: string;
  kind: string;
  source: string | null;
  pinned: boolean;
  uses: number;
  embedding?: number[] | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

const STOP = new Set('the a an and or but of to in on at for with is are was were be been am i me my mine you your we our it its this that these those what which who whom how when where why do does did can could should would will shall may might have has had not no yes please tell about from into over under than then there their they them he she his her him as by if so just also very really'.split(' '));

export function keywords(q: string): string[] {
  return [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 12);
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Heuristic fact extraction used when no model is connected. */
export function heuristicFacts(text: string): { text: string; kind: string }[] {
  const out: { text: string; kind: string }[] = [];
  const t = text.trim();
  const clean = (s: string) => s.trim().replace(/[.!?,;]+$/, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\bmy name is ([\p{L}][\p{L}'-]+(?: [\p{L}][\p{L}'-]+)?)/iu))) out.push({ text: `The user's name is ${clean(m[1])}.`, kind: 'profile' });
  if ((m = t.match(/\bcall me ([\p{L}][\p{L}'-]+)/iu))) out.push({ text: `The user likes to be called ${clean(m[1])}.`, kind: 'preference' });
  if ((m = t.match(/\bi live in ([^.!?\n]+)/i))) out.push({ text: `The user lives in ${clean(m[1])}.`, kind: 'profile' });
  if ((m = t.match(/\bi work (?:at|for) ([^.!?\n]+)/i))) out.push({ text: `The user works at ${clean(m[1])}.`, kind: 'profile' });
  if ((m = t.match(/\bi work as an? ([^.!?\n]+)/i))) out.push({ text: `The user works as a ${clean(m[1])}.`, kind: 'profile' });
  if ((m = t.match(/\bmy (wife|husband|partner|son|daughter|mother|mom|father|dad|brother|sister|boss|manager|assistant|friend)(?:'s name)? is ([\p{L}][\p{L}'-]+)/iu))) out.push({ text: `The user's ${m[1].toLowerCase()} is ${clean(m[2])}.`, kind: 'relationship' });
  if ((m = t.match(/\bmy birthday is ([^.!?\n]+)/i))) out.push({ text: `The user's birthday is ${clean(m[1])}.`, kind: 'profile' });
  if ((m = t.match(/\bi (?:really )?(?:prefer|love|like|enjoy) ([^.!?\n]{3,80})/i)) && !/\bto know\b|\byou\b/i.test(m[1])) out.push({ text: `The user likes ${clean(m[1])}.`, kind: 'preference' });
  if ((m = t.match(/\bi (?:don't|do not|hate|dislike) (?:like )?([^.!?\n]{3,80})/i)) && !/\bknow\b|\bthink\b|\bwant\b/i.test(m[1])) out.push({ text: `The user dislikes ${clean(m[1])}.`, kind: 'preference' });
  if ((m = t.match(/\bmy favou?rite ([\p{L} ]{2,30}) is ([^.!?\n]+)/iu))) out.push({ text: `The user's favorite ${clean(m[1])} is ${clean(m[2])}.`, kind: 'preference' });
  return out;
}

export class MemoryService {
  constructor(private getAether: () => Aether) {}

  private get db() { return this.getAether().db; }

  async ensureFiles() {
    for (const name of MEMORY_FILES) {
      await this.db.query('insert into memory_files (name, content) values ($1,$2) on conflict (name) do nothing', [name, DEFAULT_FILES[name]]);
    }
  }

  async files(): Promise<Record<string, string>> {
    const rows = await this.db.query<{ name: string; content: string }>('select name, content from memory_files');
    const out: Record<string, string> = {};
    for (const n of MEMORY_FILES) out[n] = rows.find((r) => r.name === n)?.content ?? DEFAULT_FILES[n];
    return out;
  }

  async file(name: MemoryFileName) { return (await this.files())[name]; }

  async setFile(name: string, content: string) {
    if (!(MEMORY_FILES as readonly string[]).includes(name)) throw new Error(`unknown memory file ${name}`);
    await this.db.query(
      'insert into memory_files (name, content) values ($1,$2) on conflict (name) do update set content=excluded.content, updated_at=now()',
      [name, content.slice(0, 40000)],
    );
    this.getAether().bus.publish('memory.changed', { file: name });
  }

  async appendToFile(name: MemoryFileName, line: string) {
    const cur = await this.file(name);
    await this.setFile(name, `${cur.trimEnd()}\n- ${line.trim()}\n`);
  }

  async facts(limit = 500): Promise<Fact[]> {
    return this.db.query<Fact>('select id, text, kind, source, pinned, uses, created_at, updated_at, last_used_at from facts order by pinned desc, updated_at desc limit $1', [limit]);
  }

  private async embedOne(text: string): Promise<number[] | null> {
    try {
      const e = await this.getAether().models.embedder();
      if (!e) return null;
      const [v] = await e.embed!([text]);
      return v ?? null;
    } catch (err: any) {
      l.debug(`embedding skipped: ${err?.message}`);
      return null;
    }
  }

  async addFact(text: string, kind = 'note', source: string | null = null, pinned = false): Promise<{ fact: Fact; duplicate: boolean }> {
    const t = text.trim().slice(0, 1000);
    if (!t) throw new Error('empty fact');
    const existing = await this.db.query<Fact>('select * from facts');
    const n = norm(t);
    const dup = existing.find((f) => norm(f.text) === n);
    if (dup) return { fact: dup, duplicate: true };
    const embedding = await this.embedOne(t);
    const fact = await this.db.one<Fact>(
      'insert into facts (id, text, kind, source, pinned, embedding) values ($1,$2,$3,$4,$5,$6::jsonb) returning id, text, kind, source, pinned, uses, created_at, updated_at, last_used_at',
      [uid('mem'), t, kind, source, pinned, embedding],
    );
    this.getAether().bus.publish('memory.changed', { fact });
    return { fact: fact!, duplicate: false };
  }

  async updateFact(id: string, patch: { text?: string; kind?: string; pinned?: boolean }) {
    const cur = await this.db.one<Fact>('select * from facts where id=$1', [id]);
    if (!cur) throw new Error('fact not found');
    const text = patch.text?.trim() || cur.text;
    const embedding = patch.text ? await this.embedOne(text) : cur.embedding ?? null;
    await this.db.query('update facts set text=$2, kind=$3, pinned=$4, embedding=$5::jsonb, updated_at=now() where id=$1',
      [id, text, patch.kind ?? cur.kind, patch.pinned ?? cur.pinned, embedding]);
    this.getAether().bus.publish('memory.changed', { id });
  }

  async removeFact(id: string) {
    await this.db.query('delete from facts where id=$1', [id]);
    this.getAether().bus.publish('memory.changed', { id, removed: true });
  }

  /** Hybrid retrieval: keyword (Postgres full text + substring), embeddings when available, pinned + recency boosts. */
  async search(query: string, k = 8): Promise<(Fact & { score: number })[]> {
    const words = keywords(query);
    const scores = new Map<string, number>();
    const byId = new Map<string, Fact>();
    if (words.length) {
      const tsq = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' | ');
      try {
        const rows = await this.db.query<Fact & { rank: number }>(
          `select *, ts_rank(to_tsvector('simple', text), to_tsquery('simple', $1)) as rank from facts
           where to_tsvector('simple', text) @@ to_tsquery('simple', $1) order by rank desc limit 30`, [tsq]);
        for (const r of rows) { byId.set(r.id, r); scores.set(r.id, (scores.get(r.id) ?? 0) + 1 + Number(r.rank) * 4); }
      } catch (e: any) { l.debug(`fts failed: ${e?.message}`); }
      const like = await this.db.query<Fact>(
        `select * from facts where ${words.map((_, i) => `text ilike $${i + 1}`).join(' or ')} limit 30`, words.map((w) => `%${w.slice(0, 5)}%`));
      for (const r of like) { byId.set(r.id, r); scores.set(r.id, (scores.get(r.id) ?? 0) + 0.6); }
    }
    const qv = await this.embedOne(query);
    if (qv) {
      const rows = await this.db.query<Fact>('select * from facts where embedding is not null');
      for (const r of rows) {
        const c = cosine(qv, (r.embedding as number[]) ?? []);
        if (c > 0.25) { byId.set(r.id, r); scores.set(r.id, (scores.get(r.id) ?? 0) + c * 2.5); }
      }
    }
    const nowMs = Date.now();
    const out = [...byId.values()].map((f) => {
      const ageDays = (nowMs - new Date(f.updated_at).getTime()) / 864e5;
      const s = (scores.get(f.id) ?? 0) + (f.pinned ? 0.8 : 0) + Math.max(0, 0.3 - ageDays * 0.01);
      const { embedding: _e, ...rest } = f as any;
      return { ...rest, score: s } as Fact & { score: number };
    });
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Facts for the system prompt: relevant matches, pinned facts, then the most recent few. */
  async relevant(query: string, k = 8): Promise<Fact[]> {
    const hits = await this.search(query, k);
    const ids = new Set(hits.map((h) => h.id));
    const pinned = await this.db.query<Fact>('select id, text, kind, source, pinned, uses, created_at, updated_at, last_used_at from facts where pinned order by updated_at desc limit 6');
    const recent = await this.db.query<Fact>('select id, text, kind, source, pinned, uses, created_at, updated_at, last_used_at from facts order by updated_at desc limit 4');
    const out: Fact[] = [...hits];
    for (const f of [...pinned, ...recent]) if (!ids.has(f.id) && out.length < k + 6) { ids.add(f.id); out.push(f); }
    if (hits.length) await this.db.query(`update facts set uses=uses+1, last_used_at=now() where id = any($1::text[])`, [`{${hits.map((h) => h.id).join(',')}}`]).catch(() => undefined);
    return out;
  }

  async forget(query: string): Promise<Fact[]> {
    const direct = await this.db.one<Fact>('select * from facts where id=$1', [query]);
    const victims = direct ? [direct] : (await this.search(query, 5)).filter((f) => f.score >= 1);
    for (const v of victims) await this.removeFact(v.id);
    return victims;
  }

  async reset() {
    await this.db.query('delete from facts');
    for (const n of MEMORY_FILES) await this.setFile(n, DEFAULT_FILES[n]);
    this.getAether().bus.publish('memory.changed', { reset: true });
  }

  async exportMarkdown(): Promise<string> {
    const files = await this.files();
    const facts = await this.facts(5000);
    const parts = Object.entries(files).map(([n, c]) => `<!-- ${n} -->\n${c.trim()}\n`);
    parts.push('# Facts\n\n' + facts.map((f) => `- (${f.kind}${f.pinned ? ', pinned' : ''}) ${f.text}`).join('\n') + '\n');
    return parts.join('\n');
  }

  /** Mem0-style: extract durable facts from the latest exchange and reconcile with similar ones. */
  async extract(source: string, userText: string, assistantText: string): Promise<{ added: number; updated: number; removed: number }> {
    const a = this.getAether();
    const res = { added: 0, updated: 0, removed: 0 };
    if (!userText.trim()) return res;
    const provider = await a.models.provider();
    if (provider.id === 'local') {
      for (const f of heuristicFacts(userText)) {
        const r = await this.addFact(f.text, f.kind, source);
        if (!r.duplicate) res.added++;
      }
      return res;
    }
    const similar = await this.search(`${userText}\n${assistantText}`, 10);
    const sys = 'You maintain long-term memory for a personal assistant. From the latest exchange, extract durable facts about the user: identity, preferences, relationships, plans, important dates, projects, accounts (never secrets or passwords). Ignore small talk and one-off requests. Compare with existing memories and return strict JSON: {"add":[{"text":"...","kind":"profile|preference|relationship|plan|project|note"}],"update":[{"id":"...","text":"..."}],"delete":["id"]}. Each fact is one short third-person sentence starting with "The user". Return empty arrays when nothing qualifies.';
    const user = `Existing memories:\n${similar.map((f) => `- [${f.id}] ${f.text}`).join('\n') || '(none)'}\n\nLatest exchange:\nUser: ${userText.slice(0, 2000)}\nAssistant: ${assistantText.slice(0, 1500)}`;
    try {
      const r = await provider.chat({ system: sys, messages: [{ role: 'user', content: user }], tools: [], json: true, temperature: 0 });
      const j = safeJson<any>(r.text.replace(/^```(?:json)?|```$/g, '').trim(), null);
      if (!j) return res;
      for (const f of (j.add ?? []).slice(0, 5)) if (f?.text) { const x = await this.addFact(String(f.text), String(f.kind ?? 'note'), source); if (!x.duplicate) res.added++; }
      for (const u of (j.update ?? []).slice(0, 5)) if (u?.id && u?.text && similar.some((s) => s.id === u.id)) { await this.updateFact(u.id, { text: String(u.text) }); res.updated++; }
      for (const id of (j.delete ?? []).slice(0, 5)) if (similar.some((s) => s.id === id)) { await this.removeFact(String(id)); res.removed++; }
    } catch (e: any) {
      l.warn(`extraction failed: ${e?.message}`);
      for (const f of heuristicFacts(userText)) { const x = await this.addFact(f.text, f.kind, source); if (!x.duplicate) res.added++; }
    }
    return res;
  }
}
