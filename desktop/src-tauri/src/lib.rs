//! Loom desktop — Tauri shell around the `editor` web app.
//!
//! Two command surfaces:
//! - `fs_bridge`: a path-based filesystem bridge. WKWebView has no File
//!   System Access API, so the editor's local-folder backend runs on a
//!   handle-shaped shim (`editor/src/lib/desktop-fs.ts`) that forwards to
//!   these commands.
//! - `godot`: Wwise-style game-engine integration — link a Godot 4
//!   project, install the embedded `addons/loom` runtime into it, and
//!   write compiled `.loombank` + `LoomIDs.gd` artifacts (the webview
//!   compiles banks with `@loom/bank`; the host only touches disk).

mod fs_bridge;
mod godot;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fs_bridge::fs_pick_folder,
            fs_bridge::fs_list,
            fs_bridge::fs_read_file,
            fs_bridge::fs_write_text,
            fs_bridge::fs_touch,
            fs_bridge::fs_create_dir,
            fs_bridge::fs_remove,
            fs_bridge::fs_rename,
            fs_bridge::fs_stat,
            fs_bridge::reveal_path,
            godot::godot_pick_project,
            godot::godot_project_status,
            godot::godot_install_addon,
            godot::godot_write_banks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Loom desktop");
}
