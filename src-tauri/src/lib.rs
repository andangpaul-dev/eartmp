// EARTMP Tauri shell — supervises the bundled Node host sidecar.
//
// On startup it launches the Node sidecar (`eartmp-node`, a node runtime shipped
// as an external binary) running the bundled host (`host/server.mjs` from app
// resources) on the loopback port the webview talks to. The child is killed when
// the app exits so no orphan host outlives the window.
//
// NOTE: not compiled in the headless dev environment (no Rust toolchain). Build
// per docs/packaging-runbook.md.
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const HOST_PORT: &str = "5179";

#[derive(Default)]
struct Sidecar(Mutex<Option<CommandChild>>);

fn spawn_host(app: &tauri::AppHandle) -> Result<CommandChild, String> {
    // The bundled host entrypoint, shipped under resources/host/.
    let server = app
        .path()
        .resolve("host/server.mjs", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve server.mjs: {e}"))?;

    let (mut rx, child) = app
        .shell()
        .sidecar("eartmp-node")
        .map_err(|e| format!("sidecar: {e}"))?
        .arg(server.to_string_lossy().to_string())
        .env("EARTMP_HOST_PORT", HOST_PORT)
        .spawn()
        .map_err(|e| format!("spawn host: {e}"))?;

    // Drain sidecar stdout/stderr so the OS pipe never fills and blocks it.
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stderr(line) | CommandEvent::Stdout(line) = event {
                eprintln!("[host] {}", String::from_utf8_lossy(&line));
            }
        }
    });

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::default())
        .setup(|app| {
            let handle = app.handle().clone();
            match spawn_host(&handle) {
                Ok(child) => {
                    let state: State<Sidecar> = app.state();
                    *state.0.lock().unwrap() = Some(child);
                }
                Err(e) => eprintln!("failed to start host sidecar: {e}"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building EARTMP")
        .run(|app, event| {
            // Kill the sidecar when the last window closes / app exits.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                let state: State<Sidecar> = app.state();
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
