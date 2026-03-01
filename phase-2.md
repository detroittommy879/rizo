# Phase 2 — AI Features, Community Themes & Teaching Mode

> **Depends on:** Phase 1 complete. Session buffer (`tab.sessionBuffer`) must be working — it's the AI's context window.
> **Goal:** Full AI-powered terminal. OpenRouter backend with streaming and fallbacks. Teaching mode, quizzes, command suggestions. Community themes live as a paid/viral selling point.

---

## 🤖 Subagent: OpenRouter API Research (run before Task 2.1)

> **Agent:** `Oracle-subagent`
>
> **Return:**
>
> - Exact chat completions endpoint URL and required request headers for OpenRouter
> - Whether `reqwest` + raw HTTP is better than any SDK for Tauri/Rust (confirm no Rust OpenAI SDK needed)
> - Best free-tier model IDs right now: deepseek, Qwen, Llama variants — exact string IDs as in API
> - How SSE streaming works: what each chunk object looks like, how to detect `[DONE]`
> - Rate limit headers to watch for (429 behaviour)
> - Does `reqwest` in Tauri v2 need any extra capability entry in `capabilities/default.json`? Does `tauri-plugin-http` need to be added?
> - Any CORS or network permission issues with making outbound HTTP from Tauri WebView vs from Rust backend? (AI calls should go from Rust side, confirm this is the right approach)

---

## Task 2.1 — OpenRouter Rust Backend

**Files:** `src-tauri/src/main.rs` → refactor: move AI code to `src-tauri/src/ai.rs`; `src-tauri/Cargo.toml`

### `Cargo.toml` additions

```toml
reqwest = { version = "0.12", features = ["json", "stream"] }
# tokio and serde_json are almost certainly already present via tauri
```

### New file: `src-tauri/src/ai.rs`

```rust
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,   // "system" | "user" | "assistant"
    pub content: String,
}

/// Main AI chat command. Streams chunks back as Tauri events.
#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    model: Option<String>,
    api_key: String,
    base_url: Option<String>,
    app: AppHandle,
) -> Result<(), String>
```

Implementation notes:

- `base_url` defaults to `https://openrouter.ai/api/v1`
- Default model: `deepseek/deepseek-chat`
- Fallback chain (tried in order on 429 or model error): `["qwen/qwen-2.5-72b-instruct:free", "meta-llama/llama-3.3-70b-instruct:free", "mistralai/mistral-7b-instruct:free"]`
- Request: `POST {base_url}/chat/completions` with body `{ model, messages, stream: true }`
- Required headers: `Authorization: Bearer {api_key}`, `Content-Type: application/json`, `HTTP-Referer: https://rizo.terminal` (OpenRouter requires a referer)
- Stream parsing: read SSE line by line; each `data: {...}` line is a JSON chunk; `data: [DONE]` ends stream
- Emit each chunk as Tauri event: `app.emit("ai-chunk", AiChunkPayload { content, done, error })`
- **Security**: strip `api_key` from all error messages and logs before emitting to frontend — never expose it

### `main.rs` registration

```rust
mod ai;
// In generate_handler![..., ai::ai_chat]
```

---

## Task 2.2 — AI Sidebar Panel

**Files:** `src/main.js`, `src/styles.css`

### DOM restructure

Wrap the existing content in `#app-layout` (flex row):

```html
<div id="app-layout">
  <div id="main-area">
    <!-- existing: tab bar, terminals, preset bar, AI bar, status bar -->
  </div>
  <div id="ai-sidebar" class="ai-sidebar ai-sidebar--collapsed">
    <div class="ai-sidebar__header">
      <span>AI Assistant</span>
      <button id="ai-sidebar-toggle" title="Ctrl+\">◀</button>
    </div>
    <nav class="ai-sidebar__tabs">
      <button class="ai-stab ai-stab--active" data-stab="chat">Chat</button>
      <button class="ai-stab" data-stab="teach">Teach</button>
      <button class="ai-stab" data-stab="automate">Automate</button>
    </nav>
    <div id="ai-stab-chat" class="ai-stab-content"></div>
    <div id="ai-stab-teach" class="ai-stab-content ai-hidden"></div>
    <div id="ai-stab-automate" class="ai-stab-content ai-hidden"></div>
  </div>
</div>
```

