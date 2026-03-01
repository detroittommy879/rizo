# Phase 3 — Power-User Features, Monetization & Ecosystem

> **Depends on:** Phase 2 complete. Community themes live (2.8), AI backend working (2.1), session buffer working (Phase 1).
> **Goal:** Multi-instance named workspaces, remote/mobile terminal, MCP coding agent connector, SSH key sync, custom sandboxed background effects. These are the features people pay for.

---

## 🤖 Subagent: Tauri v2 Multi-Window + Crypto Research (run before Task 3.1)

> **Agent:** `Oracle-subagent`
>
> **Return:**
>
> - How to open a second `WebviewWindow` from Rust in Tauri v2 (exact API — `WebviewWindowBuilder`, required capabilities)
> - How to pass startup config/state to a new window (URL query params? Tauri state? Event emit?)
> - How windows communicate: global events (`app.emit_all()`), or shared `State<Mutex<T>>`?
> - Can window position + size be saved/restored, and how? Any Tauri v2 API for this?
> - Any known issues with multiple WebGL renderers in the same Tauri process (shared GPU context?)
> - Best Rust crate for AES-256-GCM: `aes-gcm` (RustCrypto) vs `ring` — which is simpler for a one-off encrypt/decrypt use case? Minimal `Cargo.toml` entry for the winner.
> - Best Rust crate for QR code generation (for remote bridge auth token): `qrcode` or `fast_qr`? Return minimal usage example.

---

## Task 3.1 — Named Workspace Layouts

**Files:** `src-tauri/src/main.rs`, `src/main.js`, `src/styles.css`

### Concept

A "workspace" is a saved snapshot of: open tabs (shell types, titles), tile layout tree, window size/position, active theme, and any active font overrides. Users can save multiple named workspaces and switch between them.

### Config

```js
config.workspaces = [
  {
    name: "Dev Setup",
    windowBounds: { x: 100, y: 100, w: 1400, h: 900 },
    themePreset: "Tokyo Night",
    uiFonts: {
      /* optional override */
    },
    tileTree: {
      /* saved tile layout from Phase 1 */
    },
    tabs: [
      { title: "Server", shell: "pwsh" },
      { title: "Git", shell: "pwsh" },
      { title: "Logs", shell: "wsl" },
    ],
  },
];
```

### Rust command

```rust
#[tauri::command]
async fn open_workspace(workspace_json: String, app: AppHandle) -> Result<(), String>
```

- Deserializes workspace JSON
- Uses `WebviewWindowBuilder` to open a new window with saved bounds
- Passes workspace config as a URL query param or via `app.emit_to(label, "load-workspace", data)`

### Menu bar changes (Rust `setup` hook)

```
File
  ├─ New Tab               Ctrl+T
  ├─ New Window            Ctrl+Shift+N
  ├─ ─────────────────────
  ├─ Workspaces ▶
  │   ├─ Dev Setup
  │   ├─ Remote Work
  │   ├─ ─────────────────
  │   ├─ Save current as workspace…
  │   └─ Manage workspaces…
  └─ ...
```

### "Save current as workspace" dialog

Mini-dialog: name input → captures `getWindowBounds()` (Rust command returning current position/size), current tile tree, active theme name, tab list → pushes to `config.workspaces` → saves config.

### "Manage workspaces" dialog

Lists saved workspaces. Each row: name, edit (rename), delete, open. Reorderable by drag.

---

## Task 3.2 — Community Themes: Full Infrastructure

**Files:** Backend registry, `src/settings.js`, `src/main.js`

Phase 2 launched community themes with a static registry. Phase 3 builds the real infrastructure:

### Registry backend (minimal, outside Tauri)

A simple Node.js or Deno/Hono endpoint (or even GitHub API + a Gist-based store) that supports:

```
GET  /themes                 → paginated list with metadata
GET  /themes/{id}            → single theme JSON
POST /themes                 → submit new theme (requires auth token)
POST /themes/{id}/like       → increment like count
```

