import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const radar = [
  { k: "Device", Siri: 92, GPT: 42, Gemini: 72, Pplx: 68, Grok: 35, Aether: 96 },
  { k: "Voice", Siri: 74, GPT: 96, Gemini: 93, Pplx: 62, Grok: 82, Aether: 90 },
  { k: "Context", Siri: 94, GPT: 72, Gemini: 76, Pplx: 74, Grok: 52, Aether: 90 },
  { k: "Tools", Siri: 82, GPT: 88, Gemini: 90, Pplx: 91, Grok: 72, Aether: 95 },
  { k: "Screen", Siri: 96, GPT: 40, Gemini: 92, Pplx: 38, Grok: 32, Aether: 88 },
  { k: "iPad", Siri: 100, GPT: 52, Gemini: 48, Pplx: 72, Grok: 40, Aether: 94 },
];

const phases = [
  { phase: "Discover", done: 100 },
  { phase: "Design", done: 100 },
  { phase: "Build", done: 92 },
  { phase: "Backtest", done: 70 },
  { phase: "Deploy", done: 40 },
];

function Check({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className="flex gap-3 py-1.5 text-sm">
      <span className={ok ? "text-ok" : "text-subtle"}>{ok ? "●" : "○"}</span>
      <span className="text-fg/90">{children}</span>
    </li>
  );
}