### CSS

- `#app-layout`: `display: flex; flex-direction: row; height: 100vh`
- `#main-area`: `flex: 1; min-width: 0; display: flex; flex-direction: column`
- `#ai-sidebar`: `width: 300px; transition: width 0.2s ease; overflow: hidden; border-left: 1px solid var(--border-color)`
- `.ai-sidebar--collapsed`: `width: 0; border-left: none`
- `.ai-messages`: `flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px`
- User bubble: right-aligned, background `var(--accent-color)`, border-radius, max-width 85%
- Assistant bubble: left-aligned, background `var(--surface-2)`, supports basic markdown (bold `**`, inline `code`, code blocks with syntax highlight via CSS class only)
- Typing indicator: three dots `●●●` with staggered fade animation
- Per-element font from `config.uiFonts.aiPanel` applied via `--font-ai-panel` CSS variable

### View menu + keyboard shortcut

- Tauri menu: View → "AI Sidebar" (checkmark, defaults unchecked)
- `Ctrl+\` keyboard shortcut toggles `ai-sidebar--collapsed`
- Also wires the AI Input Bar (Phase 1 stub) to open this sidebar on Enter key

---

## Task 2.3 — AI Chat Tab

**Files:** `src/main.js`

`#ai-stab-chat` contains:

```html
<div class="ai-messages" id="ai-chat-messages"></div>
<div class="ai-chat-input-row">
  <textarea
    id="ai-chat-input"
    rows="2"
    placeholder="Ask about this terminal session..."
  ></textarea>
  <button id="ai-chat-send">Send</button>
</div>
```

On send (Enter without Shift, or Send button):

1. Get `inputText`
2. Get last `config.ai.contextLines` lines from `activeTab().sessionBuffer` as context
3. Build messages array:
   ```js
   [
     {
       role: "system",
       content: `You are a terminal AI assistant. The user's recent terminal output:\n\n${context}\n\nAnswer helpfully and educationally.`,
     },
     ...chatHistory,
     { role: "user", content: inputText },
   ];
   ```
4. Append user bubble to `#ai-chat-messages`, scroll to bottom
5. Create empty assistant bubble with typing indicator
6. Call `invoke('ai_chat', { messages, apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl })`
7. `listen('ai-chunk', ({ payload }) => { append payload.content to bubble; if payload.done: remove typing indicator })`
8. On error: show error in a red bubble, do not crash

---

## Task 2.4 — AI Teach Tab

**Files:** `src/main.js`, `src/styles.css`

`#ai-stab-teach` layout:

```
[Explain last command]  [Quiz me ← appears after explanation]

Score: 3/5 ✓  ← appears after first quiz

[Explanation card — rendered in this area]
```

### "Explain last command"

1. Scan `activeTab().sessionBuffer` backward for the last line that looks like a prompt + command (heuristic: last line matching `^[^#\r\n]*[$>#]\s+\S`)
2. Extract the command and the N lines of output following it
3. Build system prompt: _"You are a terminal teacher. Give a clear, educational explanation of this command. Structure your response with: **What it does**, **Key flags/arguments**, **A memory trick to remember it**, **Common variations**."_
4. Stream response into an explanation card (pre-formatted `<div class="explanation-card">`)
5. After streaming completes, show "Quiz me" button

### "Quiz me" button

1. Send follow-up: _"Generate exactly 3 multiple-choice quiz questions about this command as JSON: `[{q, options: [a,b,c,d], correct: 0}]`. Return only valid JSON."_
2. Parse JSON from response (handle markdown code-block wrapping)
3. Render 3 question cards with clickable option buttons
4. On answer: highlight correct (green) / wrong (red), update `tab.quizScore = { correct, total }`
5. Score badge in tab header updates: `3/5 ✓`
6. "Next question" auto-advances

### Hint arrows

- Right-click terminal pane → context menu adds "Place hint arrow 🏹"
- Creates a draggable `<div class="hint-arrow">` with SVG arrow + `?` button
- `?` button → sends selected text (or clipboard) as context to AI Chat tab with prompt "What does this terminal output mean?"
- Arrow persists until user clicks `✕` on it

---

## Task 2.5 — AI Automate Tab

**Files:** `src/main.js`

`#ai-stab-automate` layout:

