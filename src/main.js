import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openSettings } from './settings.js';

// ── Default config ──────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  theme: {
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 14,
    googleFont: '',
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#ffffff',
    cursorAccent: '#000000',
    selectionBackground: '#264f78',
    useGradient: false,
    gradientStart: '#1a1a2e',
    gradientEnd: '#16213e',
    gradientAngle: 135,
    cursorBlink: true,
    ansiColors: {
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff',
    },
  },
  presets: [
    { label: 'Clear', command: 'cls\r' },
    { label: 'Dir', command: 'dir\r' },
    { label: 'Git Status', command: 'git status\r' },
    { label: 'Git Log', command: 'git log --oneline -10\r' },
    { label: 'PWD', command: 'cd\r' },
  ],
  window: {
    defaultCols: 120,
    defaultRows: 30,
  },
};

// ── Global state ────────────────────────────────────────────────────────

let config = structuredClone(DEFAULT_CONFIG);
const tabs = [];          // { id, ptyId, terminal, fitAddon, webglAddon, container, unlisten[] }
let activeTabId = null;
let splitMode = false;
let splitSecondId = null;
let tabIdCounter = 0;

// ── Config management ───────────────────────────────────────────────────

export function getConfig() { return config; }

export async function loadConfig() {
  try {
    const raw = await invoke('load_config');
    if (raw) {
      const saved = JSON.parse(raw);
      config = deepMerge(structuredClone(DEFAULT_CONFIG), saved);
    }
  } catch (e) {
    console.warn('Failed to load config:', e);
  }
}

export async function saveConfig() {
  try {
    await invoke('save_config', { config: JSON.stringify(config, null, 2) });
  } catch (e) {
    console.warn('Failed to save config:', e);
  }
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
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
  return {
    background: t.background,
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
    tab.fitAddon.fit();
  }
}

function loadGoogleFont(fontName) {
  const link = document.getElementById('google-font-link');
  if (fontName) {
    const encoded = fontName.replace(/ /g, '+');
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
  } else {
    link.href = '';
  }
}

function applyGradient() {
  const container = document.getElementById('terminals-container');
  if (config.theme.useGradient) {
    const { gradientStart, gradientEnd, gradientAngle } = config.theme;
    container.style.background = `linear-gradient(${gradientAngle}deg, ${gradientStart}, ${gradientEnd})`;
  } else {
    container.style.background = config.theme.background;
  }
}

// ── Tab management ──────────────────────────────────────────────────────

async function createTab() {
  const id = tabIdCounter++;
  const cols = config.window.defaultCols;
  const rows = config.window.defaultRows;

  // Spawn PTY in backend
  const ptyId = await invoke('spawn_pty', { cols, rows });

  // Create terminal
  const terminal = new Terminal({
    fontSize: config.theme.fontSize,
    fontFamily: config.theme.fontFamily,
    theme: buildXtermTheme(),
    cursorBlink: config.theme.cursorBlink,
    scrollback: 10000,
    allowProposedApi: true,
    cols,
    rows,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Create container element
  const container = document.createElement('div');
  container.className = 'terminal-pane';
  container.dataset.tabId = id;
  document.getElementById('terminals-container').appendChild(container);

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

  // Wire PTY I/O
  terminal.onData((data) => {
    invoke('write_to_pty', { id: ptyId, data });
  });

  terminal.onResize(({ cols, rows }) => {
    invoke('resize_pty', { id: ptyId, cols, rows });
    if (activeTabId === id) updateStatusBar();
  });

  const unlistenOutput = await listen(`pty-output-${ptyId}`, (event) => {
    terminal.write(event.payload);
  });

  const unlistenExit = await listen(`pty-exit-${ptyId}`, () => {
    terminal.writeln('\r\n\x1b[31m[Process exited]\x1b[0m');
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
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (tabs.length <= 1) return; // Don't close last tab

  const tab = tabs[idx];
  tab.unlisten.forEach(fn => fn());
  tab._resizeObserver?.disconnect();
  invoke('close_pty', { id: tab.ptyId });
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
  const tab = tabs.find(t => t.id === id);
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
      tab.container.classList.add('visible');
      tab.container.classList.remove('hidden-pane');
    } else if (tab.id === activeTabId) {
      tab.container.classList.add('visible');
      tab.container.classList.remove('hidden-pane');
    } else {
      tab.container.classList.remove('visible');
      tab.container.classList.add('hidden-pane');
    }
  }
  const container = document.getElementById('terminals-container');
  container.classList.toggle('split-view', splitMode && splitSecondId != null);
}

function addTabButton(id) {
  const list = document.getElementById('tab-list');
  const btn = document.createElement('div');
  btn.className = 'tab-button';
  btn.dataset.tabId = id;

  const label = document.createElement('span');
  label.className = 'tab-label';
  label.textContent = `Tab ${id + 1}`;
  label.addEventListener('click', () => switchTab(id));

  const close = document.createElement('span');
  close.className = 'tab-close';
  close.textContent = '\u00d7';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  btn.appendChild(label);
  btn.appendChild(close);
  list.appendChild(btn);
}

function updateTabButtons() {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.tabId) === activeTabId);
  });
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
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
      splitSecondId = tabs.find(t => t.id !== activeTabId)?.id ?? null;
    }
  }
  updateTabVisibility();
  // Re-fit all visible tabs
  for (const tab of tabs) {
    if (!tab.container.classList.contains('hidden-pane')) {
      setTimeout(() => tab.fitAddon.fit(), 50);
    }
  }
}