> **Note:** For Phase 3 MVP, a static GitHub-hosted JSON file updated manually is acceptable. Full dynamic API can be a post-launch addition.

### Rust command: `fetch_url(url: String) -> Result<String, String>`

A generic secure HTTP GET that only allows `https://` URLs (reject all others — SSRF prevention). Used by the community browser to fetch the registry without CORS issues.

### Community browser upgrades (from Phase 2 basic version)

- Pagination / infinite scroll
- Filter by tags (dark, light, cyberpunk, retro, minimal, etc.)
- Sort by: Popular / Newest / Most liked
- User accounts (Phase 3+): login with GitHub OAuth or email magic link to submit and like themes
- "Submit Mine" uploads the current theme to the registry endpoint

### Theme monetization hook

Premium themes: registry can flag `premium: true`. Rizo client checks a license key in `config.license` before applying premium themes. Premium themes unlocked by subscription.

---

## Task 3.3 — SSH Key Sync + Encrypted Export

**Files:** `src-tauri/src/main.rs` (or new `src-tauri/src/crypto.rs`), `src/settings.js`, `src-tauri/Cargo.toml`

### `Cargo.toml` additions

```toml
aes-gcm = "0.10"
rand = "0.8"
base64 = { version = "0.22", features = ["std"] }
```

### SSH profiles config

```js
config.sshProfiles = [
  {
    id: "uuid",
    name: "My Server",
    host: "192.168.1.10",
    user: "admin",
    port: 22,
    identityFile: "~/.ssh/id_rsa",
  },
];
```

### Rust commands

```rust
#[tauri::command]
fn encrypt_export(data: String, passphrase: String) -> Result<String, String>
// AES-256-GCM: derive key from passphrase via PBKDF2, encrypt, return base64(nonce+ciphertext)

#[tauri::command]
fn decrypt_import(encoded: String, passphrase: String) -> Result<String, String>
// Decode base64, split nonce, decrypt, return plaintext JSON
```

**Security requirements:**

- Passphrase is **never stored** anywhere — only in memory during the operation
- Key derivation: PBKDF2-HMAC-SHA256, 100,000 iterations, random 16-byte salt prepended to output
- Final encoded format: `base64(salt[16] + nonce[12] + ciphertext)`
- Wrong passphrase → `Err("Decryption failed")`, no details leaked

### Settings — new "SSH" tab

- Table of SSH profiles: add, edit, delete rows
- "Export all profiles" → encrypt with passphrase → download as `rizo-ssh.encrypted`
- "Import profiles" → file picker, passphrase prompt → decrypt → merge into config
- Optional: "Sync to URL" — POST encrypted blob to user-supplied endpoint (basic webhook sync)

---

## Task 3.4 — Remote / Mobile Terminal View

**Files:** `src-tauri/src/main.rs` (or `src-tauri/src/remote.rs`), `src-tauri/Cargo.toml`, new `remote-client/` folder

### `Cargo.toml` additions

```toml
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
sha2 = "0.10"
```

### Architecture

```
Rizo app (Rust WS server)  ←→  WebSocket  ←→  Remote client (browser xterm.js)
    127.0.0.1:{port}                              any browser, same LAN
```

### Rust command

```rust
#[tauri::command]
async fn start_remote_bridge(port: u16, app: AppHandle) -> Result<String, String>
// Starts WS server, generates a random 128-bit auth token
// Returns token as hex string for display to user
```

### Protocol (over WebSocket)

Messages are JSON. Server→client: `{ type: "output", tabId, data: string }`. Client→server: `{ type: "input", tabId, data: string }` or `{ type: "auth", token: string }` (first message must be auth).

### Security:

- Server only binds to `127.0.0.1` (loopback only — not exposed to internet)
- First message must be `{"type": "auth", "token": "..."}` — constant-time comparison
- Failed auth: close connection immediately, log attempt
- Token regenerated each time `start_remote_bridge` is called