```
[↻ Refresh suggestions]

Suggested next commands:
┌────────────────────────────────────────┐
│ git push origin main          [▶ Run]  │
│ Because you just committed...          │
├────────────────────────────────────────┤
│ npm test                      [▶ Run]  │
│ No tests run in this session...        │
├────────────────────────────────────────┤
│ ls -la                        [▶ Run]  │
│ Common after changing files...         │
└────────────────────────────────────────┘
```

On tab focus or Refresh click:

1. Extract last 30 commands from session buffer (lines matching prompt heuristic)
2. Prompt: _"Based on this terminal command history, suggest the 3 most likely next commands. Return JSON: `[{command, reason}]`. Be concise."_
3. Parse and render suggestion cards

Each card's **Run** button:

```js
invoke("write_to_pty", {
  id: activeTab().ptyId,
  data: suggestion.command + "\r",
});
```

### Ghost-text inline completions

When `config.features.autocompleteSuggestions` is true and `config.ai.apiKey` is set:

- Hook terminal `onKey` (debounce 500ms)
- If cursor is at end of line and input ≥ 3 chars: send to AI with prompt "Complete this terminal command: `{partial}`. Return only the completion suffix, no explanation."
- Show completion as a greyed `<span class="ghost-text">` overlaid at cursor position
- Tab key accepts; any other key dismisses

---

## Task 2.6 — Wire AI Bar (Phase 1 stub → Phase 2 real)

**File:** `src/main.js`

In Phase 1 the AI bar just showed a toast. Now wire it:

- Replace stub handler with: build a `user` message from input, open AI sidebar, switch to Chat tab, send the message
- If sidebar is collapsed, expand it first (remove `ai-sidebar--collapsed`)
- The AI bar becomes a quick-access input that funnels into the full sidebar chat

---

## Task 2.7 — AI Settings Tab

**Files:** `src/settings.js`, `src/main.js`

New **"AI"** tab in settings dialog (8th tab after Themes):

```
API Key    [●●●●●●●●●●●●]  [Show]
Base URL   [https://openrouter.ai/api/v1       ]
Model      [deepseek/deepseek-chat          ▼  ]
           (free tier, good for most tasks)

☑ Teaching mode (Teach tab)
☑ Stream responses
☑ Ghost-text completions (requires key)
Context lines   [──────●──────]  50

[Test Connection]    Status: ● Connected
```

- API Key: `<input type="password">`, stored in `config.ai.apiKey` (plaintext for now — Phase 3 option for keychain)
- Model dropdown: hardcoded list of recommended free + paid models with labels
- "Test Connection": calls `ai_chat` with a minimal ping message, shows spinner then success/error
- All values live in `config.ai.*` per `DEFAULT_CONFIG` in Phase 1

### `DEFAULT_CONFIG` additions

```js
ai: {
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'deepseek/deepseek-chat',
  teachingMode: true,
  streaming: true,
  ghostText: false,
  contextLines: 50,
}
```

---

## Task 2.8 — Community Themes: Phase 2 Launch (selling point)

**Files:** `src/settings.js`, `src/main.js`, `src/styles.css`

Community themes is the viral/monetization hook. Make it a real feature in Phase 2.

### Theme export

- "Export theme" button in Themes settings tab
- Serializes current full theme (including `uiFonts`, `extras`, `effects`) to JSON
- Prompts for theme name + author name + description tag (e.g. "dark" / "light" / "cyberpunk" / "retro")
- Exports as `{name}.rizotheme` file (JSON download via `<a download>` trick)
- Also generates a share link: `rizo://theme/{base64-encoded-json}` — copyable to clipboard

### Theme import

- "Import from file…" in Themes dropdown → file input accepting `.rizotheme`
- Validates schema (must have `background`, `foreground`, 16 ANSI colors) before accepting
- Drag `.rizotheme` onto the settings window also imports

### Community browser (basic Phase 2 version)

Click **Browse Community** (was locked in Phase 1) → opens a modal:

