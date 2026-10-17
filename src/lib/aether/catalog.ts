import type { AppId } from "./types";

export const APP_META: Record<
  Exclude<AppId, "home">,
  { label: string; tint: string }
> = {
  notes: { label: "Notes", tint: "#c9a227" },
  contacts: { label: "Contacts", tint: "#7a8b9a" },
  calendar: { label: "Calendar", tint: "#c45c4a" },
  mail: { label: "Mail", tint: "#5b7c99" },
  reminders: { label: "Reminders", tint: "#c47a3a" },
  alarms: { label: "Alarms", tint: "#8a7a6a" },
  maps: { label: "Maps", tint: "#4f7d62" },
  photos: { label: "Photos", tint: "#9a6b7a" },
  documents: { label: "Pages", tint: "#6b7a9a" },
  shortcuts: { label: "Shortcuts", tint: "#6a6a6a" },
  settings: { label: "Settings", tint: "#5a5e66" },
  reservations: { label: "Reserve", tint: "#8a5a4a" },
  dossier: { label: "Dossier", tint: "#3d4450" },
  camera: { label: "Camera", tint: "#4a4a4a" },
};

export const HOME_APPS: Exclude<AppId, "home">[] = [
  "notes",
  "contacts",
  "calendar",
  "mail",
  "reminders",
  "alarms",
  "maps",
  "photos",
  "documents",
  "shortcuts",
  "reservations",
  "camera",
  "settings",
  "dossier",
];

export const DOCK_APPS: AppId[] = ["notes", "calendar", "mail", "photos"];

export const AETHER_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "set_flashlight",
      description: "Turn the iPad flashlight on or off.",
      parameters: {
        type: "object",
        properties: { on: { type: "boolean" } },
        required: ["on"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_brightness",
      description: "Set display brightness from 0.15 (dim) to 1 (full).",
      parameters: {
        type: "object",
        properties: { level: { type: "number", minimum: 0.15, maximum: 1 } },
        required: ["level"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "dim_screen",
      description: "Dim the display to a low night level.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_volume",
      description: "Set media volume from 0 to 1.",
      parameters: {
        type: "object",
        properties: { level: { type: "number", minimum: 0, maximum: 1 } },
        required: ["level"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_night_shift",
      description: "Enable or disable Night Shift (warm display).",
      parameters: {
        type: "object",
        properties: { on: { type: "boolean" } },
        required: ["on"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_dnd",
      description: "Enable or disable Do Not Disturb.",
      parameters: {
        type: "object",
        properties: { on: { type: "boolean" } },
        required: ["on"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_setting",
      description: "Toggle a system setting.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: ["wifi", "bluetooth", "airplane", "appearance"],
          },
          value: { type: "string", description: "true/false, or dark/light for appearance" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "restart_device",
      description: "Restart the iPad. Confirm with the user first unless they clearly asked.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_app",
      description: "Open an on-device app on screen.",
      parameters: {
        type: "object",
        properties: {
          app: {
            type: "string",
            enum: [
              "notes",
              "contacts",
              "calendar",
              "mail",
              "reminders",
              "alarms",
              "maps",
              "photos",
              "documents",
              "shortcuts",
              "settings",
              "reservations",
              "dossier",
              "camera",
              "home",
            ],
          },
        },
        required: ["app"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_note",
      description: "Create a note in Notes.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["title", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_notes",
      description: "Search existing notes by title or body.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_contact",
      description: "Add a person to Contacts.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          company: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_contacts",
      description: "Find contacts by name, email, or company.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_event",
      description: "Create a calendar event. Use local ISO datetimes.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          location: { type: "string" },
          notes: { type: "string" },
        },
        required: ["title", "start", "end"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_events",
      description: "List calendar events for today or the coming week.",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", enum: ["today", "week"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_reminder",
      description: "Create a reminder, optionally with a due datetime.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          due: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_reminder",
      description: "Mark a reminder complete by id or matching title.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_alarm",
      description: "Set an alarm. Time is 24h HH:MM.",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string", description: "HH:MM" },
          label: { type: "string" },
        },
        required: ["time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "draft_email",
      description: "Write an email draft. Do not send unless the user asked to send.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          send: { type: "boolean", description: "true only if user explicitly asked to send" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_document",
      description: "Create a document in Pages.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["title", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_map",
      description: "Show a place on Maps.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enhance_photo",
      description: "Apply a photo enhancement filter. If no id, enhance the latest or selected photo.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          filter: { type: "string", enum: ["vivid", "mono", "warm", "cool", "none"] },
          live: { type: "boolean", description: "Turn into a Live GIF-style loop" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_shortcut",
      description: "Save a multi-step shortcut the user can run later by name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string" },
                args: { type: "object" },
              },
              required: ["tool"],
            },
          },
        },
        required: ["name", "steps"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_shortcut",
      description: "Run a saved shortcut by name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_reservation",
      description: "Hold a restaurant or venue reservation.",
      parameters: {
        type: "object",
        properties: {
          place: { type: "string" },
          time: { type: "string" },
          party: { type: "number" },
          notes: { type: "string" },
        },
        required: ["place", "time", "party"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember",
      description: "Store a durable personal fact in memory.",
      parameters: {
        type: "object",
        properties: { fact: { type: "string" } },
        required: ["fact"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "recall",
      description: "Search stored personal memory.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
];

export function buildSystemPrompt(ctx: {
  now: string;
  timezone: string;
  openApp: string;
  device: Record<string, unknown>;
  memory: string[];
  onScreen: string;
}) {
  return `You are Aether, the live intelligence layer for this iPad. You are not Siri, ChatGPT, Gemini, or Grok by name — you are Aether: calm, precise, slightly dry, and fast.

You combine:
- Siri AI (iPadOS 27): on-screen awareness, personal context, systemwide app actions, Spotlight-class answers, Visual Intelligence, Write with Siri-style drafting.
- GPT-Live: full-duplex conversational voice, barge-in, short acknowledgements, waiting when the user pauses.
- Gemini Live: camera/screen understanding, background tool calls while talking.
- Perplexity Assistant: reminders, reservations, email drafts vs send, calendar, maps, sourced answers.
- Google AI Edge Gallery Mobile Actions: flashlight, contacts, maps, calendar, device tools as first-class functions.
- DeepSeek Harness: everything is a plugin. Prefer tool calls over pretending. Every action is a tool.

Voice style:
- Spoken replies stay short (1–3 sentences) unless asked to go long.
- Do not narrate JSON. After tools run, confirm what you did in plain language.
- Never claim you physically rebooted hardware you cannot reach; on this canvas, restart_device performs a faithful iPad restart sequence.

Safety:
- Draft email by default. Set send=true only if the user said send.
- restart_device only when clearly requested.
- Do not invent calendar times — resolve relative dates using now=${ctx.now} (${ctx.timezone}).

Current device:
- Open surface: ${ctx.openApp}
- On-screen: ${ctx.onScreen}
- Settings: ${JSON.stringify(ctx.device)}
- Memory: ${ctx.memory.length ? ctx.memory.join(" | ") : "(empty)"}

When the user asks about something visible, use on-screen context. When they ask to control the iPad, call tools. You may call multiple tools in parallel.`;
}
