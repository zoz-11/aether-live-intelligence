# Aether 1.0 — Master Plan and Living Checklist

Rule: a box is ticked `[x]` only after the item was verified (test, build, or live run). Every ticked item carries a short `Note:` saying how it was verified. Nothing is ticked on intent.

Branch: `aether-1.0` (becomes the default branch once Phase 9 passes). The previous `main` stays untouched as history.

## Vision (locked)

Aether is a voice-first personal agent for iPhone and iPad that is also a real right hand:

1. Live voice with Voice-Lock (tap/hold to talk, release to send, one turn per release).
2. One unified memory for voice, text, email, calls, Telegram, and background tasks.
3. Everything is a plugin; any plugin can be switched off without breaking others.
4. Its own computer (Linux desktop with browser, terminal, files) that the user can watch and take over.
5. Its own email inbox and its own phone line (calls and SMS).
6. Dev right hand: files, shell, processes, packages, git, downloads, deletes, secrets — behind approvals.
7. Nothing risky happens silently: a Sentinel approval layer sits outside the model.
8. Beautiful, calm UI that keeps the original Aether iPad look (wallpaper, widgets, orb, dock).

## Reference projects (reverse-engineered, best-of-each)

See `docs/REFERENCES.md` for provenance. Short map:

| Capability | Primary reference | What we took |
|---|---|---|
| Gateway, skills, plugins, cron, browser, voice-call | OpenClaw (MIT) | Workspace persona files, SKILL.md progressive disclosure, plugin enable/disable, cron jobs, CDP browser, call actions (initiate/continue/speak/end/status) and a mock call provider |
| Approvals, vault, visible work, durable tasks | Meta Muse docs + CopilotKit OpenMuse (MIT) | Sentinel gate with allow once / this task / always / deny, surrogate secret tokens, Soul/Identity/Memory files, pause/resume/cancel/retry tasks, take-over browser |
| Agent computer | Bytebot (Apache-2.0), OpenMausBot, Rakazo | Separate desktop daemon with a REST action API, Xvfb + VNC + Chromium, takeover mode |
| Agent email | open-agent-email (Apache-2.0), AgentInbox, openagentemail | Inbox per agent, built-in SMTP listener, SMTP/Resend outbound, OTP and verify-link extraction, approval before send, raw-MIME webhook |
| Phone | OpenClaw voice-call, Twilio ConversationRelay | Twilio outbound/inbound with speech loop, relay WebSocket, SMS, signature checks, mock provider |
| Plugin kernel | DeepSeek Harness (everything is a plugin) | Plugins own tools, skills, routes, lifecycle; registry gates tools at prompt time and at execute time |
| Screen awareness | HeyClicky | On-demand look only, never always-on |
| Generative UI | CopilotKit Open Intelligent UI / A2UI | Declarative cards rendered natively + sandboxed HTML artifacts |
| Memory | Mem0 pattern | Fact extraction with add/update/delete against similar facts, hybrid retrieval |

## Architecture (summary)

```
apps/web     React 19 + Vite + Tailwind 4 PWA (iPhone/iPad first). Works standalone (local engine) or connected to Core.
apps/core    Node 20+ TypeScript server (Hono). Agent loop, plugins, Sentinel, memory, vault, email, phone, tasks, channels.
             Also ships `aether-desktopd`, the daemon that runs inside the agent computer.
desktop/     Dockerfile for the agent computer (Xvfb, Openbox, tint2, Chromium, x11vnc, xdotool, desktopd).
skills/      Bundled SKILL.md skills.
integrations Cloudflare Email Worker (inbound mail to Core), Apple Shortcuts bridge notes.
```

Storage: embedded Postgres (PGlite) by default, any Postgres (for example Supabase) through `DATABASE_URL`. One SQL dialect, one migration set.

---

## Phase 0 — Discovery and source of truth

- [x] 0.1 Inventory every source
  - [x] 0.1.1 Project upload A (cut-off Grok handoff) — Note: catalog/types/dossier compared; catalog identical to the original.
  - [x] 0.1.2 Project upload B ("full version" HTML assets) — Note: only `_files` assets, main HTML missing; chat recovered from Grok instead.
  - [x] 0.1.3 GitHub `main` (minimal recovered Vite app, v0.3.0) — Note: cloned and read module by module.
  - [x] 0.1.4 Original Grok chat (57 messages) — Note: extracted from the Grok project conversation.
  - [x] 0.1.5 Original Grok Build workspace zip (6.9 MB, full TanStack app with 14 apps, tool calling, TTS) — Note: recovered from the chat attachment and unpacked; becomes the UI baseline.
