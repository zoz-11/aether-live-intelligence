// Copies the built web app into apps/core/public so a single Core process serves UI + API.
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');
const out = resolve(here, '../public');
if (existsSync(webDist)) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(webDist, out, { recursive: true });
  console.log('[copy-assets] web dist copied to', out);
} else {
  console.log('[copy-assets] no web dist found, skipping (run `npm run build --workspace apps/web` first)');
}
