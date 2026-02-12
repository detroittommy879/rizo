#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::Emitter;

struct PtyState {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
}

#[tauri::command]
fn write_to_pty(data: String, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let mut writer = state.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn resize_pty(cols: u16, rows: u16, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let master = state.master.lock().map_err(|e| e.to_string())?;
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

fn main() {
    // ── Open PTY ────────────────────────────────────────────────────────
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("Failed to open PTY");

    // ── Spawn shell ─────────────────────────────────────────────────────
    let cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("cmd.exe")
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        CommandBuilder::new(shell)
    };

    let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn shell");
    drop(pair.slave);

    // ── Split PTY into reader / writer / master ─────────────────────────
    let reader = pair
        .master
        .try_clone_reader()
        .expect("Failed to get PTY reader");
    let writer = pair
        .master
        .take_writer()
        .expect("Failed to get PTY writer");

    let pty_state = PtyState {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
    };

    // ── Build Tauri app ─────────────────────────────────────────────────
    tauri::Builder::default()
        .manage(pty_state)
        .invoke_handler(tauri::generate_handler![write_to_pty, resize_pty])
        .setup(move |app| {
            // ── Menu bar ────────────────────────────────────────────────
            use tauri::menu::{MenuBuilder, SubmenuBuilder};

            let file_menu = SubmenuBuilder::new(app, "File")
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
                .build()?;

            let terminal_menu = SubmenuBuilder::new(app, "Terminal")
                .text("clear", "Clear")
                .text("reset", "Reset")
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

            // ── PTY reader thread ───────────────────────────────────────
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut reader = reader;
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&buf[..n]).to_string();
                            let _ = app_handle.emit("pty-output", &text);
                        }
                        Err(_) => break,
                    }
                }
                let _ = app_handle.emit("pty-exit", ());
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "quit" => {
                    app.exit(0);
                }
                id => {
                    let _ = app.emit("menu-event", id);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
