import { isoLocal, uidShort as uid } from "./util.js";
import type {
  Alarm,
  CalEvent,
  Contact,
  DocItem,
  MailItem,
  MemoryFact,
  Note,
  PhotoItem,
  Reminder,
  Reservation,
  Shortcut,
} from "./types.js";

function atHour(h: number, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return isoLocal(d);
}

function plusDays(h: number, m: number, days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return isoLocal(d);
}

export function seedContacts(): Contact[] {
  return [
    {
      id: uid("ct"),
      name: "Maya Chen",
      phone: "+1 415 555 0142",
      email: "maya.chen@lumen.studio",
      company: "Lumen Studio",
    },
    {
      id: uid("ct"),
      name: "Jonah Ruiz",
      phone: "+1 646 555 0190",
      email: "jonah@northwind.audio",
      company: "Northwind Audio",
    },
    {
      id: uid("ct"),
      name: "Dr. Elena Voss",
      phone: "+1 617 555 0118",
      email: "evoss@harbor.clinic",
      company: "Harbor Clinic",
    },
  ];
}

export function seedNotes(): Note[] {
  const now = new Date().toISOString();
  return [
    {
      id: uid("nt"),
      title: "iPadOS 27 — Siri AI field notes",
      body: "Spotlight integration on iPad. Visual Intelligence with Apple Pencil highlight. Dedicated Siri app with iCloud conversation sync. On-screen awareness + personal context index across Mail, Messages, Photos, Notes. Write with Siri in any text field. English-first; more languages in October.",
      updatedAt: now,
    },
    {
      id: uid("nt"),
      title: "Stakeholder talking points",
      body: "Aether is a live intelligence layer, not a chatbot in a bubble. Device actions are plugins. Voice is interruptible. Memory is on-device. Dossier is the board narrative.",
      updatedAt: now,
    },
  ];
}

export function seedEvents(): CalEvent[] {
  return [
    {
      id: uid("ev"),
      title: "Design review — Aether orb",
      start: atHour(11, 0),
      end: atHour(11, 45),
      location: "Studio B",
      notes: "Motion, barge-in, reduced-motion path",
    },
    {
      id: uid("ev"),
      title: "Investor briefing dry run",
      start: atHour(16, 30),
      end: atHour(17, 30),
      location: "Board room",
    },
    {
      id: uid("ev"),
      title: "Dinner with Maya",
      start: plusDays(19, 30, 1),
      end: plusDays(21, 0, 1),
      location: "Kadeau",
    },
  ];
}

export function seedReminders(): Reminder[] {
  return [
    { id: uid("rm"), title: "Send dossier PDF to Jonah", due: atHour(18, 0), done: false },
    { id: uid("rm"), title: "Charge Pencil before Visual Intelligence demo", done: false },
  ];
}

export function seedAlarms(): Alarm[] {
  return [{ id: uid("al"), time: "07:10", label: "Weekday", enabled: true }];
}

export function seedMail(): MailItem[] {
  return [
    {
      id: uid("ml"),
      to: "jonah@northwind.audio",
      subject: "Aether — walkthrough tomorrow",
      body: "Jonah — attaching the Dossier. The live orb now barges in cleanly, and flashlight / Night Shift / restart are first-class tools. See you at 16:30.",
      status: "draft",
      createdAt: new Date().toISOString(),
    },
  ];
}

export function seedDocs(): DocItem[] {
  return [
    {
      id: uid("dc"),
      title: "Aether one-pager",
      body: "Aether is on-device intelligence with a live voice surface, a plugin tool runtime, and a spatial results canvas. It is designed to sit on iPad the way Spotlight and Siri AI do — summoned, not launched.",
      updatedAt: new Date().toISOString(),
    },
  ];
}

export function seedPhotos(): PhotoItem[] {
  return [
    { id: uid("ph"), src: "/photos/espresso.jpg", title: "Morning", filter: "none", live: false },
    { id: uid("ph"), src: "/photos/stairs.jpg", title: "Atrium", filter: "none", live: false },
    { id: uid("ph"), src: "/photos/leaf.jpg", title: "Study", filter: "none", live: false },
    { id: uid("ph"), src: "/photos/restaurant.jpg", title: "Kadeau", filter: "none", live: false },
  ];
}

export function seedShortcuts(): Shortcut[] {
  return [
    {
      id: uid("sc"),
      name: "Focus night",
      steps: [
        { tool: "set_night_shift", args: { on: true } },
        { tool: "set_dnd", args: { on: true } },
        { tool: "dim_screen", args: {} },
      ],
    },
  ];
}

export function seedReservations(): Reservation[] {
  return [
    {
      id: uid("rs"),
      place: "Kadeau",
      time: plusDays(19, 30, 1),
      party: 2,
      status: "confirmed",
      notes: "Window table if possible",
    },
  ];
}

export function seedMemory(): MemoryFact[] {
  return [
    {
      id: uid("mm"),
      fact: "User prefers concise spoken replies and drafts emails before sending.",
      createdAt: new Date().toISOString(),
    },
  ];
}
