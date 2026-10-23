import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface Skill { name: string; description: string; dir: string; source: 'bundled' | 'user' }

export function parseSkill(md: string): { meta: Record<string, any>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  let meta: Record<string, any> = {};
  try { meta = parseYaml(m[1]) ?? {}; } catch { meta = {}; }
  return { meta, body: m[2] };
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

/** SKILL.md skills (AgentSkills format): the index goes in the prompt, bodies are read on demand. */
export class SkillService {
  constructor(private dirs: string[], private userDir: string) {}

  async list(): Promise<Skill[]> {
    const out: Skill[] = [];
    const seen = new Set<string>();
    for (const [i, dir] of [this.userDir, ...this.dirs.filter((d) => d !== this.userDir)].entries()) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const sd = join(dir, name);
        const f = join(sd, 'SKILL.md');
        if (!existsSync(f) || !statSync(sd).isDirectory()) continue;
        const { meta } = parseSkill(readFileSync(f, 'utf8'));
        const n = String(meta.name ?? name);
        if (seen.has(n)) continue;
        seen.add(n);
        out.push({ name: n, description: String(meta.description ?? '').slice(0, 300), dir: sd, source: i === 0 ? 'user' : 'bundled' });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(name: string): Promise<{ skill: Skill; body: string; files: string[] } | null> {
    const s = (await this.list()).find((x) => x.name === name);
    if (!s) return null;
    const { body } = parseSkill(readFileSync(join(s.dir, 'SKILL.md'), 'utf8'));
    const files = readdirSync(s.dir).filter((f) => f !== 'SKILL.md');
    return { skill: s, body, files };
  }

  async readFile(name: string, file: string): Promise<string> {
    const s = (await this.list()).find((x) => x.name === name);
    if (!s || file.includes('..') || file.includes('/')) throw new Error('not found');
    return readFileSync(join(s.dir, file), 'utf8').slice(0, 50_000);
  }

  async create(name: string, description: string, body: string) {
    if (!NAME_RE.test(name)) throw new Error('Skill names are lowercase-with-dashes.');
    const dir = join(this.userDir, name);
    mkdirSync(dir, { recursive: true });
    const safeDesc = description.replace(/\n/g, ' ').replace(/"/g, "'");
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${safeDesc}"\n---\n\n${body.trim()}\n`);
    return { name, dir };
  }

  async remove(name: string) {
    const s = (await this.list()).find((x) => x.name === name);
    if (!s) throw new Error('not found');
    if (s.source !== 'user') throw new Error('Bundled skills cannot be deleted; disable instead by editing the repo.');
    rmSync(s.dir, { recursive: true, force: true });
  }
}
