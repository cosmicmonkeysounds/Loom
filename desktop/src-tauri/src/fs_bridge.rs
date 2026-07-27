//! Path-based filesystem commands backing the editor's desktop FS shim.
//!
//! The shim mirrors the File System Access API surface the editor already
//! uses (`lib/fs.ts`), so paths here are absolute paths the user granted by
//! picking a folder through the native dialog.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
    pub text: String,
    pub modified_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatInfo {
    pub exists: bool,
    pub is_dir: bool,
    pub modified_ms: f64,
}

fn modified_ms(path: &Path) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Native folder picker. Returns the absolute path, or None on cancel.
#[tauri::command]
pub async fn fs_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    match picked {
        Some(path) => {
            let path = path.into_path().map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn fs_list(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| format!("{path}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn fs_read_file(path: String) -> Result<FileContents, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(FileContents {
        text,
        modified_ms: modified_ms(Path::new(&path)),
    })
}

#[tauri::command]
pub fn fs_write_text(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// Create an empty file if none exists (FSA `getFileHandle(create: true)`).
#[tauri::command]
pub fn fs_touch(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Ok(());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, "").map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_remove(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    let result = if p.is_dir() {
        if recursive {
            fs::remove_dir_all(p)
        } else {
            fs::remove_dir(p)
        }
    } else {
        fs::remove_file(p)
    };
    result.map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|e| format!("{from} -> {to}: {e}"))
}

#[tauri::command]
pub fn fs_stat(path: String) -> Result<StatInfo, String> {
    let p = Path::new(&path);
    Ok(StatInfo {
        exists: p.exists(),
        is_dir: p.is_dir(),
        modified_ms: modified_ms(p),
    })
}

/// Reveal a path in the platform file manager (Finder / Explorer / …).
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(PathBuf::from(&path)).map_err(|e| e.to_string())
}
