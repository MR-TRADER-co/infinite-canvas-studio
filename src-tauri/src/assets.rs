//! Desktop media AssetStore twin — the `icbasset` protocol + the asset
//! IPC commands (فاز D1, DECISIONS #63).
//!
//! The WEB shell keeps asset bytes on the Next.js server (`/api/assets/*`
//! routes guarded by `lib/serverAssets.ts`). The DESKTOP shell has no
//! server, so the same contract is served natively, mirroring the guards
//! of the server routes byte-for-byte:
//!
//! - **IPC writes**: `asset_write_chunk` streams one base64 chunk at an
//!   absolute byte offset — a multi-hundred-MB video never sits inside a
//!   single IPC payload, and offsets make an interrupted import safely
//!   resumable (content addressing guarantees every offset always
//!   receives the same bytes for the same hash).
//! - **Reads stream through the custom `icbasset` scheme**: the URL
//!   carries ONLY the hash (+ optional `project`/`mime` query), so a
//!   Save-As relocation never invalidates a URL; the handler resolves
//!   the scope chain [project sidecar, inbox] itself and answers
//!   `Range` requests with bounded 206 slices — `<video>` seeking works
//!   without ever buffering the whole file.
//! - **The inbox** lives at `<appData>/media-inbox` (the A.2.1 desktop
//!   twin of the web shell's server-side inbox): unsaved-project imports
//!   survive reboots there, and the first Save As MOVES them into the
//!   `<project>.icb.assets` sidecar (later Save As COPIES — the old
//!   project keeps resolving).
//!
//! Guards: asset file names must be exactly 64 lower-case hex chars
//! (SHA-256, verified without regex), and sidecar scopes must end with
//! the `.assets` suffix — the Rust-side mirror of `assetPaths.ts`.

use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use tauri::http::Response;
use tauri::{AppHandle, Manager, Runtime};

/// The custom scheme the WebView loads assets through. On Windows the
/// URL renders as `http://icbasset.localhost/<hash>`; on macOS/Linux as
/// `icbasset://localhost/<hash>` (wry's platform mapping — the TS twin
/// builds both through `__TAURI_INTERNALS__.convertFileSrc`).
pub const ASSET_SCHEME: &str = "icbasset";

/// Largest body ONE protocol response carries (8 MiB). Open-ended
/// `Range` requests are answered as bounded partial slices, so media
/// buffering advances chunk-by-chunk instead of loading whole files.
const RESPONSE_SLICE_CAP: u64 = 8 * 1024 * 1024;

/// The media-inbox directory under the app-data dir (A.2.1's desktop
/// twin — persistent across reboots, unlike the web shell's tmpdir).
fn inbox_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("media-inbox")
}

