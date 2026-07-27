//! Wwise-style Godot integration.
//!
//! The desktop app links a Godot 4 project the way Wwise links a game
//! project: validate it (`project.godot` present), install the Loom
//! runtime addon into `addons/loom/`, optionally enable the editor plugin
//! (needed so exported PCKs include imported `.loombank` assets — the
//! runtime nodes themselves are plain `class_name` scripts and work with
//! the plugin disabled), and write compiled bank artifacts. Bank
//! compilation happens in the webview via `@loom/bank`; this module only
//! validates and touches disk.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

/// The Godot runtime addon, embedded at compile time from the canonical
/// source of truth in `engines/godot`.
static ADDON: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../engines/godot/addons/loom");

const PLUGIN_CFG_RES: &str = "res://addons/loom/plugin.cfg";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GodotProjectStatus {
    /// `config/name` out of project.godot, if declared.
    pub name: Option<String>,
    pub path: String,
    pub addon_installed: bool,
    /// `version=` out of the *installed* addon's plugin.cfg.
    pub addon_version: Option<String>,
    /// `version=` of the addon embedded in this app build.
    pub bundled_addon_version: Option<String>,
    pub plugin_enabled: bool,
    /// Every `.loombank` in the project (relative paths), newest first.
    pub banks: Vec<BankInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankInfo {
    pub path: String,
    pub modified_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    pub files_written: usize,
    pub plugin_enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BankArtifact {
    pub name: String,
    pub text: String,
}

fn cfg_string_value(source: &str, key: &str) -> Option<String> {
    // Godot .cfg / .godot files: `key="value"` lines (sections bracketed).
    source.lines().find_map(|line| {
        let line = line.trim();
        let rest = line.strip_prefix(key)?.trim_start();
        let rest = rest.strip_prefix('=')?.trim();
        let rest = rest.strip_prefix('"')?;
        Some(rest.strip_suffix('"')?.to_string())
    })
}

fn is_godot_project(dir: &Path) -> bool {
    dir.join("project.godot").is_file()
}

fn project_name(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join("project.godot")).ok()?;
    cfg_string_value(&text, "config/name")
}

fn addon_version_at(addon_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(addon_dir.join("plugin.cfg")).ok()?;
    cfg_string_value(&text, "version")
}

fn bundled_addon_version() -> Option<String> {
    let cfg = ADDON.get_file("plugin.cfg")?;
    cfg_string_value(cfg.contents_utf8()?, "version")
}

/// Insert `res://addons/loom/plugin.cfg` into project.godot's
/// `[editor_plugins] enabled=PackedStringArray(...)`, creating the section
/// or the key as needed. Returns the new text, or None if already enabled.
fn enable_plugin_text(source: &str) -> Option<String> {
    if source.contains(PLUGIN_CFG_RES) {
        return None;
    }
    let entry = format!("\"{PLUGIN_CFG_RES}\"");

    if let Some(section_pos) = source.find("[editor_plugins]") {
        let after_section = &source[section_pos..];
        if let Some(rel) = after_section.find("enabled=PackedStringArray(") {
            let open = section_pos + rel + "enabled=PackedStringArray(".len();
            let close = source[open..].find(')')? + open;
            let existing = source[open..close].trim();
            let inserted = if existing.is_empty() {
                entry
            } else {
                format!("{existing}, {entry}")
            };
            return Some(format!("{}{}{}", &source[..open], inserted, &source[close..]));
        }
        // Section exists but no `enabled=` key: add it right after the header.
        let header_end = section_pos + "[editor_plugins]".len();
        return Some(format!(
            "{}\n\nenabled=PackedStringArray({}){}",
            &source[..header_end],
            entry,
            &source[header_end..],
        ));
    }

    // No section: append one.
    let sep = if source.ends_with('\n') { "" } else { "\n" };
    Some(format!(
        "{source}{sep}\n[editor_plugins]\n\nenabled=PackedStringArray({entry})\n"
    ))
}

fn write_embedded_dir(dir: &Dir<'_>, dest: &Path, written: &mut usize) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for file in dir.files() {
        let name = file
            .path()
            .file_name()
            .ok_or_else(|| "embedded file with no name".to_string())?;
        fs::write(dest.join(name), file.contents()).map_err(|e| e.to_string())?;
        *written += 1;
    }
    for sub in dir.dirs() {
        let name = sub
            .path()
            .file_name()
            .ok_or_else(|| "embedded dir with no name".to_string())?;
        write_embedded_dir(sub, &dest.join(name), written)?;
    }
    Ok(())
}

fn collect_banks(dir: &Path, root: &Path, out: &mut Vec<BankInfo>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            // Skip Godot's import cache, hidden dirs, and the addon itself.
            if name.starts_with('.') || name == "addons" {
                continue;
            }
            collect_banks(&path, root, out);
        } else if name.ends_with(".loombank") {
            let modified = fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            out.push(BankInfo {
                path: rel,
                modified_ms: modified,
            });
        }
    }
}

fn status_of(dir: &Path) -> Result<GodotProjectStatus, String> {
    if !is_godot_project(dir) {
        return Err(format!(
            "{} is not a Godot project (no project.godot)",
            dir.display()
        ));
    }
    let addon_dir = dir.join("addons").join("loom");
    let project_text = fs::read_to_string(dir.join("project.godot")).unwrap_or_default();
    let mut banks = Vec::new();
    collect_banks(dir, dir, &mut banks);
    banks.sort_by(|a, b| b.modified_ms.total_cmp(&a.modified_ms));
    Ok(GodotProjectStatus {
        name: project_name(dir),
        path: dir.to_string_lossy().into_owned(),
        addon_installed: addon_dir.join("plugin.cfg").is_file(),
        addon_version: addon_version_at(&addon_dir),
        bundled_addon_version: bundled_addon_version(),
        plugin_enabled: project_text.contains(PLUGIN_CFG_RES),
        banks,
    })
}