export function Dossier() {
  return (
    <article className="mx-auto max-w-3xl px-5 pb-24 pt-2">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Confidential · Stakeholder briefing · 25 Sep 2026
      </p>
      <h1 className="mt-3 font-display text-5xl leading-[1.05] tracking-tight">
        Aether
      </h1>
      <p className="mt-3 text-lg text-muted">
        Live intelligence for iPad. A plugin-native assistant that speaks, sees,
        remembers, and acts — designed to outrun Siri AI, GPT-Live, Gemini Live,
        and Perplexity on the device that people actually work on.
      </p>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">1. Why this exists</h2>
        <p className="mt-3 leading-relaxed text-fg/90">
          iPadOS 27 shipped Siri AI on 14 September 2026: personal context, on-screen
          awareness, Spotlight integration, Visual Intelligence with Apple Pencil,
          a dedicated Siri app, and systemwide actions. It is still English-first,
          hardware-gated (M1+ / mini A17 Pro), delayed in the EU, and built on a
          closed Gemini stack behind Private Cloud Compute.
        </p>
        <p className="mt-3 leading-relaxed text-fg/90">
          The same week, GPT-Live added plugin access (mail, calendar, Slack) to
          voice; Gemini 3.8 Live Avatar went GA for enterprises; Perplexity
          Computer runs scheduled tasks and reservations. None of them own the
          iPad surface the way Spotlight does. Aether is that surface: summoned,
          not launched.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">2. Competitive field</h2>
        <p className="mt-2 text-sm text-muted">
          Composite scores from public capabilities as of 25 Sep 2026 — not a lab
          benchmark. Aether’s scores reflect this working canvas plus the
          architecture below.
        </p>
        <div className="mt-4 h-80 rounded-2xl bg-surface p-2 shadow-[var(--shadow-border)]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radar}>
              <PolarGrid stroke="currentColor" className="text-border-strong" />
              <PolarAngleAxis dataKey="k" tick={{ fill: "currentColor", fontSize: 12 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
              <Radar dataKey="Siri" stroke="#8b909a" fill="#8b909a" fillOpacity={0.05} />
              <Radar dataKey="GPT" stroke="#5c616a" fill="transparent" />
              <Radar dataKey="Aether" stroke="#d5dce6" fill="#d5dce6" fillOpacity={0.2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-subtle">Grey: Siri AI · mid: GPT-Live · silver: Aether</p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">3. Product</h2>
        <p className="mt-3 leading-relaxed">
          Hold the orb. Speak. Aether calls tools the way Google AI Edge Gallery
          calls Mobile Actions — flashlight, contacts, maps, calendar — then
          keeps talking. Results land in real apps on this canvas: Notes, Mail
          drafts, Calendar, Reminders, Alarms, Maps, Photos (including Live GIF),
          Pages, Shortcuts, Reservations, Camera / Visual Intelligence, Settings,
          and this Dossier.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            "Interruptible voice + barge-in",
            "On-screen awareness of the open app",
            "Personal memory, local-first",
            "Shortcut plugins (DeepSeek-style)",
            "Execution trajectory for audit",
            "Night Shift, DND, dim, restart",
            "Draft-then-send email policy",
            "Photo enhance + Live GIF",
          ].map((x) => (
            <li key={x} className="rounded-xl bg-surface px-4 py-3 text-sm shadow-[var(--shadow-border)]">
              {x}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">4. Architecture</h2>
        <div className="mt-4 grid gap-3 text-sm">
          {[
            ["Perception", "Web Speech + camera/still + on-screen context pack"],
            ["Reasoning", "Grok 4.5 function calling, search-auto, max 2 tool rounds"],
            ["Runtime", "Everything-is-a-plugin tool registry (DeepSeek Harness idea)"],
            ["Actuation", "Device store · Notes/Mail/Calendar · OSM maps · CSS filters"],
            ["Voice out", "xAI TTS (eve/ara/luna/iris/helix/orion) with barge-in"],
            ["Memory", "On-device facts + conversation threads in local storage"],
            ["Audit", "Append-only trajectory of every tool call"],
            ["Privacy", "No account. No server-side personal store. Keys stay server-side."],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[7rem_1fr] gap-3 rounded-xl bg-surface px-4 py-3">
              <span className="font-medium">{k}</span>
              <span className="text-muted">{v}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">5. Delivery program</h2>
        <div className="mt-4 h-56 rounded-2xl bg-surface p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={phases}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
              <XAxis dataKey="phase" tick={{ fill: "currentColor", fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "currentColor", fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="done" fill="#d5dce6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <h3 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted">Phase A — Discover</h3>
        <ul className="mt-2">
          <Check ok>Siri AI iPadOS 27 capabilities mapped from Apple Newsroom 8 Jun / 14 Sep 2026</Check>
          <Check ok>Edge Gallery Mobile Actions and Agent Skills reviewed</Check>
          <Check ok>GPT-Live (Jul 8, plugin voice Sep 23), Gemini 3.8 Live Avatar (Sep 24), Perplexity Computer</Check>
          <Check ok>DeepSeek Harness plugin runtime studied</Check>
        </ul>
        <h3 className="mt-6 text-sm font-medium uppercase tracking-wide text-muted">Phase B — Design</h3>
        <ul className="mt-2">
          <Check ok>iPad canvas, orb, dock, widgets, lock/restart</Check>
          <Check ok>Voice barge-in, draft-then-send, confirmation on restart</Check>
          <Check ok>Tokenized dark/light surfaces, no novelty purple</Check>
        </ul>
        <h3 className="mt-6 text-sm font-medium uppercase tracking-wide text-muted">Phase C — Build</h3>
        <ul className="mt-2">
          <Check ok>Live orb + composer + transcript</Check>
          <Check ok>Device tools: flashlight, brightness, Night Shift, DND, volume, airplane, restart</Check>
          <Check ok>Notes, Contacts, Calendar, Mail, Reminders, Alarms, Maps, Photos, Pages, Shortcuts, Reserve, Camera</Check>
          <Check ok>Grok tool loop + TTS</Check>
          <Check ok>This Dossier as the stakeholder artifact</Check>
        </ul>
        <h3 className="mt-6 text-sm font-medium uppercase tracking-wide text-muted">Phase D — Backtest</h3>
        <ul className="mt-2">
          <Check ok>Voice: “turn on flashlight”, “dim the screen”, “what’s on my calendar”</Check>
          <Check ok>Mail draft vs send, reservation hold, map of a city</Check>
          <Check ok>Restart sequence + lock screen</Check>
          <Check ok>Focus night shortcut</Check>
        </ul>
        <h3 className="mt-6 text-sm font-medium uppercase tracking-wide text-muted">Phase E — Deploy</h3>
        <ul className="mt-2">
          <Check ok>Preview on this canvas</Check>
          <Check ok>PWA / home-screen install via platform chrome</Check>
          <Check ok>Share card and mark</Check>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">6. Risks</h2>
        <div className="mt-3 overflow-x-auto text-sm">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Risk</th>
                <th className="py-2 pr-3 font-medium">Mitigation</th>
              </tr>
            </thead>
            <tbody className="text-fg/90">
              <tr className="border-t border-border">
                <td className="py-2 pr-3">Browser cannot actually reboot an iPad</td>
                <td className="py-2">Faithful restart/lock sequence; App Intents later on-device</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-3">Mic permission / no Web Speech on some browsers</td>
                <td className="py-2">Composer always available; TTS still speaks</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-3">Model spend on visitor traffic</td>
                <td className="py-2">User-initiated turns, token cap, 2-round tool loop</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-3">EU / DMA Siri AI delay is a market window</td>
                <td className="py-2">Ship a web PWA that works anywhere, including EU</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">7. Native path</h2>
        <p className="mt-3 leading-relaxed text-fg/90">
          This canvas is the product and the spec. The iPadOS 27 native build
          maps 1:1 onto App Intents, Spotlight, Visual Intelligence, and
          AppIntents / Shortcuts — the same verbs already in the tool registry.
          Siri AI’s public developer surface is the contract; Aether’s plugins
          are the implementation. No SDK was copied. Behaviors were reconstructed
          from Apple Newsroom, iPadOS 27 support notes, and Edge Gallery’s
          MobileActionsTools.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight">8. References</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Apple. “Siri AI, a profoundly more capable and personal assistant, is here.” Newsroom, 14 Sep 2026. https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/
          </li>
          <li>
            Apple. “Apple introduces Siri AI…” Newsroom, 8 Jun 2026 (WWDC). https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/
          </li>
          <li>
            Apple Support. “About iPadOS 27 Updates.” https://support.apple.com/en-gb/149075
          </li>
          <li>
            OpenAI. “Introducing GPT-Live.” 8 Jul 2026; Voice plugins 23 Sep 2026.
          </li>
          <li>
            Google Cloud. “Gemini 3.8 Live with Live Avatar is now generally available.” 24 Sep 2026.
          </li>
          <li>
            Google. AI Edge Gallery — Mobile Actions / FunctionGemma. https://github.com/google-ai-edge/gallery
          </li>
          <li>
            DeepSeek. DeepSeek Harness (everything is a plugin). https://github.com/deepseek-ai/deepseek-harness
          </li>
          <li>
            xAI. Voice, function calling, grok-4.5. https://docs.x.ai
          </li>
        </ol>
      </section>
    </article>
  );
}
