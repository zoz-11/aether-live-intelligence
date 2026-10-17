# Aether — Project Status (Handoff)

**Last updated:** 17 October 2026  
**Owner:** Zoz (`@zoz-11`) + Grok  
**Repo:** https://github.com/zoz-11/aether-live-intelligence  
**Repo goal:** Resume and finish Aether from any machine / any AI tool without context loss.

---

## Where we stopped

| Area | Status |
|------|--------|
| Phase 0 – Foundation | **Done** (Project + Blueprint + handoff repo) |
| Phase 1 – Core Experience | **Done in Grok Build session** (Voice-Lock, unified chat, memory, Settings) |
| Phase 2 – Intelligence & Plugins | **Done in Grok Build session** (plugin gates, Smart UI cards, system prompt + custom instructions) |
| Phase 3 – Device Control | **In progress** (confirmations started; native XCTest/cell-use **not** integrated) |
| Phase 4 – Advanced | Not started |
| Phase 5 – Polish & Launch | Not started |

### Exact last engineering work

1. Phase 2 shipped in the **Grok Build / app-builder** environment (plugin-aware tools, `show_card`, Settings plugins, custom instructions in system prompt).
2. Phase 3 started: risky-action confirmation scaffolding (`restart_device`, send-email) and on-demand screen awareness design.
3. Build rate-limit hit on Grok Build — no further Build Mode until reset.
4. This private repo was created and seeded with **docs + partial source export**.

---

## Honest source inventory (important)

### Present on `main` today

- Docs: README, STATUS, AGENTS, SECURITY, LICENSE, HANDOFF, BLUEPRINT checklist
- Repo ops: `.gitignore`, `.env.example`, CI workflow, issue templates
- `src/lib/aether/catalog.ts`, `src/lib/aether/types.ts`
- `src/components/aether/dossier.tsx`
- `package.json` (from app-builder template — **scripts/ folder is missing**)

### Missing from this export (implemented in Build, not recovered here)

- `src/lib/aether/store.ts`
- `src/lib/aether/session.ts`
- `src/lib/aether/execute.ts`
- `src/lib/aether/speech.ts`
- `src/lib/aether/seed.ts`
- `src/lib/ai/turn.ts`
- `src/components/aether/live.tsx` (Voice-Lock)
- `src/components/aether/apps.tsx` (Settings)
- `src/components/aether/cards.tsx` (Smart UI)
- `src/components/aether/{home,chrome,os}.tsx`
- `src/routes/*`, `src/router.tsx`, `src/styles.css`, `src/lib/utils.ts`, `src/components/ui/button.tsx`
- App-builder `scripts/` referenced by `package.json`

**Implication:** `npm run dev` will not work until missing modules are restored or the app is re-scaffolded against this checklist.

Treat this STATUS + `docs/HANDOFF.md` + `docs/BLUEPRINT_AND_CHECKLIST.md` as the product source of truth until the full tree is recovered.

---

## What works in product intent (from verified Build session)

- Hold-to-talk **Voice-Lock** (accumulate → release → process).
- Voice and text share the same conversation + memory.
- Settings: Custom Instructions, Plugin toggles, Memory viewer/editor.
- Plugins: Memory + Smart UI on by default; Screen Awareness + Device Control off.
- Smart UI cards: text, list, key-value, actions.
- System prompt injects custom instructions every turn.

## Explicitly not done

- Real device computer-use (cell-use / TouchSynthesis / PiDurableKit / XCTest).
- Pixel-level screen vision.
- Background agents, identity email/phone, multi-device handoff.

---

## Immediate next actions

1. **Recover or re-implement** missing core modules listed above (priority: `store` → `session` → `execute` → `live` → Settings).
2. Replace or slim `package.json` so scripts match the actual tree (or restore `scripts/` from app-builder).
3. Resume Phase 3.2–3.3: on-demand screen + confirmation cards end-to-end.
4. Document native control path; do not block the web product on it.
5. Keep checklist updated on every completed task.

---

## Environment notes

- Stack target: React 19 · TanStack Start · Tailwind v4 · Zustand · xAI chat + TTS.
- iPhone / iPad first.
- Never rewrite working open-source control libraries from scratch; compose them.
- Everything that can be a plugin should be a plugin.
