// EARTMP Tauri shell — supervises the bundled Node host sidecar.
//
// On startup it picks a free loopback port, creates the main window with that
// port's API base injected BEFORE the frontend loads (so the webview never has
// to discover the port), then launches the Node sidecar (`eartmp-node`) running
// the bundled host (`host/server.mjs`) on that port. A watchdog restarts the
// sidecar if it dies unexpectedly (reusing the same port, so the injected base
// stays valid), up to a bounded number of attempts. The child is killed when the
// app exits so no orphan host outlives the window.
//
// NOTE: build per docs/packaging-runbook.md.
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Give up after this many unexpected restarts — a host that keeps dying is
/// genuinely broken, and an unbounded loop would spin forever.
const MAX_RESTARTS: u32 = 10;

#[derive(Default)]
struct Sidecar {
    child: Mutex<Option<CommandChild>>,
    shutting_down: AtomicBool,
    restarts: AtomicU32,
    port: Mutex<u16>,
}

/// Bind an OS-assigned port, read it, and release it — the host then binds it.
/// Cheaper and simpler than a stdout handshake, and lets us inject the base
/// before the window loads.
fn pick_free_port() -> Result<u16, String> {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("pick port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();
    Ok(port)
}

fn spawn_host(app: &tauri::AppHandle, port: u16) -> Result<CommandChild, String> {
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

    // Per-user log dir so the headless sidecar's output is inspectable after the
    // fact (a packaged app has no terminal).
    let log_dir = strip(data_dir.join("logs"));

    let mut cmd = app
        .shell()
        .sidecar("eartmp-node")
        .map_err(|e| format!("sidecar: {e}"))?
        .arg(server_arg)
        .env("EARTMP_HOST_PORT", port.to_string())
        .env("DATABASE_URL", db_url)
        .env("EARTMP_MIGRATIONS_DIR", migrations_dir)
        .env("EARTMP_LOG_DIR", log_dir);

    // UAT/test builds (the `uat` cargo feature, on by default): seed sample data
    // and auto-unlock the encrypted DB with the documented default passphrase so
    // testers aren't blocked. A production build (`--no-default-features`) omits
    // the sample data and requires the operator passphrase via the unlock screen.
    #[cfg(feature = "uat")]
    {
        cmd = cmd
            .env("EARTMP_SEED_DEMO", "1")
            .env("EARTMP_DB_PASSPHRASE", "eartmp-dev-passphrase");
    }
    #[cfg(not(feature = "uat"))]
    {
        cmd = cmd.env("EARTMP_REQUIRE_UNLOCK", "1");
    }

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn host: {e}"))?;

    // Drain sidecar stdout/stderr so the OS pipe never fills and blocks it, and
    // watch for unexpected termination to trigger a restart.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    eprintln!("[host] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[host] terminated: {payload:?}");
                    restart_host(&handle);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Restart the host after an unexpected exit, unless the app is shutting down or
/// we've exhausted the restart budget. Backs off linearly and reuses the same
/// port so the base injected into the webview stays valid.
fn restart_host(app: &tauri::AppHandle) {
    let state: State<Sidecar> = app.state();
    if state.shutting_down.load(Ordering::SeqCst) {
        return;
    }
    let n = state.restarts.fetch_add(1, Ordering::SeqCst) + 1;
    if n > MAX_RESTARTS {
        eprintln!("[host] exceeded {MAX_RESTARTS} restarts; giving up");
        return;
    }
    let port = *state.port.lock().unwrap();
    let backoff = Duration::from_millis(500 * u64::from(n));
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(backoff);
        let st: State<Sidecar> = handle.state();
        if st.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        match spawn_host(&handle, port) {
            Ok(child) => {
                *st.child.lock().unwrap() = Some(child);
                eprintln!("[host] restarted on port {port} (attempt {n})");
            }
            Err(e) => eprintln!("[host] restart failed: {e}"),
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch focuses the existing window instead of starting a
            // competing shell + sidecar (which would fight over the encrypted DB).
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Sidecar::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let port = pick_free_port().unwrap_or(5179);
            {
                let state: State<Sidecar> = app.state();
                *state.port.lock().unwrap() = port;
            }

            // Create the main window with the host's loopback base injected
            // before any frontend JS runs — no port-discovery handshake needed.
            let script =
                format!("window.__EARTMP_API_BASE__ = 'http://127.0.0.1:{port}/api';");
            WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                .title("EARTMP — Academic Records & Transcripts")
                .inner_size(1280.0, 820.0)
                .min_inner_size(1024.0, 680.0)
                .initialization_script(&script)
                .build()
                .map_err(|e| format!("build main window: {e}"))?;

            match spawn_host(&handle, port) {
                Ok(child) => {
                    let state: State<Sidecar> = app.state();
                    *state.child.lock().unwrap() = Some(child);
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
                    state.shutting_down.store(true, Ordering::SeqCst);
                    // Bind to a local so the MutexGuard temporary drops before
                    // `state` does at the block's end (avoids E0597).
                    let child = state.child.lock().unwrap().take();
                    child
                };
                if let Some(child) = taken {
                    let _ = child.kill();
                }
            }
        });
}
