import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ── Preset commands (edit this list to customize) ───────────────────────
const presetCommands = [
  { label: 'Clear', command: 'cls\r' },
  { label: 'Dir', command: 'dir\r' },
  { label: 'Git Status', command: 'git status\r' },
  { label: 'Git Log', command: 'git log --oneline -10\r' },
  { label: 'PWD', command: 'cd\r' },
  { label: 'NPM Install', command: 'npm install\r' },
  { label: 'Cargo Build', command: 'cargo build\r' },
];

// ── Terminal setup ──────────────────────────────────────────────────────
const terminal = new Terminal({
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace",
  theme: {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#ffffff',
    selectionBackground: '#264f78',
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
  cursorBlink: true,
  scrollback: 10000,
  allowProposedApi: true,
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

const container = document.getElementById('terminal-container');
terminal.open(container);
fitAddon.fit();

// ── WebGL GPU acceleration ──────────────────────────────────────────────
let rendererType = 'canvas';
try {
  const webglAddon = new WebglAddon();
  webglAddon.onContextLoss(() => {
    console.warn('WebGL context lost, disposing addon');
    webglAddon.dispose();
    rendererType = 'canvas (fallback)';
    updateStatusBar();
  });
  terminal.loadAddon(webglAddon);
  rendererType = 'WebGL2 (GPU)';
  console.log('WebGL2 renderer active - GPU accelerated');
} catch (e) {
  console.warn('WebGL addon failed, using canvas renderer:', e);
  rendererType = 'canvas';
}
updateStatusBar();

// ── PTY IPC ─────────────────────────────────────────────────────────────
// Send user input to Rust PTY backend
terminal.onData((data) => {
  invoke('write_to_pty', { data });
});

// Handle terminal resize → notify backend PTY
terminal.onResize(({ cols, rows }) => {
  invoke('resize_pty', { cols, rows });
  updateStatusBar();
});

// Receive PTY output from Rust backend
listen('pty-output', (event) => {
  terminal.write(event.payload);
});

// Handle PTY process exit
listen('pty-exit', () => {
  terminal.writeln('\r\n\x1b[31m[Process exited]\x1b[0m');
});

// ── Window resize handling ──────────────────────────────────────────────
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
});
resizeObserver.observe(container);

// ── Preset buttons ──────────────────────────────────────────────────────
function setupPresetBar() {
  const bar = document.getElementById('preset-bar');
  presetCommands.forEach(({ label, command }) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.title = command.replace('\r', ' [Enter]');
    btn.addEventListener('click', () => {
      invoke('write_to_pty', { data: command });
      terminal.focus();
    });
    bar.appendChild(btn);
  });
}
setupPresetBar();

// ── Menu event handling ─────────────────────────────────────────────────
listen('menu-event', (event) => {
  const menuId = event.payload;
  switch (menuId) {
    case 'copy':
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection());
      }
      break;
    case 'paste':
      navigator.clipboard.readText().then((text) => {
        invoke('write_to_pty', { data: text });
      });
      break;
    case 'select-all':
      terminal.selectAll();
      break;
    case 'clear':
      terminal.clear();
      break;
    case 'reset':
      terminal.reset();
      break;
    case 'zoom-in':
      terminal.options.fontSize = Math.min(terminal.options.fontSize + 2, 32);
      fitAddon.fit();
      break;
    case 'zoom-out':
      terminal.options.fontSize = Math.max(terminal.options.fontSize - 2, 8);
      fitAddon.fit();
      break;
    case 'zoom-reset':
      terminal.options.fontSize = 14;
      fitAddon.fit();
      break;
  }
});

// ── Status bar ──────────────────────────────────────────────────────────
function updateStatusBar() {
  document.getElementById('status-renderer').textContent = `Renderer: ${rendererType}`;
  document.getElementById('status-size').textContent = `${terminal.cols}x${terminal.rows}`;
}

// ── Init ────────────────────────────────────────────────────────────────
terminal.focus();
setTimeout(() => {
  fitAddon.fit();
  updateStatusBar();
}, 100);
