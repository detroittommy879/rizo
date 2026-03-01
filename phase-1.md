# Phase 1 — UI/UX Polish & Session Infrastructure

> **Depends on:** Nothing (entry condition: `npm run tauri dev` compiles and runs).  
> **Unlocks:** Phase 2 (session buffer used as AI context; AI bar stub already in DOM).  
> **Goal:** App looks and feels excellent. Fonts everywhere, 20+ themes, modular rearrangeable UI, proper tiling split layout, session crash recovery.

---

## 🤖 Subagent: Full Codebase Read (run first, before any task)

> **Agent:** `Explore` or `Oracle-subagent`
>
> **Return exactly:**
>
> - Line numbers for: `buildSettingsHTML()`, every settings tab section start/end, `createTab()`, `closeTab()`, `applyTheme()`, `buildXtermTheme()`, `applySettingsFromDialog()`, `init()`
> - Full `DEFAULT_CONFIG` object verbatim
> - All options passed to `new Terminal({...})` constructor
> - CSS class names for: tab bar, tab buttons, terminal pane containers, preset bar, split toggle button
> - Full `Cargo.toml` `[dependencies]` section
> - Any existing right-click / contextmenu handlers
> - Current hardcoded scrollback line count
>
> This context is required by every task below. Do not skip.

---

## Task 1.0 — AGENTS.md Self-Improvement _(do first, ~5 min)_

**File:** `AGENTS.md`

1. Add this paragraph near the top, after the first section heading:

   > **For AI agents:** When working in this codebase, append any discoveries, gotchas, naming conventions, or workflow shortcuts to this `AGENTS.md` file. Future agents will read it before starting work, so anything you write helps them skip repeated research and avoid known pitfalls.

2. Audit `AGENTS.md` against the actual file tree — update the Project Structure section if it has drifted.

---

## Task 1.1 — Extended Font Controls (terminal text)

**Files:** `src/settings.js`, `src/main.js`

### `DEFAULT_CONFIG.theme` additions

```js
lineHeight: 1.2,
letterSpacing: 0,
fontWeight: 400,       // 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
fontWeightBold: 700,   // for bold text in terminal
```

### Settings → Font tab additions (after existing font size slider)

- **Line height** — `<input type="range" min="1.0" max="2.5" step="0.05">` + numeric readout
- **Letter spacing** — `<input type="range" min="-2" max="12" step="0.5">` + numeric readout
- **Font weight** — `<select>` with all 9 CSS weights: `100 (Hairline) / 200 (ExtraLight) / 300 (Light) / 400 (Regular) / 500 (Medium) / 600 (SemiBold) / 700 (Bold) / 800 (ExtraBold) / 900 (Black)`  
  _(Note: the selected Google Font must support the chosen weight — add a small hint label)_
- **Bold weight** — same select, for terminal bold text

### `applyTheme()` change

Pass new options to `terminal.options` for each existing tab:

```js
terminal.options.lineHeight = config.theme.lineHeight;
terminal.options.letterSpacing = config.theme.letterSpacing;
terminal.options.fontWeight = config.theme.fontWeight;
terminal.options.fontWeightBold = config.theme.fontWeightBold;
```

---

## Task 1.2 — Per-Element Fonts (fonts everywhere)

**Files:** `src/settings.js`, `src/main.js`, `src/styles.css`

### Concept

Every distinct UI region has its own font family, size, and weight — all independently set. Fonts are loaded from Google Fonts on demand.

### UI regions with their own fonts

| Region              | Config key          | Default font     |
| ------------------- | ------------------- | ---------------- |
| Terminal text       | `theme.fontFamily`  | `JetBrains Mono` |
| Tab bar labels      | `uiFonts.tabBar`    | `Inter`          |
| Preset buttons bar  | `uiFonts.presetBar` | `Inter`          |
| AI sidebar / AI bar | `uiFonts.aiPanel`   | `Inter`          |
| Settings dialog     | `uiFonts.settings`  | `Inter`          |
| Status bar          | `uiFonts.statusBar` | `Inter`          |

### `DEFAULT_CONFIG` addition

```js
uiFonts: {
  tabBar:    { family: 'Inter', size: 12, weight: 400 },
  presetBar: { family: 'Inter', size: 12, weight: 400 },
  aiPanel:   { family: 'Inter', size: 13, weight: 400 },
  settings:  { family: 'Inter', size: 13, weight: 400 },
  statusBar: { family: 'Inter', size: 11, weight: 400 },
},
```

### Google Fonts loader

Add `loadGoogleFont(family)` helper in `main.js`:

