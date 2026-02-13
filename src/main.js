import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openSettings } from "./settings.js";

// ── Default config ──────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  theme: {
    fontFamily:
      "'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 14,
    googleFont: "",
    background: "#1e1e1e",
    foreground: "#cccccc",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "#264f78",
    useGradient: false,
    gradientStart: "#1a1a2e",
    gradientEnd: "#16213e",
    gradientAngle: 135,
    cursorBlink: true,
    ansiColors: {
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    },
  },
  presets: [
    { label: "Clear", command: "cls\r" },
    { label: "Dir", command: "dir\r" },
    { label: "Git Status", command: "git status\r" },
    { label: "Git Log", command: "git log --oneline -10\r" },
    { label: "PWD", command: "cd\r" },
  ],
  sshPresets: [],
  window: {
    defaultCols: 120,
    defaultRows: 30,
  },
  features: {
    colorTestOnStartup: true,
    autocompleteSuggestions: true,
  },
};

// ── Global state ────────────────────────────────────────────────────────

let config = structuredClone(DEFAULT_CONFIG);
const tabs = []; // { id, ptyId, terminal, fitAddon, webglAddon, container, unlisten[] }
let activeTabId = null;
let splitMode = false;
let splitSecondId = null;
let tabIdCounter = 0;
let shellInfo = null; // { defaultShell, wslAvailable, platform }
let commandHistory = []; // Array of command strings for autocomplete
let currentSuggestion = "";
let suggestionShowing = false;

// ── Config management ───────────────────────────────────────────────────

export function getConfig() {
  return config;
}

export async function loadConfig() {
  try {
    const raw = await invoke("load_config");
    if (raw) {
      const saved = JSON.parse(raw);
      config = deepMerge(structuredClone(DEFAULT_CONFIG), saved);
    }
  } catch (e) {
    console.warn("Failed to load config:", e);
  }
}

