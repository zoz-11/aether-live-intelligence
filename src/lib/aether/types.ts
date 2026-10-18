export type AppId = "home" | "settings" | "notes" | "dossier";

export type DeviceState = {
  brightness: number;
  flashlight: boolean;
  dnd: boolean;
  volume: number;
  appearance: "dark" | "light";
  locked: boolean;
};

export type MemoryFact = {
  id: string;
  fact: string;
  createdAt: string;
};

export type ChatRole = "user" | "assistant" | "system";

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
};

export type UiCardKind = "text" | "list" | "actions" | "kv" | "confirm";

export type UiCard = {
  id: string;
  kind: UiCardKind;
  title?: string;
  body?: string;
  items?: string[];
  actions?: { label: string; prompt?: string; confirmAction?: string }[];
  fields?: { label: string; value: string }[];
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  tools?: ToolCall[];
  cards?: UiCard[];
  createdAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

export type PluginDef = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
};

export type LiveState = {
  active: boolean;
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  interim: string;
};

export type PendingRisky = {
  name: string;
  args: Record<string, unknown>;
  label: string;
} | null;
