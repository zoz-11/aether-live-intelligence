import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import type {
  AppId,
  ChatMessage,
  Conversation,
  DeviceState,
  LiveState,
  MemoryFact,
  PendingRisky,
  PluginDef,
} from "./types";

function firstConv(): Conversation {
  const id = uid("cv");
  return {
    id,
    title: "New conversation",
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

function freshPlugins(): PluginDef[] {
  return [
    { id: "memory", name: "Long-term Memory", enabled: true, description: "Remember facts across sessions" },
    { id: "smart-ui", name: "Smart UI Cards", enabled: true, description: "Interactive response cards" },
    { id: "screen", name: "Screen Awareness", enabled: false, description: "On-demand on-screen context (Phase 3)" },
    { id: "device-control", name: "Device Control", enabled: false, description: "Native taps later - not in browser" },
  ];
}

type State = {
  openApp: AppId;
  device: DeviceState;
  live: LiveState;
  conversations: Conversation[];
  activeConversationId: string;
  memory: MemoryFact[];
  customInstructions: string;
  plugins: PluginDef[];
  pendingRisky: PendingRisky;
  notes: { id: string; title: string; body: string }[];
  lookRequested: boolean;
};

type Actions = {
  setOpenApp: (app: AppId) => void;
  patchDevice: (p: Partial<DeviceState>) => void;
  setLive: (p: Partial<LiveState>) => void;
  setCustomInstructions: (t: string) => void;
  togglePlugin: (id: string) => void;
  addMemory: (fact: string) => MemoryFact;
  removeMemory: (id: string) => void;
  appendMessage: (msg: Omit<ChatMessage, "id" | "createdAt"> & { id?: string }) => ChatMessage;
  newConversation: () => void;
  setPendingRisky: (p: PendingRisky) => void;
  requestLook: () => void;
  clearLook: () => void;
  upsertNote: (n: { id: string; title: string; body: string }) => void;
};

const seed = firstConv();

export const useAether = create<State & Actions>()(
  persist(
    (set, get) => ({
      openApp: "home",
      device: {
        brightness: 0.85,
        flashlight: false,
        dnd: false,
        volume: 0.7,
        appearance: "dark",
        locked: false,
      },
      live: { active: false, listening: false, speaking: false, thinking: false, interim: "" },
      conversations: [seed],
      activeConversationId: seed.id,
      memory: [],
      customInstructions: "",
      plugins: freshPlugins(),
      pendingRisky: null,
      notes: [{ id: uid("nt"), title: "Welcome", body: "Hold the orb to talk. Release to send. Voice and text share one memory." }],
      lookRequested: false,

      setOpenApp: (app) => set({ openApp: app, live: { ...get().live, active: app === "home" ? get().live.active : false } }),
      patchDevice: (p) => set({ device: { ...get().device, ...p } }),
      setLive: (p) => set({ live: { ...get().live, ...p } }),
      setCustomInstructions: (t) => set({ customInstructions: t }),
      togglePlugin: (id) =>
        set({
          plugins: get().plugins.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
        }),
      addMemory: (fact) => {
        const item: MemoryFact = { id: uid("mm"), fact, createdAt: new Date().toISOString() };
        set({ memory: [item, ...get().memory] });
        return item;
      },
      removeMemory: (id) => set({ memory: get().memory.filter((m) => m.id !== id) }),
      appendMessage: (msg) => {
        const full: ChatMessage = {
          id: msg.id ?? uid("msg"),
          role: msg.role,
          content: msg.content,
          tools: msg.tools,
          cards: msg.cards,
          createdAt: new Date().toISOString(),
        };
        const { conversations, activeConversationId } = get();
        const titleFrom = msg.role === "user" && msg.content ? msg.content.slice(0, 42) : undefined;
        set({
          conversations: conversations.map((c) =>
            c.id === activeConversationId
              ? {
                  ...c,
                  title: c.messages.length === 0 && titleFrom ? titleFrom : c.title,
                  messages: [...c.messages, full],
                  updatedAt: full.createdAt,
                }
              : c,
          ),
        });
        return full;
      },
      newConversation: () => {
        const c = firstConv();
        set({ conversations: [c, ...get().conversations], activeConversationId: c.id });
      },
      setPendingRisky: (p) => set({ pendingRisky: p }),
      requestLook: () => set({ lookRequested: true }),
      clearLook: () => set({ lookRequested: false }),
      upsertNote: (n) =>
        set({
          notes: [n, ...get().notes.filter((x) => x.id !== n.id)],
          openApp: "notes",
        }),
    }),
    {
      name: "aether-v2",
      partialize: (s) => ({
        device: { ...s.device, locked: false, flashlight: false },
        conversations: s.conversations.slice(0, 12),
        activeConversationId: s.activeConversationId,
        memory: s.memory,
        customInstructions: s.customInstructions,
        plugins: s.plugins,
        notes: s.notes,
      }),
    },
  ),
);

export function pluginEnabled(id: string) {
  return useAether.getState().plugins.some((p) => p.id === id && p.enabled);
}

export function activeConversation() {
  const s = useAether.getState();
  return s.conversations.find((c) => c.id === s.activeConversationId) ?? s.conversations[0];
}
