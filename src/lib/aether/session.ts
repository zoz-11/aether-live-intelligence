import { cardsFromTools, cancelPending, confirmPending, executeCalls } from "./execute";
import { activeConversation, pluginEnabled, useAether } from "./store";
import type { ToolCall, UiCard } from "./types";
import { uid } from "@/lib/utils";

function onScreenSummary(): string {
  const s = useAether.getState();
  if (s.openApp === "notes") {
    const n = s.notes[0];
    return n ? `Notes · ${n.title}: ${n.body.slice(0, 200)}` : "Notes empty";
  }
  if (s.openApp === "settings") return "Settings · plugins, memory, instructions";
  return `${s.openApp} on screen`;
}

function localReply(text: string, onScreen: string | null): { content: string; tools: ToolCall[]; cards?: UiCard[] } {
  const lower = text.toLowerCase();
  const tools: ToolCall[] = [];
  const s = useAether.getState();

  if (/\b(flashlight|torch)\b/.test(lower)) {
    const on = !/off|disable/.test(lower);
    tools.push({ id: uid("tc"), name: "set_flashlight", args: { on } });
  }
  if (/\b(dnd|do not disturb)\b/.test(lower)) {
    const on = !/off|disable/.test(lower);
    tools.push({ id: uid("tc"), name: "set_dnd", args: { on } });
  }
  if (/remember\s+(.+)/i.test(text) && pluginEnabled("memory")) {
    const m = text.match(/remember\s+(.+)/i);
    if (m?.[1]) tools.push({ id: uid("tc"), name: "remember", args: { fact: m[1].trim() } });
  }
  if (/restart|reboot/i.test(lower)) {
    tools.push({ id: uid("tc"), name: "restart_device", args: {} });
  }
  if (/send (an )?email/i.test(lower)) {
    tools.push({
      id: uid("tc"),
      name: "send_email",
      args: { to: "someone@example.com", subject: "Hello", body: text },
    });
  }
  if (/create note|note about/i.test(lower)) {
    tools.push({
      id: uid("tc"),
      name: "create_note",
      args: { title: "Quick note", body: text },
    });
  }

  const executed = tools.length ? executeCalls(tools) : [];
  const cards = cardsFromTools(executed);

  let content = "";
  if (onScreen) {
    content = `On screen: ${onScreen}`;
  } else if (executed.some((t) => t.result?.startsWith("NEEDS_CONFIRM:"))) {
    content = "That needs your confirmation.";
  } else if (executed.length) {
    content = executed.map((t) => t.result).filter(Boolean).join(" ");
  } else if (/hello|hi\b|hey\b/i.test(lower)) {
    content = "I'm Aether. Hold to talk, release to send. Voice and text share one conversation.";
  } else if (pluginEnabled("memory") && s.memory.length && /what do you (know|remember)/i.test(lower)) {
    content = s.memory.map((m) => m.fact).join(" · ");
  } else {
    content =
      s.customInstructions.trim().length > 0
        ? `(Following your instructions.) Understood. Try: turn on flashlight, remember, or restart.`
        : "Try: turn on flashlight · remember … · what's on screen (enable Screen Awareness) · restart (needs confirm).";
  }

  if (pluginEnabled("smart-ui") && /list|card|options/i.test(lower) && !cards.length) {
    cards.push({
      id: uid("card"),
      kind: "list",
      title: "Aether",
      items: ["Hold orb to talk", "Release to process", "Settings → plugins", "Risky actions need Confirm"],
    });
  }

  return { content, tools: executed, cards: cards.length ? cards : undefined };
}

export async function sendTurn(text: string) {
  const s = useAether.getState();
  const trimmed = text.trim();
  if (!trimmed) return;

  s.setLive({ thinking: true, listening: false, interim: "" });
  s.appendMessage({ role: "user", content: trimmed });

  const screenOn = pluginEnabled("screen");
  const wantsLook =
    s.lookRequested ||
    /\b(what('?s| is) on (my )?screen|look( at)?( the)? screen|what do you see)\b/i.test(trimmed);
  const onScreen = screenOn && wantsLook ? onScreenSummary() : null;
  s.clearLook();

  try {
    const reply = localReply(trimmed, onScreen);
    s.appendMessage({
      role: "assistant",
      content: reply.content,
      tools: reply.tools.length ? reply.tools : undefined,
      cards: reply.cards,
    });
  } finally {
    s.setLive({ thinking: false });
  }
}

export function handleConfirmAction(action: string) {
  const s = useAether.getState();
  if (action === "cancel") {
    cancelPending();
    s.appendMessage({ role: "assistant", content: "Cancelled." });
    return;
  }
  if (action === "confirm") {
    const result = confirmPending();
    s.appendMessage({ role: "assistant", content: result });
  }
}

export function activeMessages() {
  return activeConversation()?.messages ?? [];
}