export async function saveConfig() {
  try {
    await invoke("save_config", { config: JSON.stringify(config, null, 2) });
  } catch (e) {
    console.warn("Failed to save config:", e);
  }
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ── Theme application ───────────────────────────────────────────────────

function buildXtermTheme() {
  const t = config.theme;
  // Always use transparent background for the terminal itself
  // We control the actual background (solid or gradient) on the container element
  const background = "rgba(0, 0, 0, 0)";
  return {
    background,
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.cursorAccent,
    selectionBackground: t.selectionBackground,
    black: t.ansiColors.black,
    red: t.ansiColors.red,
    green: t.ansiColors.green,
    yellow: t.ansiColors.yellow,
    blue: t.ansiColors.blue,
    magenta: t.ansiColors.magenta,
    cyan: t.ansiColors.cyan,
    white: t.ansiColors.white,
    brightBlack: t.ansiColors.brightBlack,
    brightRed: t.ansiColors.brightRed,
    brightGreen: t.ansiColors.brightGreen,
    brightYellow: t.ansiColors.brightYellow,
    brightBlue: t.ansiColors.brightBlue,
    brightMagenta: t.ansiColors.brightMagenta,
    brightCyan: t.ansiColors.brightCyan,
    brightWhite: t.ansiColors.brightWhite,
  };
}

export function applyTheme() {
  loadGoogleFont(config.theme.googleFont);
  applyGradient();
  for (const tab of tabs) {
    tab.terminal.options.theme = buildXtermTheme();
    tab.terminal.options.fontFamily = config.theme.fontFamily;
    tab.terminal.options.fontSize = config.theme.fontSize;
    tab.terminal.options.cursorBlink = config.theme.cursorBlink;

    // Ensure WebGL is active
    if (!tab.webglAddon) {
      try {
        console.log("Enabling WebGL");
        const newWebglAddon = new WebglAddon();
        newWebglAddon.onContextLoss(() => {
          newWebglAddon.dispose();
          tab.webglAddon = null;
        });
        tab.terminal.loadAddon(newWebglAddon);
        tab.webglAddon = newWebglAddon;
      } catch (e) {
        console.warn("Failed to enable WebGL:", e);
      }
    }

    tab.fitAddon.fit();
  }
}

function loadGoogleFont(fontName) {
  const link = document.getElementById("google-font-link");
  if (fontName) {
    const encoded = fontName.replace(/ /g, "+");
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
  } else {
    link.href = "";
  }
}

function applyGradient() {
  const container = document.getElementById("terminals-container");
  if (config.theme.useGradient) {
    const { gradientStart, gradientEnd, gradientAngle } = config.theme;
    container.style.background = `linear-gradient(${gradientAngle}deg, ${gradientStart}, ${gradientEnd})`;
  } else {
    // When not using gradient, apply the solid background color to the container
    container.style.background = config.theme.background;
  }
}

// ── Color test on startup ───────────────────────────────────────────────

function generateColorTest() {
  if (!config.features?.colorTestOnStartup) return "";

  const lines = [
    "\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m",
    "\x1b[1;36m║\x1b[0m  \x1b[1;33mXTerm Rust\x1b[0m - GPU-Accelerated Terminal  \x1b[1;36m║\x1b[0m",
    "\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m",
    "",
    "\x1b[1mColor Test:\x1b[0m",
    "  \x1b[30m⬤ Black      \x1b[31m⬤ Red        \x1b[32m⬤ Green      \x1b[33m⬤ Yellow\x1b[0m",
    "  \x1b[34m⬤ Blue       \x1b[35m⬤ Magenta    \x1b[36m⬤ Cyan       \x1b[37m⬤ White\x1b[0m",
    "  \x1b[1;30m⬤ Br Black   \x1b[1;31m⬤ Br Red     \x1b[1;32m⬤ Br Green   \x1b[1;33m⬤ Br Yellow\x1b[0m",
    "  \x1b[1;34m⬤ Br Blue    \x1b[1;35m⬤ Br Magenta \x1b[1;36m⬤ Br Cyan    \x1b[1;37m⬤ Br White\x1b[0m",
    "",
    "\x1b[1mStyles:\x1b[0m \x1b[1mBold\x1b[0m \x1b[2mDim\x1b[0m \x1b[3mItalic\x1b[0m \x1b[4mUnderline\x1b[0m \x1b[9mStrike\x1b[0m",
    "",
    `\x1b[32m✓\x1b[0m WebGL2 rendering enabled`,
    `\x1b[36m⚡\x1b[0m Shell: ${shellInfo?.defaultShell || "detecting..."}`,
    "",
  ];

  return lines.join("\r\n") + "\r\n";
}

// ── Tab management ──────────────────────────────────────────────────────

async function createTab(shellOverride = null) {
  const id = tabIdCounter++;
  const cols = config.window.defaultCols;
  const rows = config.window.defaultRows;

  // Spawn PTY in backend
  const ptyId = shellOverride
    ? await invoke("spawn_pty_with_shell", { cols, rows, shell: shellOverride })
    : await invoke("spawn_pty", { cols, rows });

  // Create terminal
  const terminal = new Terminal({
    fontSize: config.theme.fontSize,
    fontFamily: config.theme.fontFamily,
    theme: buildXtermTheme(),
    cursorBlink: config.theme.cursorBlink,
    scrollback: 10000,
    allowProposedApi: true,
    allowTransparency: true,
    cols,
    rows,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Create container element
  const container = document.createElement("div");
  container.className = "terminal-pane";
  container.dataset.tabId = id;
  document.getElementById("terminals-container").appendChild(container);

  terminal.open(container);
  fitAddon.fit();

  // WebGL GPU acceleration
  let webglAddon = null;
  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      webglAddon = null;
    });
    terminal.loadAddon(webglAddon);
  } catch (e) {
    console.warn(`Tab ${id}: WebGL failed, using canvas:`, e);
  }

  // Command history tracking for autocomplete
  let currentLine = "";

  // Wire PTY I/O
  terminal.onData((data) => {
    invoke("write_to_pty", { id: ptyId, data });

    // Track command history for autocomplete
    if (config.features?.autocompleteSuggestions) {
      if (data === "\r") {
        // Command submitted
        if (currentLine.trim()) {
          if (!commandHistory.includes(currentLine.trim())) {
            commandHistory.push(currentLine.trim());
            if (commandHistory.length > 1000) {
              commandHistory.shift();
            }
          }
        }
        currentLine = "";
        currentSuggestion = "";
        suggestionShowing = false;
      } else if (data === "\x7f") {
        // Backspace
        currentLine = currentLine.slice(0, -1);
        currentSuggestion = "";
        suggestionShowing = false;
      } else if (data === "\t" && currentSuggestion) {
        // Tab to accept suggestion
        const remaining = currentSuggestion.slice(currentLine.length);
        invoke("write_to_pty", { id: ptyId, data: remaining });
        currentLine = currentSuggestion;
        currentSuggestion = "";
        suggestionShowing = false;
      } else if (data.length === 1 && data >= " " && data <= "~") {
        // Printable character
        currentLine += data;

        // Find matching command in history
        const match = commandHistory.find(
          (cmd) => cmd.startsWith(currentLine) && cmd !== currentLine,
        );
        if (match) {
          currentSuggestion = match;
          // Show suggestion in gray (this is a simplified version)
          // In a full implementation, you'd use xterm addons for inline suggestions
        } else {
          currentSuggestion = "";
        }
      }
    }
  });

  terminal.onResize(({ cols, rows }) => {
    invoke("resize_pty", { id: ptyId, cols, rows });
    if (activeTabId === id) updateStatusBar();
  });

  // Flag to track if we've written the color test
  let colorTestWritten = false;

  const unlistenOutput = await listen(`pty-output-${ptyId}`, (event) => {
    terminal.write(event.payload);

    // Write color test after first output (shell prompt is ready)
    if (
      !colorTestWritten &&
      config.features?.colorTestOnStartup &&
      !shellOverride
    ) {
      colorTestWritten = true;
      // Small delay to ensure prompt is fully written
      setTimeout(() => {
        const colorTest = generateColorTest();
        if (colorTest) {
          terminal.write("\r\n" + colorTest);
        }
      }, 100);
    }
  });

  const unlistenExit = await listen(`pty-exit-${ptyId}`, () => {
    terminal.writeln("\r\n\x1b[31m[Process exited]\x1b[0m");
  });

  const tab = {
    id,
    ptyId,
    terminal,
    fitAddon,
    webglAddon,
    container,
    unlisten: [unlistenOutput, unlistenExit],
  };
  tabs.push(tab);

  // Add tab button
  addTabButton(id);
  switchTab(id);

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (container.offsetWidth > 0 && container.offsetHeight > 0) {
      fitAddon.fit();
    }
  });
  ro.observe(container);
  tab._resizeObserver = ro;

  return tab;
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  if (tabs.length <= 1) return; // Don't close last tab

  const tab = tabs[idx];
  tab.unlisten.forEach((fn) => fn());
  tab._resizeObserver?.disconnect();
  invoke("close_pty", { id: tab.ptyId });
  tab.terminal.dispose();
  tab.container.remove();
  tabs.splice(idx, 1);

  // Remove tab button
  const btn = document.querySelector(`.tab-button[data-tab-id="${id}"]`);
  if (btn) btn.remove();

  // If we closed the active tab, switch to another
  if (activeTabId === id) {
    switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
  }
  if (splitSecondId === id) {
    splitSecondId = null;
    updateTabVisibility();
  }
}

