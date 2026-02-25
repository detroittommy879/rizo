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
    gradientAnimation: true,
    gradientStart: "#1a1a2e",
    gradientEnd: "#16213e",
    gradientColorC: "#8a2be2",
    gradientColorD: "#ff1493",
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
  effects: {
    crtEnabled: false,
    crtScanlines: 50,
    crtTearing: 25,
    crtCurvature: 30,
    staticEnabled: false,
    staticIntensity: 50,
    staticDensity: 60,
    staticAmplitude: 55,
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
    gpuAcceleration: true,
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

    // Ensure WebGL is active if enabled and not in gradient mode
    const wantWebgl = config.features?.gpuAcceleration !== false && !config.theme.useGradient;
    
    if (wantWebgl && !tab.webglAddon) {
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
    } else if (!wantWebgl && tab.webglAddon) {
      try {
        tab.webglAddon.dispose();
      } catch (e) {
        console.warn("Failed to dispose WebGL:", e);
      }
      tab.webglAddon = null;
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
    const { gradientStart, gradientEnd, gradientColorC, gradientColorD, gradientAngle, gradientAnimation } = config.theme;
    
    // Apply a multi-stop animated gradient using CSS variables for colors
    container.style.background = `linear-gradient(${gradientAngle}deg, ${gradientStart}, ${gradientEnd}, ${gradientColorC || "#8a2be2"}, ${gradientColorD || "#ff1493"}, ${gradientStart})`;
    
    if (gradientAnimation !== false) {
      container.style.backgroundSize = "400% 400%";
      container.style.animation = "psychedelicGradient 12s ease infinite";
      container.classList.add("psychedelic-mode");
      
      // Setup mouse move trail effect if not already setup
      if (!container._hasMouseTrail) {
        container.addEventListener("mousemove", (e) => {
          const rect = container.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          container.style.setProperty("--mouse-x", `${x}%`);
          container.style.setProperty("--mouse-y", `${y}%`);
        });
        container._hasMouseTrail = true;
      }
    } else {
      container.style.backgroundSize = "100% 100%";
      container.style.animation = "none";
      container.classList.remove("psychedelic-mode");
    }
  } else {
    // When not using gradient, apply the solid background color to the container
    container.style.background = config.theme.background;
    container.style.backgroundSize = "100% 100%";
    container.style.animation = "none";
    container.classList.remove("psychedelic-mode");
  }
}

// ── Effect 1: WebGL Analog Static Noise Overlay ─────────────────────────

let _staticGL      = null;
let _staticProg    = null;
let _staticBuf     = null;
let _staticLocs    = null;
let _staticRunning = false;
let _staticRAF     = null;
let _staticRenderFn = null;

