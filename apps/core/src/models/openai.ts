import { readSSE } from './sse.js';
import { ModelError, type ChatMessage, type ChatRequest, type ChatResponse, type ModelProvider, type ToolCall } from './types.js';

/** Converts internal messages to OpenAI chat-completions format (works for xAI, OpenAI, OpenRouter, Groq, DeepSeek, Gemini-compat, Ollama). */
export function toOpenAIMessages(system: string, messages: ChatMessage[], vision: boolean) {
  const out: any[] = [{ role: 'system', content: system }];
  let pendingImages: { name: string; images: NonNullable<Extract<ChatMessage, { role: 'tool' }>['images']> }[] = [];
  const flushImages = () => {
    if (!pendingImages.length) return;
    if (vision) {
      const parts: any[] = [{ type: 'text', text: `Images returned by tools: ${pendingImages.map((p) => p.name).join(', ')}` }];
      for (const p of pendingImages) for (const img of p.images) parts.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
      out.push({ role: 'user', content: parts });
    }
    pendingImages = [];
  };
  for (const m of messages) {
    if (m.role !== 'tool') flushImages();
    if (m.role === 'user') {
      if (m.images?.length && vision) {
        out.push({ role: 'user', content: [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] });
      } else out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }));
      }
      out.push(msg);
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content || '(empty)' });
      if (m.images?.length) pendingImages.push({ name: m.name, images: m.images });
    }
  }
  flushImages();
  return out;
}

export class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    public id: string,
    public model: string,
    private baseUrl: string,
    private apiKey: string | null,
    public vision = true,
    private extraHeaders: Record<string, string> = {},
  ) {}

  private headers() {
    const h: Record<string, string> = { 'content-type': 'application/json', ...this.extraHeaders };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model || this.model;
    const body: any = {
      model,
      messages: toOpenAIMessages(req.system, req.messages, this.vision),
      stream: true,
      temperature: req.temperature ?? 0.4,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    if (req.json) body.response_format = { type: 'json_object' };
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: req.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new ModelError(`${this.id} ${res.status}: ${t.slice(0, 400)}`, res.status);
    }
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('event-stream')) {
      const j: any = await res.json();
      const msg = j.choices?.[0]?.message ?? {};
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text) req.onText?.(text);
      return {
        text,
        toolCalls: (msg.tool_calls ?? []).map((c: any, i: number) => ({ id: c.id || `call_${i}`, name: c.function?.name, args: safeArgs(c.function?.arguments) })),
        stop: j.choices?.[0]?.finish_reason ?? 'stop', provider: this.id, model,
        usage: { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens },
      };
    }
    let text = '';
    let stop = 'stop';
    let usage: ChatResponse['usage'];
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const ev of readSSE(res, req.signal)) {
      if (ev.data === '[DONE]') break;
      let j: any;
      try { j = JSON.parse(ev.data); } catch { continue; }
      if (j.error) throw new ModelError(`${this.id}: ${JSON.stringify(j.error).slice(0, 300)}`);
      if (j.usage) usage = { input: j.usage.prompt_tokens, output: j.usage.completion_tokens };
      const choice = j.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      if (typeof d.content === 'string' && d.content) { text += d.content; req.onText?.(d.content); }
      for (const tc of d.tool_calls ?? []) {
        const idx = typeof tc.index === 'number' ? tc.index : calls.size;
        const cur = calls.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (choice.finish_reason) stop = choice.finish_reason;
    }
    const toolCalls: ToolCall[] = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ id: c.id || `call_${Date.now()}_${i}`, name: c.name, args: safeArgs(c.args) }));
    return { text, toolCalls, stop, usage, provider: this.id, model };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const model = this.model;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) throw new ModelError(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
    const j: any = await res.json();
    return (j.data ?? []).map((d: any) => d.embedding as number[]);
  }
}

export function safeArgs(s: unknown): any {
  if (s && typeof s === 'object') return s;
  if (typeof s !== 'string' || !s.trim()) return {};
  try { return JSON.parse(s); } catch {
    // Some models emit trailing garbage; try the largest JSON object prefix.
    const end = s.lastIndexOf('}');
    if (end > 0) { try { return JSON.parse(s.slice(0, end + 1)); } catch { /* fallthrough */ } }
    return { _raw: s };
  }
}