function switchTab(id) {
  activeTabId = id;
  updateTabVisibility();
  updateTabButtons();
  const tab = tabs.find((t) => t.id === id);
  if (tab) {
    setTimeout(() => {
      tab.fitAddon.fit();
      tab.terminal.focus();
      updateStatusBar();
    }, 10);
  }
}

function updateTabVisibility() {
  for (const tab of tabs) {
    if (splitMode && (tab.id === activeTabId || tab.id === splitSecondId)) {
      tab.container.classList.add("visible");
      tab.container.classList.remove("hidden-pane");
    } else if (tab.id === activeTabId) {
      tab.container.classList.add("visible");
      tab.container.classList.remove("hidden-pane");
    } else {
      tab.container.classList.remove("visible");
      tab.container.classList.add("hidden-pane");
    }
  }
  const container = document.getElementById("terminals-container");
  container.classList.toggle("split-view", splitMode && splitSecondId != null);
}

function addTabButton(id) {
  const list = document.getElementById("tab-list");
  const btn = document.createElement("div");
  btn.className = "tab-button";
  btn.dataset.tabId = id;

  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = `Tab ${id + 1}`;
  label.addEventListener("click", () => switchTab(id));

  const close = document.createElement("span");
  close.className = "tab-close";
  close.textContent = "\u00d7";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  btn.appendChild(label);
  btn.appendChild(close);
  list.appendChild(btn);
}

function updateTabButtons() {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.tabId) === activeTabId);
  });
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId);
}

