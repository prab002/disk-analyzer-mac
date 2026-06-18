// Disk Analyzer — Rust backend
// Scans the filesystem in parallel, builds a size tree, and supports
// safe deletion (move to Trash) and revealing files in Finder.

use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// How many levels deep we actually serialize and ship to the frontend.
/// Sizes are still totaled for the *full* depth below this — we just stop
/// retaining individual `Node`s past here so a Home-directory scan can't
/// build a multi-gigabyte tree and freeze the machine. Deeper folders are
/// re-scanned on demand when the user zooms in.
const MAX_TREE_DEPTH: usize = 6;
/// Don't ship entries smaller than this; they can never render in the treemap
/// and dominate the node count. Their bytes are still counted in the parent.
const MIN_NODE_BYTES: u64 = 64 * 1024; // 64 KiB
/// Hard cap on children retained per directory, to bound breadth (a folder
/// with a million same-sized files would otherwise still explode).
const MAX_CHILDREN: usize = 500;

/// A node in the file/directory size tree sent to the frontend.
#[derive(Serialize)]
struct Node {
    name: String,
    path: String,
    size: u64,
    is_dir: bool,
    /// Number of files contained (1 for a file). Useful for stats.
    file_count: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<Node>,
}

/// Total the size and file count under `path` without retaining any per-entry
/// `Node`s. Used once we pass `MAX_TREE_DEPTH` so deep trees contribute
/// accurate sizes without allocating (and shipping) a node per file.
fn dir_totals(path: &Path) -> (u64, u64) {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    // Symlinks and regular files count as themselves.
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return (meta.len(), 1);
    }
    let entries: Vec<PathBuf> = match fs::read_dir(path) {
        Ok(rd) => rd.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
        Err(_) => Vec::new(),
    };
    entries
        .par_iter()
        .map(|p| dir_totals(p))
        .reduce(|| (0, 0), |a, b| (a.0 + b.0, a.1 + b.1))
}

/// Recursively build a size tree for `path`, retaining nodes only down to
/// `depth` levels.
/// - Symlinks are NOT followed (counted as their own small size) to avoid
///   loops and double-counting.
/// - Directories are walked in parallel via rayon.
/// - Unreadable entries are skipped rather than failing the whole scan.
/// - Sizes/counts are accurate for the full subtree; only the retained
///   (shipped) children are bounded by depth, `MIN_NODE_BYTES`, `MAX_CHILDREN`.
fn build_tree(path: &Path, depth: usize) -> Option<Node> {
    let meta = fs::symlink_metadata(path).ok()?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let path_str = path.to_string_lossy().into_owned();

    // Don't follow symlinks.
    if meta.file_type().is_symlink() {
        return Some(Node {
            name,
            path: path_str,
            size: meta.len(),
            is_dir: false,
            file_count: 1,
            children: Vec::new(),
        });
    }

    if meta.is_dir() {
        // Past the serialization depth: total sizes but retain no children.
        // The folder stays explorable — the frontend re-scans it on zoom.
        if depth == 0 {
            let (size, file_count) = dir_totals(path);
            return Some(Node {
                name,
                path: path_str,
                size,
                is_dir: true,
                file_count,
                children: Vec::new(),
            });
        }

        let entries: Vec<PathBuf> = match fs::read_dir(path) {
            Ok(rd) => rd.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
            Err(_) => Vec::new(), // permission denied etc. — treat as empty
        };

        let mut children: Vec<Node> = entries
            .par_iter()
            .filter_map(|p| build_tree(p, depth - 1))
            .collect();

        // Largest first — matches how the UI wants to render.
        children.sort_by(|a, b| b.size.cmp(&a.size));

        // Totals reflect ALL children, computed before we prune below.
        let size = children.iter().map(|c| c.size).sum();
        let file_count = children.iter().map(|c| c.file_count).sum();

        // Bound the payload: drop entries too small to ever render and cap how
        // many we ship. Their bytes are already in `size`/`file_count` above.
        children.retain(|c| c.size >= MIN_NODE_BYTES);
        children.truncate(MAX_CHILDREN);

        Some(Node {
            name,
            path: path_str,
            size,
            is_dir: true,
            file_count,
            children,
        })
    } else {
        Some(Node {
            name,
            path: path_str,
            size: meta.len(),
            is_dir: false,
            file_count: 1,
            children: Vec::new(),
        })
    }
}

/// Scan a directory and return its size tree.
/// Runs on a blocking worker thread so the heavy filesystem walk never freezes
/// the UI thread (which would show the macOS "beachball" cursor).
#[tauri::command]
async fn scan_directory(path: String) -> Result<Node, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.exists() {
            return Err(format!("Path does not exist: {path}"));
        }
        build_tree(&p, MAX_TREE_DEPTH).ok_or_else(|| format!("Failed to scan: {path}"))
    })
    .await
    .map_err(|e| format!("Scan task failed: {e}"))?
}

/// Move the given paths to the Trash (recoverable). Returns bytes freed.
/// Off the UI thread — sizing a large folder before trashing can be slow.
#[tauri::command]
async fn delete_to_trash(paths: Vec<String>) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut freed = 0u64;
        for path in &paths {
            let p = Path::new(path);
            // Compute size before deletion so we can report freed space.
            // Use dir_totals (no node allocation) — we only need the byte count.
            let (size, _) = dir_totals(p);
            freed += size;
            trash::delete(p).map_err(|e| format!("Failed to trash {path}: {e}"))?;
        }
        Ok(freed)
    })
    .await
    .map_err(|e| format!("Delete task failed: {e}"))?
}

/// Open Finder with the file selected.
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Return the user's home directory (handy default scan target).
#[tauri::command]
fn home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Best-effort probe for Full Disk Access. Several locations under
/// `~/Library` are readable *only* when the app has Full Disk Access, so if we
/// can read one of them we treat FDA as granted. This lets the UI ask for the
/// permission a single time (one grant covers every folder + subfolder) instead
/// of macOS prompting per protected folder.
#[tauri::command]
fn has_full_disk_access() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    // The TCC database itself is only readable with Full Disk Access.
    if fs::File::open(home.join("Library/Application Support/com.apple.TCC/TCC.db")).is_ok() {
        return true;
    }
    // Fallbacks — both are FDA-protected directories.
    fs::read_dir(home.join("Library/Safari")).is_ok()
        || fs::read_dir(home.join("Library/Mail")).is_ok()
}

/// Open System Settings directly at the Full Disk Access pane so the user can
/// grant access once. (macOS applies the change after the app is relaunched.)
#[tauri::command]
fn open_full_disk_access_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            delete_to_trash,
            reveal_in_finder,
            home_dir,
            has_full_disk_access,
            open_full_disk_access_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