/// Pick a Godot project folder. Errors if the picked folder has no
/// project.godot; returns None on cancel.
#[tauri::command]
pub async fn godot_pick_project(
    app: tauri::AppHandle,
) -> Result<Option<GodotProjectStatus>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    status_of(&path).map(Some)
}

#[tauri::command]
pub fn godot_project_status(path: String) -> Result<GodotProjectStatus, String> {
    status_of(Path::new(&path))
}

/// Copy the embedded addon into `<project>/addons/loom` (overwriting any
/// previous install) and optionally enable the editor plugin.
#[tauri::command]
pub fn godot_install_addon(path: String, enable_plugin: bool) -> Result<InstallReport, String> {
    let project = PathBuf::from(&path);
    if !is_godot_project(&project) {
        return Err(format!("{path} is not a Godot project (no project.godot)"));
    }
    let mut files_written = 0usize;
    write_embedded_dir(&ADDON, &project.join("addons").join("loom"), &mut files_written)?;

    let mut plugin_enabled = false;
    let godot_cfg = project.join("project.godot");
    let text = fs::read_to_string(&godot_cfg).map_err(|e| e.to_string())?;
    if text.contains(PLUGIN_CFG_RES) {
        plugin_enabled = true;
    } else if enable_plugin {
        if let Some(updated) = enable_plugin_text(&text) {
            fs::write(&godot_cfg, updated).map_err(|e| e.to_string())?;
            plugin_enabled = true;
        }
    }
    Ok(InstallReport {
        files_written,
        plugin_enabled,
    })
}

/// Write compiled bank artifacts under `<project>/<subdir>/`. Artifact
/// names must be bare file names — the webview chooses them, the host
/// refuses anything path-shaped.
#[tauri::command]
pub fn godot_write_banks(
    path: String,
    subdir: String,
    files: Vec<BankArtifact>,
) -> Result<Vec<String>, String> {
    let project = PathBuf::from(&path);
    if !is_godot_project(&project) {
        return Err(format!("{path} is not a Godot project (no project.godot)"));
    }
    let clean_subdir = subdir.trim().trim_matches('/');
    if clean_subdir.split('/').any(|seg| seg.is_empty() || seg == ".." || seg == ".") {
        return Err(format!("bad bank folder `{subdir}`"));
    }
    let out_dir = project.join(clean_subdir);
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let mut written = Vec::new();
    for artifact in files {
        if artifact.name.contains('/') || artifact.name.contains('\\') || artifact.name.starts_with('.') {
            return Err(format!("bad artifact name `{}`", artifact.name));
        }
        let dest = out_dir.join(&artifact.name);
        fs::write(&dest, artifact.text).map_err(|e| e.to_string())?;
        written.push(format!("{clean_subdir}/{}", artifact.name));
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_addon_is_complete() {
        // The compile-time embed must carry the plugin manifest, the
        // runtime entry points, and the sub-trees.
        assert!(ADDON.get_file("plugin.cfg").is_some());
        assert!(ADDON.get_file("loom_runtime.gd").is_some());
        assert!(ADDON.get_file("loom_story.gd").is_some());
        assert!(ADDON.get_file("loom_dialogue_box.gd").is_some());
        assert!(ADDON.get_dir("styles").is_some());
        assert!(ADDON.get_dir("icons").is_some());
        assert!(bundled_addon_version().is_some());
    }

    #[test]
    fn cfg_value_parses_quoted_assignments() {
        let cfg = "[plugin]\nname=\"Loom\"\nversion=\"0.1.0\"\n";
        assert_eq!(cfg_string_value(cfg, "version").as_deref(), Some("0.1.0"));
        assert_eq!(cfg_string_value(cfg, "name").as_deref(), Some("Loom"));
        assert_eq!(cfg_string_value(cfg, "script"), None);
    }

    #[test]
    fn enable_plugin_appends_section_when_missing() {
        let src = "config_version=5\n\n[application]\n\nconfig/name=\"Game\"\n";
        let out = enable_plugin_text(src).unwrap();
        assert!(out.contains("[editor_plugins]"));
        assert!(out.contains("enabled=PackedStringArray(\"res://addons/loom/plugin.cfg\")"));
        // Untouched prefix.
        assert!(out.starts_with(src));
    }

    #[test]
    fn enable_plugin_extends_existing_array() {
        let src = "config_version=5\n\n[editor_plugins]\n\nenabled=PackedStringArray(\"res://addons/other/plugin.cfg\")\n";
        let out = enable_plugin_text(src).unwrap();
        assert!(out.contains(
            "enabled=PackedStringArray(\"res://addons/other/plugin.cfg\", \"res://addons/loom/plugin.cfg\")"
        ));
    }

    #[test]
    fn enable_plugin_fills_empty_array_and_bare_section() {
        let empty = "[editor_plugins]\n\nenabled=PackedStringArray()\n";
        let out = enable_plugin_text(empty).unwrap();
        assert!(out.contains("enabled=PackedStringArray(\"res://addons/loom/plugin.cfg\")"));

        let bare = "[editor_plugins]\n";
        let out = enable_plugin_text(bare).unwrap();
        assert!(out.contains("enabled=PackedStringArray(\"res://addons/loom/plugin.cfg\")"));
    }

    #[test]
    fn enable_plugin_is_idempotent() {
        let src = "[editor_plugins]\n\nenabled=PackedStringArray(\"res://addons/loom/plugin.cfg\")\n";
        assert!(enable_plugin_text(src).is_none());
    }
}
