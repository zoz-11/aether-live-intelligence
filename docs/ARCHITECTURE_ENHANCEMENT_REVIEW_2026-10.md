# Aether Live Intelligence — Architecture & Enhancement Review

**Review date:** 23 October 2026  
**Repository:** https://github.com/zoz-11/aether-live-intelligence  
**Branch:** `docs/aether-architecture-review-2026-10`  
**Scope:** Read-only source audit and upstream reference analysis. No runtime features are claimed as implemented by this document.

## Executive decision

Do not restart the Perplexity task or purchase credits yet. The current repository gives enough evidence to define the next build increments. First make the baseline reproducibly install, typecheck, build, and smoke-test; next wire a real model adapter behind the current UI; then put all consequential tools behind a trusted, auditable policy layer. Add richer interactive UI and durable computer tasks only after those gates pass. Native iOS device automation remains an optional, separately permissioned track.

The Grok Build context shows a “Free tier limit reached” message and a response claiming the recovery commit was pushed. Its own response also leaves later phases frozen until the product owner verifies the running build. Treat those as useful context, not as test evidence.

## Evidence and confidence

- Perplexity Analytics screenshot: the “Complete and Productionize Aet…” session showed **0.00 credits** at 8:12 AM; a separate “Aether Live Intelligence Project S…” session showed **0.02 credits** at 8:21 AM. Credit usage does not establish code changes or completion.
- Latest commit returned in the queried main-branch history: `18f947b`, “fix: add missing live.tsx (Voice-Lock UI, Composer, Transcript),” dated 18 October 2026.
- Latest observed CI run: https://github.com/zoz-11/aether-live-intelligence/actions/runs/39177591652. It failed at `actions/setup-node` because no supported dependency lockfile was found; dependency installation was skipped and typecheck was skipped.
- Perplexity pages could not be read through the connected browser because a security policy blocked page inspection. Unpublished task output and artifacts remain unverified.

## Current source audit

### Preserve

- Voice-Lock: accumulate speech while held and submit on release.
- Shared text/voice `sendTurn()` and conversation append path.
- Zustand persistence for current browser-local memory, notes, instructions and conversation state.
- Plugin toggles and Smart UI cards.
- The existing confirm/cancel scaffold, but strengthen it before real side effects are enabled.

### Major gaps found in the public source

1. **No real model execution in the current session path.** `src/lib/aether/session.ts` calls `localReply()`, a local keyword matcher. No provider call appears in that path.
2. **Simulated side effects.** `src/lib/aether/execute.ts` changes local state for flashlight/DND and returns strings such as email sent or restart started. Those are not real-world receipts.
3. **Screen-awareness overclaim risk.** The current summary describes Aether’s own app state and first note, not a real iOS screen capture across other apps.
4. **CI never validated the app.** The workflow’s npm cache setup fails without a lockfile; install is skipped; typecheck is skipped and is also configured as a soft/continue-on-error gate.
5. **Type/registry mismatch risk.** `src/lib/aether/types.ts` defines a narrow `AppId` union while `catalog.ts` declares a larger app catalogue. Run typecheck to establish exact compile diagnostics.
6. **Approvals are only scaffolding.** A global pending-risky object does not yet provide durable immutable approval binding, expiry, one-time-use semantics, idempotency or a complete audit trail.
7. **Documentation contradictions.** Source inventory/handoff descriptions lag behind the recovered modules. Update status only after commands and results are recorded.

## Open-source references: selectively adapt

