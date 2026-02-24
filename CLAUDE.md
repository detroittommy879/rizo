# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Rizo** (also called "The Unnamed Terminal" or "XTerm Rust") is a GPU-accelerated terminal emulator built with:
- **Tauri**: Rust backend for system integration and window management
- **xterm.js**: Terminal emulation engine with WebGL2 GPU acceleration
- **Vite**: Frontend build tool

Key features:
- GPU-accelerated rendering via WebGL2
- Tabbed interface with split-view support
- Customizable themes (solid colors or gradients)
- Preset commands bar
- SSH connection presets
- WSL (Windows Subsystem for Linux) support
- Configurable font, colors, and terminal settings

## Development Commands

### Install Dependencies
```bash
npm install
```

### Development Workflow
```bash
npm run tauri dev        # Run app in development mode (hot reload)
npm run dev              # Run Vite dev server only
npm run build            # Build production version
npm run tauri build      # Build Tauri application (exe installer)
```

### Checking for Updates
```bash
npm outdated             # Check for outdated npm packages
cargo outdated           # Check for outdated Rust crates (run in src-tauri)
```

## Project Structure

### Frontend (src/)
- **main.js**: Core application logic
  - Terminal creation and tab management
  - PTY (pseudoterminal) communication with backend
  - Theme application and configuration management
  - Preset commands and SSH presets handling
  - Split view functionality

- **settings.js**: Settings UI and configuration editor
- **styles.css**: Application styling (terminal, tabs, sidebar, dialogs)

### Backend (src-tauri/)
- **src/main.rs**: Rust backend
  - PTY management using `portable-pty` crate
  - Shell detection (Windows: pwsh/powershell/cmd, macOS: zsh/bash, Linux: bash)
  - WSL availability check
  - Configuration file handling (JSON storage in app data dir)
  - Menu bar creation and event handling

- **Cargo.toml**: Rust dependencies
- **tauri.conf.json**: Tauri configuration

### Configuration
- Config stored in: `%APPDATA%/xterm-rust/config.json` (Windows) or platform-specific app data dir
- Default config defined in `src/main.js` (DEFAULT_CONFIG)

## Key Architectural Concepts

### Terminal Architecture
```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (xterm.js)                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Terminal (xterm.js) with WebGL2 addon                │  │
│  │  - Renders output                                     │  │
│  │  - Handles user input (keystrokes, mouse)             │  │
│  └───────────────────────────────────────────────────────┘  │
│              ▲                          │                   │
│              │ (events)                 │ (invoke)          │
│              │                          ▼                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Tauri Event Bridge                                    │  │
│  └───────────────────────────────────────────────────────┘  │
│              ▲                          │                   │
│              │ (emit)                  │ (command)          │
│              │                          ▼                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Rust Backend (src-tauri/src/main.rs)                 │  │
│  │  ┌───────────────────────────────────────────────────┐  │
│  │  │  PtyManager - manages PTY instances                │  │
│  │  │  - Spawns PTYs with requested shell                │  │
│  │  │  - Handles I/O between frontend and PTY            │  │
│  │  │  - Manages PTY lifecycle (create/resize/close)     │  │
│  │  └───────────────────────────────────────────────────┘  │
│  └───────────────────────────────────────────────────────┘  │
│              │                                              │
│              ▼                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  System Shell (cmd/pwsh/bash/zsh/wsl)                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow
1. User interacts with xterm.js terminal
2. Input sent to Rust backend via `invoke()` commands
3. Backend writes data to PTY
4. PTY output read by backend thread
5. Output emitted to frontend via `emit()` events
6. Frontend writes to xterm.js terminal

## Common Development Tasks

### Adding a New Command
1. Add to `src-tauri/src/main.rs` with `#[tauri::command]` attribute
2. Register in `generate_handler![]` in main()
3. Call from frontend using `invoke()` from `@tauri-apps/api/core`

### Modifying the UI
- CSS in `src/styles.css`
- DOM manipulation in `src/main.js` or `src/settings.js`
- Dialogs created dynamically using `document.createElement()`

### Updating Themes
- Default theme in `src/main.js` (DEFAULT_CONFIG.theme)
- Theme application in `applyTheme()` function
- XTerm theme built in `buildXtermTheme()`

## Build Notes

- Windows: Builds an exe installer (~7MB)
- Uses Tauri's built-in updater (config in tauri.conf.json)
- Release profile in src-tauri/Cargo.toml: strip, LTO, codegen-units=1 for small binary size