function initStaticEffect() {
  const canvas = document.getElementById("static-canvas");
  if (!canvas) { console.error("No #static-canvas element found"); return; }

  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false });
  if (!gl) { console.warn("WebGL not available for static effect"); return; }
  _staticGL = gl;

  const vertSrc = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;
  const fragSrc = `
    precision highp float;
    uniform vec2  u_res;
    uniform float u_time;
    uniform float u_intensity;
    uniform float u_density;
    uniform float u_amplitude;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      float slow = sin(u_time * 0.31) * 0.5 + 0.5;
      float med  = sin(u_time * 0.79 + 1.0) * 0.5 + 0.5;
      vec2 base = uv * 1100.0 * u_density * (0.85 + slow * 0.3);
      float t1 = u_time * 53.0;
      float t2 = u_time * 38.0;
      float t3 = u_time * 67.0;
      float n1 = hash(base + vec2(t1, t1 * 0.73));
      float n2 = hash(base * 1.55 + vec2(t2 * 0.91, t2));
      float n3 = hash(base * 2.30 + vec2(t3, t3 * 1.17));
      float w1 = 0.50 + med  * 0.20;
      float w2 = 0.30 + slow * 0.15;
      float w3 = 1.0 - w1 - w2;
      float grain = n1*w1 + n2*w2 + n3*w3;
      grain = grain * 2.0 - 1.0;
      grain = sign(grain) * pow(abs(grain), 0.75);
      grain = grain * u_amplitude;
      grain = clamp(grain, 0.0, 1.0);
      grain = pow(grain, 1.15);
      gl_FragColor = vec4(vec3(grain), u_intensity);
    }
  `;

  function mkShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("Static shader compile error:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = mkShader(gl.VERTEX_SHADER,   vertSrc);
  const fs = mkShader(gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Static program link error:", gl.getProgramInfoLog(prog));
    return;
  }
  _staticProg = prog;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  _staticBuf = buf;

  _staticLocs = {
    pos:       gl.getAttribLocation(prog, "a_pos"),
    res:       gl.getUniformLocation(prog, "u_res"),
    time:      gl.getUniformLocation(prog, "u_time"),
    intensity: gl.getUniformLocation(prog, "u_intensity"),
    density:   gl.getUniformLocation(prog, "u_density"),
    amplitude: gl.getUniformLocation(prog, "u_amplitude"),
  };
  console.log("Static effect: WebGL initialized, locs:", _staticLocs);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + "px";
    canvas.style.height = window.innerHeight + "px";
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener("resize", resize);

  // Assign render fn FIRST so applyStaticEffect can use it immediately
  _staticRenderFn = function render(now) {
    if (!_staticRunning) return;
    const e = config.effects || {};
    const intensity = Math.max(0.05, (e.staticIntensity ?? 50) / 100 * 0.9);
    const density   = 0.4 + (e.staticDensity   ?? 60) / 100 * 1.6;
    const amplitude = 0.2 + (e.staticAmplitude ?? 55) / 100 * 1.0;

    gl.useProgram(_staticProg);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, _staticBuf);
    gl.enableVertexAttribArray(_staticLocs.pos);
    gl.vertexAttribPointer(_staticLocs.pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(_staticLocs.res,       canvas.width, canvas.height);
    gl.uniform1f(_staticLocs.time,      now * 0.001);
    gl.uniform1f(_staticLocs.intensity, intensity);
    gl.uniform1f(_staticLocs.density,   density);
    gl.uniform1f(_staticLocs.amplitude, amplitude);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    _staticRAF = requestAnimationFrame(_staticRenderFn);
  };

  // Apply now (defaults to hidden since staticEnabled:false by default)
  applyStaticEffect();
}

export function applyStaticEffect() {
  const canvas = document.getElementById("static-canvas");
  if (!canvas) return;
  const e = config.effects || {};
  const enabled = !!(e.staticEnabled);

  canvas.style.display      = enabled ? "block" : "none";
  canvas.style.mixBlendMode = "screen";
  canvas.style.opacity      = "0.9";

  if (enabled && !_staticRunning) {
    _staticRunning = true;
    if (_staticRenderFn) {
      console.log("Starting static render loop");
      requestAnimationFrame(_staticRenderFn);
    } else {
      console.warn("Static render fn not ready yet");
    }
  } else if (!enabled && _staticRunning) {
    _staticRunning = false;
    if (_staticRAF) { cancelAnimationFrame(_staticRAF); _staticRAF = null; }
  }
}

// ── Effect 2: CSS Scanlines + Phosphor Glow + animated scan bar ──────────

let _crtAnimRAF   = null;
let _crtScanPos   = 0; // 0..1 fraction of screen height, scrolling downward

function initCRTEffect() {
  applyCRTEffect();
}

function _tickCRT() {
  const overlay = document.getElementById("crt-overlay");
  if (!overlay) { _crtAnimRAF = requestAnimationFrame(_tickCRT); return; }
  const e = config.effects || {};
  if (!e.crtEnabled) { _crtAnimRAF = requestAnimationFrame(_tickCRT); return; }

  // Scroll the scan bar at ~30px/s
  _crtScanPos = (_crtScanPos + 0.003) % 1;
  overlay.style.setProperty("--scan-pos", _crtScanPos.toFixed(4));
  _crtAnimRAF = requestAnimationFrame(_tickCRT);
}