```js
function loadGoogleFont(family) {
  const id = "gfont-" + family.replace(/\s/g, "-");
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
  document.head.appendChild(link);
}
```

### CSS custom properties

In `applyTheme()`, apply UI fonts via CSS variables on `:root`:

```js
document.documentElement.style.setProperty(
  "--font-tab-bar",
  `'${cfg.tabBar.family}', sans-serif`,
);
document.documentElement.style.setProperty(
  "--font-preset-bar",
  `'${cfg.presetBar.family}', sans-serif`,
);
// ...etc
```

Use these variables in `styles.css` for the respective selectors.

### Settings — Font tab: per-element font pickers

In each font picker: a search input that filters from the bundled `GOOGLE_FONTS_LIST` array (see Font Search subagent below), plus a `size` number input and a `weight` select. One collapsible section per UI region.

---

## 🤖 Subagent: Font List Generation

> **Agent:** `Oracle-subagent`
>
> **Task:** Produce a JS file `src/fonts-list.js` that exports `const GOOGLE_FONTS_LIST` — an array of objects:
>
> ```js
> { name: "JetBrains Mono", category: "monospace", popular: true }
> ```
>
> Include:
>
> - All well-known monospace fonts available on Google Fonts (for terminal use)
> - Top ~150 popular display/sans-serif fonts (for UI regions)
> - Mark `popular: true` on the top 30 most commonly used
> - Categories: `"monospace"`, `"sans-serif"`, `"serif"`, `"display"`, `"handwriting"`
>
> No API key needed — use your knowledge of the Google Fonts catalog.
> Output: the complete JS file content, ready to create.

---

## Task 1.3 — Google Fonts Search in Font Pickers

**Files:** `src/settings.js`, `src/main.js` (imports `fonts-list.js`)

Each font picker in the settings dialog has:

1. An `<input type="text" placeholder="Search fonts or type 'top'...">`
2. A scrollable `<div class="font-dropdown-list">` that shows matching results
3. Typing filters `GOOGLE_FONTS_LIST` by name (case-insensitive substring)
4. Typing `"top"` or leaving empty shows only `popular: true` entries
5. Clicking a result: calls `loadGoogleFont(name)`, sets the picker value, shows a live preview line (small text: `"The quick brown fox"` rendered in that font)
6. Font preview uses a `<span style="font-family: ...">` rendered 500ms after selection (font may need to load)

---

## 🤖 Subagent: Theme Generation

> **Agent:** `Oracle-subagent`
>
> **Task:** Generate a JS array `const BUILT_IN_THEMES = [...]` for `src/main.js`. Each theme object must match the existing `DEFAULT_CONFIG.theme` shape precisely, plus:
>
> - `name: string` — display name
> - `description: string` — 1-sentence flavor text
> - `extras?: { [key: string]: { label, min, max, step, default } }` — optional theme-specific sliders
>
> Required themes (minimum 25):
> Dracula, Nord, Tokyo Night, Solarized Dark, Monokai, One Dark Pro, Gruvbox Dark, Synthwave84, Cyberpunk Neon, Matrix Green, Ocean Deep, Sunset Gradient, Dark Coffee, Catppuccin Mocha, Rosé Pine, Everforest, Alabaster Light, High Contrast, Neon Purple, Retro Amber, Ice Blue, Blood Moon, Poimandres, Ayu Dark, GitHub Dark, Kanagawa, Vesper.
>
> For gradient themes: set `useGradient: true` and fill all gradient fields.  
> For CRT/static themes: set `crtEnabled: true` or `staticEnabled: true` as appropriate.  
> Return the complete array literal, ready to paste.

---

## Task 1.4 — Themes Tab in Settings

**Files:** `src/settings.js`, `src/main.js`, `src/styles.css`

### `main.js`

- Add `BUILT_IN_THEMES` array (from subagent)
- Add `config.customThemes = []` to `DEFAULT_CONFIG`
- Add helper: `applyThemePreset(themeObj)` — deep-merges theme into `config.theme`, calls `applyTheme()`, saves config

### Settings — new "Themes" tab (7th, after Effects)

```
┌──────────────────────────────────────────┐
│  Theme  [──── search/dropdown ──────── ▼]│
│                          [Apply] [Reset] │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  ┌──────────────────────────────────────┐ │
│  │ $ ls -la             [mini preview]  │ │
│  │ drwxr-xr-x  5 user  ...             │ │
│  │ -rw-r--r--  1 user  main.js         │ │
│  └──────────────────────────────────────┘ │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  [ theme-specific extra sliders, if any ] │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  [Save as Custom]  [Browse Community 🔒] │
└──────────────────────────────────────────┘
```

