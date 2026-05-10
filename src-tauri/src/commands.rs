use crate::exif;
use crate::models::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct AppState {
    pub file_list: Mutex<Vec<FileEntry>>,
    pub rename_state: Mutex<RenameState>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            file_list: Mutex::new(Vec::new()),
            rename_state: Mutex::new(RenameState::new()),
        }
    }
}

#[tauri::command]
pub fn add_files(paths: Vec<String>, app_state: tauri::State<AppState>) -> Result<Vec<FileEntry>, String> {
    let mut file_list = app_state.file_list.lock().map_err(|e| e.to_string())?;
    let mut rename_state = app_state.rename_state.lock().map_err(|e| e.to_string())?;
    let mut new_entries = Vec::new();

    for path_str in paths {
        let path = PathBuf::from(&path_str);
        if !path.exists() || !path.is_file() {
            continue;
        }
        if !is_photo_file(&path) {
            continue;
        }

        let already_exists = file_list.iter().any(|e| e.path == path_str);
        if already_exists {
            continue;
        }

        rename_state.record_original(&path_str);

        let exif_info = exif::read_exif_info(&path);
        let filename = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        let entry = FileEntry {
            path: path_str,
            filename,
            shooting_time: exif_info.shooting_time,
            camera_model: exif_info.camera_model,
            lens: exif_info.lens,
            new_filename: exif_info.new_filename,
            final_filename: String::new(),
            status: "等待处理".to_string(),
        };

        new_entries.push(entry.clone());
        file_list.push(entry);
    }

    compute_final_filenames(&mut file_list);
    for (i, entry) in new_entries.iter_mut().enumerate() {
        if i < file_list.len() {
            entry.final_filename = file_list[i].final_filename.clone();
        }
    }

    Ok(new_entries)
}

#[tauri::command]
pub fn add_folder(folder_path: String, app_state: tauri::State<AppState>) -> Result<Vec<FileEntry>, String> {
    let folder = Path::new(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err("文件夹不存在".to_string());
    }

    let photo_files = get_photo_files_from_folder(folder);
    let paths: Vec<String> = photo_files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    add_files(paths, app_state)
}

#[tauri::command]
pub fn get_preview(file_path: String) -> Result<PreviewData, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    let is_raw = exif::is_raw_file(path);

    if is_raw {
        let image_base64 = exif::generate_preview_base64(path).unwrap_or_default();
        let file_info = get_file_info(path);
        let exif_detail = exif::read_exif_detail(path);

        Ok(PreviewData {
            preview_type: "base64".to_string(),
            asset_url: String::new(),
            image_base64,
            file_info,
            exif_detail,
        })
    } else {
        let asset_url = format!(
            "http://asset.localhost/{}",
            urlencoding::encode(&file_path)
        );
        let file_info = get_file_info(path);
        let exif_detail = exif::read_exif_detail(path);

        Ok(PreviewData {
            preview_type: "asset".to_string(),
            asset_url,
            image_base64: String::new(),
            file_info,
            exif_detail,
        })
    }
}

#[tauri::command]
pub fn rename_files(app_state: tauri::State<AppState>) -> Result<HashMap<String, String>, String> {
    let mut file_list = app_state.file_list.lock().map_err(|e| e.to_string())?;
    let mut rename_state = app_state.rename_state.lock().map_err(|e| e.to_string())?;

    compute_final_filenames(&mut file_list);

    let mut results = HashMap::new();
    let mut success_count = 0u32;
    let mut error_count = 0u32;

    for i in 0..file_list.len() {
        let path_str = file_list[i].path.clone();
        let final_filename = file_list[i].final_filename.clone();
        let path = PathBuf::from(&path_str);

        if final_filename == "无法生成" || final_filename.is_empty() {
            error_count += 1;
            file_list[i].status = "失败: 无EXIF信息".to_string();
            results.insert(path_str, "失败: 无EXIF信息".to_string());
            continue;
        }

        let current_filename = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        if current_filename == final_filename {
            success_count += 1;
            file_list[i].status = "已符合".to_string();
            results.insert(path_str, "已符合".to_string());
            continue;
        }

        let directory = path.parent().unwrap_or(Path::new("."));
        let new_path = directory.join(&final_filename);

        if new_path == path {
            success_count += 1;
            file_list[i].status = "已符合".to_string();
            results.insert(path_str, "已符合".to_string());
            continue;
        }

        if new_path.exists() {
            error_count += 1;
            file_list[i].status = format!("失败: 目标文件已存在 {}", final_filename);
            results.insert(path_str, format!("失败: 目标文件已存在"));
            continue;
        }

        match fs::rename(&path, &new_path) {
            Ok(_) => {
                let new_path_str = new_path.to_string_lossy().to_string();
                rename_state.update_path(&path_str, &new_path_str);

                success_count += 1;
                file_list[i].status = "成功".to_string();
                results.insert(path_str, "成功".to_string());

                file_list[i].path = new_path_str;
                file_list[i].filename = final_filename;
            }
            Err(e) => {
                error_count += 1;
                file_list[i].status = format!("失败: {}", e);
                results.insert(path_str, format!("失败: {}", e));
            }
        }
    }

    results.insert(
        "_summary".to_string(),
        format!("成功 {} 个, 失败 {} 个", success_count, error_count),
    );

    Ok(results)
}