// ── Split view ──────────────────────────────────────────────────────────

function toggleSplit() {
  if (splitMode) {
    splitMode = false;
    splitSecondId = null;
  } else {
    if (tabs.length >= 2) {
      splitMode = true;
      // Pick the next tab that isn't active
      splitSecondId = tabs.find((t) => t.id !== activeTabId)?.id ?? null;
    }
  }
  updateTabVisibility();
  // Re-fit all visible tabs
  for (const tab of tabs) {
    if (!tab.container.classList.contains("hidden-pane")) {
      setTimeout(() => tab.fitAddon.fit(), 50);
    }
  }
}

// ── Preset bar ──────────────────────────────────────────────────────────

export function rebuildPresetBar() {
  const bar = document.getElementById("preset-bar");
  bar.innerHTML = "";

  // Add WSL button if available
  if (shellInfo?.wslAvailable) {
    const wslBtn = document.createElement("button");
    wslBtn.className = "preset-btn";
    wslBtn.textContent = "🐧 WSL";
    wslBtn.title = "Open Windows Subsystem for Linux";
    wslBtn.style.background = "#16a34a";
    wslBtn.style.borderColor = "#15803d";
    wslBtn.addEventListener("click", () => {
      createTab("wsl.exe");
    });
    bar.appendChild(wslBtn);
  }

  config.presets.forEach(({ label, command }, i) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.title = command.replace(/\r/g, " [Enter]");
    btn.addEventListener("click", () => {
      const tab = getActiveTab();
      if (tab) {
        invoke("write_to_pty", { id: tab.ptyId, data: command });
        tab.terminal.focus();
      }
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (confirm(`Remove preset "${label}"?`)) {
        config.presets.splice(i, 1);
        saveConfig();
        rebuildPresetBar();
      }
    });
    bar.appendChild(btn);
  });

  // Add preset button
  const addBtn = document.createElement("button");
  addBtn.className = "preset-btn preset-add";
  addBtn.textContent = "+";
  addBtn.title = "Add new preset";
  addBtn.addEventListener("click", showAddPresetDialog);
  bar.appendChild(addBtn);
}

// ── SSH Sidebar ─────────────────────────────────────────────────────────

export function rebuildSSHPresets() {
  const container = document.getElementById("ssh-presets");
  container.innerHTML = "";

  if (!config.sshPresets) config.sshPresets = [];

  config.sshPresets.forEach(({ label, command }, i) => {
    const btn = document.createElement("button");
    btn.className = "ssh-preset-btn";
    btn.textContent = label;
    btn.title = command;
    btn.addEventListener("click", () => {
      const tab = getActiveTab();
      if (tab) {
        invoke("write_to_pty", { id: tab.ptyId, data: command + "\r" });
        tab.terminal.focus();
      }
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (confirm(`Remove SSH preset "${label}"?`)) {
        config.sshPresets.splice(i, 1);
        saveConfig();
        rebuildSSHPresets();
      }
    });
    container.appendChild(btn);
  });
}

function showAddSSHDialog() {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div class="mini-dialog">
      <h3>Add SSH Connection</h3>
      <label>Label:<input type="text" id="ssh-label" placeholder="e.g. Production Server" /></label>
      <label>Command:<input type="text" id="ssh-command" placeholder="e.g. ssh user@host" /></label>
      <div class="dialog-note">Enter will be added automatically</div>
      <div class="dialog-buttons">
        <button id="ssh-cancel">Cancel</button>
        <button id="ssh-ok">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const labelInput = overlay.querySelector("#ssh-label");
  const cmdInput = overlay.querySelector("#ssh-command");
  labelInput.focus();

  overlay
    .querySelector("#ssh-cancel")
    .addEventListener("click", () => overlay.remove());
  overlay.querySelector("#ssh-ok").addEventListener("click", () => {
    const label = labelInput.value.trim();
    const command = cmdInput.value.trim();
    if (label && command) {
      if (!config.sshPresets) config.sshPresets = [];
      config.sshPresets.push({ label, command });
      saveConfig();
      rebuildSSHPresets();
    }
    overlay.remove();
  });
  cmdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") overlay.querySelector("#ssh-ok").click();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById("left-sidebar");
  sidebar.classList.toggle("hidden");

  // Re-fit all visible terminals after sidebar toggle
  setTimeout(() => {
    for (const tab of tabs) {
      if (!tab.container.classList.contains("hidden-pane")) {
        tab.fitAddon.fit();
      }
    }
  }, 50);
}