- Dropdown: `BUILT_IN_THEMES` + separator + `config.customThemes` (user-created) + separator + `[Import from file...]`
- Mini-preview: a `<div class="theme-preview">` with hardcoded ANSI-colored fake terminal output, colored via inline CSS using the selected theme's palette values. Updates live on dropdown change.
- Extra sliders: rendered dynamically if `theme.extras` contains entries (e.g. Synthwave glow intensity)
- **Save as Custom**: prompt name → serialize current full settings state as theme → push to `config.customThemes`
- **Browse Community**: locked icon, tooltip "Coming in Phase 2" — click shows "Coming soon!" modal

### Themes also set per-element fonts

When a theme is applied, if `theme.uiFonts` is defined on the theme object, also apply those font overrides. Themes can bundle font recommendations.

---

## Task 1.5 — Animated Title Fonts ("Enhanced Titles")

**Files:** `src/settings.js`, `src/main.js`, `src/styles.css`

- `DEFAULT_CONFIG.theme.enhancedTitles = false`
- `DEFAULT_CONFIG.theme.enhancedTitleStyle = 'neon'` — options: `'neon' | 'jiggle' | 'typewriter'`
- Settings toggle in Font tab + style dropdown (visible when toggle on)
- In `createTab()`: when enabled, hook `terminal.onRender` to scan rendered lines for heuristic title patterns (ANSI bold + uppercase words ≥5 chars, or ASCII art rows)
- When matched: inject a `<div class="enhanced-title-overlay">` absolutely positioned at the line's y coordinate
- Three animation styles:
  - **Neon Glow** — SVG `<filter>` with `feGaussianBlur` + pulse `@keyframes` on `stdDeviation`
  - **Jiggle** — letters split into `<tspan>` each with a randomized `animation-delay` on a wobble transform
  - **Typewriter** — SVG `stroke-dasharray` / `stroke-dashoffset` animation on path letters
- Overlay is removed when the terminal scrolls that line out of view

---

## Task 1.6 — Modular UI / Customizable Layout Mode

**Files:** `src/main.js`, `src/styles.css`

### Concept

Users can toggle a "Customize UI" mode that shows drag handles and visibility toggles for every panel. Layout state is saved to `config.layout`.

### Panels tracked

| Panel              | ID                | Default visible              |
| ------------------ | ----------------- | ---------------------------- |
| Tab bar            | `panel-tabbar`    | true                         |
| Preset bar         | `panel-presets`   | true                         |
| Status bar         | `panel-statusbar` | true                         |
| AI quick-input bar | `panel-aibar`     | false (stub, lit in Phase 2) |
| AI sidebar         | `panel-sidebar`   | false (Phase 2)              |

### View menu additions (Tauri menu via `menu-event`)

Each panel gets a checkmark menu item in the **View** menu:

```
View
  ✓ Tab Bar           (toggle panel-tabbar)
  ✓ Preset Bar        (toggle panel-presets)
  ✓ Status Bar        (toggle panel-statusbar)
    AI Input Bar      (toggle panel-aibar)
  ────
    Customize Layout… (enters customize mode)
```

### Customize mode

- Activated by "Customize Layout…" menu item or keyboard shortcut `Ctrl+Shift+L`
- When active: each panel gets a bright dashed border + a `✕ Hide` button in its corner
- Panels can be reordered vertically by drag-and-drop (`mousedown` + `mousemove` + `mouseup` on drag handle)
- A floating "Done" button exits customize mode and saves current order/visibility to `config.layout`
- Drag-and-drop uses CSS `order` property (flexbox) for reordering — no absolute repositioning

### `config.layout` shape

```js
layout: {
  panels: {
    tabbar:    { visible: true, order: 0 },
    presets:   { visible: true, order: 1 },
    statusbar: { visible: true, order: 4 },
    aibar:     { visible: false, order: 2 },
    sidebar:   { visible: false, order: 3 },
  }
}
```

`applyLayout(config.layout)` called on startup and after any change.

---

## Task 1.7 — Tiling Split Terminal Layout (replaces current split)

**Files:** `src/main.js`, `src/styles.css`

### Problem with current split

The current `toggleSplit()` is a simple 2-pane 50/50 toggle. Replace with a proper tiling system.

### New split architecture

The terminal area is a **tile tree**: each node is either a leaf (a terminal pane) or a split container (horizontal or vertical). Implemented as a recursive flex layout.

