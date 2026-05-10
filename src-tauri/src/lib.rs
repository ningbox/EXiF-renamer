mod commands;
mod exif;
mod models;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::add_files,
            commands::add_folder,
            commands::get_preview,
            commands::rename_files,
            commands::undo_rename,
            commands::refresh_files,
            commands::clear_list,
            commands::get_file_list,
            commands::remove_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