```
┌──────────────────────────────────────────────────────┐
│  Community Themes         [Search...]  [Sort: Popular]│
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Neon     │ │ Sakura   │ │ Hacker   │ │ Autumn   │ │
│  │ Sunset   │ │ Pink     │ │ Green    │ │ Leaves   │ │
│  │ ██████   │ │ ████▓    │ │ ▓█▓█▓   │ │ ██▓█▓   │ │
│  │ ─────    │ │ ─────    │ │ ─────   │ │ ─────   │ │
│  │ by @user │ │ by @user │ │ by @user│ │ by @user│ │
│  │ [Install]│ │ [Install]│ │[Install]│ │[Install]│ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                          [Submit Mine] │
└──────────────────────────────────────────────────────┘
```

For Phase 2, the community registry endpoint is a static JSON file hosted somewhere simple (GitHub Gist or a basic endpoint). Structure:

```json
{ "themes": [{ "name", "author", "description", "tags": [], "downloads": 0, "data": {<theme>} }] }
```

Fetched via `invoke('fetch_themes_registry', { url })` — Rust makes the HTTP GET (avoids CORS), returns JSON string.

**This is a primary selling point and sharing mechanism.** Users share wild themes, others try the app to get them.

---

## 🤖 Subagent: Market Research

> **Agent:** `Oracle-subagent`
>
> **Task:** Return a structured market research report (`MARKET_RESEARCH.md`) covering:
>
> 1. **Competitor terminals**: Warp, Warp AI, Tabby, Hyper, WezTerm, iTerm2, Rio, Alacritty — what do they charge? Any AI features? Subscription or one-time?
> 2. **AI terminal tools**: Fig (acquired), Butterfish, Warp AI, Shell-GPT, aider — pricing models, user reception
> 3. **Developer pain points**: Reddit r/commandline, r/devops, HN "Ask HN: What do you want in a terminal?" — common themes
> 4. **Pricing benchmarks**: developer SaaS sweet spots ($4–15/mo). Freemium vs one-time vs subscription evidence
> 5. **Feature wishlists**: GitHub issues on popular terminal repos — what gets most upvotes?
> 6. **Community growth channels**: best places to share a terminal emulator (HN, Reddit, Dev.to, Discord servers to target)
> 7. **Recommendation**: suggest a pricing/tier model for Rizo specifically based on the above
>
> Return as a complete markdown document ready to save to `MARKET_RESEARCH.md`.

---

## Phase 2 Verification Checklist

- [ ] `npm run tauri dev` compiles with new AI Rust code
- [ ] Settings → AI tab: all fields visible, values persist to `config.json`
- [ ] "Test Connection" button: with valid OpenRouter key shows green; with bad key shows clear error (no crash)
- [ ] Chat tab: type a message, hit Send → response streams word-by-word; history shown in bubbles
- [ ] System context: run `echo hello` in terminal then ask "what did I just run?" → AI answer references it
- [ ] Teach tab: run `find . -name "*.js"`, click "Explain last command" → explanation card with all sections
- [ ] "Quiz me": generates 3 MCQ cards; answering shows feedback; score badge updates
- [ ] Automate tab: 3 suggestion cards appear; clicking Run executes command in active terminal
- [ ] Model fallback: replace API key with `test-bad-key` → error shown gracefully; no uncaught exception
- [ ] Hint arrow: right-click terminal → "Place hint arrow" → arrow draggable; ? click → AI response in Chat tab
- [ ] Community themes: click "Browse Community" → modal loads themes from registry
- [ ] Export theme → `.rizotheme` file downloads; import in same session → theme appears in dropdown
- [ ] AI bar (from Phase 1): typing a question + Enter opens sidebar Chat tab with the question pre-sent
- [ ] `Ctrl+\` opens/closes sidebar with smooth CSS transition
- [ ] Ghost-text completions (if enabled in settings): typing partial command shows faded completion after 500ms debounce

---

## Key Files Modified in Phase 2

| File                    | Changes                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `src-tauri/src/ai.rs`   | New file — AI chat command, streaming, fallback logic                                        |
| `src-tauri/src/main.rs` | `mod ai;` declaration, register commands, `fetch_themes_registry` command                    |
| `src-tauri/Cargo.toml`  | `reqwest` with stream feature                                                                |
| `src/main.js`           | AI sidebar init, chat history state, teach/quiz/automate logic, ghost-text, AI bar wire-up   |
| `src/settings.js`       | AI settings tab, community theme browser, theme export/import                                |
| `src/styles.css`        | Sidebar layout, message bubbles, explanation cards, quiz cards, hint arrows, community modal |