```
┌─────────────────────────────────────────┐
│  [+H] [+V]  buttons top-right of pane  │
│  ┌──────────────┬──────────────────────┐ │
│  │   Terminal A │   Terminal B         │ │
│  │   [tab: 1]   │   [New PTY ▼]        │ │
│  │              │                      │ │
│  └──────────────┴──────────────────────┘ │
└─────────────────────────────────────────┘
```

### Tile node data structure

```js
// Leaf node
{ type: 'leaf', tabId: number | null }

// Split node
{ type: 'split', direction: 'h' | 'v', children: [TileNode, TileNode], ratio: 0.5 }
```

### Each terminal pane has a header bar with:

- **Tab dropdown** — lists all open tabs + "─── New ───" group with: `New PowerShell`, `New WSL`, `New AI Chat` (Phase 2), `New CMD`; selecting assigns that tab/shell to this pane
- **[+H]** button — splits this pane horizontally, creating a new empty pane to the right
- **[+V]** button — splits this pane vertically, creating a new empty pane below
- **[✕]** button — closes this pane (if leaf: just hides; if split: collapses to sibling)

### Empty pane state

A pane with `tabId: null` shows a placeholder:

```
┌────────────────────────────────┐
│                                │
│   Select a terminal above ↑   │
│   or open a new one            │
│                                │
└────────────────────────────────┘
```

### Divider resize

Each `split` container has a draggable divider (6px wide CSS element with `cursor: col-resize` or `row-resize`). Dragging updates `ratio` and re-renders the flex `flex-basis` of children.

### Config

`config.layout.tileTree` stores the current tile tree JSON. Restored on startup.

### Migration from old split

Remove `toggleSplit()` and the split toggle button. Keep `splitMode` variable only for backward compat during transition. The new system replaces it entirely.

---

## Task 1.8 — Session Recording & Crash Recovery

**Files:** `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src/main.js`

### Rust additions

```rust
#[tauri::command]
async fn save_session(id: String, data: String, app: AppHandle) -> Result<(), String>
// Writes to {app_data_dir}/sessions/{id}.json, creates dir if needed

#[tauri::command]
async fn load_sessions(app: AppHandle) -> Result<String, String>
// Returns JSON array: [{id, timestamp, tabCount, preview: firstFewLines}]
// Deletes sessions older than config.session.retentionDays on call

#[tauri::command]
async fn delete_session(session_id: String, app: AppHandle) -> Result<(), String>
```

Register all three in `generate_handler![]`.

### Frontend

- Per-tab rolling buffer: `tab.sessionBuffer = []`
- On `pty-output-{id}` event: push raw text to buffer. Trim to `config.session.maxLines` (default 10,000).
- Flush to disk: `setInterval(flushAllSessions, 60_000)` + flush on `closeTab()`
- Session file format: `{ version: 1, created: timestamp, tabs: [{ title, shell, lines: string[] }] }`
- On `init()`: call `load_sessions()`. If array non-empty, show restore banner:
  ```html
  <div class="restore-banner">
    <span>↩ 3 terminal sessions from last time</span>
    <button onclick="restoreSessions()">Restore Tabs</button>
    <button onclick="dismissBanner()">Dismiss</button>
  </div>
  ```
- `restoreSessions()`: for each saved tab, call `createTab()` then write buffered lines to `terminal.write()`. Does NOT re-spawn PTY for historical content — just replays, then opens a fresh PTY.

### `DEFAULT_CONFIG` addition

```js
session: {
  enabled: true,
  maxLines: 10000,
  retentionDays: 30,
  flushIntervalSec: 60,
}
```

### Settings — new "Session" section in Window tab

- Max lines to record: slider 1,000–50,000
- Retention: select (7 days / 14 days / 30 days / 90 days)
- Toggle: "Auto-save sessions"
- Button: "Clear all saved sessions" → calls `delete_session` for each

---

## Task 1.9 — Tab Bar: Two Rows & Right-Click Context Menu

**Files:** `src/main.js`, `src/styles.css`

### Two-row tab bar

Change `#tab-list` CSS:

```css
#tab-list {
  flex-wrap: wrap;
  max-height: 56px; /* ~2 rows of 26px-height tabs */
  overflow-y: auto;
  /* Remove: overflow-x: auto; white-space: nowrap; */
}
```

Add a small `⇅` wrap-toggle button at the far right of the tab bar that toggles `flex-wrap: nowrap` for users who prefer horizontal scrolling.

### Right-click context menu

In `addTabButton(id)`:

```js
btn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  showTabContextMenu(e.clientX, e.clientY, id);
});
```

`showTabContextMenu(x, y, tabId)` renders:

