//! Library crate of Infinite Canvas Studio.
//!
//! Phase 0 registers a single IPC command, `append_log`, which appends
//! buffered frontend log lines to the app log file with size-based rotation.
//! Everything runs fully offline — no network access anywhere.
//!
//! The save system adds `save_text_file` / `read_text_file`: the "save at
//! address" command pair — writes and reads the `.icb` project payload at
//! an absolute user-supplied path (see `src/persistence/SaveToDisk.ts` and
//! `src/persistence/LoadFromDisk.ts`). The `tauri-plugin-dialog` plugin
//! supplies the NATIVE Windows save/open pickers so the user can browse
//! for the path instead of typing it (see `src/platform/tauri/dialog.ts`).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{Emitter, Manager};

/// Desktop AssetStore twin (فاز D1, DECISIONS #63): the `icbasset`
/// streaming protocol + the chunked asset IPC commands.
pub mod assets;

/// Rotate the log file once it grows beyond this size (5 MiB).
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// Number of rotated backups kept (`app.log.1` … `app.log.3`).
const MAX_BACKUPS: u32 = 3;

/// Appends pre-formatted log lines to the rotating app log file.
///
/// The frontend batches lines and invokes this command (see
/// `src/platform/tauri/log.ts`); rotation happens here so the WebView never
/// blocks on file system details.
#[tauri::command]
fn append_log(app: tauri::AppHandle, line: String) -> Result<(), String> {
    let dir: PathBuf = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path: PathBuf = dir.join("infinite-canvas-studio.log");
    rotate_if_needed(&path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|error| error.to_string())
}

/// Writes a UTF-8 text file to an absolute user-supplied path, creating
/// parent directories as needed. Returns the canonical path on success so
/// the frontend can report exactly where the project landed.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<String, String> {
    let target = Path::new(&path);
    if target.file_name().is_none() {
        return Err("missing file name — include the file name in the path".into());
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    fs::write(target, contents).map_err(|error| error.to_string())?;
    Ok(path)
}

/// Reads a UTF-8 text file from an absolute user-supplied path — the recall
/// twin of [`save_text_file`]. The frontend validates the `.icb` envelope
/// after reading; this command only moves bytes.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let target = Path::new(&path);
    if target.file_name().is_none() {
        return Err("missing file name — include the file name in the path".into());
    }
    fs::read_to_string(target).map_err(|error| error.to_string())
}

/// Writes a BINARY file (base64-encoded payload) to an absolute path —
/// the PNG export channel (R4.8): the WebView rasterises the image and
/// hands the bytes here after the native Save dialog picks the path.
/// Parent directories are created as needed.
#[tauri::command]
fn save_binary_file(path: String, contents: String) -> Result<String, String> {
    let target = Path::new(&path);
    if target.file_name().is_none() {
        return Err("missing file name — include the file name in the path".into());
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    let bytes = decode_base64(contents.trim())?;
    fs::write(target, bytes).map_err(|error| error.to_string())?;
    Ok(path)
}

/// Deletes a file at an absolute path (the autosave slot clear, R4.6).
/// A missing file is already "cleared" — the command is idempotent.
#[tauri::command]
fn delete_text_file(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    match fs::remove_file(target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Decodes a standard base64 string into raw bytes (no dependencies —
/// the export pipeline only ever produces well-formed padding).
///
/// # Errors
///
/// Returns a string error for characters outside the base64 alphabet or
/// an impossible length.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (index, symbol) in TABLE.iter().enumerate() {
        lookup[*symbol as usize] = index as u8;
    }
    let cleaned: Vec<u8> = input
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    if cleaned.len() % 4 == 1 {
        return Err("invalid base64 length".into());
    }
    let mut output = Vec::with_capacity(cleaned.len() / 4 * 3);
    for chunk in cleaned.chunks(4) {
        let mut indices = [0u8; 4];
        for (slot, byte) in chunk.iter().enumerate() {
            if *byte == b'=' {
                indices[slot] = 0;
                continue;
            }
            let value = lookup[*byte as usize];
            if value == 255 {
                return Err("invalid base64 character".into());
            }
            indices[slot] = value;
        }
        let triple = (u32::from(indices[0]) << 18)
            | (u32::from(indices[1]) << 12)
            | (u32::from(indices[2]) << 6)
            | u32::from(indices[3]);
        output.push((triple >> 16) as u8);
        if chunk.len() > 2 && chunk[2] != b'=' {
            output.push((triple >> 8) as u8);
        }
        if chunk.len() > 3 && chunk[3] != b'=' {
            output.push(triple as u8);
        }
    }
    Ok(output)
}

/// Renames `app.log` → `app.log.1` (shifting older backups up) when the
/// active file exceeds [`MAX_LOG_BYTES`].
fn rotate_if_needed(path: &Path) -> Result<(), String> {
    let size: u64 = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if size < MAX_LOG_BYTES {
        return Ok(());
    }
    for index in (1..MAX_BACKUPS).rev() {
        let from: PathBuf = log_backup_path(path, index);
        let to: PathBuf = log_backup_path(path, index + 1);
        if from.exists() {
            fs::rename(&from, &to).map_err(|error| error.to_string())?;
        }
    }
    let first: PathBuf = log_backup_path(path, 1);
    fs::rename(path, first).map_err(|error| error.to_string())
}

/// Builds the backup path for `app.log` (e.g. index 1 → `app.log.1`).
fn log_backup_path(path: &Path, index: u32) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "app.log".to_string());
    name.push('.');
    name.push_str(&index.to_string());
    path.with_file_name(name)
}

