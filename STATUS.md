# Aether — Project Status (Handoff)

**Last updated:** 17 October 2026  
**Owner:** Zoz (`@zoz-11`) + Grok  
**Repo goal:** Resume and finish Aether from any machine / any AI tool without context loss.

---

## Where we stopped

| Area | Status |
|------|--------|
| Phase 0 – Foundation | **Done** (Project + Blueprint + source tree) |
| Phase 1 – Core Experience | **Done** (Voice-Lock, unified chat, memory, Settings) |
| Phase 2 – Intelligence & Plugins | **Done** (plugin gates, Smart UI cards, system prompt + custom instructions) |
| Phase 3 – Device Control | **In progress** (confirmations started; native XCTest/cell-use **not** integrated) |
| Phase 4 – Advanced | Not started |
| Phase 5 – Polish & Launch | Not started |

### Exact last engineering work

1. Phase 2 shipped into the live app (plugin-aware tools, `show_card`, Settings plugins, custom instructions in system prompt).
2. Phase 3 started: risky-action confirmation scaffolding (`restart_device`, send-email) and on-demand screen awareness design.
3. Build rate-limit hit on Grok Build — **no further Build Mode until reset**.
4. GitHub connector authenticated as `zoz-11` but **cannot create repositories** (App missing `administration` / repo-create scope). Handoff package prepared locally for push once a repo exists.

---

## What works today (product)

- Hold-to-talk **Voice-Lock** (accumulate speech → process only on release).
- Voice and text share the **same conversation + memory**.
- Settings: Custom Instructions, Plugin toggles, Memory viewer/editor, device toggles, voice picker.
- Plugins: Memory, Smart UI Cards (on by default); Screen Awareness, Device Control (off by default).
- Smart UI cards: text, list, key-value, action buttons.
- System prompt injects custom instructions every turn.
- Simulated iPad OS surface (notes, mail, calendar, etc.) with tool calling via xAI models when `XAI_API_KEY` is set.

## What is explicitly NOT done

- Real iPhone/iPad **computer-use** (cell-use / TouchSynthesis / PiDurableKit / XCTest). Browser cannot drive a physical device.
- Pixel-level screen vision (current “Screen Awareness” = structured app state summary when plugin is on).
- Background agents, identity email/phone, iPhone↔iPad handoff.
- Full source tree may be incomplete in this handoff if only partial extract survived the environment — treat `docs/BLUEPRINT_AND_CHECKLIST.md` and this STATUS as the source of truth for product intent.

---

## Immediate next actions (when Build limit resets)

1. Create GitHub repo `aether-live-intelligence` under `zoz-11` (private recommended).
2. Push this package to `main`.
3. Resume **Phase 3.2–3.3**: on-demand screen snapshot + confirmation cards wired end-to-end.
4. Phase 3.1: document native control path (Swift companion / cell-use) as optional module — do not block web product.
5. Keep checklist updated on every completed task.

---

## Environment notes

- Stack: React 19 · TanStack Start · Tailwind v4 · Zustand · xAI chat + TTS.
- iPhone / iPad first.
- Never rewrite working open-source control libraries from scratch; compose them.
- Everything that can be a plugin should be a plugin.
