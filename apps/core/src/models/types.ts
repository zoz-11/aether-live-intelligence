import type { ToolImage } from '../types.js';

export interface ToolCall { id: string; name: string; args: any }
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }

export type ChatMessage =
  | { role: 'user'; content: string; images?: ToolImage[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; images?: ToolImage[]; isError?: boolean };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for plain JSON output (used by memory extraction). */
  json?: boolean;
  model?: string;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  stop: string;
  usage?: { input?: number; output?: number };
  provider: string;
  model: string;
  notice?: string;
}

export interface ModelProvider {
  id: string;
  model: string;
  vision: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed?(texts: string[]): Promise<number[][]>;
}

export class ModelError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}
