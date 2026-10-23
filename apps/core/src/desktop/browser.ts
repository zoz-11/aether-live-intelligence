import type { Browser, Page } from 'playwright-core';
import type { ToolImage } from '../types.js';

const SNAPSHOT_JS = `(() => {
  const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=true],summary';
  document.querySelectorAll('[data-aether-id]').forEach(e => e.removeAttribute('data-aether-id'));
  const out = []; let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
    if (r.bottom < -50 || r.top > innerHeight * 2.5) continue;
    const id = ++i; el.setAttribute('data-aether-id', String(id));
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.title || el.getAttribute('alt') || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 90);
    const href = el.getAttribute && el.getAttribute('href');
    out.push('[' + id + '] <' + el.tagName.toLowerCase() + (el.type ? ' type=' + el.type : '') + '> ' + label + (href ? ' -> ' + href.slice(0, 90) : ''));
    if (out.length >= 160) break;
  }
  const text = document.body ? document.body.innerText.replace(/\\n{3,}/g, '\\n\\n').slice(0, 4000) : '';
  return { title: document.title, url: location.href, elements: out, text, scrollY: Math.round(scrollY), height: document.body ? document.body.scrollHeight : 0 };
})()`;

/** Drives the agent computer's Chromium over CDP with an indexed element snapshot (browser-use style). */
export class BrowserController {
  private browser: Browser | null = null;
  private current: Page | null = null;
  constructor(private cdpUrl: () => Promise<string>) {}

  private async connect(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.connectOverCDP(await this.cdpUrl(), { timeout: 15_000 });
    this.browser.on('disconnected', () => { this.browser = null; this.current = null; });
    return this.browser;
  }

  async page(): Promise<Page> {
    const b = await this.connect();
    if (this.current && !this.current.isClosed()) return this.current;
    const ctx = b.contexts()[0] ?? (await b.newContext());
    const pages = ctx.pages().filter((p) => !p.url().startsWith('devtools://'));
    this.current = pages[pages.length - 1] ?? (await ctx.newPage());
    return this.current;
  }

  async navigate(url: string) {
    const p = await this.page();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await p.bringToFront().catch(() => undefined);
    return this.snapshot();
  }

  async snapshot(): Promise<string> {
    const p = await this.page();
    await p.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    const s: any = await p.evaluate(SNAPSHOT_JS);
    return `Page: ${s.title}\nURL: ${s.url}\nScroll: ${s.scrollY}/${s.height}\n\nInteractive elements:\n${s.elements.join('\n') || '(none)'}\n\nVisible text:\n${s.text}`;
  }

  private async el(id: number) {
    const p = await this.page();
    const loc = p.locator(`[data-aether-id="${id}"]`).first();
    if (!(await loc.count())) throw new Error(`Element [${id}] not found. Take a fresh snapshot first.`);
    return { p, loc };
  }

  async click(id: number) {
    const { p, loc } = await this.el(id);
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    await loc.click({ timeout: 10_000 });
    await p.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined);
    await p.waitForTimeout(400);
    return this.snapshot();
  }

  async type(id: number, text: string, submit = false) {
    const { p, loc } = await this.el(id);
    await loc.fill(text, { timeout: 10_000 }).catch(async () => { await loc.click(); await p.keyboard.type(text, { delay: 10 }); });
    if (submit) { await loc.press('Enter'); await p.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined); await p.waitForTimeout(600); }
    return this.snapshot();
  }

  async select(id: number, value: string) {
    const { loc } = await this.el(id);
    await loc.selectOption(value);
    return this.snapshot();
  }

  async press(keys: string) { const p = await this.page(); await p.keyboard.press(keys); await p.waitForTimeout(300); return this.snapshot(); }

  async scroll(direction: 'up' | 'down', amount = 1) {
    const p = await this.page();
    await p.mouse.wheel(0, (direction === 'up' ? -1 : 1) * 700 * Math.max(1, Math.min(amount, 10)));
    await p.waitForTimeout(300);
    return this.snapshot();
  }

  async back() { const p = await this.page(); await p.goBack({ timeout: 15_000 }).catch(() => undefined); return this.snapshot(); }
  async reload() { const p = await this.page(); await p.reload({ timeout: 30_000 }); return this.snapshot(); }

  async extract(): Promise<string> {
    const p = await this.page();
    const t = await p.evaluate(() => document.body?.innerText ?? '');
    return `URL: ${p.url()}\n\n${t.replace(/\n{3,}/g, '\n\n').slice(0, 20_000)}`;
  }

  async screenshot(): Promise<ToolImage> {
    const p = await this.page();
    const buf = await p.screenshot({ type: 'jpeg', quality: 60 });
    return { mime: 'image/jpeg', base64: buf.toString('base64') };
  }

  async tabs(): Promise<string> {
    const b = await this.connect();
    const pages = b.contexts().flatMap((c) => c.pages());
    return pages.map((p, i) => `${i}: ${p.url()}${p === this.current ? ' (active)' : ''}`).join('\n') || '(no tabs)';
  }

  async switchTab(index: number) {
    const b = await this.connect();
    const pages = b.contexts().flatMap((c) => c.pages());
    if (!pages[index]) throw new Error(`No tab ${index}`);
    this.current = pages[index];
    await this.current.bringToFront();
    return this.snapshot();
  }

  async newTab(url?: string) {
    const b = await this.connect();
    const ctx = b.contexts()[0] ?? (await b.newContext());
    this.current = await ctx.newPage();
    if (url) return this.navigate(url);
    return this.snapshot();
  }

  async close() { try { await this.browser?.close(); } catch { /* ignore */ } this.browser = null; this.current = null; }
}
