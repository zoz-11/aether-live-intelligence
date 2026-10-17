export type AppId =
  | "home"
  | "notes"
  | "contacts"
  | "calendar"
  | "mail"
  | "reminders"
  | "alarms"
  | "maps"
  | "photos"
  | "documents"
  | "shortcuts"
  | "settings"
  | "reservations"
  | "dossier"
  | "camera";

export type Appearance = "dark" | "light";

export type VoiceId =
  | "eve"
  | "ara"
  | "luna"
  | "iris"
  | "helix"
  | "orion"
  | "aurora"
  | "leo";

export type DeviceState = {
  brightness: number;
  flashlight: boolean;
  dnd: boolean;
  volume: number;
  nightShift: boolean;
  wifi: boolean;
  bluetooth: boolean;
  airplane: boolean;
  appearance: Appearance;
  locked: boolean;
};

export type Contact = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
};

export type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  notes?: string;
};

export type Reminder = {
  id: string;
  title: string;
  due?: string;
  done: boolean;
};

export type Alarm = {
  id: string;
  time: string;
  label: string;
  enabled: boolean;
};

export type MailItem = {
  id: string;
  to: string;
  subject: string;
  body: string;
  status: "draft" | "sent";
  createdAt: string;
};

export type DocItem = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
};

export type ShortcutStep = { tool: string; args: Record<string, unknown> };

export type Shortcut = {
  id: string;
  name: string;
  steps: ShortcutStep[];
};

export type PhotoItem = {
  id: string;
  src: string;
  title: string;
  filter: "none" | "vivid" | "mono" | "warm" | "cool";
  live: boolean;
};

export type Reservation = {
  id: string;
  place: string;
  time: string;
  party: number;
  notes?: string;
  status: "held" | "confirmed";
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

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  tools?: ToolCall[];
  createdAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

export type TrajectoryEvent = {
  id: string;
  at: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
};

export type MapView = {
  query: string;
  lat?: number;
  lon?: number;
  label?: string;
};

export type LiveState = {
  active: boolean;
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  interim: string;
  wake: boolean;
};
