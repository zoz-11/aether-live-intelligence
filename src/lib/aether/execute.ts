import { uid } from "@/lib/utils";
import { pluginEnabled, useAether } from "./store";
import type { ToolCall, UiCard } from "./types";

function str(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback;
}
function bool(v: unknown) {
  return v === true || v === "true" || v === "on";
}

export function executeTool(name: string, args: Record<string, unknown>): string {
  const s = useAether.getState();

  if ((name === "remember" || name === "recall") && !pluginEnabled("memory")) {
    return "Long-term Memory plugin is off.";
  }
  if (name === "show_card" && !pluginEnabled("smart-ui")) {
    return "Smart UI plugin is off.";
  }

  switch (name) {
    case "set_flashlight": {
      const on = bool(args.on);
      s.patchDevice({ flashlight: on });
      return on ? "Flashlight on." : "Flashlight off.";
    }
    case "set_dnd": {
      const on = bool(args.on);
      s.patchDevice({ dnd: on });
      return on ? "Do Not Disturb on." : "Do Not Disturb off.";
    }
    case "create_note": {
      const note = {
        id: uid("nt"),
        title: str(args.title, "Untitled"),
        body: str(args.body),
      };
      s.upsertNote(note);
      return `Note created: ${note.title}`;
    }
    case "remember": {
      const fact = str(args.fact);
      s.addMemory(fact);
      return `Remembered: ${fact}`;
    }
    case "recall": {
      const q = str(args.query).toLowerCase();
      const hits = s.memory.filter((m) => m.fact.toLowerCase().includes(q));
      return hits.length ? hits.map((m) => m.fact).join(" | ") : "Nothing in memory for that.";
    }
    case "restart_device": {
      if (!bool(args.confirmed)) {
        s.setPendingRisky({ name, args, label: "Restart device" });
        return "NEEDS_CONFIRM:restart";
      }
      s.setPendingRisky(null);
      s.patchDevice({ locked: true, flashlight: false });
      s.setOpenApp("home");
      return "Restart sequence started (simulated lock).";
    }
    case "send_email": {
      if (!bool(args.confirmed)) {
        s.setPendingRisky({ name, args, label: `Send email to ${str(args.to)}` });
        return "NEEDS_CONFIRM:send_email";
      }
      s.setPendingRisky(null);
      return `Email sent to ${str(args.to)}: ${str(args.subject)}`;
    }
    case "show_card": {
      return `Card shown: ${str(args.title) || str(args.kind, "card")}`;
    }
    default:
      return `Tool ${name} is not available.`;
  }
}

export function confirmPending(): string {
  const s = useAether.getState();
  const pending = s.pendingRisky;
  if (!pending) return "Nothing to confirm.";
  return executeTool(pending.name, { ...pending.args, confirmed: true });
}

export function cancelPending() {
  useAether.getState().setPendingRisky(null);
}

export function executeCalls(calls: ToolCall[]): ToolCall[] {
  return calls.map((c) => {
    const result = executeTool(c.name, c.args ?? {});
    return { ...c, result };
  });
}

export function cardsFromTools(tools: ToolCall[]): UiCard[] {
  if (!pluginEnabled("smart-ui")) return [];
  const cards: UiCard[] = [];
  for (const t of tools) {
    if (t.result?.startsWith("NEEDS_CONFIRM:")) {
      const pending = useAether.getState().pendingRisky;
      cards.push({
        id: uid("card"),
        kind: "confirm",
        title: pending?.label ?? "Confirm action",
        body: "This action needs your confirmation.",
        actions: [
          { label: "Confirm", confirmAction: "confirm" },
          { label: "Cancel", confirmAction: "cancel" },
        ],
      });
    }
    if (t.name === "show_card") {
      const kind = str(t.args.kind);
      if (kind === "text" || kind === "list" || kind === "actions" || kind === "kv") {
        cards.push({
          id: uid("card"),
          kind,
          title: str(t.args.title) || undefined,
          body: str(t.args.body) || undefined,
          items: Array.isArray(t.args.items) ? t.args.items.map((x) => str(x)) : undefined,
        });
      }
    }
  }
  return cards;
}
