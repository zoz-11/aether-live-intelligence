import type { Aether } from '../types.js';
import type { ProviderId } from '../settings.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai.js';
import { LocalEngine } from './local.js';
import type { ModelProvider } from './types.js';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseUrl: string;
  keyName: string | null;
  defaultModel: string;
  embeddingModel?: string;
  vision: boolean;
  suggestions: string[];
}

export const PROVIDERS: ProviderPreset[] = [
  { id: 'local', label: 'Local engine (no key, limited)', baseUrl: '', keyName: null, defaultModel: 'aether-local', vision: false, suggestions: ['aether-local'] },
  { id: 'xai', label: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', keyName: 'XAI_API_KEY', defaultModel: 'grok-4.5', vision: true, suggestions: ['grok-4.5', 'grok-4-latest', 'grok-4', 'grok-4-fast'] },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyName: 'OPENAI_API_KEY', defaultModel: 'gpt-5-mini', embeddingModel: 'text-embedding-3-small', vision: true, suggestions: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'] },
  { id: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', keyName: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-5', vision: true, suggestions: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'OPENROUTER_API_KEY', defaultModel: 'x-ai/grok-4-fast', vision: true, suggestions: ['x-ai/grok-4-fast', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini', 'deepseek/deepseek-chat'] },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyName: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile', vision: false, suggestions: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'] },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyName: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat', vision: false, suggestions: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyName: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-flash', embeddingModel: 'text-embedding-004', vision: true, suggestions: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
  { id: 'ollama', label: 'Ollama (local models)', baseUrl: 'http://127.0.0.1:11434/v1', keyName: null, defaultModel: 'llama3.1', vision: false, suggestions: ['llama3.1', 'qwen2.5', 'mistral'] },
  { id: 'custom', label: 'Custom OpenAI-compatible', baseUrl: '', keyName: 'CUSTOM_API_KEY', defaultModel: '', vision: true, suggestions: [] },
];

export class ModelGateway {
  private local = new LocalEngine();
  constructor(private getAether: () => Aether) {}

  preset(id: ProviderId) { return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]; }

  /** Returns the configured provider, or the local engine with a notice when keys are missing. */
  async provider(): Promise<ModelProvider & { notice?: string }> {
    const a = this.getAether();
    const s = (await a.settings.get()).model;
    const p = this.preset(s.provider);
    if (p.id === 'local') return this.local;
    const key = p.keyName ? await a.vault.get(p.keyName) : null;
    if (p.keyName && !key && p.id !== 'custom') {
      return Object.assign(Object.create(this.local), { notice: `${p.label} is selected but ${p.keyName} is not set; using the local engine.` });
    }
    const model = s.model || p.defaultModel;
    if (p.id === 'anthropic') {
      const base = s.baseUrl || process.env.ANTHROPIC_BASE_URL || p.baseUrl;
      return new AnthropicProvider(model, key!, base);
    }
    const baseUrl = s.baseUrl || p.baseUrl;
    if (!baseUrl) return Object.assign(Object.create(this.local), { notice: 'Custom provider needs a base URL.' });
    const headers: Record<string, string> = p.id === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/zoz-11/aether-live-intelligence', 'X-Title': 'Aether' } : {};
    return new OpenAICompatibleProvider(p.id, model, baseUrl, key, p.vision, headers);
  }

  /** Embedding provider when configured (OpenAI-compatible only). */
  async embedder(): Promise<ModelProvider | null> {
    const a = this.getAether();
    const s = (await a.settings.get()).model;
    const p = this.preset(s.provider);
    const model = s.embeddingModel || p.embeddingModel;
    if (!model || p.id === 'local' || p.id === 'anthropic') return null;
    const key = p.keyName ? await a.vault.get(p.keyName) : null;
    if (p.keyName && !key) return null;
    return new OpenAICompatibleProvider(p.id, model, s.baseUrl || p.baseUrl, key, false);
  }

  async describe() {
    const a = this.getAether();
    const s = (await a.settings.get()).model;
    const p = this.preset(s.provider);
    const hasKey = p.keyName ? await a.vault.has(p.keyName) : true;
    const notice = p.id !== 'local' && p.keyName && !hasKey && p.id !== 'custom' ? `${p.keyName} is not set; using the local engine` : undefined;
    return { provider: p.id, label: p.label, model: s.model || p.defaultModel, hasKey, keyName: p.keyName, vision: p.vision, notice };
  }
}