### UI in settings / menu

- Menu: Terminal → "Start Remote Bridge…"
- Dialog shows: port, auth token, a QR code image (generated via `qrcode` crate → PNG bytes → base64 data URL), and instructions for mobile
- "Stop bridge" button
- Bridge status indicator in status bar when active: `◉ Remote: 1 client connected`

### Remote client (`remote-client/`)

A minimal Vite + xterm.js web app:

- Single page: shows auth token input if not authenticated, then terminal view
- Connects to `ws://localhost:{port}`
- Sends auth message first, then forwards keystrokes and displays output
- Tab selector if multiple tabs
- Can be opened on mobile browser via `http://localhost:{port}/client` (served by the Rust WS server as static files)

---

## Task 3.5 — MCP / Coding Agent Connector

**Files:** `src-tauri/src/main.rs` (or `src-tauri/src/mcp.rs`), `src-tauri/Cargo.toml`

### What is MCP here

A local HTTP server that coding agents (Claude Code, Cursor, Copilot Chat, etc.) can register as an MCP server. It exposes Rizo terminal state and control as MCP tools.

### `Cargo.toml` addition

```toml
tiny_http = "0.12"   # or axum/warp if already in tree
```

### Endpoints

```
GET  /health               → 200 OK (connection test)
GET  /mcp/list_tabs        → JSON: [{ id, title, ptyId, shellType }]
GET  /mcp/get_output/{id}  → JSON: { lines: string[], lineCount: int }
POST /mcp/send_input/{id}  → body: { data: string } → write to PTY; returns 200
GET  /mcp/screenshot       → PNG base64 of current window
GET  /mcp/get_env/{id}     → returns current working dir if available
```

### Authentication

- Bearer token in `Authorization` header (same token model as remote bridge)
- Token shown in Settings → Developer → "MCP Token" + regenerate button
- Reject all requests without valid token with 401

### MCP tool definitions (returned from `/mcp/manifest`)

```json
{
  "tools": [
    { "name": "get_terminal_output", "description": "Get the last N lines of terminal output from a tab", "inputSchema": {...} },
    { "name": "send_terminal_input", "description": "Send a command or keystrokes to a terminal tab", "inputSchema": {...} },
    { "name": "list_terminal_tabs", "description": "List all open terminal tabs", "inputSchema": {} },
    { "name": "take_screenshot", "description": "Capture current terminal window as PNG", "inputSchema": {} }
  ]
}
```

### How to use (instructions for user)

In Claude Code: add MCP server `http://localhost:{port}` with token.  
In Cursor: same process via MCP settings.

---

## Task 3.6 — Custom Sandboxed Background Effects

**Files:** `src/main.js`, `src/settings.js`, `src/styles.css`

This is the "type your own crazy background code" feature. Safety is non-negotiable — no arbitrary JS eval.

### Phase 3 approach: parameterized effect engine (safe)

Instead of executing user code, provide a rich **effect parameter language**: a small JSON/object config that drives a safe built-in effect renderer. Users describe _what they want_ via params, not via code.

```js
// User types this (JSON5-like, parsed safely)
{
  effect: "matrix-rain",
  chars: "アイウエオカキクケコ0123456789ABCDEF",
  speed: 1.5,
  color: "#00ff41",
  density: 0.7,
  fadeAlpha: 0.05
}
```

Built-in effect types with their parameters:
| Effect | Parameters |
|--------|-----------|
| `matrix-rain` | chars, speed, color, density, fadeAlpha |
| `particle-field` | count, speed, color, connectRadius, shape |
| `plasma-waves` | frequency, amplitude, colorA, colorB, speed |
| `starfield` | count, speed, twinkle, colorA, colorB |
| `fire` | intensity, colorA, colorB, spread |
| `ascii-noise` | chars, speed, colorA, colorB, scale |
| `custom-text-rain` | text (any string), speed, color, fontSize |

`custom-text-rain` lets users put ANY text (their name, a quote, whatever) as the falling characters — this is the "type custom anything" request, safely handled.