export function applyCRTEffect() {
  const e = config.effects || {};
  const container = document.getElementById("terminals-container");
  const mainContent = document.getElementById("main-content");

  let overlay = document.getElementById("crt-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "crt-overlay";
    // Place overlay INSIDE main-content so it covers only the terminal area
    mainContent.appendChild(overlay);
  }

  // Always clear terminal pane filters — no more SVG displacement
  document.querySelectorAll(".terminal-pane").forEach(pane => {
    pane.style.filter = "none";
  });

  if (e.crtEnabled) {
    overlay.style.display = "block";

    const scanlines  = e.crtScanlines ?? 50;
    const glow       = e.crtTearing   ?? 25;
    const curvature  = e.crtCurvature ?? 30;

    // Scanline CSS: repeating horizontal lines
    const scanOpacity = (scanlines / 100) * 0.45;
    overlay.style.background = `repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 3px,
      rgba(0,0,0,${scanOpacity.toFixed(3)}) 3px,
      rgba(0,0,0,${scanOpacity.toFixed(3)}) 4px
    )`;

    // Phosphor glow
    const glowPx = (glow / 100) * 18;
    const glowOpacity = (glow / 100) * 0.5;
    overlay.style.boxShadow = glowPx > 0
      ? `inset 0 0 ${glowPx}px rgba(80,255,120,${glowOpacity.toFixed(3)})`
      : "none";

    // Barrel distortion
    const curvePx = (curvature / 100) * 500;
    if (curvePx > 10) {
      const scaleFactor = 1 + (curvature / 100) * 0.02;
      container.style.perspective = `${Math.round(curvePx * 8)}px`;
      container.style.transform   = `scale(${scaleFactor.toFixed(4)})`;
      container.style.borderRadius = `${Math.round(curvature / 5)}px`;
    } else {
      container.style.perspective  = "none";
      container.style.transform    = "none";
      container.style.borderRadius = "0";
    }

    container.classList.add("crt-active");
    overlay.classList.add("crt-active");

    // Start animated scan bar loop if not running
    if (!_crtAnimRAF) _crtAnimRAF = requestAnimationFrame(_tickCRT);

  } else {
    overlay.style.display = "none";
    container.classList.remove("crt-active");
    overlay.classList.remove("crt-active");
    container.style.perspective  = "none";
    container.style.transform    = "none";
    container.style.borderRadius = "0";
    document.querySelectorAll(".terminal-pane").forEach(pane => {
      pane.style.filter = "none";
    });
    // Leave _crtAnimRAF running (it checks crtEnabled each tick)
  }
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
    windowsMode: true,
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
  
  // Static and CRT effects are applied via canvas/CSS overlays, not per-pane filters

  terminal.onResize(({ cols, rows }) => {
    invoke("resize_pty", { id: ptyId, cols, rows });
    if (activeTabId === id) updateStatusBar();
  });

  terminal.open(container);
  fitAddon.fit();

  // Refresh terminal on focus to prevent cursor glitching
  container.addEventListener("focusin", () => {
    setTimeout(() => {
      terminal.refresh(0, terminal.rows - 1);
    }, 10);
  });

  // WebGL GPU acceleration
  let webglAddon = null;
  const wantWebgl = config.features?.gpuAcceleration !== false && !config.theme.useGradient;
  if (wantWebgl) {
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

  const unlistenOutput = await listen(`pty-output-${ptyId}`, (event) => {
    terminal.write(event.payload);
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

  // Resize observer with debounce to prevent glitching on focus/blur
  let resizeTimeout;
  const ro = new ResizeObserver(() => {
    if (container.offsetWidth > 0 && container.offsetHeight > 0) {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (container.offsetWidth > 0 && container.offsetHeight > 0) {
          fitAddon.fit();
        }
      }, 50);
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
  initStaticEffect();
  initCRTEffect();
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
