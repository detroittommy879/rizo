import { getConfig, saveConfig, applyTheme, rebuildPresetBar, applyCRTEffect } from "./main.js";
import { invoke } from "@tauri-apps/api/core";

// ── Google Fonts monospace list (curated) ────────────────────────────────

const GOOGLE_MONO_FONTS = [
  "",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Roboto Mono",
  "Ubuntu Mono",
  "IBM Plex Mono",
  "Space Mono",
  "Inconsolata",
  "Noto Sans Mono",
  "PT Mono",
  "Anonymous Pro",
  "Cousine",
  "Share Tech Mono",
  "Overpass Mono",
  "Red Hat Mono",
  "DM Mono",
  "Azeret Mono",
  "Martian Mono",
  "Geist Mono",
];

const ANSI_COLOR_NAMES = [
  ["black", "Black"],
  ["red", "Red"],
  ["green", "Green"],
  ["yellow", "Yellow"],
  ["blue", "Blue"],
  ["magenta", "Magenta"],
  ["cyan", "Cyan"],
  ["white", "White"],
  ["brightBlack", "Bright Black"],
  ["brightRed", "Bright Red"],
  ["brightGreen", "Bright Green"],
  ["brightYellow", "Bright Yellow"],
  ["brightBlue", "Bright Blue"],
  ["brightMagenta", "Bright Magenta"],
  ["brightCyan", "Bright Cyan"],
  ["brightWhite", "Bright White"],
];

// ── Settings dialog ─────────────────────────────────────────────────────

