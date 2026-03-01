# AGENTS.md - Rizo Terminal (XTerm Rust)

> **For AI agents:** When working in this codebase, append any discoveries, gotchas, naming conventions, or workflow shortcuts you learn to this file. Future agents will read it before starting work — anything you write helps them skip repeated research and avoid known pitfalls. The implementation roadmap lives in [PLAN.md](PLAN.md) with phase details in [phase-1.md](phase-1.md), [phase-2.md](phase-2.md), [phase-3.md](phase-3.md).

GPU-accelerated terminal emulator built with Tauri v2 (Rust) and xterm.js (WebGL2).

## Prerequisites

- **Node.js** >= 18 (tested with v25)
- **Rust** >= 1.70 (tested with 1.91)
- **pnpm** >= 9 (use pnpm, not npm — see note below)

> **Package manager note:** This project uses `pnpm`. After cloning, run `pnpm install` then `pnpm approve-builds` (required once to allow esbuild's postinstall script). Do NOT use `npm install` as it will create a `package-lock.json` and may leave `node_modules` incomplete.
>
> **`npm run tauri build -- --debug` does NOT work** — pnpm passes the `--` literally to cargo, causing an error. Use `pnpm tauri build --debug` instead.

## Quick Start

```bash
# Install frontend dependencies
pnpm install
pnpm approve-builds   # required once after first install

# Development mode (hot reload frontend + debug Rust backend)
pnpm run tauri dev

# Production build
pnpm tauri build

# Debug build (faster compile, unoptimized)
pnpm tauri build --debug
```

## Build Output

- **Debug**: `src-tauri/target/debug/xterm-rust.exe`
- **Release**: `src-tauri/target/release/xterm-rust.exe`
- **Installer bundles**: `src-tauri/target/release/bundle/` (MSI, NSIS on Windows)

## Build Commands Reference

| Command                         | What it does                                        |
| ------------------------------- | --------------------------------------------------- |
| `pnpm install`                  | Install JS dependencies (xterm.js, Tauri API, Vite) |
| `pnpm approve-builds`           | Allow esbuild postinstall (run once after install)  |
| `pnpm run dev`                  | Start Vite dev server only (port 1420)              |
| `pnpm run build`                | Build frontend to `dist/`                           |
| `pnpm run tauri dev`            | Full dev mode: Vite + Rust compile + launch app     |
| `pnpm tauri build`              | Full release build with bundled installer           |
| `pnpm tauri build --debug`      | Debug build (faster, larger binary)                 |
| `cargo check` (in `src-tauri/`) | Check Rust compiles without building                |
| `cargo build` (in `src-tauri/`) | Build Rust backend only                             |

## Project Structure

```
xterm-rust/
├── AGENTS.md                          # This file
├── package.json                       # pnpm config, JS dependencies, scripts
├── pnpm-lock.yaml                     # Locked dependency versions (pnpm)
├── vite.config.js                     # Vite dev server config (port 1420)
├── index.html                         # HTML entry point (loads src/main.js)
├── .gitignore
│
├── src/                               # ── Frontend (JavaScript) ──
│   ├── main.js                        # App entry: tabs, PTY IPC, presets, config, theme
│   ├── settings.js                    # Settings dialog: fonts, colors, background, window
│   └── styles.css                     # All UI styling (dark theme)
│
└── src-tauri/                         # ── Backend (Rust / Tauri v2) ──
    ├── Cargo.toml                     # Rust dependencies (tauri, portable-pty, serde)
    ├── Cargo.lock                     # Locked Rust dependency versions
    ├── build.rs                       # Tauri build script (required, just calls tauri_build)
    ├── tauri.conf.json                # Tauri app config (window size, app ID, build commands)
    ├── capabilities/
    │   └── default.json               # Tauri v2 permissions (core:default)
    ├── icons/
    │   └── icon.ico                   # Application icon (Windows)
    └── src/
        └── main.rs                    # All Rust code: PTY manager, config I/O, menus
```

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────┐
│  Frontend (WebView)                                  │
│                                                      │
│  ┌─────────┐    ┌──────────┐    ┌────────────────┐  │
│  │ xterm.js │◄──│ Tauri    │◄──│  Settings      │  │
│  │ Terminal │    │ Events   │    │  Dialog        │  │
│  │ (WebGL2) │    │          │    │  (settings.js) │  │
│  └────┬─────┘    └────┬─────┘    └────────────────┘  │
│       │ onData()      │ listen('pty-output-{id}')    │
│       ▼               │                              │
│  invoke('write_to_pty')│                              │
│       │               │                              │
└───────┼───────────────┼──────────────────────────────┘
        │ IPC           │ IPC Events
┌───────▼───────────────▼──────────────────────────────┐
│  Backend (Rust)                                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ PtyManager                                    │    │
│  │  instances: HashMap<u32, Arc<PtyInstance>>     │    │
│  │                                               │    │
│  │  PtyInstance {                                 │    │
│  │    writer: Mutex<Box<dyn Write + Send>>        │    │
│  │    master: Mutex<Box<dyn MasterPty + Send>>    │    │
│  │  }                                            │    │
│  └──────────────────────────────────────────────┘    │
│                    │                                  │
│                    ▼                                  │
│          ┌─────────────────┐                         │
│          │ portable-pty    │                          │
│          │ (ConPTY/Unix)   │                          │
│          └────────┬────────┘                         │
│                   ▼                                  │
│          ┌─────────────────┐                         │
│          │ cmd.exe / $SHELL│                          │
│          └─────────────────┘                         │
└──────────────────────────────────────────────────────┘
```

### Rust Backend (`src-tauri/src/main.rs`)

All Rust logic is in a single file with three sections:

**PTY Management** - Multi-instance terminal process management

- `PtyManager` holds a `HashMap<u32, Arc<PtyInstance>>` for concurrent access
- `spawn_pty(cols, rows)` -> creates PTY, spawns shell, starts reader thread, returns ID
- `write_to_pty(id, data)` -> writes user input to the PTY's stdin
- `resize_pty(id, cols, rows)` -> resizes the PTY (notifies the shell of new dimensions)
- `close_pty(id)` -> removes PTY instance, drops writer/master (process terminates)
- Each PTY has a dedicated reader thread that emits `pty-output-{id}` events to the frontend

**Config Management** - JSON config persistence

- `load_config()` -> reads `config.json` from the app data directory
- `save_config(json_string)` -> writes config to disk
- `get_config_path_display()` -> returns the config file path for the UI
- Config location: `%APPDATA%/com.xtermrust.terminal/config.json` (Windows)

**Menu Setup** - Native menu bar created in the `setup` hook

- File (New Tab, Exit), Edit (Copy, Paste, Select All), View (Zoom, Split),
  Terminal (Clear, Reset, Settings), Help (About)
- Menu events forwarded to frontend via `menu-event` Tauri event
- "Exit" handled directly in Rust via `app.exit(0)`

### Frontend (`src/`)

**`main.js`** - Application core (~1,150 lines)

- `DEFAULT_CONFIG` - complete default config object (theme, effects, features, presets, window)
- Config functions: `loadConfig()`, `saveConfig()`, `getConfig()`, `applyTheme()`
- Tab management: `createTab()`, `closeTab(id)`, `switchTab(id)`, `toggleSplit()`
  - Each tab has its own `Terminal` instance, `FitAddon`, `WebglAddon`, DOM container
  - Listens to per-PTY events (`pty-output-{id}`, `pty-exit-{id}`)
  - `ResizeObserver` per tab for auto-fitting
- Preset bar: `rebuildPresetBar()`, right-click to delete, `+` button to add
- Effects: `initStaticEffect()`, `initCRTEffect()`, `applyGradient()`
- Menu event handler dispatches to appropriate tab/action
- `init()` loads config, builds UI, creates first tab

**`settings.js`** - Settings dialog (~500 lines)

- `openSettings()` - builds and shows the modal dialog
- Six tabs: Font, Colors, Background, Window, Features, Effects
- Font: Google Fonts dropdown (20 monospace fonts), local font file upload via `FontFace` API
- Colors: `<input type="color">` pickers for fg, cursor, selection, 16 ANSI colors
- Live color preview showing sample terminal output
- Background: solid color or gradient with up to 4 stops + angle + animation toggle
- Window: default cols/rows for new tabs
- Features: GPU acceleration toggle, autocomplete toggle
- Effects: WebGL noise (static), CRT distortion sliders
- Apply (live preview) vs Save & Close (persists to disk)

**`styles.css`** - All styling (~600 lines)

- Dark theme throughout, VS Code-inspired palette
- Tab bar: horizontal scroll when many tabs, active tab highlight
- Preset bar: flex-wrap with max-height 72px, scrollable overflow
- Terminal panes: flex layout, `.split-view` shows two panes at 50% width
- Settings modal: overlay with tabbed dialog, color grids, form inputs
- Mini-dialog: used for "Add Preset" popup

### Config File Format

Saved at `%APPDATA%/com.xtermrust.terminal/config.json`:

```json
{
  "theme": {
    "fontFamily": "'JetBrains Mono', monospace",
    "fontSize": 14,
    "googleFont": "JetBrains Mono",
    "background": "#1e1e1e",
    "foreground": "#cccccc",
    "cursor": "#ffffff",
    "cursorAccent": "#000000",
    "selectionBackground": "#264f78",
    "useGradient": false,
    "gradientStart": "#1a1a2e",
    "gradientEnd": "#16213e",
    "gradientAngle": 135,
    "cursorBlink": true,
    "ansiColors": {
      "black": "#000000",
      "red": "#cd3131",
      "green": "#0dbc79",
      "yellow": "#e5e510",
      "blue": "#2472c8",
      "magenta": "#bc3fbc",
      "cyan": "#11a8cd",
      "white": "#e5e5e5",
      "brightBlack": "#666666",
      "brightRed": "#f14c4c",
      "brightGreen": "#23d18b",
      "brightYellow": "#f5f543",
      "brightBlue": "#3b8eea",
      "brightMagenta": "#d670d6",
      "brightCyan": "#29b8db",
      "brightWhite": "#ffffff"
    }
  },
  "presets": [
    { "label": "Clear", "command": "cls\r" },
    { "label": "Dir", "command": "dir\r" }
  ],
  "window": {
    "defaultCols": 120,
    "defaultRows": 30
  }
}
```

## Key Dependencies

### Rust (src-tauri/Cargo.toml)

| Crate                  | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `tauri` v2             | Desktop app framework, webview, IPC, menus                      |
| `portable-pty` v0.8    | Cross-platform PTY (ConPTY on Windows, Unix PTY on Linux/macOS) |
| `serde` / `serde_json` | Serialization for Tauri command params                          |
| `tauri-build` v2       | Build-time code generation                                      |

### JavaScript (package.json)

| Package              | Purpose                                 |
| -------------------- | --------------------------------------- |
| `@xterm/xterm` v5    | Terminal emulator component             |
| `@xterm/addon-webgl` | WebGL2 GPU-accelerated renderer         |
| `@xterm/addon-fit`   | Auto-resize terminal to container       |
| `@tauri-apps/api` v2 | Frontend IPC (invoke, listen, events)   |
| `vite` v6            | Dev server and bundler                  |
| `@tauri-apps/cli` v2 | Tauri CLI (build, dev, icon generation) |

## Tauri IPC Commands

These are the Rust functions callable from JS via `invoke()`:

| Command                   | Parameters                      | Returns         | Description                    |
| ------------------------- | ------------------------------- | --------------- | ------------------------------ |
| `spawn_pty`               | `cols: u16, rows: u16`          | `u32` (PTY ID)  | Create new PTY + shell process |
| `write_to_pty`            | `id: u32, data: String`         | `()`            | Send input to PTY stdin        |
| `resize_pty`              | `id: u32, cols: u16, rows: u16` | `()`            | Resize PTY dimensions          |
| `close_pty`               | `id: u32`                       | `()`            | Destroy PTY instance           |
| `load_config`             | (none)                          | `String` (JSON) | Read config file from disk     |
| `save_config`             | `config: String` (JSON)         | `()`            | Write config file to disk      |
| `get_config_path_display` | (none)                          | `String`        | Get config file path           |

## Tauri Events (Backend -> Frontend)

| Event             | Payload                  | Description                     |
| ----------------- | ------------------------ | ------------------------------- |
| `pty-output-{id}` | `String` (terminal text) | Shell output for a specific PTY |
| `pty-exit-{id}`   | `()`                     | Shell process exited            |
| `menu-event`      | `String` (menu item ID)  | Native menu item clicked        |

## Adding Features

### Adding a new Tauri command

1. Add `#[tauri::command] fn my_command(...)` in `src-tauri/src/main.rs`
2. Register it in `.invoke_handler(tauri::generate_handler![..., my_command])`
3. Call from JS: `import { invoke } from '@tauri-apps/api/core'; await invoke('my_command', { params })`

### Adding a new menu item

1. Add `.text("my-id", "My Label")` to the appropriate submenu in the `setup` closure
2. Handle it in `src/main.js` in the `listen('menu-event', ...)` switch statement

### Adding a new settings tab

1. Add a `<button class="stab" data-tab="mytab">` in `buildSettingsHTML()` in `settings.js`
2. Add a `<div id="stab-mytab" class="stab-content">` with the tab content
3. Read values in `applySettingsFromDialog()` and write them to `config`

### AI features (planned)

The architecture supports adding AI features:

- Add AI API calls as Tauri commands in Rust (keeps API keys server-side)
- Stream responses via Tauri events to the frontend
- Add an AI sidebar panel in the HTML/CSS alongside the terminal container
- The config system can store AI-related settings

If you want to take a screenshot of an app window, use this cli command:

appsnap -h

the full source and maybe docs are in xterm.js/ folder