function showAddPresetDialog() {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div class="mini-dialog">
      <h3>Add Preset Button</h3>
      <label>Label:<input type="text" id="preset-label" placeholder="e.g. Build" /></label>
      <label>Command:<input type="text" id="preset-command" placeholder="e.g. cargo build" /></label>
      <div class="dialog-note">Press Enter at end will be added automatically</div>
      <div class="dialog-buttons">
        <button id="preset-cancel">Cancel</button>
        <button id="preset-ok">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const labelInput = overlay.querySelector("#preset-label");
  const cmdInput = overlay.querySelector("#preset-command");
  labelInput.focus();

  overlay
    .querySelector("#preset-cancel")
    .addEventListener("click", () => overlay.remove());
  overlay.querySelector("#preset-ok").addEventListener("click", () => {
    const label = labelInput.value.trim();
    const command = cmdInput.value;
    if (label && command) {
      config.presets.push({ label, command: command + "\r" });
      saveConfig();
      rebuildPresetBar();
    }
    overlay.remove();
  });
  cmdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") overlay.querySelector("#preset-ok").click();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ── Status bar ──────────────────────────────────────────────────────────

function updateStatusBar() {
  const tab = getActiveTab();
  if (!tab) return;

  const rendererType = tab.webglAddon ? "WebGL2 (GPU)" : "canvas";
  const gradientIndicator = config.theme.useGradient ? " [Gradient]" : "";
  document.getElementById("status-renderer").textContent =
    `Renderer: ${rendererType}${gradientIndicator}`;
  document.getElementById("status-size").textContent =
    `${tab.terminal.cols}x${tab.terminal.rows}`;
  document.getElementById("status-tab").textContent =
    `Tab ${tab.id + 1} of ${tabs.length}`;
}

// ── Menu events ─────────────────────────────────────────────────────────

listen("menu-event", (event) => {
  const menuId = event.payload;
  const tab = getActiveTab();
  switch (menuId) {
    case "new-tab":
      createTab();
      break;
    case "copy":
      if (tab?.terminal.hasSelection()) {
        navigator.clipboard.writeText(tab.terminal.getSelection());
      }
      break;
    case "paste":
      if (tab) {
        navigator.clipboard.readText().then((text) => {
          invoke("write_to_pty", { id: tab.ptyId, data: text });
        });
      }
      break;
    case "select-all":
      tab?.terminal.selectAll();
      break;
    case "clear":
      tab?.terminal.clear();
      break;
    case "reset":
      tab?.terminal.reset();
      break;
    case "zoom-in":
      config.theme.fontSize = Math.min(config.theme.fontSize + 2, 40);
      applyTheme();
      break;
    case "zoom-out":
      config.theme.fontSize = Math.max(config.theme.fontSize - 2, 8);
      applyTheme();
      break;
    case "zoom-reset":
      config.theme.fontSize = 14;
      applyTheme();
      break;
    case "split-toggle":
      toggleSplit();
      break;
    case "settings":
      openSettings();
      break;
    case "about":
      alert(
        "XTerm Rust v0.1.0\nA GPU-accelerated terminal emulator\nBuilt with Tauri + xterm.js\n\nFeatures: WebGL2 rendering, tabs, custom themes, preset commands",
      );
      break;
  }
});

// ── Init ────────────────────────────────────────────────────────────────

async function init() {
  // Get shell info from backend
  try {
    shellInfo = await invoke("get_shell_info");
    console.log("Shell info:", shellInfo);
  } catch (e) {
    console.warn("Failed to get shell info:", e);
  }

  await loadConfig();
  applyGradient();
  loadGoogleFont(config.theme.googleFont);
  rebuildPresetBar();
  rebuildSSHPresets();

  // Sidebar controls
  document
    .getElementById("sidebar-toggle")
    .addEventListener("click", toggleSidebar);
  document
    .getElementById("sidebar-close")
    .addEventListener("click", toggleSidebar);
  document
    .getElementById("ssh-add")
    .addEventListener("click", showAddSSHDialog);

  // New tab button
  document
    .getElementById("tab-add")
    .addEventListener("click", () => createTab());

  // Create first tab
  await createTab();
  updateStatusBar();
}

init();
