#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

// ── PTY management ──────────────────────────────────────────────────────

struct PtyInstance {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
}

struct PtyManager {
    instances: Mutex<HashMap<u32, Arc<PtyInstance>>>,
    next_id: AtomicU32,
}

#[tauri::command]
fn spawn_pty(cols: u16, rows: u16, app: AppHandle, state: tauri::State<'_, PtyManager>) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("cmd.exe")
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        CommandBuilder::new(shell)
    };

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);

    let instance = Arc::new(PtyInstance {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
    });

    state
        .instances
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, instance);

    // Reader thread streams output to frontend
    let output_event = format!("pty-output-{}", id);
    let exit_event = format!("pty-exit-{}", id);
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(&output_event, &text);
                }
                Err(_) => break,
            }
        }
        let _ = app.emit(&exit_event, ());
    });

    Ok(id)
}

#[tauri::command]
fn write_to_pty(id: u32, data: String, state: tauri::State<'_, PtyManager>) -> Result<(), String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&id).ok_or("PTY not found")?.clone();
    drop(instances);

    let mut writer = instance.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn resize_pty(id: u32, cols: u16, rows: u16, state: tauri::State<'_, PtyManager>) -> Result<(), String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&id).ok_or("PTY not found")?.clone();
    drop(instances);

    let master = instance.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_pty(id: u32, state: tauri::State<'_, PtyManager>) -> Result<(), String> {
    state
        .instances
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    Ok(())
}

// ── Config management ───────────────────────────────────────────────────

fn get_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<String, String> {
    let path = get_config_path(&app)?;
    if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn save_config(config: String, app: AppHandle) -> Result<(), String> {
    let path = get_config_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_config_path_display(app: AppHandle) -> Result<String, String> {
    let path = get_config_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

// ── Main ────────────────────────────────────────────────────────────────

fn main() {
    let pty_manager = PtyManager {
        instances: Mutex::new(HashMap::new()),
        next_id: AtomicU32::new(0),
    };

    tauri::Builder::default()
        .manage(pty_manager)
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_to_pty,
            resize_pty,
            close_pty,
            load_config,
            save_config,
            get_config_path_display,
        ])
        .setup(|app| {
            use tauri::menu::{MenuBuilder, SubmenuBuilder};

            let file_menu = SubmenuBuilder::new(app, "File")
                .text("new-tab", "New Tab")
                .separator()
                .text("quit", "Exit")
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .text("copy", "Copy")
                .text("paste", "Paste")
                .separator()
                .text("select-all", "Select All")
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .text("zoom-in", "Zoom In")
                .text("zoom-out", "Zoom Out")
                .text("zoom-reset", "Reset Zoom")
                .separator()
                .text("split-toggle", "Toggle Split View")
                .build()?;

            let terminal_menu = SubmenuBuilder::new(app, "Terminal")
                .text("clear", "Clear")
                .text("reset", "Reset")
                .separator()
                .text("settings", "Settings...")
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("about", "About XTerm Rust")
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &file_menu,
                    &edit_menu,
                    &view_menu,
                    &terminal_menu,
                    &help_menu,
                ])
                .build()?;

            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => {
                app.exit(0);
            }
            id => {
                let _ = app.emit("menu-event", id);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