- [x] 0.2 Reference research — Note: OpenClaw, OpenMuse, Meta Muse docs, OpenGrok/OpenMausBot, Rakazo, Bytebot, agent-email projects, phone projects reviewed; see REFERENCES.md.

## Phase 1 — Foundation

- [ ] 1.1 Monorepo
  - [ ] 1.1.1 npm workspaces `apps/core`, `apps/web`; shared TypeScript strict config
  - [ ] 1.1.2 Root scripts: `dev`, `build`, `test`, `typecheck`, `start`
  - [ ] 1.1.3 `.env.example`, `.gitignore` (data/, .env, keys never committed)
- [ ] 1.2 Core skeleton
  - [ ] 1.2.1 Config loader (env + defaults), data dir layout (`data/db`, `data/workspace`, `data/files`)
  - [ ] 1.2.2 Database layer: `Db` interface over PGlite and `pg`; ordered SQL migrations with a `_migrations` table
  - [ ] 1.2.3 HTTP app (Hono) + Node server + WebSocket upgrade
  - [ ] 1.2.4 Auth: owner token (Bearer or `?token=`), loopback/dev bypass only when explicitly enabled
  - [ ] 1.2.5 Event bus + SSE endpoint `/api/events`
  - [ ] 1.2.6 Activity (audit) log table and API
- [ ] 1.3 Web shell
  - [ ] 1.3.1 Vite + React 19 + Tailwind 4, original Aether tokens (fonts, glass, orb)
  - [ ] 1.3.2 Safe storage wrapper (works when storage is blocked)
  - [ ] 1.3.3 Core client: base URL discovery (same-origin, injected, saved), token, fetch-stream SSE parser
- [ ] 1.4 CI: install, typecheck, test, build (hard fail)

## Phase 2 — Brain

- [ ] 2.1 Model gateway
  - [ ] 2.1.1 OpenAI-compatible chat completions (xAI, OpenAI, OpenRouter, Groq, DeepSeek, Gemini-compatible, Ollama, custom) with streaming text and tool calls
  - [ ] 2.1.2 Anthropic Messages API with tool use and streaming
  - [ ] 2.1.3 Provider keys read from the vault (never from the prompt), base URL overrides
  - [ ] 2.1.4 Local engine (no key): intent parser that maps common requests to the same tools, honest about its limits
- [ ] 2.2 Agent loop
  - [ ] 2.2.1 Multi-step tool loop with step limit, abort signal, per-turn event stream
  - [ ] 2.2.2 Tool results truncated and secret-redacted before returning to the model
  - [ ] 2.2.3 Errors become tool results, never crash the turn
- [ ] 2.3 Plugin kernel
  - [ ] 2.3.1 Plugin contract: id, name, description, defaultEnabled, tools, skills, setup/teardown, settings schema
  - [ ] 2.3.2 Registry: enable/disable at runtime, persisted state, per-plugin error isolation
  - [ ] 2.3.3 Gate twice: tools hidden from the prompt when off, and refused at execute time when off
- [ ] 2.4 Sentinel (approvals)
  - [ ] 2.4.1 Risk per tool action: read / write / danger, with a human description
  - [ ] 2.4.2 Policy modes: careful (ask for write+danger), balanced (ask for danger), autonomous (ask only for irreversible: send, call, delete, pay, install)
  - [ ] 2.4.3 Decisions: allow once, allow for this task, always allow (grant), deny; grants listed and revocable
  - [ ] 2.4.4 The model cannot approve: no `confirmed` argument is honored; only an authenticated user gesture resolves an approval
  - [ ] 2.4.5 Pending approvals survive in the tray; timeouts deny safely
- [ ] 2.5 Conversation
  - [ ] 2.5.1 One main thread shared by all channels, messages tagged by channel
  - [ ] 2.5.2 Side threads (new chat) and task threads
  - [ ] 2.5.3 System prompt assembly: persona files, custom instructions, relevant memories, context (time, device, open app), skills index, safety rules

## Phase 3 — Memory

- [ ] 3.1 Facts store with keyword search and optional embeddings (cosine in process)
- [ ] 3.2 Persona files: SOUL.md, IDENTITY.md, USER.md, MEMORY.md, AGENTS.md (editable in UI)
- [ ] 3.3 Automatic extraction after turns (model-based add/update/delete; heuristic fallback)
- [ ] 3.4 Retrieval injected each turn (top facts by hybrid score, recency boost)
- [ ] 3.5 Thread compaction into a rolling summary when long
- [ ] 3.6 Forget (by id or topic), reset, export (markdown)

## Phase 4 — Hands

