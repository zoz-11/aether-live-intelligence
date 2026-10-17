# Source inventory

**Repo:** zoz-11/aether-live-intelligence  
**Date:** 17 October 2026

## On `main`

| Path | Role |
|------|------|
| `src/lib/aether/catalog.ts` | Tools list + system prompt builder |
| `src/lib/aether/types.ts` | Core types |
| `src/components/aether/dossier.tsx` | In-app dossier surface |
| Docs / STATUS / AGENTS / SECURITY / LICENSE | Handoff |
| `package.json` | App-builder template deps + scripts |

## Missing (required for a runnable app)

| Path | Why it matters |
|------|----------------|
| `store.ts` | Conversations, memory, plugins, Settings state |
| `session.ts` | `sendTurn`, context, TTS orchestration |
| `execute.ts` | Tool execution + confirmation pending |
| `speech.ts` | Web Speech / Voice-Lock recognition |
| `live.tsx` | Voice-Lock UI |
| `apps.tsx` | Settings + app surfaces |
| `cards.tsx` | Smart UI rendering |
| `turn.ts` | xAI server functions |
| routes / router / styles / utils / button | App shell |
| `scripts/*` | Referenced by `package.json` |

## Recovery strategy

1. Prefer re-export from the original Grok Build / workspace if still available.
2. Otherwise re-implement from `docs/HANDOFF.md` and STATUS (do not invent features outside the checklist).
3. Until recovered, treat the repo as a **spec + partial code** handoff, not a clone-and-run product.