/// Whether `name` is a well-formed SHA-256 asset file name
/// (exactly 64 lower-case hex characters).
fn is_valid_hash_name(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// Whether `dir` is a legal sidecar scope (`<project>.icb.assets`).
fn is_sidecar_dir(dir: &Path) -> bool {
    dir.extension()
        .map(|ext| ext == "assets")
        .unwrap_or(false)
}

/// Resolves one asset path inside a scope (`None` = the inbox).
fn scope_path<R: Runtime>(
    app: &AppHandle<R>,
    scope: Option<&str>,
    hash: &str,
) -> Result<PathBuf, String> {
    if !is_valid_hash_name(hash) {
        return Err("invalid asset hash".into());
    }
    match scope {
        None => Ok(inbox_dir(app).join(hash)),
        Some(dir) => {
            let sidecar = PathBuf::from(dir);
            if !is_sidecar_dir(&sidecar) {
                return Err("asset scope must be a .assets sidecar".into());
            }
            Ok(sidecar.join(hash))
        }
    }
}

/// Writes ONE chunk of an asset at the absolute byte offset (base64).
///
/// Chunked writes keep every IPC payload small — a 500 MB video streams
/// through ~125 sequential calls — and offsets make a crashed import
/// safely resumable: content addressing means every offset always
/// receives the same bytes for the same hash.
#[tauri::command]
pub fn asset_write_chunk(
    app: AppHandle,
    scope: Option<String>,
    hash: String,
    offset: u64,
    contents: String,
) -> Result<(), String> {
    let target = scope_path(&app, scope.as_deref(), &hash)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = crate::decode_base64(contents.trim())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(&target)
        .map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(())
}

/// Whether the asset exists anywhere in the scope chain
/// [sidecar (when saved), inbox].
#[tauri::command]
pub fn asset_exists<R: Runtime>(
    app: AppHandle<R>,
    scope: Option<String>,
    hash: String,
) -> bool {
    if !is_valid_hash_name(&hash) {
        return false;
    }
    if let Some(dir) = &scope {
        if PathBuf::from(dir).join(&hash).is_file() {
            return true;
        }
    }
    inbox_dir(&app).join(&hash).is_file()
}

/// Relocates assets between scopes (A.2.1): `move` on the FIRST Save As
/// (inbox → sidecar — those files belonged to no project), `copy` on
/// later ones (the old project keeps resolving). Returns the MISSING
/// hashes; already-relocated targets count as success (idempotent).
#[tauri::command]
pub fn asset_relocate<R: Runtime>(
    app: AppHandle<R>,
    from_scope: Option<String>,
    to_scope: String,
    hashes: Vec<String>,
    mode: String,
) -> Result<Vec<String>, String> {
    let target_dir = PathBuf::from(&to_scope);
    if !is_sidecar_dir(&target_dir) {
        return Err("relocation target must be a .assets sidecar".into());
    }
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let mut missing: Vec<String> = Vec::new();
    for hash in hashes {
        if !is_valid_hash_name(&hash) {
            missing.push(hash);
            continue;
        }
        let source = match &from_scope {
            Some(dir) => PathBuf::from(dir).join(&hash),
            None => inbox_dir(&app).join(&hash),
        };
        let target = target_dir.join(&hash);
        if target.is_file() {
            continue;
        }
        if !source.is_file() {
            missing.push(hash);
            continue;
        }
        let relocated = if mode == "move" {
            // rename() can fail across volumes (app-data → any user
            // drive) — the copy-and-remove fallback covers it.
            fs::rename(&source, &target).or_else(|_| copy_and_remove(&source, &target))
        } else {
            fs::copy(&source, &target).map(|_| ())
        };
        if relocated.is_err() {
            missing.push(hash);
        }
    }
    Ok(missing)
}

/// Serves one `icbasset` request: `/<hash>?project=<icb>&mime=<type>`.
///
/// The URL carries only the hash, so relocations never change URLs; the
/// handler resolves the scope chain [project sidecar, inbox] itself and
/// streams `Range` requests as bounded 206 slices. A missing asset is a
/// plain 404 — the renderer's dashed placeholder (A.2.1) — never an
/// error page.
pub fn serve_asset<R: Runtime>(
    app: &AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri = request.uri().clone();
    let hash = uri.path().trim_start_matches('/').to_string();
    if !is_valid_hash_name(&hash) {
        return asset_error_response(404, "invalid asset hash");
    }
    let query = parse_query(uri.query().unwrap_or(""));
    let project = query
        .iter()
        .find(|(key, _)| key == "project")
        .map(|(_, value)| value.clone());
    let mime = query
        .iter()
        .find(|(key, _)| key == "mime")
        .map(|(_, value)| value.clone())
        .map(|value| sanitize_mime(&value))
        .unwrap_or_else(|| "application/octet-stream".to_string());

    // The scope chain — the project sidecar first, the inbox as the
    // fallback (the exact [sidecar, inbox] semantics of the web routes).
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(project_path) = project {
        let sidecar = PathBuf::from(format!("{}.assets", project_path));
        if is_sidecar_dir(&sidecar) {
            candidates.push(sidecar.join(&hash));
        }
    }
    candidates.push(inbox_dir(app).join(&hash));

    let file_path = match candidates
        .iter()
        .find(|candidate| candidate.is_file())
    {
        Some(path) => path.clone(),
        None => return asset_error_response(404, "asset not found"),
    };
    let size = match fs::metadata(&file_path) {
        Ok(meta) => meta.len(),
        Err(_) => return asset_error_response(404, "asset not found"),
    };
    if size == 0 {
        return build_asset_response(200, &mime, 0, Vec::new(), None);
    }

    // Range: `bytes=<start>-[<end>]`. Open-ended ends are capped at
    // RESPONSE_SLICE_CAP; explicit ends are honoured (clamped to EOF).
    // Suffix ranges (`bytes=-N`) are not the media-element dialect —
    // they fall back to a full 200.
    let range = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_range);
    let (start, end, partial) = match range {
        Some((start, end)) => {
            if start >= size {
                return range_not_satisfiable(size);
            }
            let clamped_end = match end {
                Some(end) => end.min(size - 1),
                None => (start + RESPONSE_SLICE_CAP - 1).min(size - 1),
            };
            (start, clamped_end, true)
        }
        None => (0, size - 1, false),
    };

    let length = end - start + 1;
    let body = match read_slice(&file_path, start, length) {
        Some(body) => body,
        None => return asset_error_response(500, "asset read failed"),
    };
    // HEAD requests (probes) get the headers without the body.
    let body = if request.method().as_str() == "HEAD" {
        Vec::new()
    } else {
        body
    };
    let content_range = if partial {
        Some(format!("bytes {}-{}/{}", start, end, size))
    } else {
        None
    };
    build_asset_response(if partial { 206 } else { 200 }, &mime, length, body, content_range)
}

