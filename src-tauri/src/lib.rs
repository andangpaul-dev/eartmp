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
    // The bundled host entrypoint, shipped under resources/host/. On Windows the
    // resolver returns an extended-length path (\\?\C:\…); Node's main-module
    // resolution chokes on that prefix, so strip it.
    let server = app
        .path()
        .resolve("host/server.mjs", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve server.mjs: {e}"))?;
    let strip = |p: std::path::PathBuf| {
        let s = p.to_string_lossy();
        s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
    };
    let server_arg = strip(server);

    // Migration SQL shipped as resources/migrations/ for the first-launch
    // bootstrap (apply + seed on a fresh DB).
    let migrations = app
        .path()
        .resolve("migrations", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve migrations: {e}"))?;
    let migrations_dir = strip(migrations);

    // SQLite DB in the per-user app-data dir. Prisma resolves a RELATIVE
    // `file:` path against the schema dir, so pass an ABSOLUTE url. Create the
    // dir first — Prisma/SQLite won't create the parent.
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir: {e}"))?;
    let db_url = format!("file:{}", strip(data_dir.join("eartmp.db")));

    let (mut rx, child) = app
        .shell()
        .sidecar("eartmp-node")
        .map_err(|e| format!("sidecar: {e}"))?
        .arg(server_arg)
        .env("EARTMP_HOST_PORT", HOST_PORT)
        .env("DATABASE_URL", db_url)
        .env("EARTMP_MIGRATIONS_DIR", migrations_dir)
        // TEST BUILD: seed UAT sample data on first launch. Remove for production.
        .env("EARTMP_SEED_DEMO", "1")
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
            // Kill the sidecar when the last window closes / app exits. Take the
            // child out in an inner scope so the MutexGuard/State temporaries are
            // dropped before we use it (avoids E0597).
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                let taken = {
                    let state: State<Sidecar> = app.state();
                    let child = state.0.lock().unwrap().take();
                    child
                };
                if let Some(child) = taken {
                    let _ = child.kill();
                }
            }
        });
}