### Settings UI

In Effects tab (existing), add a new section:

```
Background Effect
  Type   [matrix-rain         ▼]

  Chars  [アイウエオ0123456789  ]  ← editable text field, sanitized
  Speed  [──────●──────]
  Color  [■ #00ff41]
  Density [──●────────]

  [Preview]    [Apply]
```

The input text field for `chars` / `text` is sanitized: only printable Unicode characters allowed. No `<`, `>`, `"`, `'`, `;` (XSS prevention). Max 500 chars.

The effect renderer is a canvas `AnimationLoop` class (similar to existing `initStaticEffect()`). No `eval()`, `new Function()`, or dynamic code execution anywhere.

### Phase 3+ stretch goal (out of scope for this phase, document only)

A future version could allow a sandboxed `<iframe sandbox="allow-scripts">` containing a user's canvas sketch. The iframe has no `allow-same-origin` so it cannot access parent DOM. Communication only via `postMessage` with an allowlist of commands. This would enable true user-defined animations while remaining safe.

---

## 🤖 Subagent: Market Research (if not done in Phase 2)

> **Agent:** `Oracle-subagent`
>
> See Phase 2 Subagent Market Research task for full prompt. If not yet run, run it now.
> Output should be saved as `MARKET_RESEARCH.md` in the repo root.

---

## Phase 3 Verification Checklist

- [ ] `npm run tauri dev` compiles with all new Rust modules
- [ ] File → Workspaces → "Save current as workspace…" → dialog appears, saves workspace name
- [ ] Saved workspace appears in File → Workspaces menu
- [ ] Clicking workspace in menu opens new window with restored tab count and layout
- [ ] Community themes: "Submit Mine" uploads theme to registry; themes from registry appear in browser
- [ ] Premium theme flag: theme marked `premium: true` requires valid `config.license` to apply
- [ ] SSH profiles: add a profile → export with passphrase → `.encrypted` file downloads (inspect: not plaintext JSON)
- [ ] Import `.encrypted` file with correct passphrase → profiles restored; wrong passphrase → clear error message, no crash
- [ ] Terminal → "Start Remote Bridge…" → dialog shows port, QR code, instructions
- [ ] Open `http://localhost:{port}/client` in a browser → auth token input appears → enter token → terminal output visible
- [ ] Typing in browser xterm sends keystrokes to Rizo PTY
- [ ] Settings → Developer: MCP token shown; "Test" button verifies server responds
- [ ] Add MCP server to Claude Code pointing at local port → `list_terminal_tabs` returns current tab list
- [ ] MCP `send_terminal_input` from Claude Code executes in terminal
- [ ] Effects tab: change effect type to `matrix-rain`, change chars field and color → preview updates live
- [ ] `custom-text-rain` with user's name as text → name falls on background
- [ ] Entering `<script>` in chars field: sanitized to remove angle brackets, no XSS

---

## Key Files Modified in Phase 3

| File                      | Changes                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `src-tauri/src/main.rs`   | `mod remote; mod mcp; mod crypto;` declarations, workspace commands, `fetch_url` |
| `src-tauri/src/crypto.rs` | New — encrypt/decrypt with AES-256-GCM                                           |
| `src-tauri/src/remote.rs` | New — WebSocket bridge server, protocol handler                                  |
| `src-tauri/src/mcp.rs`    | New — local HTTP MCP server                                                      |
| `src-tauri/Cargo.toml`    | `aes-gcm`, `rand`, `base64`, `tokio-tungstenite`, `sha2`, `tiny_http`            |
| `src/main.js`             | Workspace save/restore, parameterized effects engine                             |
| `src/settings.js`         | SSH tab, workspace manager dialog, effects params UI, developer/MCP tab          |
| `src/styles.css`          | Workspace dialog, SSH profiles table, bridge status indicator                    |
| `remote-client/`          | New minimal Vite project for mobile/browser client                               |