#[tauri::command]
pub fn undo_rename(app_state: tauri::State<AppState>) -> Result<HashMap<String, String>, String> {
    let mut file_list = app_state.file_list.lock().map_err(|e| e.to_string())?;
    let rename_state = app_state.rename_state.lock().map_err(|e| e.to_string())?;

    let mut results = HashMap::new();
    let mut success_count = 0u32;
    let mut error_count = 0u32;

    for i in 0..file_list.len() {
        let path_str = file_list[i].path.clone();
        let current_path = PathBuf::from(&path_str);
        let current_filename = current_path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        let original_filename = rename_state
            .get_original(&path_str)
            .cloned()
            .unwrap_or(current_filename.clone());

        if current_filename == original_filename {
            file_list[i].status = "无需撤销".to_string();
            continue;
        }

        let directory = current_path.parent().unwrap_or(Path::new("."));
        let original_path = directory.join(&original_filename);

        if original_path.exists() {
            error_count += 1;
            file_list[i].status = "撤销失败：文件名已存在".to_string();
            results.insert(path_str, "撤销失败：文件名已存在".to_string());
            continue;
        }

        match fs::rename(&current_path, &original_path) {
            Ok(_) => {
                success_count += 1;
                let original_path_str = original_path.to_string_lossy().to_string();
                file_list[i].path = original_path_str;
                file_list[i].status = "已撤销".to_string();
                results.insert(path_str, "已撤销".to_string());
            }
            Err(e) => {
                error_count += 1;
                file_list[i].status = format!("撤销失败：{}", e);
                results.insert(path_str, format!("撤销失败：{}", e));
            }
        }
    }

    results.insert(
        "_summary".to_string(),
        format!("成功 {} 个, 失败 {} 个", success_count, error_count),
    );

    Ok(results)
}

#[tauri::command]
pub fn refresh_files(app_state: tauri::State<AppState>) -> Result<Vec<FileEntry>, String> {
    let mut file_list = app_state.file_list.lock().map_err(|e| e.to_string())?;

    for entry in file_list.iter_mut() {
        let path = PathBuf::from(&entry.path);
        entry.filename = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let exif_info = exif::read_exif_info(&path);
        entry.shooting_time = exif_info.shooting_time;
        entry.camera_model = exif_info.camera_model;
        entry.lens = exif_info.lens;
        entry.new_filename = exif_info.new_filename;
        entry.status = "等待处理".to_string();
    }

    compute_final_filenames(&mut file_list);

    Ok(file_list.clone())
}

#[tauri::command]
pub fn clear_list(app_state: tauri::State<AppState>) -> Result<(), String> {
    let mut file_list = app_state.file_list.lock().map_err(|e| e.to_string())?;
    let mut rename_state = app_state.rename_state.lock().map_err(|e| e.to_string())?;

    file_list.clear();
    rename_state.original_names.clear();

    Ok(())
}

#[tauri::command]
pub fn get_file_list(app_state: tauri::State<AppState>) -> Result<Vec<FileEntry>, String> {
    let file_list = app_state.file_list.lock().map_err(|e| e.to_string())?;
    Ok(file_list.clone())
}

#[tauri::command]
pub fn remove_file(index: usize, app_state: tauri::State<AppState>) -> Result<(), String> {
    let mut file_list = app_state.file_list.lock().map_err(|e| e.to_string())?;
    let mut rename_state = app_state.rename_state.lock().map_err(|e| e.to_string())?;

    if index >= file_list.len() {
        return Err("索引超出范围".to_string());
    }

    let entry = &file_list[index];
    rename_state.original_names.remove(&entry.path);
    file_list.remove(index);

    compute_final_filenames(&mut file_list);

    Ok(())
}