```
 ┌──────────────────────────┐
 │  ✎ Rename                │
 │  ❐ Duplicate tab         │
 │  ─────────────────────── │
 │  ✕ Close                 │
 │  ✕ Close others          │
 │  ✕ Close to the right    │
 │  ─────────────────────── │
 │  ★ Generate AI Summary   │  ← stub, wired in Phase 2
 └──────────────────────────┘
```

Built as a `<div class="context-menu">` (same style as existing `.mini-dialog`).  
Dismissed by click-outside or `Escape`.

---

## Task 1.10 — AI Quick-Input Bar Stub ("AI>")

**Files:** `src/main.js`, `src/styles.css`

This is the DOM stub only. The AI backend is wired in Phase 2.

### Layout

```
┌─────────────────────────────────────────────────────┐
│ AI▶  [ask a question, run a command, automate...   ]│
└─────────────────────────────────────────────────────┘
```

- A narrow bar below the terminal area (above status bar): `#ai-bar`
- `<span class="ai-bar-prefix">AI▶</span>` + `<input type="text" id="ai-bar-input" placeholder="Ask AI anything about this terminal...">`
- Hidden by default (`config.layout.panels.aibar.visible = false`)
- Toggle via View menu "AI Input Bar" + keyboard shortcut `Ctrl+Shift+A`
- On `Enter` key: stub handler logs the input, shows "AI features coming in Phase 2" toast, clears input
- Styled to match the overall dark theme; prefix `AI▶` in accent color

---

## Task 1.11 — Alternating Row Shading

**Files:** `src/main.js`, `src/styles.css`

Use the canvas overlay approach (consistent with existing CRT/static effects):

- `initRowShading(terminal, container)` — creates a canvas sized to terminal container
- Draws horizontal semi-transparent rectangles every `terminal.options.lineHeight * terminal.options.fontSize` pixels on even-numbered rows
- Updates on `terminal.onResize` and `ResizeObserver`
- Color: `config.theme.rowShadeColor` (default `rgba(255,255,255,0.03)`)
- Intensity driven by `config.theme.rowShadeAlpha` (0–1, default 0.03)

### Settings addition (Font tab)

- Toggle: "Alternating row shading"
- Slider: "Shade intensity" (0–20%, visible when toggled on)
- Color picker: "Shade color" (default near-white or near-accent)

---

## Phase 1 Verification Checklist

- [ ] `npm run tauri dev` compiles and runs with no errors after all changes
- [ ] Settings → Font tab: line height, letter spacing, all 9 weight options appear; changing any updates terminal live
- [ ] Settings → Font tab: per-element font pickers visible; typing partial name shows filtered Google Font list; typing "top" shows popular fonts
- [ ] Selecting a UI region font updates that region's font without reloading the app
- [ ] Settings → Themes tab: 25+ built-in themes in dropdown; selecting one updates mini-preview and applies to terminal
- [ ] Some themes expose extra sliders; moving a slider tweaks the theme live
- [ ] "Save as Custom" prompts for name, new theme appears in dropdown
- [ ] "Browse Community" shows "coming soon" message and does not crash
- [ ] View menu has checkmark items for each panel; unchecking hides the panel
- [ ] "Customize Layout…" enters mode with dashed borders; dragging a panel reorders it; "Done" saves and exits
- [ ] Terminal split: [+H] and [+V] buttons visible on panes; clicking creates a new blank pane
- [ ] Blank pane dropdown shows all open tabs + New PowerShell/WSL/CMD options
- [ ] Divider between split panes is draggable and adjusts ratio
- [ ] Create 3 tabs, close app, reopen → restore banner appears; Accept replays content into new tabs
- [ ] Right-click a tab → context menu with all items; Rename, Duplicate, Close Others all work
- [ ] AI Input Bar hidden by default; View → AI Input Bar shows it; Enter press shows "Phase 2" toast
- [ ] AGENTS.md has self-improvement paragraph at top
- [ ] `cargo check` in `src-tauri/` passes with no errors

---

## Key Files Modified in Phase 1

| File                    | Changes                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`             | Self-improvement paragraph                                                                                                          |
| `src/fonts-list.js`     | New file — bundled Google Fonts list                                                                                                |
| `src/main.js`           | `DEFAULT_CONFIG` additions, `applyTheme()` updates, `BUILT_IN_THEMES`, tile layout system, session buffer, AI bar stub, font loader |
| `src/settings.js`       | Themes tab, extended font controls, per-element font pickers, session section, row shading controls                                 |
| `src/styles.css`        | Theme preview, tile layout CSS, context menu, AI bar, font CSS variables, row shading canvas, customize mode overlays               |
| `src-tauri/src/main.rs` | `save_session`, `load_sessions`, `delete_session` commands                                                                          |
