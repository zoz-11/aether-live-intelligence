# Aether — iPhone / iPad Live Intelligence

**State-of-the-art personal AI teammate:** push-to-talk Voice-Lock, unified memory across voice and text, plugin-first skills, Smart UI cards, and a path to real device computer-use.

> Hold to speak as long as you want. Release → process. Never interrupted. Never forgets what you said in the other modality.

---

## Status

See **[STATUS.md](./STATUS.md)** for exact progress and where work stopped.  
See **[docs/BLUEPRINT_AND_CHECKLIST.md](./docs/BLUEPRINT_AND_CHECKLIST.md)** for vision, pillars, and the living checklist.  
See **[docs/HANDOFF.md](./docs/HANDOFF.md)** to resume with any AI tool or human engineer.

| Phase | State |
|-------|--------|
| 0 Foundation | Done |
| 1 Core Experience | Done |
| 2 Plugins + Smart UI | Done |
| 3 Device Control | In progress |
| 4 Advanced | Not started |
| 5 Polish & Launch | Not started |

---

## Principles (non-negotiable)

1. **Reuse open source** — DeepSeek Harness–style plugins, PiDurableKit, cell-use, TouchSynthesis, Bops identity patterns. Do not rewrite working systems.
2. **Everything is a plugin** when possible.
3. **Unified memory** — voice and text share one conversation brain.
4. **Push-to-talk / Voice-Lock** is mandatory.
5. **iPhone and iPad first.** Mac later.
6. **Phase-based + checklist-driven.** Mark `[x]` only after verification.
7. Challenge unnecessary complexity.

---

## Stack

- React 19 + TanStack Start + Tailwind CSS v4  
- Zustand (persisted conversation + memory + plugins)  
- xAI Chat Completions (tool calling) + xAI TTS  
- Web Speech API for recognition (Voice-Lock UX)

---

## Quick start

```bash
# requires Node 20+
npm install
export XAI_API_KEY=your_key   # optional; app degrades gracefully without it
npm run dev                   # typically http://localhost:8080
```

Open **Settings** to set Custom Instructions, toggle plugins, and edit memory.

---

## Architecture (short)

```
User voice/text
    → session.sendTurn (shared conversation)
    → aetherTurn (system prompt + enabled plugins + tools)
    → executeCalls (plugin-gated tools)
    → Smart UI cards + optional speech
```

| Plugin ID | Default | Effect |
|-----------|---------|--------|
| `memory` | on | `remember` / `recall` + memory in prompt |
| `smart-ui` | on | `show_card` + card rendering |
| `screen` | off | On-screen app summary in context (Phase 3) |
| `device-control` | off | Real computer-use target (Phase 3 native) |

Simulated device tools (flashlight, notes, mail, …) remain available for the web OS demo even when `device-control` is off. Native taps/types require a separate Swift / companion path.

---

## Reference projects (compose, do not rewrite)

| Project | Use |
|---------|-----|
| DeepSeek Harness / Agency | Plugin kernel |
| PiDurableKit (Finn Voorhees) | Durable agent runtime patterns |
| cell-use / TouchSynthesis | On-device control |
| Bops.bot | Persistent identity patterns |
| HeyClicky | Screen-skill patterns |
| Perplexity / Sesame | Voice UX targets |

---

## License

MIT — see [LICENSE](./LICENSE).

## Security

Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md). Never commit API keys.