export function openSettings() {
  const config = getConfig();
  const overlay = document.getElementById("settings-overlay");
  const dialog = document.getElementById("settings-dialog");

  dialog.innerHTML = buildSettingsHTML(config);
  overlay.classList.remove("hidden");

  // Wire up tab switching
  dialog.querySelectorAll(".stab").forEach((btn) => {
    btn.addEventListener("click", () => {
      dialog
        .querySelectorAll(".stab")
        .forEach((b) => b.classList.remove("active"));
      dialog
        .querySelectorAll(".stab-content")
        .forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      dialog.querySelector(`#stab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  // Font file loader
  dialog.querySelector("#font-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fontName = `CustomFont_${Date.now()}`;
      const fontFace = new FontFace(fontName, reader.result);
      fontFace
        .load()
        .then((loaded) => {
          document.fonts.add(loaded);
          const input = dialog.querySelector("#font-family");
          input.value = `'${fontName}', monospace`;
          dialog.querySelector("#font-file-label").textContent = file.name;
        })
        .catch((err) => {
          alert("Failed to load font: " + err.message);
        });
    };
    reader.readAsArrayBuffer(file);
  });

  // Google font change -> update preview
  dialog.querySelector("#google-font")?.addEventListener("change", (e) => {
    const font = e.target.value;
    const input = dialog.querySelector("#font-family");
    if (font) {
      input.value = `'${font}', monospace`;
    }
  });

  // Gradient toggle
  dialog.querySelector("#use-gradient")?.addEventListener("change", (e) => {
    dialog
      .querySelector("#gradient-options")
      .classList.toggle("hidden", !e.target.checked);
  });

  // CRT toggle -> grey out options
  dialog.querySelector("#crt-enabled")?.addEventListener("change", (e) => {
    const opts = dialog.querySelector("#crt-options");
    if (opts) {
      opts.style.opacity = e.target.checked ? "1" : "0.5";
      opts.style.pointerEvents = e.target.checked ? "auto" : "none";
    }
  });

  // Color preview update
  dialog.querySelectorAll('input[type="color"]').forEach((input) => {
    input.addEventListener("input", () => {
      const preview = dialog.querySelector("#color-preview");
      if (preview) updateColorPreview(dialog, preview);
    });
  });

  // Show config path
  invoke("get_config_path_display").then((path) => {
    const el = dialog.querySelector("#config-path");
    if (el) el.textContent = path;
  });

  // Close
  dialog.querySelector("#settings-close").addEventListener("click", () => {
    overlay.classList.add("hidden");
  });

  // Apply
  dialog.querySelector("#settings-apply").addEventListener("click", () => {
    applySettingsFromDialog(dialog);
  });

  // Save & Close
  dialog.querySelector("#settings-save").addEventListener("click", () => {
    applySettingsFromDialog(dialog);
    saveConfig();
    overlay.classList.add("hidden");
  });

  // Click outside to close
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });

  // Escape to close
  const escHandler = (e) => {
    if (e.key === "Escape") {
      overlay.classList.add("hidden");
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  // Init preview
  const preview = dialog.querySelector("#color-preview");
  if (preview) updateColorPreview(dialog, preview);
}

function buildSettingsHTML(config) {
  const t = config.theme;
  const fontOptions = GOOGLE_MONO_FONTS.map(
    (f) =>
      `<option value="${f}" ${f === t.googleFont ? "selected" : ""}>${f || "(None - use custom)"}</option>`,
  ).join("");

  const ansiColorInputs = ANSI_COLOR_NAMES.map(
    ([key, label]) =>
      `<div class="color-row">
      <label>${label}</label>
      <input type="color" data-color="${key}" value="${t.ansiColors[key]}" />
    </div>`,
  ).join("");

  return `
    <div class="settings-header">
      <h2>Settings</h2>
      <button id="settings-close" class="settings-close-btn">&times;</button>
    </div>

    <div class="settings-tabs">
      <button class="stab active" data-tab="font">Font</button>
      <button class="stab" data-tab="colors">Colors</button>
      <button class="stab" data-tab="background">Background</button>
      <button class="stab" data-tab="window">Window</button>
      <button class="stab" data-tab="features">Features</button>
      <button class="stab" data-tab="effects">Effects</button>
    </div>

    <div class="settings-body">

      <!-- Font tab -->
      <div id="stab-font" class="stab-content active">
        <div class="setting-group">
          <h3>Google Fonts (Monospace)</h3>
          <select id="google-font">${fontOptions}</select>
        </div>
        <div class="setting-group">
          <h3>Load Font File</h3>
          <label class="file-label">
            <input type="file" id="font-file-input" accept=".ttf,.otf,.woff,.woff2" />
            <span id="font-file-label">Choose .ttf / .otf / .woff2 file...</span>
          </label>
        </div>
        <div class="setting-group">
          <h3>Font Family (CSS)</h3>
          <input type="text" id="font-family" value="${escHtml(t.fontFamily)}" class="full-width" />
        </div>
        <div class="setting-group">
          <h3>Font Size</h3>
          <input type="number" id="font-size" value="${t.fontSize}" min="8" max="40" />
        </div>
        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" id="cursor-blink" ${t.cursorBlink ? "checked" : ""} />
            Cursor Blink
          </label>
        </div>
      </div>

      <!-- Colors tab -->
      <div id="stab-colors" class="stab-content">
        <div class="setting-group">
          <h3>Terminal Colors</h3>
          <div class="color-grid">
            <div class="color-row">
              <label>Foreground</label>
              <input type="color" id="color-fg" value="${t.foreground}" />
            </div>
            <div class="color-row">
              <label>Cursor</label>
              <input type="color" id="color-cursor" value="${t.cursor}" />
            </div>
            <div class="color-row">
              <label>Selection</label>
              <input type="color" id="color-selection" value="${t.selectionBackground}" />
            </div>
          </div>
        </div>
        <div class="setting-group">
          <h3>ANSI Colors</h3>
          <div class="color-grid ansi-grid">${ansiColorInputs}</div>
        </div>
        <div class="setting-group">
          <h3>Preview</h3>
          <div id="color-preview" class="color-preview"></div>
        </div>
      </div>

      <!-- Background tab -->
      <div id="stab-background" class="stab-content">
        <div class="setting-group">
          <div class="color-row">
            <label>Background Color</label>
            <input type="color" id="color-bg" value="${t.background}" />
          </div>
        </div>
        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" id="use-gradient" ${t.useGradient ? "checked" : ""} />
            Use Gradient Background
          </label>
          <div class="dialog-note">⚠️ Note: Gradient mode disables WebGL GPU acceleration to show the gradient.</div>
        </div>
        <div id="gradient-options" class="${t.useGradient ? "" : "hidden"}">
          <div class="setting-group">
            <div class="color-row">
              <label>Gradient Start</label>
              <input type="color" id="gradient-start" value="${t.gradientStart}" />
            </div>
            <div class="color-row">
              <label>Gradient End</label>
              <input type="color" id="gradient-end" value="${t.gradientEnd}" />
            </div>
            <div class="color-row">
              <label>Gradient Color 3</label>
              <input type="color" id="gradient-color-c" value="${t.gradientColorC || "#8a2be2"}" />
            </div>
            <div class="color-row">
              <label>Gradient Color 4</label>
              <input type="color" id="gradient-color-d" value="${t.gradientColorD || "#ff1493"}" />
            </div>
            <div class="color-row">
              <label>Angle (deg)</label>
              <input type="number" id="gradient-angle" value="${t.gradientAngle}" min="0" max="360" />
            </div>
          </div>
        </div>
      </div>

      <!-- Window tab -->
      <div id="stab-window" class="stab-content">
        <div class="setting-group">
          <h3>Default Terminal Size</h3>
          <div class="size-inputs">
            <label>Columns: <input type="number" id="default-cols" value="${config.window.defaultCols}" min="40" max="400" /></label>
            <label>Rows: <input type="number" id="default-rows" value="${config.window.defaultRows}" min="10" max="200" /></label>
          </div>
          <div class="dialog-note">Applies to new tabs only</div>
        </div>
        <div class="setting-group">
          <h3>Config File Location</h3>
          <div id="config-path" class="config-path">Loading...</div>
        </div>
      </div>

      <!-- Features tab -->
      <div id="stab-features" class="stab-content">
        <div class="setting-group">
          <h3>Terminal Features</h3>
          <label class="checkbox-label">
            <input type="checkbox" id="feature-gpu" ${config.features?.gpuAcceleration !== false ? "checked" : ""} />
            Enable GPU Acceleration (WebGL)
          </label>
          <div class="dialog-note">Turn off if you experience visual glitches or cursor issues</div>
        </div>
        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" id="feature-autocomplete" ${config.features?.autocompleteSuggestions !== false ? "checked" : ""} />
            Enable command suggestions (experimental)
          </label>
          <div class="dialog-note">Show command history suggestions as you type</div>
        </div>
      </div>

      <!-- Effects tab -->
      <div id="stab-effects" class="stab-content">
        <div class="setting-group">
          <h3>Gradient Animations</h3>
          <label class="checkbox-label" style="margin-bottom: 8px;">
            <input type="checkbox" id="gradient-animation" ${t.gradientAnimation !== false ? "checked" : ""} />
            Enable Animated Psychedelic Trails
          </label>
          <div class="dialog-note">Requires Gradient Background to be enabled in Background tab.</div>
        </div>
        
        <hr style="border:0; border-top:1px solid #444; margin: 16px 0;" />
        
        <div class="setting-group">
          <h3>Retro CRT / NTSC TV Effect</h3>
          <label class="checkbox-label" style="margin-bottom: 8px;">
            <input type="checkbox" id="crt-enabled" ${config.effects?.crtEnabled ? "checked" : ""} />
            Enable 80s TV Glitch Effect
          </label>
        </div>
        
        <div id="crt-options" class="setting-group" style="display: flex; flex-direction: column; gap: 8px; opacity: ${config.effects?.crtEnabled ? "1" : "0.5"}; pointer-events: ${config.effects?.crtEnabled ? "auto" : "none"};">
          <label style="font-size: 13px; color: #ccc;">Scanline Opacity
            <input type="range" id="crt-scanlines" min="0" max="100" value="${config.effects?.crtScanlines ?? 50}" style="width: 100%; margin-top: 4px;">
          </label>
          <label style="font-size: 13px; color: #ccc;">Signal Interference (Tearing)
            <input type="range" id="crt-tearing" min="0" max="100" value="${config.effects?.crtTearing ?? 25}" style="width: 100%; margin-top: 4px;">
          </label>
          <label style="font-size: 13px; color: #ccc;">Screen Curvature
            <input type="range" id="crt-curvature" min="0" max="100" value="${config.effects?.crtCurvature ?? 50}" style="width: 100%; margin-top: 4px;">
          </label>
          <label style="font-size: 13px; color: #ccc;">Vsync Jitter
            <input type="range" id="crt-jitter" min="0" max="100" value="${config.effects?.crtJitter ?? 5}" style="width: 100%; margin-top: 4px;">
          </label>
        </div>
      </div>

    </div>

    <div class="settings-footer">
      <button id="settings-apply" class="btn">Apply</button>
      <button id="settings-save" class="btn btn-primary">Save & Close</button>
    </div>
  `;
}

function applySettingsFromDialog(dialog) {
  const config = getConfig();
  const t = config.theme;

  // Font
  t.googleFont = dialog.querySelector("#google-font").value;
  t.fontFamily = dialog.querySelector("#font-family").value;
  t.fontSize = parseInt(dialog.querySelector("#font-size").value) || 14;
  t.cursorBlink = dialog.querySelector("#cursor-blink").checked;

  // Colors
  t.foreground = dialog.querySelector("#color-fg").value;
  t.cursor = dialog.querySelector("#color-cursor").value;
  t.selectionBackground = dialog.querySelector("#color-selection").value;

  // ANSI colors
  dialog.querySelectorAll('.ansi-grid input[type="color"]').forEach((input) => {
    const key = input.dataset.color;
    if (key) t.ansiColors[key] = input.value;
  });

  // Background
  t.background = dialog.querySelector("#color-bg").value;
  t.useGradient = dialog.querySelector("#use-gradient").checked;
  t.gradientStart = dialog.querySelector("#gradient-start").value;
  t.gradientEnd = dialog.querySelector("#gradient-end").value;
  t.gradientColorC = dialog.querySelector("#gradient-color-c").value;
  t.gradientColorD = dialog.querySelector("#gradient-color-d").value;
  t.gradientAngle =
    parseInt(dialog.querySelector("#gradient-angle").value) || 135;

  // Window
  config.window.defaultCols =
    parseInt(dialog.querySelector("#default-cols").value) || 120;
  config.window.defaultRows =
    parseInt(dialog.querySelector("#default-rows").value) || 30;

  // Features
  if (!config.features) config.features = {};
  config.features.gpuAcceleration =
    dialog.querySelector("#feature-gpu")?.checked ?? true;
  config.features.autocompleteSuggestions =
    dialog.querySelector("#feature-autocomplete")?.checked ?? true;

  // Effects
  t.gradientAnimation = dialog.querySelector("#gradient-animation")?.checked ?? true;
  
  if (!config.effects) config.effects = {};
  config.effects.crtEnabled = dialog.querySelector("#crt-enabled")?.checked ?? false;
  config.effects.crtScanlines = parseInt(dialog.querySelector("#crt-scanlines")?.value) || 0;
  config.effects.crtTearing = parseInt(dialog.querySelector("#crt-tearing")?.value) || 0;
  config.effects.crtCurvature = parseInt(dialog.querySelector("#crt-curvature")?.value) || 0;
  config.effects.crtJitter = parseInt(dialog.querySelector("#crt-jitter")?.value) || 0;

  applyTheme();
  applyCRTEffect();
  rebuildPresetBar();
}

function updateColorPreview(dialog, preview) {
  const bg = dialog.querySelector("#color-bg")?.value || "#1e1e1e";
  const fg = dialog.querySelector("#color-fg")?.value || "#cccccc";
  const colors = {};
  dialog.querySelectorAll('.ansi-grid input[type="color"]').forEach((input) => {
    colors[input.dataset.color] = input.value;
  });

  preview.style.background = bg;
  preview.style.color = fg;
  preview.innerHTML = `
    <span style="color:${fg}">user@host</span><span style="color:${colors.white || "#e5e5e5"}">:</span><span style="color:${colors.blue || "#2472c8"}">~/project</span><span style="color:${fg}">$ </span><span style="color:${colors.green || "#0dbc79"}">git</span> status<br/>
    <span style="color:${colors.green || "#0dbc79"}">On branch main</span><br/>
    <span style="color:${colors.red || "#cd3131"}">modified: </span><span style="color:${fg}">src/main.rs</span><br/>
    <span style="color:${colors.yellow || "#e5e510"}">warning:</span><span style="color:${fg}"> unused variable</span><br/>
    <span style="color:${colors.cyan || "#11a8cd"}">info:</span><span style="color:${fg}"> build complete</span><br/>
    <span style="color:${colors.magenta || "#bc3fbc"}">error[E0308]:</span><span style="color:${fg}"> mismatched types</span>
  `;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