/// Parses `bytes=<start>-[<end>]` (the media-element dialect).
fn parse_range(header: &str) -> Option<(u64, Option<u64>)> {
    let value = header.trim().strip_prefix("bytes=")?;
    let (start_raw, end_raw) = value.split_once('-')?;
    let start: u64 = start_raw.parse().ok()?;
    let end = if end_raw.is_empty() {
        None
    } else {
        Some(end_raw.parse::<u64>().ok()?)
    };
    Some((start, end))
}

/// Reads one bounded slice of a file (the whole slice or nothing).
fn read_slice(path: &Path, start: u64, length: u64) -> Option<Vec<u8>> {
    let mut file = fs::File::open(path).ok()?;
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer).ok()?;
    Some(buffer)
}

/// rename() fallback for cross-volume relocations.
fn copy_and_remove(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::copy(source, target).map(|_| ())?;
    fs::remove_file(source)
}

/// Parses a query string (`k=v&k2=v2` — `+` means a space, `%XX` decoded).
fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| match pair.split_once('=') {
            Some((key, value)) => (url_decode(key), url_decode(value)),
            None => (url_decode(pair), String::new()),
        })
        .collect()
}

/// Percent-decodes one query token (`+` becomes a space).
fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' => {
                if index + 2 < bytes.len() {
                    if let (Some(high), Some(low)) =
                        (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
                    {
                        out.push(high * 16 + low);
                        index += 3;
                        continue;
                    }
                }
                out.push(b'%');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One hex digit's value.
fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Header values must be visible ASCII without separators — anything
/// else degrades to the safe default.
fn sanitize_mime(candidate: &str) -> String {
    if !candidate.is_empty()
        && candidate
            .bytes()
            .all(|byte| (32..127).contains(&byte))
    {
        candidate.to_string()
    } else {
        "application/octet-stream".to_string()
    }
}

/// Builds a streaming-friendly response: immutable caching (hash-named
/// content), explicit range acceptance, and the CORS headers the
/// WebView's same-origin `fetch` layer needs (pdf.js blob reads).
fn build_asset_response(
    status: u16,
    mime: &str,
    length: u64,
    body: Vec<u8>,
    content_range: Option<String>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Content-Length", length.to_string())
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header("Cache-Control", "public, max-age=31536000, immutable");
    if let Some(range_value) = content_range {
        builder = builder.header("Content-Range", range_value);
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// The 416 (Range Not Satisfiable) response with the size hint.
fn range_not_satisfiable(size: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(416)
        .header("Content-Range", format!("bytes */{}", size))
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// A tiny plain-text error response (404/500 — the canvas shows the
/// dashed placeholder; the text is for the DevTools network panel).
fn asset_error_response(status: u16, message: &str) -> Response<Vec<u8>> {
    let body = message.as_bytes().to_vec();
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}