| Reference | Extract | Do not transplant wholesale |
|---|---|---|
| [OpenDots](https://github.com/CopilotKit/OpenDots) | Persistent computer/workspace pattern; per-agent permissions; live activity; user takeover; inline approve/decline; saved artifacts. | Full runtime/CopilotKit/AG-UI/containers and every voice/Slack integration before the current baseline works. Upstream describes an alpha template and notes that conversations require CopilotKit Intelligence or supported evaluation/self-hosted setup. |
| [Open Intelligent UI](https://github.com/CopilotKit/OpenIntelligentUI) | Typed-first UI routing, native components, isolated sandboxed custom UI, streaming interactive answers. | Importing the whole Next.js + Python Deep Agent + visualization router into current Vite before a real model adapter is available. The visualization router is a separate dependency and potential cost. |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Plugin lifecycle/dependency abstractions for model, tools, sessions, storage, scheduling, sandbox and UI. | Replacing Aether wholesale with a fast-moving developer-preview harness; the upstream warns of breaking changes and asks users to read its safety notice. |
| [OpenClaw](https://github.com/openclaw/openclaw) | Gateway/control-plane separation; swappable model harnesses; local-first state/credentials; adapters. | Replicating broad multi-channel features before Aether delivers one reliable client workflow. Host-side tools need a deliberate sandbox/security setup. |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | Separate agent server/workspaces, eventful runs, bounded execution and local/cloud runtime choices. | Embedding an entire coding agent and general shell into the primary voice assistant. |
| [TouchSynthesis](https://github.com/willfaust/TouchSynthesis) | Research input for experimental iOS screen streaming/touch synthesis. | Mandatory production dependency. It relies on advanced pairing/developer setup and XCTest private APIs; keep lab-only until thoroughly verified. |
| Meta Muse / xAI Grok Bot | Product-level ideas: dedicated computer/VM, long-running work, learning from context, user approval at action boundaries. | Treating these product announcements as open-source code dependencies; no official source repository for those products was verified in this review. |

## Target architecture

1. **Aether client:** Voice-Lock, text composer, transcript, task timeline, typed UI.
2. **Agent orchestrator:** model adapter, planning, typed streaming events and context assembly. It proposes; it does not execute side effects directly.
3. **Trusted policy gate:** tool scopes, schema validation, risk tier, immutable approval ID, expiry, per-action user consent and server-side enforcement.
4. **Durable task runtime:** run IDs, checkpointing, retry, cancellation, timeout, resume and artifact indexing.
5. **Tool broker/MCP:** scoped adapters, secret management, cost/latency limits, health state, audit events and provider receipts.
6. **Optional isolated computer:** per-agent browser profile/workspace and bounded terminal. Default-deny capabilities; never silently fall back to host files or shell.
7. **Optional iOS companion:** App Intents/Shortcuts and permissioned screen-sharing first; experimental touch synthesis later, separately gated.
8. **Observability:** activity feed, status, last completed step, artifact links, redacted audit, cost ledger, tests and health.

## Critical security properties

- Treat web/MCP/tool output as untrusted data; do not let retrieved instructions change the policy layer.
- Tool availability is not consent. Default to least privilege, per-tool scopes and an approval step for consequential writes.
- Approval is bound server-side to the exact connection, agent, tool and validated argument hash. It expires, runs once, and is rejected when permissions change.
- An action is “successful” only with a real tool/provider receipt. No receipt means failed, unavailable or unverified—not success.
- Use idempotency keys for external writes; make retries safe and deduplicate repeated operations.
- Generated custom UI stays isolated and receives only a narrow typed bridge; never expose credentials or unrestricted host capabilities to generated JavaScript.
- Bound model tokens, tool calls, elapsed time and retries. Preserve checkpoint and explain why a run paused.
- Separate per-agent computer/browser data and credentials. Audit actions without routinely logging secrets or full sensitive payloads.

## Productionization plan

### Phase 0 — Repair baseline

- Choose one package manager and commit its lockfile.
- Align CI cache/install with that package manager.
- Make typecheck and production build required; add test and browser smoke gates.
- Run a clean clone in CI and save commit SHA, logs and screenshots.
- Resolve current source/type/catalog mismatches based on real compiler errors.
- Reconcile STATUS.md, HANDOFF.md and SOURCE_INVENTORY.md based on verified facts.

**Gate:** clean lockfile install, typecheck, build and minimal smoke test pass.

### Phase 1 — Real intelligence

- Put provider interaction behind a typed server-side adapter.
- Keep secrets out of browser bundles/logs.
- Add streaming progress, structured errors, timeout, cancellation and explicit provider status.
- Keep a deterministic mock provider for offline unit tests.

**Gate:** configured request demonstrably hits provider; missing key/timeout/network failure is visible; no fake answer is reported as provider output.

### Phase 2 — Trusted tools

- Centralize tool catalog, JSON Schema validation, capability grants and server-side authorization.
- Add immutable approval records, expiry, argument hash, one-time execution, audit trail and idempotency.
- Label current tools as mock/simulated until real adapters return receipts.

**Gate:** replayed/stale/modified approvals are rejected; tool-off gates block calls server-side; failed integrations never claim success.

### Phase 3 — Typed Smart UI

- Start with list, key/value, actions/confirm, table, chart, calculator and form.
- Validate each card type at runtime.
- Add isolated generative UI only after a sandbox and narrow host bridge pass security tests.
- Provide text fallback and keyboard/touch accessibility.

**Gate:** malformed UI is rejected, calculations are deterministic, and custom UI cannot access keys or bypass tool permissions.

### Phase 4 — Durable tasks

- Persist run states, step checkpoints, artifacts, costs and audit summaries.
- Resume from last safe checkpoint after reload/restart.
- Make retries/cancel/expire state explicit in UI.

**Gate:** restart mid-run and resume without duplicate external side effect; artifact and last completed step remain visible.

### Phase 5 — Native device bridge

- Prefer app-specific App Intents/Shortcuts for actions the OS/apps expose.
- Prototype user-triggered screen sharing with explicit permission, visible capture status and stop control.
- Use XCTest/XCUIAutomation for Aether’s own test suite.
- Explore TouchSynthesis only on an isolated lab device; version-gate it and retain a kill switch.

**Gate:** physical-device tests record OS/device, permission state, screenshots and actual results; core app continues working when native bridge is unavailable.

## Immediate engineering actions

1. Commit the current project’s chosen lockfile and fix CI.
2. Run typecheck/build and address real compiler output. Do not guess at failures.
3. Separate mock tool execution from real provider adapters.
4. Ensure every displayed “success” requires a verifiable external receipt.
5. Update the status/checklist only after each acceptance gate passes.
6. Keep later features frozen until the owner has confirmed a working build on their own device.

## User-visible demo target

The next useful milestone should prove one complete, truthful loop rather than show a broad feature list:

- Hold the Voice-Lock orb, speak one request, release and see exactly one submitted turn.
- Receive a genuine streaming model response or a clearly labelled local mock.
- Render a sourced typed comparison card with a follow-up action.
- Run a read-only browser/search action in an isolated workspace and display the activity timeline.
- For any write, display exact action/destination/permissions/expiry in an approval card; decline does nothing.
- After approval, show a real receipt or truthful failure.
- Reload the app and confirm run state, saved artifact, last completed step and cost summary remain available.
- All simulated or unsupported device features are labelled plainly.

## Evidence gaps

- Perplexity page contents could not be read through the connected browser because the active browser policy blocked page scripting. Unpublished artifacts from the 8:12 and 8:21 sessions remain unverified.
- The GitHub CI job failed before installation; no successful typecheck/build was observed.
- Target iPhone/iPad OS and native integration environment need confirmation in the device phase.
- “Open Grok” was ambiguous. This review did not treat it as a verified repository name.

## Sources

- Aether repository: https://github.com/zoz-11/aether-live-intelligence
- Latest observed Aether commit: https://github.com/zoz-11/aether-live-intelligence/commit/18f947bfabe82fd90123ae013fd41779e7b84ba4
- Latest observed CI run: https://github.com/zoz-11/aether-live-intelligence/actions/runs/39177591652
- OpenDots: https://github.com/CopilotKit/OpenDots
- OpenDots computer permissions: https://github.com/CopilotKit/OpenDots/blob/main/docs/COMPUTERS.md
- OpenDots connections/approvals: https://github.com/CopilotKit/OpenDots/blob/main/docs/CONNECTIONS.md
- Open Intelligent UI: https://github.com/CopilotKit/OpenIntelligentUI
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- Official DeepSeek Harness overview: https://www.deepseek.com/harness/en/
- OpenClaw: https://github.com/openclaw/openclaw
- OpenHands: https://github.com/All-Hands-AI/OpenHands
- TouchSynthesis: https://github.com/willfaust/TouchSynthesis
- Meta Muse announcement: https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/
- xAI Grok Bot announcement: https://x.ai/news/introducing-grok-bot
- OpenAI Computer Use integration guide: https://developers.openai.com/api/docs/guides/tools-computer-use-integration
- AG-UI event model: https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx
- OWASP MCP Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- MCP authorization security considerations: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/security-considerations.mdx
- Apple XCUIAutomation: https://developer.apple.com/documentation/XCUIAutomation
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/ScreenCaptureKit
- Apple iOS screen-capture sample: https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-on-ios