/// Forwards an OS-opened `.icb` path to the WebView as the `open-file`
/// event (R8.8: the file-association + second-instance channel; the
/// frontend imports it through the regular pipeline).
fn forward_open_file(app: &tauri::AppHandle, path: &str) {
    let _ = app.emit("open-file", path);
}

/// Extracts the first `.icb` argument of a launch argument list (argv
/// without the program name).
fn icb_arg_of(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".icb") && arg.len() > 4
        })
        .cloned()
}

/// Boots the Tauri WebView shell with the app window from `tauri.conf.json`.
///
/// The dialog plugin is registered BEFORE the handler so the WebView's
/// `plugin:dialog|save` / `plugin:dialog|open` calls (native Windows file
/// pickers, gated by the `dialog:default` capability) resolve at startup.
///
/// R8.5: `tauri-plugin-sql` backs the version history (`sqlite:appdata.db`,
/// `core_`-prefixed tables through the frontend DbAccess gate).
/// R8.8: `tauri-plugin-single-instance` (registered FIRST per its docs)
/// routes second launches to the running window and forwards any `.icb`
/// argument through `open-file`; the `setup` hook covers the FIRST
/// launch's own arguments (Explorer double-click cold start).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second instance asked for the app: focus the main window
            // and forward the opened file (if any).
            if let Some(webview) = app.get_webview_window("main") {
                let _ = webview.set_focus();
            }
            let forwarded_args: Vec<String> = args.iter().skip(1).cloned().collect();
            if let Some(path) = icb_arg_of(forwarded_args.as_slice()) {
                forward_open_file(app, &path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // OS browser opener (R3B.3): confirmed link opens delegate to the
        // user's default browser via `plugin:opener|open_url`.
        .plugin(tauri_plugin_opener::init())
        // SQLite storage of the version history (R8.5).
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Desktop asset serving (فاز D1): the custom `icbasset` scheme —
        // hash-in-URL, scope chain [sidecar, inbox] resolved Rust-side,
        // bounded 206 slices for media seeking. Registration is pure
        // addition: the web shell never touches this protocol.
        .register_uri_scheme_protocol(assets::ASSET_SCHEME, |ctx, request| {
            assets::serve_asset(ctx.app_handle(), request)
        })
        .invoke_handler(tauri::generate_handler![
            append_log,
            save_text_file,
            read_text_file,
            save_binary_file,
            delete_text_file,
            assets::asset_write_chunk,
            assets::asset_exists,
            assets::asset_relocate
        ])
        .setup(|app| {
            // Cold start with a file argument (Explorer double-click on an
            // associated .icb): the WebView may not be listening yet, so
            // the event is emitted immediately AND re-emitted after the
            // window has had time to attach its listener.
            let args: Vec<String> = std::env::args().skip(1).collect();
            if let Some(path) = icb_arg_of(&args) {
                let handle = app.handle().clone();
                forward_open_file(app.handle(), &path);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(2500));
                    let _ = handle.emit("open-file", path);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Infinite Canvas Studio");
}