- [ ] 4.1 Aether apps plugin: the 27 original tools (notes, contacts, calendar, reminders, alarms, mail drafts, maps, photos, documents, shortcuts, reservations, device settings) on server data
- [ ] 4.2 Smart UI plugin: `show_card` (text, list, kv, table, steps, progress, links, actions, image, chart) and `show_artifact` (sandboxed HTML)
- [ ] 4.3 Screen plugin (off by default): on-demand look at the open Aether app and, when running, the agent computer
- [ ] 4.4 Secrets vault: AES-256-GCM at rest, names only to the model, `{{secret:NAME}}` placeholders resolved at the boundary, output redaction, agent can request a secret through a secure card
- [ ] 4.5 Dev plugin
  - [ ] 4.5.1 files: list, read, write, move, delete (to trash), search — confined to the workspace root
  - [ ] 4.5.2 shell: run with timeout and output cap; background processes with logs and stop
  - [ ] 4.5.3 packages: npm / pip install; git clone/status/commit; download with size cap
  - [ ] 4.5.4 Runs on the agent computer when connected, otherwise in the Core workspace
- [ ] 4.6 Web plugin: search (keyless fallback), fetch to readable text, HTTP requests with secret placeholders

## Phase 5 — Own computer

- [ ] 5.1 `aether-desktopd`: Xvfb, window manager, panel, Chromium with CDP, x11vnc; REST actions (screenshot, click, double click, move, drag, type, key, scroll, cursor, open url/app, exec)
- [ ] 5.2 Computer plugin: one `computer` tool with action enum; screenshots returned to vision models
- [ ] 5.3 Browser plugin: CDP connection, indexed element snapshot, click/type by index, navigate, extract
- [ ] 5.4 VNC over WebSocket proxy in Core; noVNC viewer in the web app with watch / take over
- [ ] 5.5 Docker image for the desktop + compose wiring

## Phase 6 — Identity (email, phone, channels)

- [ ] 6.1 Email
  - [ ] 6.1.1 Mailbox tables, threads, read state
  - [ ] 6.1.2 Inbound: built-in SMTP listener, raw-MIME webhook (Cloudflare Email Worker included), IMAP polling
  - [ ] 6.1.3 Outbound: SMTP, Resend, loopback dev transport; approval before every send unless granted
  - [ ] 6.1.4 OTP and verify-link extraction; `wait_for` tool
- [ ] 6.2 Phone
  - [ ] 6.2.1 Calls and SMS tables, transcripts, summaries into memory
  - [ ] 6.2.2 Twilio: outbound call, inbound webhook, speech loop (Gather) and ConversationRelay WebSocket, SMS, signature validation
  - [ ] 6.2.3 Mock provider (simulated callee) and in-app softphone for testing without a carrier
- [ ] 6.3 Telegram channel (long polling, owner allowlist, approvals with inline buttons)
- [ ] 6.4 Web Push notifications (VAPID) for approvals, finished tasks, new mail, call summaries

## Phase 7 — Autonomy

- [ ] 7.1 Background tasks: create, run, pause, resume, cancel, retry; waiting-for-approval state
- [ ] 7.2 Scheduler: one-shot times and cron routines
- [ ] 7.3 Delegate tool: sub-agent with its own thread and a tool subset
- [ ] 7.4 Skills: bundled + user skills, read on demand, agent-proposed skills behind approval
- [ ] 7.5 MCP client: stdio and HTTP servers, tools registered as plugins

## Phase 8 — Experience

- [ ] 8.1 Voice-Lock with Web Speech; recorder fallback to server STT; TTS through provider with browser fallback; tap orb to stop speaking
- [ ] 8.2 Home: original wallpaper, widgets, app grid, dock, orb, composer
- [ ] 8.3 Live stage: transcript, streaming text, cards, tool chips, approvals inline
- [ ] 8.4 Approvals tray (notification-center style) with all four decisions
- [ ] 8.5 Apps: original 14 + Computer, Inbox, Phone, Files, Tasks, Memory, Activity
- [ ] 8.6 Settings: connection, model, voice, persona, plugins, skills, MCP, secrets, approvals policy and grants, email, phone, Telegram, computer, notifications, data
- [ ] 8.7 PWA: manifest, icons, service worker, iPhone/iPad safe areas

## Phase 9 — Verification and release

- [ ] 9.1 Unit and integration tests (vault, sentinel, plugins, memory, local engine, email round trip, Twilio TwiML and signatures, files sandbox, desktop actions)
- [ ] 9.2 End-to-end browser run of the main flows
- [ ] 9.3 Docs: README, ARCHITECTURE, REFERENCES, SECURITY, OPERATIONS, NATIVE_CONTROL, STATUS
- [ ] 9.4 Push branch, make it default, deploy the web app
