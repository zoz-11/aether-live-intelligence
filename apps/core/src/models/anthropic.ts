import { readSSE } from './sse.js';
import { safeArgs } from './openai.js';
import { ModelError, type ChatMessage, type ChatRequest, type ChatResponse, type ModelProvider } from './types.js';

/** Converts internal messages to Anthropic Messages API format, merging consecutive same-role turns. */
export function toAnthropicMessages(messages: ChatMessage[]) {
  const out: { role: 'user' | 'assistant'; content: any[] }[] = [];
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      const blocks: any[] = [];
      for (const i of m.images ?? []) blocks.push({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } });
      blocks.push({ type: 'text', text: m.content || '(empty)' });
      push('user', blocks);
    } else if (m.role === 'assistant') {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
      if (!blocks.length) blocks.push({ type: 'text', text: '…' });
      push('assistant', blocks);
    } else {
      const content: any[] = [{ type: 'text', text: m.content || '(empty)' }];
      for (const i of m.images ?? []) content.push({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } });
      push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content, is_error: m.isError || undefined }]);
    }
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation continues)' }] });
  return out;
}

export class AnthropicProvider implements ModelProvider {
  id = 'anthropic';
  vision = true;
  constructor(public model: string, private apiKey: string, private baseUrl: string) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model || this.model;
    const body: any = {
      model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      stream: true,
      temperature: req.temperature ?? 0.4,
    };
    if (req.tools.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new ModelError(`anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`, res.status);
    let text = '';
    let stop = 'end_turn';
    const usage: ChatResponse['usage'] = {};
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();
    for await (const ev of readSSE(res, req.signal)) {
      let j: any;
      try { j = JSON.parse(ev.data); } catch { continue; }
      switch (j.type) {
        case 'message_start': usage.input = j.message?.usage?.input_tokens; break;
        case 'content_block_start': blocks.set(j.index, { type: j.content_block?.type, id: j.content_block?.id, name: j.content_block?.name, json: '' }); break;
        case 'content_block_delta': {
          const b = blocks.get(j.index);
          if (j.delta?.type === 'text_delta') { text += j.delta.text; req.onText?.(j.delta.text); }
          else if (j.delta?.type === 'input_json_delta' && b) b.json += j.delta.partial_json ?? '';
          break;
        }
        case 'message_delta': if (j.delta?.stop_reason) stop = j.delta.stop_reason; usage.output = j.usage?.output_tokens; break;
        case 'error': throw new ModelError(`anthropic: ${JSON.stringify(j.error).slice(0, 300)}`);
        default: break;
      }
    }
    const toolCalls = [...blocks.entries()].sort((a, b) => a[0] - b[0]).filter(([, b]) => b.type === 'tool_use').map(([, b]) => ({ id: b.id!, name: b.name!, args: safeArgs(b.json || '{}') }));
    return { text, toolCalls, stop, usage, provider: 'anthropic', model };
  }
}
