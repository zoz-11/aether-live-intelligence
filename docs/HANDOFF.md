# Handoff — Resume Aether in one sitting

Paste this document into any capable coding agent (Grok, Claude, Cursor, Codex, etc.) together with the repo.

---

## Mission

Finish **Aether**: iPhone/iPad-first live voice intelligence with real computer-use path. Deliver something that feels smarter than Siri + ChatGPT Voice + Perplexity + HeyClicky combined.

## Non-negotiables

- Reuse open-source (DeepSeek Harness plugins, PiDurableKit, cell-use, TouchSynthesis). Never rewrite from scratch.
- Plugin-first. Unified memory. Push-to-talk Voice-Lock.
- iPhone/iPad first. Checklist-driven. Verify before marking done.

## Completed

### Phase 1
- Voice-Lock: accumulate transcript while held; `sendTurn` only on release (`live.tsx`).
- Unified conversation: voice and text use same `activeConversationId` + `appendMessage`.
- Persistent memory via Zustand `persist`.
- Settings: custom instructions, plugins, memory editor, device controls.

### Phase 2
- `toolsForPlugins` + execute-time gates for `memory` and `smart-ui`.
- `show_card` tool + `SmartCards` UI (text / list / kv / actions).
- System prompt: calm teammate, custom instructions every turn, plugin status aware.

### Phase 3 (started only)
- Confirmation scaffolding for `restart_device` and send-email (`pendingRisky` pattern in `execute.ts`).
- Screen Awareness plugin exists; full on-demand snapshot UX incomplete.
- **No** native cell-use / XCTest integration (impossible in pure browser).

## Do next (priority order)

1. Wire confirmation UI end-to-end: when tool returns “waiting for confirmation”, show Smart UI action card; Confirm runs `confirmPending()`.
2. On-demand screen: only inject `onScreen` when plugin on **and** user asks / taps Look.
3. Document native module interface for cell-use companion (Swift) under `docs/NATIVE_CONTROL.md` — implement later on device.
4. Harden offline/local fallback when `XAI_API_KEY` missing.
5. Tests for plugin gating + confirmation.
6. Phase 4 only after Phase 3 checklist is honest and verified.

## Key paths

```
src/lib/aether/store.ts      # state, plugins, memory, conversations
src/lib/aether/session.ts    # sendTurn, context, speak
src/lib/aether/execute.ts    # tools + confirmations
src/lib/aether/catalog.ts    # tools list + system prompt + toolsForPlugins
src/lib/ai/turn.ts           # xAI server functions
src/components/aether/live.tsx
src/components/aether/apps.tsx   # SettingsApp
src/components/aether/cards.tsx  # Smart UI
docs/BLUEPRINT_AND_CHECKLIST.md
STATUS.md
```

## Environment

```bash
npm install
export XAI_API_KEY=...
npm run dev
```

## Definition of done for Phase 3

- [ ] Screen Awareness on-demand verified
- [ ] Risky actions always require explicit confirm card
- [ ] Native control documented (implementation may be stub)
- [ ] Checklist updated with notes
- [ ] No regressions to Voice-Lock or Settings