// ── Preset bar ──────────────────────────────────────────────────────────

export function rebuildPresetBar() {
  const bar = document.getElementById('preset-bar');
  bar.innerHTML = '';

  config.presets.forEach(({ label, command }, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = label;
    btn.title = command.replace(/\r/g, ' [Enter]');
    btn.addEventListener('click', () => {
      const tab = getActiveTab();
      if (tab) {
        invoke('write_to_pty', { id: tab.ptyId, data: command });
        tab.terminal.focus();
      }
    });
    btn.addEventListener('contextmenu', (e) => {
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
  const addBtn = document.createElement('button');
  addBtn.className = 'preset-btn preset-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add new preset';
  addBtn.addEventListener('click', showAddPresetDialog);
  bar.appendChild(addBtn);
}

function showAddPresetDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
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

  const labelInput = overlay.querySelector('#preset-label');
  const cmdInput = overlay.querySelector('#preset-command');
  labelInput.focus();

  overlay.querySelector('#preset-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#preset-ok').addEventListener('click', () => {
    const label = labelInput.value.trim();
    const command = cmdInput.value;
    if (label && command) {
      config.presets.push({ label, command: command + '\r' });
      saveConfig();
      rebuildPresetBar();
    }
    overlay.remove();
  });
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('#preset-ok').click();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ── Status bar ──────────────────────────────────────────────────────────

function updateStatusBar() {
  const tab = getActiveTab();
  if (!tab) return;

  const rendererType = tab.webglAddon ? 'WebGL2 (GPU)' : 'canvas';
  document.getElementById('status-renderer').textContent = `Renderer: ${rendererType}`;
  document.getElementById('status-size').textContent = `${tab.terminal.cols}x${tab.terminal.rows}`;
  document.getElementById('status-tab').textContent = `Tab ${tab.id + 1} of ${tabs.length}`;
}

// ── Menu events ─────────────────────────────────────────────────────────

listen('menu-event', (event) => {
  const menuId = event.payload;
  const tab = getActiveTab();
  switch (menuId) {
    case 'new-tab':
      createTab();
      break;
    case 'copy':
      if (tab?.terminal.hasSelection()) {
        navigator.clipboard.writeText(tab.terminal.getSelection());
      }
      break;
    case 'paste':
      if (tab) {
        navigator.clipboard.readText().then((text) => {
          invoke('write_to_pty', { id: tab.ptyId, data: text });
        });
      }
      break;
    case 'select-all':
      tab?.terminal.selectAll();
      break;
    case 'clear':
      tab?.terminal.clear();
      break;
    case 'reset':
      tab?.terminal.reset();
      break;
    case 'zoom-in':
      config.theme.fontSize = Math.min(config.theme.fontSize + 2, 40);
      applyTheme();
      break;
    case 'zoom-out':
      config.theme.fontSize = Math.max(config.theme.fontSize - 2, 8);
      applyTheme();
      break;
    case 'zoom-reset':
      config.theme.fontSize = 14;
      applyTheme();
      break;
    case 'split-toggle':
      toggleSplit();
      break;
    case 'settings':
      openSettings();
      break;
    case 'about':
      alert('XTerm Rust v0.1.0\nA GPU-accelerated terminal emulator\nBuilt with Tauri + xterm.js\n\nFeatures: WebGL2 rendering, tabs, custom themes, preset commands');
      break;
  }
});

// ── Init ────────────────────────────────────────────────────────────────

async function init() {
  await loadConfig();
  applyGradient();
  loadGoogleFont(config.theme.googleFont);
  rebuildPresetBar();

  // New tab button
  document.getElementById('tab-add').addEventListener('click', () => createTab());

  // Create first tab
  await createTab();
  updateStatusBar();
}

init();
