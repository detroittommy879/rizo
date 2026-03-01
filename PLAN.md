# Rizo Terminal — Master Plan Index

> Last updated: 2026-02-28. This file is the index only. Each phase lives in its own complete document.
> Phases are ordered by dependency, but the architecture should be modular enough that Phase 2 work can begin on isolated tasks before Phase 1 is fully complete.

---

## Phase Files

| File                     | Phase       | Focus                                                                                                   |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| [phase-1.md](phase-1.md) | **Phase 1** | UI/UX polish: modular layout, fonts everywhere, themes, split terminals, session recording, AI bar stub |
| [phase-2.md](phase-2.md) | **Phase 2** | AI features: OpenRouter, teaching mode, quizzes, command suggestions, community themes launch           |
| [phase-3.md](phase-3.md) | **Phase 3** | Power-user + monetization: workspaces, remote/mobile, MCP, SSH sync, custom sandboxed effects           |

---

## High-Level Outcomes

| Phase       | Outcome                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** | App looks and feels excellent. Fonts everywhere with Google Fonts search. 20+ built-in themes. Modular UI users can rearrange and hide. Better tiling terminal layout. Session crash recovery. AI bar stub ready for Phase 2. |
| **Phase 2** | Full AI-powered teaching terminal. OpenRouter backend with streaming and fallbacks. AI sidebar with Chat/Teach/Automate tabs. Command quizzes, hint arrows. Community themes live as a selling point.                         |
| **Phase 3** | Multi-instance named workspaces. Remote/mobile terminal viewing. MCP connector for coding agents. SSH key sync with AES-256. Custom sandboxed background effects.                                                             |

---

## Subagent Index

| When                   | Agent                        | Task                                                                                                                       |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Before any phase**   | `Explore`                    | Full codebase read: exact line numbers for all key functions, `DEFAULT_CONFIG`, CSS class names, `Cargo.toml` deps         |
| **Phase 1 → task 1.3** | `Oracle-subagent`            | Generate 25+ terminal color themes as JS array matching `DEFAULT_CONFIG.theme` shape                                       |
| **Phase 1 → task 1.8** | `Oracle-subagent`            | Fetch/curate top 200 Google Fonts for embedding in a bundled `fonts-list.js` (no API key needed — just names + categories) |
| **Phase 2 → task 2.1** | `Oracle-subagent`            | OpenRouter API: endpoints, SSE streaming format, best free-tier model IDs, Tauri reqwest permission requirements           |
| **After Phase 2**      | `Oracle-subagent`            | Market research: competitor terminal pricing, what devs would pay for, AI terminal landscape                               |
| **Phase 3 → task 3.1** | `Oracle-subagent`            | Tauri v2 multi-window API, AES crate options, WebSocket bridge patterns                                                    |
| **Any phase**          | `Frontend-Engineer-subagent` | Delegate self-contained UI tasks (sidebar layout, theme picker, context menu, font picker UI)                              |
| **Any phase**          | `Explore`                    | Targeted re-read of specific files before implementation starts                                                            |

---

## Open Questions

1. **Alternating row shading**: Canvas overlay (matches CRT/static architecture) or CSS repeating-gradient? Canvas is pixel-accurate for `lineHeight`; CSS is simpler.
2. **Session buffer size**: "100 pages" = `100 × defaultRows` lines (dynamic, ~3,000) or flat byte limit per tab?
3. **Custom background effects safety**: Parameterized effects only (Phase 1), or sandboxed iframe/WebWorker for user JS (Phase 3)?
4. **Per-element fonts**: Load each Google Font family via injected `<link>` tags (simplest) or use `FontFace` API (already used for local font upload)?
5. **API key storage**: Config JSON (simple, plaintext on disk) or `tauri-plugin-stronghold` (encrypted keychain, more complex)?
6. **Modular layout persistence**: Save panel positions/sizes in `config.layout` as a flat object, or as a JSON tree matching the DOM nesting structure?
