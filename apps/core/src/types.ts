import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { EventBus } from './events.js';
import type { Vault } from './vault.js';
import type { SettingsStore } from './settings.js';
import type { ActivityLog } from './activity.js';
import type { PluginRegistry } from './plugins/registry.js';
import type { Sentinel } from './agent/sentinel.js';
import type { MemoryService } from './memory/service.js';
import type { ConversationStore } from './agent/conversations.js';
import type { AgentRunner } from './agent/loop.js';
import type { ModelGateway } from './models/gateway.js';
import type { AppsStore } from './plugins/apps-store.js';
import type { EmailService } from './email/service.js';
import type { PhoneService } from './phone/service.js';
import type { ComputerService } from './desktop/computer.js';
import type { TaskService } from './tasks/service.js';
import type { SkillService } from './skills.js';
import type { McpManager } from './mcp.js';
import type { Notifier } from './notify.js';
import type { TelegramChannel } from './channels/telegram.js';

/** read: no side effects. write: reversible/local. danger: hard to undo. critical: acts on the user's behalf outside (send, call, pay, permanent delete). */
export type Risk = 'read' | 'write' | 'danger' | 'critical';
export type Channel = 'text' | 'voice' | 'telegram' | 'email' | 'phone' | 'sms' | 'task' | 'system';

export type JSONSchema = Record<string, unknown>;

export interface Card {
  type: 'text' | 'list' | 'kv' | 'table' | 'steps' | 'progress' | 'links' | 'actions' | 'image' | 'chart' | 'confirm' | 'artifact' | 'code';
  title?: string;
  body?: string;
  items?: Array<string | { title: string; subtitle?: string; meta?: string }>;
  rows?: Array<{ label: string; value: string }>;
  columns?: string[];
  table?: string[][];
  steps?: Array<{ label: string; done?: boolean }>;
  value?: number;
  links?: Array<{ title: string; url: string; note?: string }>;
  actions?: Array<{ label: string; prompt: string; style?: 'primary' | 'secondary' | 'danger' }>;
  image?: { url: string; alt?: string };
  chart?: { kind: 'bar' | 'line'; labels: string[]; series: Array<{ name: string; data: number[] }> };
  html?: string;
  code?: { language?: string; text: string };
  approvalId?: string;
}

export interface ClientContext {
  openApp?: string | null;
  screen?: string | null;
  device?: Record<string, unknown>;
  timezone?: string;
  locale?: string;
  look?: boolean;
}

export interface ToolImage { mime: string; base64: string }

export interface ToolResult {
  ok: boolean;
  content: string;
  data?: unknown;
  images?: ToolImage[];
  card?: Card;
}

export interface TurnEvent {
  type:
    | 'turn.start' | 'text.delta' | 'tool.start' | 'tool.end' | 'approval' | 'approval.resolved'
    | 'card' | 'turn.end' | 'error' | 'status';
  [k: string]: unknown;
}

export interface RunScope {
  /** Grants given with "allow for this task" during this run. */
  grants: Set<string>;
  taskId?: string;
}

export interface ToolContext {
  aether: Aether;
  conversationId: string;
  taskId?: string;
  channel: Channel;
  signal: AbortSignal;
  emit: (ev: TurnEvent) => void;
  client?: ClientContext;
  scope: RunScope;
  depth: number;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: JSONSchema;
  /** Risk can depend on the action/arguments. */
  risk: Risk | ((args: any) => Risk);
  /** Short human sentence used in approvals and the activity log. */
  describe?: (args: any) => string;
  run: (args: any, ctx: ToolContext) => Promise<ToolResult>;
  /** Resolve {{secret:NAME}} placeholders in arguments right before running (after approval). */
  resolveSecrets?: boolean;
  /** Owning plugin id, filled by the registry. */
  plugin?: string;
}

export interface PluginStatus { [k: string]: unknown }

export interface Plugin {
  id: string;
  name: string;
  description: string;
  category: 'core' | 'device' | 'memory' | 'ui' | 'identity' | 'computer' | 'dev' | 'autonomy' | 'channel' | 'integration';
  defaultEnabled: boolean;
  /** Tools are built lazily so they can read live services. */
  tools?: (aether: Aether) => ToolDef[];
  setup?: (aether: Aether) => Promise<void> | void;
  teardown?: (aether: Aether) => Promise<void> | void;
  /** Extra system prompt guidance while the plugin is on. */
  prompt?: (aether: Aether, ctx: { channel: Channel; client?: ClientContext }) => Promise<string | undefined> | string | undefined;
  status?: (aether: Aether) => Promise<PluginStatus> | PluginStatus;
  /** Names of secrets this plugin can use (shown in Settings). */
  secrets?: string[];
}

export interface Aether {
  config: Config;
  db: Db;
  bus: EventBus;
  vault: Vault;
  settings: SettingsStore;
  activity: ActivityLog;
  plugins: PluginRegistry;
  sentinel: Sentinel;
  memory: MemoryService;
  conversations: ConversationStore;
  agent: AgentRunner;
  models: ModelGateway;
  apps: AppsStore;
  email: EmailService;
  phone: PhoneService;
  computer: ComputerService;
  tasks: TaskService;
  skills: SkillService;
  mcp: McpManager;
  notify: Notifier;
  telegram: TelegramChannel;
  startedAt: Date;
  shutdown: () => Promise<void>;
}
